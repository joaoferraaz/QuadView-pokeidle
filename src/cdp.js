// Ponte com o navegador pela porta de depuracao, no lugar de uma extensao instalada em cada perfil.
// Regra da casa: nada de Runtime.enable nem Log.enable. Esses ligam o relato de console e excecoes,
// que e justamente o rastro que uma pagina consegue perceber. Page.enable e necessario (sem ele o
// script injetado e aceito mas nunca roda, foi medido) e so liga eventos de ciclo de vida da pagina.
const http = require('http');
const crypto = require('crypto');

const pegarJSON = (porta, caminho) => new Promise((resolve, reject) => {
  const req = http.get({ host: '127.0.0.1', port: porta, path: caminho, timeout: 3000 }, (res) => {
    let corpo = '';
    res.on('data', (c) => { corpo += c; });
    res.on('end', () => { try { resolve(JSON.parse(corpo)); } catch (e) { reject(e); } });
  });
  req.on('timeout', () => { req.destroy(new Error('sem resposta')); });
  req.on('error', reject);
});

const fs = require('fs');
const path = require('path');

// O observador vive em arquivo proprio (src/observador.js) e so troco a marca da chave.
let fonteCrua = null;
function fonteDoObservador(chave) {
  if (fonteCrua === null) fonteCrua = fs.readFileSync(path.join(__dirname, 'observador.js'), 'utf8');
  return fonteCrua.split('__QV_CHAVE__').join(chave);
}

class Sessao {
  constructor(porta) {
    this.porta = porta;
    this.chave = '__' + crypto.randomBytes(6).toString('hex');
    this.ws = null;
    this.seq = 0;
    this.esperando = new Map();
    this.alvo = null;
    this.ligada = false;
    this.ultimoErro = '';
    this.pageLigado = false;
    this.scriptRegistrado = false;
  }

  async conectar(filtroDeUrl) {
    if (!this.ws || this.ws.readyState !== 1) {
      const aberto = await this.abrirCanal(filtroDeUrl);
      if (!aberto) return false;
    }
    // Injeto para as proximas navegacoes e tambem na pagina que ja esta aberta.
    if (!this.pageLigado) { await this.enviar('Page.enable'); this.pageLigado = true; }
    if (!this.scriptRegistrado) {
      const r = await this.enviar('Page.addScriptToEvaluateOnNewDocument', { source: fonteDoObservador(this.chave) });
      this.scriptRegistrado = !!(r && r.identifier);
    }
    await this.avaliar(fonteDoObservador(this.chave));
    // A prova de que a ponte esta de pe e conseguir ler o estado, nao o canal estar aberto.
    const teste = await this.chamar('estado');
    this.ligada = !!(teste && teste.url);
    if (!this.ligada) this.ultimoErro = 'canal aberto mas sem estado';
    return this.ligada;
  }

  async abrirCanal(filtroDeUrl) {
    let lista;
    try { lista = await pegarJSON(this.porta, '/json/list'); } catch (e) { this.ultimoErro = 'porta ' + this.porta + ': ' + e.message; return false; }
    const paginas = lista.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    const alvo = paginas.find((t) => !filtroDeUrl || String(t.url).includes(filtroDeUrl)) || paginas[0];
    if (!alvo) { this.ultimoErro = 'sem página no navegador'; return false; }

    await new Promise((resolve) => {
      const ws = new WebSocket(alvo.webSocketDebuggerUrl);
      const pronto = setTimeout(() => resolve(), 5000);
      ws.onopen = () => { clearTimeout(pronto); this.ws = ws; this.alvo = alvo.id; resolve(); };
      ws.onerror = () => { clearTimeout(pronto); resolve(); };
      // Canal novo e sessao nova no navegador: tudo que foi registrado no canal antigo morreu com ele
      // (Page.enable, observador, extensoes), entao zero as marcas para registrar de novo.
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null; this.ligada = false;
        this.pageLigado = false; this.scriptRegistrado = false; this.extensoes = null;
      };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
        const cb = this.esperando.get(m.id);
        if (cb) { this.esperando.delete(m.id); cb(m); }
      };
    });
    return !!this.ws;
  }

  enviar(method, params = {}) {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState !== 1) return resolve(null);
      const id = ++this.seq;
      // Desarmo o relogio quando a resposta chega. Com uma leitura de estado a cada 5 s por painel,
      // deixar temporizadores de 8 s vivos so acumulava trabalho para o laco de eventos.
      const relogio = setTimeout(() => { if (this.esperando.delete(id)) resolve(null); }, 8000);
      this.esperando.set(id, (m) => { clearTimeout(relogio); resolve(m.result || null); });
      try { this.ws.send(JSON.stringify({ id, method, params })); } catch (_) { clearTimeout(relogio); resolve(null); }
    });
  }

  async avaliar(expressao) {
    const r = await this.enviar('Runtime.evaluate', {
      expression: expressao, returnByValue: true, awaitPromise: true, userGesture: true,
    });
    if (!r || !r.result) return null;
    return r.result.value;
  }

  chamar(metodo, ...args) {
    const lista = args.map((a) => JSON.stringify(a)).join(',');
    return this.avaliar(`window[${JSON.stringify(this.chave)}] && window[${JSON.stringify(this.chave)}].${metodo}(${lista})`);
  }

  // Extensoes (userscripts) entram como scripts de inicio de documento, depois do observador. Guardo
  // o identificador de cada uma para conseguir retirar quando a pessoa desliga. Vale a partir do
  // proximo carregamento da pagina: script que ja rodou nao tem como ser "desrodado".
  async sincronizarExtensoes(lista) {
    if (!this.extensoes) this.extensoes = new Map(); // id -> { identificador, marca }
    let mudou = false;
    const querida = new Map(lista.map((e) => [e.id, e]));
    for (const [id, reg] of [...this.extensoes]) {
      const nova = querida.get(id);
      if (nova && nova.marca === reg.marca) continue;
      await this.enviar('Page.removeScriptToEvaluateOnNewDocument', { identifier: reg.identificador });
      this.extensoes.delete(id);
      mudou = true;
    }
    for (const e of lista) {
      if (this.extensoes.has(e.id)) continue;
      const r = await this.enviar('Page.addScriptToEvaluateOnNewDocument', { source: e.fonte });
      // Guardo so a marca (hash) da fonte, nao a fonte: com seis paineis, uma copia de cada script
      // por painel era alguns megabytes parados na memoria do processo principal.
      if (r && r.identifier) { this.extensoes.set(e.id, { identificador: r.identifier, marca: e.marca }); mudou = true; }
    }
    return mudou;
  }

  estado() { return this.chamar('estado'); }
  recarregar(semCache) { return this.enviar('Page.reload', { ignoreCache: !!semCache }); }
  navegar(url) { return this.enviar('Page.navigate', { url }); }
  fechar() {
    try { if (this.ws) this.ws.close(); } catch (_) {}
    this.ws = null; this.ligada = false; this.pageLigado = false; this.scriptRegistrado = false;
    this.extensoes = null;
  }
}

module.exports = { Sessao };

// Extensoes: scripts de usuario (userscripts) que o app carrega nos paineis do jogo, fazendo o papel
// de um Tampermonkey. Nada de extensao instalada no navegador: a injecao vai pela mesma porta de
// depuracao que o resto do app usa.
//
// Regras da casa:
// 1. O codigo de terceiros NAO vem dentro do exe. O app baixa do repositorio do autor, como qualquer
//    gerenciador de userscript, e guarda a copia em disco.
// 2. Versao fixa. Esse codigo roda dentro das sessoes logadas das contas, entao o que esta no disco
//    so muda quando a pessoa clica em atualizar. Mudanca no repositorio nao entra sozinha.
// 3. So aceita script "@grant none": e JavaScript puro de pagina. Script que pede GM_* precisa de
//    APIs que o app nao oferece e rodaria quebrado.
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const CATALOGO = [
  {
    id: 'piw-qol',
    nome: 'PIW-QOL',
    autor: 'Desjunior (JulianoCLI)',
    descricao: 'Mapa em lista com filtros, efetividade de tipo, preview de drops, hunts favoritas com teleporte rápido, '
      + 'mercado global, confirmação de venda, trava de itens e compra de bolas em lote.',
    pagina: 'https://github.com/JulianoCLI/PIW-QOL',
    url: 'https://raw.githubusercontent.com/JulianoCLI/PIW-QOL/main/piw-qol.user.js',
  },
  {
    id: 'justpokedex',
    nome: 'JustPokedex',
    autor: 'guilherme-se',
    descricao: 'Lê os dados dos Pokémon e estima IVs, detector e histórico de shinies com alerta sonoro, análise de golpes e dano, '
      + 'navegador de itens e drops, tabela de tipos, mercado global, lojas e depot portáteis.',
    pagina: 'https://github.com/guilherme-se/justpokedex',
    url: 'https://raw.githubusercontent.com/guilherme-se/justpokedex/main/JustPokedex.js',
  },
];
const HOSTS_PERMITIDOS = ['raw.githubusercontent.com'];
const TAMANHO_MAXIMO = 3 * 1024 * 1024;

let pasta = null;
let estado = {}; // id -> { ativa, versao, sha256, baixadoEm, nomeNoScript }

const arqEstado = () => path.join(pasta, 'estado.json');
const arqFonte = (id) => path.join(pasta, `${id}.user.js`);

function iniciar(pastaDeDados) {
  pasta = path.join(pastaDeDados, 'extensoes');
  fs.mkdirSync(pasta, { recursive: true });
  try { estado = JSON.parse(fs.readFileSync(arqEstado(), 'utf8')) || {}; } catch (_) { estado = {}; }
}
const gravar = () => { try { fs.writeFileSync(arqEstado(), JSON.stringify(estado, null, 2)); } catch (_) {} };

// ---------- cabecalho do userscript ----------
function lerCabecalho(fonte) {
  const m = /\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/.exec(fonte);
  if (!m) return null;
  const meta = { match: [], include: [], grant: [] };
  for (const linha of m[1].split('\n')) {
    const c = /^\s*\/\/\s*@([\w:-]+)\s+(.*?)\s*$/.exec(linha);
    if (!c) continue;
    const [, chave, valor] = c;
    if (chave === 'match' || chave === 'include' || chave === 'grant') meta[chave].push(valor);
    else if (!(chave in meta)) meta[chave] = valor;
  }
  return meta;
}

// Padrao de @match vira expressao regular. Aceito consulta e ancora no fim porque o jogo as vezes
// abre como /play?ref=..., e a pessoa espera que o script rode ali tambem.
// O curinga do DOMINIO nao pode atravessar barra: "https://*.idleworld.online/*" tem de casar com
// poke.idleworld.online e nunca com https://outro.site/x.idleworld.online/. Por isso dominio e caminho
// sao convertidos separados, como na regra oficial de match pattern ("*." inclui o dominio sem prefixo).
function matchParaRegex(padrao) {
  const esc = (t) => String(t).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const m = /^(\*|https?|wss?):\/\/([^/]*)(\/.*)?$/.exec(String(padrao));
  if (!m) return '^(?!)'; // padrao que nao entendo nao casa com nada
  const esquema = m[1] === '*' ? 'https?' : m[1];
  let dominio;
  if (m[2] === '*') dominio = '[^/]+';
  else if (m[2].startsWith('*.')) dominio = `(?:[^/.]+\\.)*${esc(m[2].slice(2))}`;
  else dominio = esc(m[2]);
  const caminho = esc(m[3] || '/').replace(/\*/g, '.*');
  return `^${esquema}://${dominio}${caminho}(?:[?#].*)?$`;
}

function validar(fonte) {
  const meta = lerCabecalho(fonte);
  if (!meta) return { ok: false, erro: 'o arquivo baixado não é um userscript (sem cabeçalho ==UserScript==)' };
  const concessoes = meta.grant.filter((g) => g && g !== 'none');
  if (concessoes.length) return { ok: false, erro: `o script pede APIs que o app não oferece (${concessoes.join(', ')})` };
  if (!meta.match.length && !meta.include.length) return { ok: false, erro: 'o script não diz em que página roda (@match)' };
  return { ok: true, meta };
}

// ---------- download ----------
function baixarTexto(url) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (_) { return reject(new Error('endereço inválido')); }
    if (u.protocol !== 'https:' || !HOSTS_PERMITIDOS.includes(u.hostname)) return reject(new Error('origem não permitida'));
    const req = https.get(u, { timeout: 15000, headers: { 'User-Agent': 'QuadView' } }, (res) => {
      // Sem seguir redirecionamento: a origem permitida e uma so, e um desvio levaria a outro lugar.
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`o GitHub respondeu ${res.statusCode}`)); }
      const partes = []; let total = 0;
      res.on('data', (c) => {
        total += c.length;
        if (total > TAMANHO_MAXIMO) { req.destroy(new Error('arquivo grande demais')); return; }
        partes.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('sem resposta do GitHub')));
    req.on('error', reject);
  });
}

// Baixa, valida e so entao troca a copia em disco. Falha no meio deixa a versao antiga intacta.
async function baixar(id, buscar = baixarTexto) {
  const item = CATALOGO.find((c) => c.id === id);
  if (!item) return { ok: false, erro: 'extensão desconhecida' };
  let fonte;
  try { fonte = await buscar(item.url); } catch (e) { return { ok: false, erro: `não consegui baixar: ${e.message}` }; }
  const v = validar(fonte);
  if (!v.ok) return v;
  const tmp = arqFonte(id) + '.novo';
  fs.writeFileSync(tmp, fonte);
  fs.renameSync(tmp, arqFonte(id));
  const antes = estado[id] || {};
  estado[id] = {
    ...antes,
    versao: v.meta.version || '?',
    nomeNoScript: v.meta.name || item.nome,
    sha256: crypto.createHash('sha256').update(fonte).digest('hex'),
    baixadoEm: new Date().toISOString(),
  };
  gravar();
  return { ok: true, versao: estado[id].versao, mudou: antes.sha256 !== estado[id].sha256 };
}

// ---------- estado ----------
const instalada = (id) => !!(estado[id] && estado[id].sha256 && fs.existsSync(arqFonte(id)));

function listar() {
  return CATALOGO.map((c) => {
    const e = estado[c.id] || {};
    return {
      id: c.id, nome: c.nome, autor: c.autor, descricao: c.descricao, pagina: c.pagina,
      ativa: !!e.ativa && instalada(c.id), instalada: instalada(c.id),
      versao: e.versao || '', baixadoEm: e.baixadoEm || '', sha256: e.sha256 || '',
    };
  });
}

// Ativar pela primeira vez baixa a copia. Depois disso liga e desliga sem tocar na rede.
async function definirAtiva(id, ativa, buscar) {
  if (!CATALOGO.some((c) => c.id === id)) return { ok: false, erro: 'extensão desconhecida' };
  if (ativa && !instalada(id)) {
    const r = await baixar(id, buscar);
    if (!r.ok) return r;
  }
  estado[id] = { ...(estado[id] || {}), ativa: !!ativa };
  gravar();
  return { ok: true };
}

// ---------- o que vai para a pagina ----------
// Esta funcao NAO roda aqui: ela vira texto e roda dentro da pagina, em volta do userscript. Faz o
// papel do gerenciador de userscript: so rodar no @match, uma vez por documento, na hora que o
// script pede (@run-at).
//
// E cuida de um caso que derrubava o PIW-QOL: o jogo e uma pagina so (SPA) e guarda a sessao no
// sessionStorage, que morre quando o navegador fecha. Entao todo dia o painel abre em /login e, depois
// do login, o jogo troca o endereco para /play SEM carregar documento novo. Script com @match so em
// /play era conferido uma unica vez, ainda em /login, e nunca mais (o JustPokedex casa com o dominio
// inteiro, por isso funcionava). Agora o embrulho fica de olho no endereco; quando ele entra no
// @match, recarrega a pagina uma vez, e o script nasce no comeco do documento, que e o que ele
// espera para conseguir embrulhar o WebSocket do jogo antes de o jogo abri-lo.
function embrulho(padroes, origens, marca, cedo, rodar) {
  var casa = function (lista) { var u = location.href; return lista.some(function (p) { return new RegExp(p).test(u); }); };
  // A injecao do app acontece ANTES de existir o <html>: nessa hora document.documentElement e nulo.
  // O Tampermonkey roda o "document-start" um instante depois, com o <html> ja criado, e e com isso
  // que os scripts contam. O PIW-QOL faz document.documentElement.style logo na largada: aqui ele
  // estourava nessa linha e morria inteiro (reproduzido em navegador de verdade). Entao espero o
  // <html> nascer. Isso ainda e antes de qualquer script da pagina, porque o navegador entrega este
  // aviso antes de executar o primeiro <script> dela.
  var comRaiz = function (fn) {
    if (document.documentElement) { fn(); return; }
    var mo = new MutationObserver(function () {
      if (!document.documentElement) return;
      mo.disconnect();
      fn();
    });
    mo.observe(document, { childList: true });
  };
  var disparar = function () {
    if (window[marca]) return;
    try { Object.defineProperty(window, marca, { value: 1 }); } catch (e) { return; }
    if (cedo) comRaiz(rodar);
    else if (document.readyState !== 'loading') rodar();
    else document.addEventListener('DOMContentLoaded', rodar, { once: true });
  };
  var aqui = false, mesmoSite = false;
  try { aqui = casa(padroes); mesmoSite = aqui || casa(origens); } catch (e) { return; }
  // Fora do try de proposito: erro do script tem de aparecer no console, nao sumir aqui dentro.
  if (aqui) { disparar(); return; }
  if (!mesmoSite) return; // outro site (login do Google etc.): nao encosto em nada

  var chave = marca + '_recarga', feito = false, relogio = null;
  var conferir = function () {
    if (feito) return;
    var entrou = false;
    try { entrou = casa(padroes); } catch (e) {}
    if (!entrou) return;
    feito = true;
    if (relogio) clearInterval(relogio);
    var ultima = 0;
    try { ultima = Number(sessionStorage.getItem(chave)) || 0; } catch (e) {}
    // Uma recarga so. Se acabou de haver uma e o endereco saiu e voltou, rodo aqui mesmo em vez de
    // recarregar de novo: melhor o script meio atrasado do que a pagina em circulo.
    if (cedo && Date.now() - ultima > 15000) {
      try { sessionStorage.setItem(chave, String(Date.now())); } catch (e) {}
      location.reload();
      return;
    }
    disparar();
  };
  ['pushState', 'replaceState'].forEach(function (nome) {
    var original = history[nome];
    if (typeof original !== 'function') return;
    history[nome] = function () {
      var r = original.apply(this, arguments);
      try { conferir(); } catch (e) {}
      return r;
    };
  });
  window.addEventListener('popstate', conferir);
  window.addEventListener('hashchange', conferir);
  relogio = setInterval(conferir, 1000); // rede de seguranca se o roteador do jogo nao passar pelo history
}

// So o comeco do endereco (esquema e dominio) de um @match: serve para saber se vale vigiar esta pagina.
const origemDoPadrao = (padrao) => matchParaRegex(String(padrao).replace(/^([^:]+:\/\/[^/]*).*$/, '$1/*'));

// A copia em disco e conferida contra o hash guardado na hora do download: arquivo mexido por fora
// nao roda.
function fontesAtivas() {
  const saida = [];
  for (const c of CATALOGO) {
    const e = estado[c.id];
    if (!e || !e.ativa || !instalada(c.id)) continue;
    let fonte;
    try { fonte = fs.readFileSync(arqFonte(c.id), 'utf8'); } catch (_) { continue; }
    if (crypto.createHash('sha256').update(fonte).digest('hex') !== e.sha256) continue;
    const v = validar(fonte);
    if (!v.ok) continue;
    const brutos = [...v.meta.match, ...v.meta.include];
    const marca = '__qvExt_' + c.id.replace(/[^a-z0-9]/gi, '_');
    // A injecao do app acontece sempre no comeco do documento. Script que NAO pede document-start
    // espera encontrar a pagina montada, entao nesse caso o embrulho segura ate o DOM ficar pronto.
    const cedo = v.meta['run-at'] === 'document-start';
    saida.push({
      id: c.id,
      fonte: `(${embrulho.toString()})(${JSON.stringify(brutos.map(matchParaRegex))},${JSON.stringify(brutos.map(origemDoPadrao))},`
        + `${JSON.stringify(marca)},${cedo},function(){\n${fonte}\n});`,
    });
  }
  return saida;
}

module.exports = { iniciar, listar, baixar, definirAtiva, fontesAtivas, lerCabecalho, matchParaRegex, validar, CATALOGO };

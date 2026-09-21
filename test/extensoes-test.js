// Regras da parte de extensoes que nao dependem de navegador: cabecalho, @match, validacao,
// versao fixa, troca atomica, hash da copia em disco e origem do download.
const fs = require('fs');
const os = require('os');
const path = require('path');
const ext = require('../src/extensoes');

const US = (extra = '', grant = 'none') => `// ==UserScript==
// @name  Teste
// @version 9.10.12
// @match https://poke.idleworld.online/play
// @grant ${grant}
// @run-at document-start
${extra}// ==/UserScript==
(function(){ window.rodou = (window.rodou||0)+1; })();`;

(async () => {
  const casos = [];
  const ok = (nome, v, extra = '') => casos.push([nome, !!v, extra]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qvext-'));
  ext.iniciar(dir);
  const arq = path.join(dir, 'extensoes', 'piw-qol.user.js');

  const meta = ext.lerCabecalho(US());
  ok('lê versão, @match e @run-at do cabeçalho', meta.version === '9.10.12' && meta.match[0].endsWith('/play') && meta['run-at'] === 'document-start');

  const re = new RegExp(ext.matchParaRegex('https://poke.idleworld.online/play'));
  ok('@match casa com /play e com /play?ref=...', re.test('https://poke.idleworld.online/play') && re.test('https://poke.idleworld.online/play?ref=6EVNV72'));
  ok('@match não casa com login, pokepedia nem outro site',
    !re.test('https://poke.idleworld.online/login') && !re.test('https://poke.idleworld.online/pokepedia')
    && !re.test('https://poke.idleworld.online/player') && !re.test('https://evil.example/https://poke.idleworld.online/play'));
  ok('o ponto do domínio é literal (pokeXidleworld não casa)', !re.test('https://pokeXidleworld.online/play'));

  {
    const t = (padrao, url) => new RegExp(ext.matchParaRegex(padrao)).test(url);
    const P = 'https://*.idleworld.online/*'; // o @match do JustPokedex
    ok('curinga de subdomínio casa com poke.idleworld.online (e com o domínio puro)',
      t(P, 'https://poke.idleworld.online/play') && t(P, 'https://poke.idleworld.online/login?x=1') && t(P, 'https://idleworld.online/'));
    ok('curinga de subdomínio não atravessa barra nem aceita domínio parecido',
      !t(P, 'https://evil.com/a.idleworld.online/') && !t(P, 'https://evilidleworld.online/')
      && !t(P, 'https://poke.idleworld.online.evil.com/') && !t(P, 'http://poke.idleworld.online/play'));
    ok('padrão que o app não entende não casa com nada', !t('qualquer coisa', 'https://poke.idleworld.online/play'));
  }
  ok('o catálogo tem PIW-QOL e JustPokedex, cada um vindo do GitHub do próprio autor',
    ext.CATALOGO.map((c) => c.id).join() === 'piw-qol,justpokedex'
    && ext.CATALOGO.every((c) => c.url.startsWith('https://raw.githubusercontent.com/') && c.url.includes(c.pagina.replace('https://github.com/', ''))));
  ok('recusa script que pede GM_*', !ext.validar(US('', 'GM_xmlhttpRequest')).ok);
  ok('recusa arquivo que não é userscript (página de erro, HTML)', !ext.validar('<html>404</html>').ok);

  ok('começa desligada e sem cópia', ext.listar()[0].ativa === false && ext.listar()[0].instalada === false);
  ok('desligada não injeta nada', ext.fontesAtivas().length === 0);

  let baixou = 0;
  const r1 = await ext.definirAtiva('piw-qol', true, async () => { baixou++; return US(); });
  ok('ligar pela primeira vez baixa a cópia', r1.ok && baixou === 1 && fs.existsSync(arq));
  ok('a lista mostra a versão fixada', ext.listar()[0].versao === '9.10.12' && ext.listar()[0].ativa);

  await ext.definirAtiva('piw-qol', false, async () => { baixou++; return US(); });
  await ext.definirAtiva('piw-qol', true, async () => { baixou++; return US(); });
  ok('desligar e ligar de novo NÃO baixa outra vez (versão fixa)', baixou === 1);

  const fontes = ext.fontesAtivas();
  ok('ligada entrega uma fonte para injetar', fontes.length === 1 && fontes[0].id === 'piw-qol');
  {
    // roda o embrulho num "window" de mentira: dentro e fora do @match, e duas vezes no mesmo documento
    const rodar = (href, win) => new Function('window', 'location', 'document', fontes[0].fonte)(win, { href }, { documentElement: {} });
    const dentro = {}; rodar('https://poke.idleworld.online/play', dentro); rodar('https://poke.idleworld.online/play', dentro);
    const fora = {}; rodar('https://piwtools.com.br/', fora);
    ok('o embrulho roda o script dentro do @match', dentro.rodou >= 1);
    {
      // na injecao de verdade o <html> ainda nao existe: o script document-start espera ele nascer
      const w = {}; const doc = { documentElement: null }; let aviso = null, desligou = false;
      function MO(fn) { aviso = fn; this.observe = () => {}; this.disconnect = () => { desligou = true; }; }
      new Function('window', 'location', 'document', 'MutationObserver', fontes[0].fonte)(w, { href: 'https://poke.idleworld.online/play' }, doc, MO);
      const antes = w.rodou;
      aviso(); // mutacao que ainda nao trouxe o <html>
      const aindaNao = w.rodou;
      doc.documentElement = {}; aviso();
      ok('sem <html> o script document-start espera, e roda assim que ele nasce', antes === undefined && aindaNao === undefined && w.rodou === 1 && desligou,
        `antes=${antes} meio=${aindaNao} depois=${w.rodou}`);
    }
    ok('e não roda duas vezes no mesmo documento', dentro.rodou === 1, `rodou=${dentro.rodou}`);
    ok('e não roda fora do @match', fora.rodou === undefined);
  }

  {
    // script SEM document-start espera a pagina montada: o embrulho segura ate o DOMContentLoaded
    const semCedo = US().replace('// @run-at document-start\n', '');
    await ext.definirAtiva('justpokedex', true, async () => semCedo);
    const f = ext.fontesAtivas().find((x) => x.id === 'justpokedex').fonte;
    const win = {}; let pendente = null;
    const doc = { readyState: 'loading', addEventListener: (ev, fn) => { if (ev === 'DOMContentLoaded') pendente = fn; } };
    new Function('window', 'location', 'document', f)(win, { href: 'https://poke.idleworld.online/play' }, doc);
    const antes = win.rodou;
    if (pendente) pendente();
    ok('script sem document-start só roda quando o DOM fica pronto', antes === undefined && win.rodou === 1, `antes=${antes} depois=${win.rodou}`);
    ok('duas extensões ligadas entram juntas, na ordem do catálogo', ext.fontesAtivas().map((x) => x.id).join() === 'piw-qol,justpokedex');
    await ext.definirAtiva('justpokedex', false);
    ok('desligar uma não mexe na outra', ext.fontesAtivas().map((x) => x.id).join() === 'piw-qol');
  }

  {
    // O jogo e SPA: abre em /login e troca para /play sem carregar documento. Simulo isso.
    const fonte = ext.fontesAtivas().find((x) => x.id === 'piw-qol').fonte;
    const montar = (href, guardado) => {
      const m = { win: { addEventListener() {} }, loc: { href, recargas: 0, reload() { m.loc.recargas++; } }, guardado: guardado || {}, relogios: 0 };
      m.hist = { pushState(_a, _b, url) { m.loc.href = new URL(url, m.loc.href).href; }, replaceState() {} };
      m.ss = { getItem: (k) => (k in m.guardado ? m.guardado[k] : null), setItem: (k, v) => { m.guardado[k] = v; } };
      m.rodar = () => new Function('window', 'location', 'document', 'history', 'sessionStorage', 'setInterval', 'clearInterval', fonte)(
        m.win, m.loc, { readyState: 'complete', documentElement: {} }, m.hist, m.ss, () => { m.relogios++; return 1; }, () => { m.relogios--; });
      return m;
    };
    const a = montar('https://poke.idleworld.online/login'); a.rodar();
    ok('em /login o script com @match só em /play ainda não roda', a.win.rodou === undefined && a.loc.recargas === 0);
    a.hist.pushState({}, '', '/play');
    ok('quando o jogo troca para /play sem recarregar, o app recarrega uma vez', a.loc.recargas === 1 && a.win.rodou === undefined, `recargas=${a.loc.recargas}`);
    const b = montar('https://poke.idleworld.online/play', a.guardado); b.rodar();
    ok('depois da recarga o script nasce já em /play, no começo do documento', b.win.rodou === 1 && b.loc.recargas === 0);
    const c = montar('https://poke.idleworld.online/login', a.guardado); c.rodar(); c.hist.pushState({}, '', '/play');
    ok('se acabou de recarregar, não entra em círculo: roda no lugar', c.loc.recargas === 0 && c.win.rodou === 1, `recargas=${c.loc.recargas} rodou=${c.win.rodou}`);
    ok('e para de vigiar depois de resolver', c.relogios === 0);
    const d = montar('https://accounts.google.com/signin'); const antes = d.hist.pushState; d.rodar();
    ok('em outro site (login do Google) não encosta em nada', d.hist.pushState === antes && d.relogios === 0);
  }

  const falha = await ext.baixar('piw-qol', async () => { throw new Error('sem rede'); });
  ok('falha no download mantém a cópia antiga', !falha.ok && ext.fontesAtivas().length === 1);
  const ruim = await ext.baixar('piw-qol', async () => US('', 'GM_setValue'));
  ok('atualização inválida é recusada e a antiga continua', !ruim.ok && ext.listar()[0].versao === '9.10.12' && ext.fontesAtivas().length === 1);

  const igual = await ext.baixar('piw-qol', async () => US());
  ok('atualizar sem mudança avisa que não mudou', igual.ok && igual.mudou === false);
  const nova = await ext.baixar('piw-qol', async () => US().replace('9.10.12', '9.11.0'));
  ok('atualizar com versão nova troca a cópia e a versão', nova.ok && nova.mudou && ext.listar()[0].versao === '9.11.0');

  // O texto injetado e guardado por hash para nao ser remontado a cada chamada (e para os paineis
  // compartilharem a mesma string). Duas garantias: reaproveita mesmo, e troca quando a versao muda.
  const a1 = ext.fontesAtivas()[0];
  const a2 = ext.fontesAtivas()[0];
  ok('o texto injetado é reaproveitado entre chamadas', a1.fonte === a2.fonte && a1.marca === a2.marca);
  await ext.baixar('piw-qol', async () => US().replace('9.10.12', '9.12.0'));
  const a3 = ext.fontesAtivas()[0];
  ok('mas é remontado quando a cópia em disco muda', a3.marca !== a1.marca && a3.fonte.includes('9.12.0'));

  fs.appendFileSync(arq, '\n/* mexido por fora */');
  // Esta e a que importa junto do cache: guardar o texto pronto NAO pode pular a conferencia do hash.
  ok('cópia em disco alterada por fora não roda (hash não confere)', ext.fontesAtivas().length === 0);

  ext.iniciar(dir);
  ok('o estado sobrevive a fechar e abrir o app', ext.listar()[0].versao === '9.12.0');

  const fonteModulo = fs.readFileSync(path.join(__dirname, '..', 'src', 'extensoes.js'), 'utf8');
  ok('só baixa por https e só do GitHub do autor', /HOSTS_PERMITIDOS = \['raw\.githubusercontent\.com'\]/.test(fonteModulo) && /u\.protocol !== 'https:'/.test(fonteModulo));
  ok('o código do autor não vem embutido no app', !fs.existsSync(path.join(__dirname, '..', 'src', 'piw-qol.user.js')) && !/TrackedWebSocket/.test(fonteModulo));
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  ok('extensão só entra em painel do jogo, nunca nas abas extras', /sincronizarExtensoes\(p\.extra \? \[\] :/.test(main) && /if \(p\.extra \|\| !temPonte\(p\)\) continue;/.test(main));
  ok('a janela só abre endereço do catálogo, não o que vier dela', /extensoes\.CATALOGO\.find\(\(c\) => c\.id === id\)/.test(main));

  let falhou = false;
  for (const [nome, v, extra] of casos) { console.log(`${v ? 'PASSOU' : 'FALHOU'}  ${nome}${extra ? '  ' + extra : ''}`); if (!v) falhou = true; }
  process.exit(falhou ? 1 : 0);
})();

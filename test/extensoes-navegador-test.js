// Navegador de verdade, injecao igual a do app (porta de depuracao, comeco do documento). Existe por
// causa de um erro que nenhum teste com pagina de mentira pegava: nessa hora o <html> ainda nao
// existe, e script que toca em document.documentElement na largada (o PIW-QOL faz isso) morria.
const http = require('http'); const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const ext = require('../src/extensoes');

const US = `// ==UserScript==
// @name  Largada
// @version 1.0
// @match http://127.0.0.1/*
// @grant none
// @run-at document-start
// ==/UserScript==
(function () {
  document.documentElement.setAttribute('data-ext', 'rodou');          // o que derrubava o PIW-QOL
  window.__extAntesDaPagina = typeof window.__paginaRodou === 'undefined';
  var N = window.WebSocket; function R(u) { return new N(u); } R.prototype = N.prototype; window.WebSocket = R;
})();`;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qvnav-'));
  ext.iniciar(dir);
  await ext.definirAtiva('piw-qol', true, async () => US);
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html');
    r.end('<!doctype html><html><head><script>window.__paginaRodou = 1; window.__wsVisto = window.WebSocket.name;</script></head><body></body></html>'); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  // o @match de teste nao tem porta (padrao de match nao aceita); ajusto a expressao ja convertida
  const fonte = ext.fontesAtivas()[0].fonte.split('^http://127\\\\.0\\\\.0\\\\.1/').join('^http://127\\\\.0\\\\.0\\\\.1:\\\\d+/');
  const porta = 49500 + Math.floor(Math.random() * 400);
  const ch = spawn(process.env.QV_CHROME || '/opt/pw-browsers/chromium',
    ['--headless=new', '--no-sandbox', `--remote-debugging-port=${porta}`, `--user-data-dir=${dir}/perfil`, 'about:blank'], { stdio: 'ignore' });
  let alvo;
  for (let i = 0; i < 50 && !alvo; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try { alvo = (await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json()).find((t) => t.type === 'page'); } catch (_) {}
  }
  const ws = new WebSocket(alvo.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
  let id = 0; const esp = new Map(); const erros = [];
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
    if (m.id && esp.has(m.id)) { esp.get(m.id)(m.result); esp.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') erros.push(m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description.split('\n')[0] : m.params.exceptionDetails.text); };
  const env = (method, params = {}) => new Promise((r) => { const n = ++id; esp.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  await env('Page.enable'); await env('Runtime.enable'); // Runtime.enable so aqui no teste, para enxergar excecao
  await env('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__raizNaInjecao = String(document.documentElement);' });
  await env('Page.addScriptToEvaluateOnNewDocument', { source: fonte });
  await env('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/play` });
  await new Promise((r) => setTimeout(r, 2500));
  const ler = async (e) => (await env('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;

  const casos = [
    ['premissa: na hora da injeção o <html> ainda não existe', (await ler('window.__raizNaInjecao')) === 'null'],
    ['mesmo assim o script que usa document.documentElement na largada roda sem erro',
      (await ler('document.documentElement.getAttribute("data-ext")')) === 'rodou' && erros.length === 0, erros.join(' | ')],
    ['e roda antes do primeiro script da página', (await ler('window.__extAntesDaPagina')) === true],
    ['a página já encontra o WebSocket trocado pelo script', (await ler('window.__wsVisto')) === 'R'],
  ];
  ch.kill(); srv.close();
  let falhou = false;
  for (const [nome, ok, extra] of casos) { console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome}${extra ? '  ' + extra : ''}`); if (!ok) falhou = true; }
  process.exit(falhou ? 1 : 0);
})();

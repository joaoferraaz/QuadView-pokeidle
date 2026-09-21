// Teste do encaixe: sobe um jogo falso, roda o app e confere se as janelas do Chrome viraram
// filhas da janela do app, se maximizar/soltar/encaixar funcionam e se a reconexao segue de pe.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qvs-'));
const APPDATA = path.join(TMP, 'appdata');
const S = process.env.QV_SHOTS || TMP;

const sim = { mutando: true, textoQueda: false, recargas: 0, campos: {}, enviou: false, cliquesGoogle: 0, derrubarSocket: false, porPainel: {}, ext: [] };
const socketsVivos = new Set();
const PAGINA = `<!doctype html><meta charset=utf-8><title>Jogo Falso</title>
<body style="background:#0f2038;color:#9fe;font:28px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">
<div><div id=h>rodando</div><div id=log style="font-size:16px;color:#f7a"></div></div>
<script>let n=0;setInterval(async()=>{const v=await fetch('/vivo').then(r=>r.text()).catch(()=>'nao');
 if(v==='sim')document.getElementById('h').textContent='rodando '+(++n);
 if(v==='queda')document.getElementById('log').textContent='Voce foi desconectado do servidor';},1000);
 new WebSocket('ws://'+location.host+'/ws');</script>`;

const srv = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x');
  let pid = (/(?:^|;\s*)pid=([^;]+)/.exec(q.headers.cookie || '') || [])[1];
  if (!pid) { pid = Math.random().toString(36).slice(2, 8); r.setHeader('set-cookie', `pid=${pid}; Path=/`); }
  const doPainel = (sim.porPainel[pid] = sim.porPainel[pid] || { u: '', p: '', google: 0 });
  if (u.pathname === '/campos') { doPainel.u = u.searchParams.get('u') || doPainel.u; doPainel.p = u.searchParams.get('p') || doPainel.p; }
  if (u.pathname === '/google') doPainel.google++;
  if (u.pathname === '/ext') { sim.ext.push({ pid, onde: u.searchParams.get('onde'), cedo: u.searchParams.get('cedo') }); return r.end('ok'); }
  if (u.pathname === '/entrada') { // imita o jogo de verdade: pagina de login que vira o jogo SEM carregar documento
    r.setHeader('content-type', 'text/html');
    return r.end('<title>Entrada</title><body>entrando...<script>setTimeout(function(){history.pushState({}, "", "/");}, 1500);<\/script></body>');
  }
  if (u.pathname === '/vivo') return r.end(sim.textoQueda ? 'queda' : sim.mutando ? 'sim' : 'nao');
  if (u.pathname === '/tools') { r.setHeader('content-type', 'text/html'); return r.end('<title>PIW Tools</title><body style="background:#10261c;color:#9fe;font:24px sans-serif">ferramentas</body>'); }
  if (u.pathname === '/campos') { sim.campos = { u: u.searchParams.get('u'), p: u.searchParams.get('p') }; return r.end('ok'); }
  if (u.pathname === '/enviou') { sim.enviou = true; return r.end('ok'); }
  if (u.pathname === '/google') { sim.cliquesGoogle++; return r.end('ok'); }
  if (u.pathname === '/login') {
    r.setHeader('content-type', 'text/html');
    return r.end(`<title>Login</title><body style="background:#0f2038;color:#9fe;font:16px sans-serif">
      <form class="auth-card">
        <input type="text" autocomplete="username" placeholder="Email ou nome de usuário">
        <input type="password" autocomplete="current-password" placeholder="Senha">
        <button type="submit">Entrar</button>
      </form>
      <button id="btGoogle" onclick="fetch('/google')">Entrar com Google</button>
      <script>
        document.querySelector('form').addEventListener('submit', e => { e.preventDefault(); fetch('/enviou'); });
        setInterval(() => { const [u,p] = document.querySelectorAll('input');
          fetch('/campos?u=' + encodeURIComponent(u.value) + '&p=' + encodeURIComponent(p.value)); }, 800);
      <\/script></body>`);
  }
  if (u.pathname === '/') sim.recargas++;
  r.setHeader('content-type', 'text/html; charset=utf-8');
  r.end(PAGINA);
});
const wssJogo = new (require(path.join(RAIZ, 'node_modules/ws')).WebSocketServer)({ server: srv, path: '/ws' });
wssJogo.on('connection', (c) => {
  socketsVivos.add(c);
  c.on('close', () => socketsVivos.delete(c));
  if (sim.derrubarSocket) c.close();
  const bater = setInterval(() => { try { c.send(JSON.stringify({ type: 'inventory', items: [] })); } catch (_) {} }, 2000);
  c.on('close', () => clearInterval(bater));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const linhas = [];
function checar(nome, ok, extra = '') {
  linhas.push(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome}${extra ? '  ' + extra : ''}`);
  console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome}${extra ? '  ' + extra : ''}`);
}
function geometria(id) {
  try {
    const t = execFileSync('xwininfo', ['-id', String(id)], { encoding: 'utf8' });
    const n = (re) => Number((t.match(re) || [])[1]);
    return { x: n(/Relative upper-left X:\s*(-?\d+)/), y: n(/Relative upper-left Y:\s*(-?\d+)/),
             w: n(/Width:\s*(\d+)/), h: n(/Height:\s*(\d+)/) };
  } catch (_) { return null; }
}
function filhasDe(id) {
  try {
    const saida = execFileSync('xwininfo', ['-children', '-id', id], { encoding: 'utf8' });
    return (saida.match(/0x[0-9a-f]+/g) || []).slice(1).map((h) => String(parseInt(h, 16)));
  } catch (_) { return []; }
}
const foto = (nome) => { try { execFileSync('import', ['-window', 'root', path.join(S, nome)]); } catch (_) {} };
// Qual janela esta com o teclado agora (no Windows isso depende de emparelhar a fila de entrada;
// aqui em X11 e o equivalente mais proximo que da para conferir de fora).
const focoX11 = () => { try { return execFileSync('xdotool', ['getwindowfocus'], { encoding: 'utf8' }).trim(); } catch (_) { return ''; } };

let estado = [], pai = null;
const voltas = []; // um registro por passe da volta do minimizado
const painel = (n) => estado.find((p) => p.n === n) || {};

srv.listen(0, '127.0.0.1', async () => {
  const host = `127.0.0.1:${srv.address().port}`;
  fs.mkdirSync(APPDATA, { recursive: true });
  fs.writeFileSync(path.join(TMP, 'config.json'), JSON.stringify({
    url: `http://${host}/`, porta: 47960, reconectar: true, detectarTravado: true, minutosTravado: 0.5,
    abrirAoIniciar: true, preencherLogin: true, metodoLogin: 'formulario', recorteTitulo: 0,
    perfis: [{ nome: 'Conta 1', slug: 'conta-1', url: '' }, { nome: 'Conta 2', slug: 'conta-2', url: '' }],
    extras: [{ nome: 'PIW Tools', slug: 'piw-tools', url: `http://${host}/tools` }],
    extrasOferecidas: ['pokepedia'], // a migracao tem teste proprio; aqui o conjunto de paineis fica fixo
  }));

  const app = spawn(path.join(RAIZ, 'node_modules/.bin/electron'), [RAIZ, '--no-sandbox'], {
    env: { ...process.env, QV_CHROME: process.env.QV_CHROME || '/opt/pw-browsers/chromium',
      QV_ESTADO_MS: '2500', QV_CHROME_ARGS: '--no-sandbox', QV_TEST: '1', QV_ESPERA_MS: '8000', QV_VIGIA_MS: '3000', QV_ESTAVEL_MS: '6000', QV_RONDA_MS: '4000',
      QV_CONFIG: path.join(TMP, 'config.json'), ELECTRON_USER_DATA: APPDATA },
  });
  app.stdout.on('data', (d) => String(d).split('\n').forEach((l) => {
    if (l.startsWith('QVSTATE ')) {
      estado = JSON.parse(l.slice(8));
      if (process.env.QV_DUMP) fs.appendFileSync(process.env.QV_DUMP, `${Math.round(process.uptime())}s ${l.slice(8)}\n`);
    }
    if (l.startsWith('QVPAI ')) pai = l.slice(6).trim();
    if (l.startsWith('QVVOLTA ')) voltas.push(JSON.parse(l.slice(8)));
  }));

  const acao = (a, i, v) => fs.writeFileSync(path.join(APPDATA, 'acao.json'), JSON.stringify({ a, i, v, t: Date.now() }));

  // espero o app publicar a janela dele em vez de cravar um tempo fixo
  for (let i = 0; i < 40 && !pai; i++) await sleep(500);
  checar('app informa a própria janela', !!pai, pai || '');
  // nao mando abrir: a configuracao pede que o app abra sozinho ao iniciar
  await sleep(28000);
  checar('abre os painéis sozinho ao iniciar', estado.every((p) => p.alca), JSON.stringify(estado.map((p) => p.erro || !!p.alca)));
  checar('a aba extra também abre', estado.length === 3 && !!estado[2].alca, JSON.stringify(estado.map((p) => p.n)));

  checar('os 2 painéis acharam a janela do navegador', estado.every((p) => p.alca), JSON.stringify(estado.map((p) => p.erro || !!p.alca)));
  const filhas = filhasDe(pai);
  const encaixadas = estado.filter((p) => p.alca && filhas.includes(String(p.alca)));
  checar('as janelas do Chrome viraram filhas da janela do app', encaixadas.length === estado.length,
    `encaixadas ${encaixadas.length}/${estado.length}`);
  checar('controle do navegador e saúde funcionando sem extensão', estado.every((p) => p.diag === 'ok'), JSON.stringify(estado.map((p) => p.diag)));
  foto('solo-grid.png');

  acao('maximizar', 1);
  await sleep(4000);
  foto('solo-max.png');
  checar('maximizar mantém a janela encaixada', filhasDe(pai).includes(String(painel('Conta 2').alca)));

  acao('grade');
  await sleep(2500);

  acao('destacar', 0);
  await sleep(5000);
  foto('solo-solto.png');
  checar('soltar tira a janela de dentro do app', painel('Conta 1').solto === true && !filhasDe(pai).includes(String(painel('Conta 1').alca)));

  acao('encaixar', 0);
  await sleep(5000);
  {
    const p1 = painel('Conta 1');
    const fs2 = filhasDe(pai);
    checar('encaixar de volta devolve pro grid', p1.solto === false && fs2.includes(String(p1.alca)),
      `solto=${p1.solto} alca=${p1.alca} filhas=[${fs2.join(',')}]`);
  }
  foto('solo-devolta.png');

  sim.mutando = false; sim.textoQueda = true;
  const antes = sim.recargas;
  await sleep(15000);
  checar('reconecta sozinho mesmo encaixado', sim.recargas > antes, `recargas ${antes} -> ${sim.recargas}`);
  checar('avisa na faixa do painel', /Reconectando/.test(painel('Conta 1').alerta || ''), painel('Conta 1').alerta || '');
  foto('solo-queda.png');

  sim.mutando = true; sim.textoQueda = false;
  await sleep(16000);
  checar('volta pro normal', painel('Conta 1').diag === 'ok', painel('Conta 1').diag || '');

  // extensoes: um userscript de mentira, com o mesmo formato do PIW-QOL (document-start, @grant none,
  // troca o window.WebSocket), so que apontado para o jogo falso. Fica LIGADO durante o teste de queda
  // do socket logo abaixo, que assim confere tambem que os dois embrulhos de WebSocket convivem.
  const userscript = `// ==UserScript==
// @name         Extensao de teste
// @version      1.2.3
// @match        http://${host}/
// @grant        none
// @run-at       document-start
// ==/UserScript==
(function () {
  'use strict';
  // "cedo" = antes do primeiro script da pagina (que declara a variavel n). E isso que document-start garante.
  var cedo = (function () { try { return typeof n === 'undefined' ? 1 : 0; } catch (e) { return 0; } })();
  var Nativo = window.WebSocket;
  function Rastreado(u, p) { return p ? new Nativo(u, p) : new Nativo(u); }
  Rastreado.prototype = Nativo.prototype; Object.setPrototypeOf(Rastreado, Nativo);
  window.WebSocket = Rastreado;
  fetch('/ext?onde=' + encodeURIComponent(location.pathname) + '&cedo=' + cedo);
})();`;
  let extLog = null;
  app.stdout.on('data', (d) => String(d).split('\n').forEach((l) => { if (l.startsWith('QVEXT ')) extLog = JSON.parse(l.slice(6)); }));
  acao('ext-teste', 0, { ligar: true, fonte: userscript });
  await sleep(9000);
  checar('ligar a extensão recarrega só os painéis do jogo', !!extLog && extLog.ok && extLog.recarregados === 2, JSON.stringify(extLog));
  {
    const pids = new Set(sim.ext.filter((e) => e.onde === '/').map((e) => e.pid));
    checar('a extensão roda nas duas contas', pids.size === 2, `contas=${pids.size} chamadas=${sim.ext.length}`);
    checar('roda antes de qualquer script da página, como o script pede (document-start)', sim.ext.length > 0 && sim.ext.every((e) => e.cedo === '1'), JSON.stringify(sim.ext.map((e) => e.cedo)));
    checar('não roda fora do @match (aba PIW Tools)', !sim.ext.some((e) => e.onde !== '/'), JSON.stringify(sim.ext.map((e) => e.onde)));
  }
  {
    // o caso que derrubava o PIW-QOL: login e jogo na mesma pagina (SPA), o endereco muda sem documento novo
    const extAntes = sim.ext.length, recargasAntes = sim.recargas;
    acao('navegar-teste', 0, `http://${host}/entrada`);
    await sleep(9000);
    const novas = sim.ext.slice(extAntes);
    checar('quando o endereço entra no @match sem recarregar, a extensão passa a rodar', novas.length === 1 && novas[0].onde === '/' && novas[0].cedo === '1', JSON.stringify(novas));
    checar('com uma recarga só, sem círculo', sim.recargas - recargasAntes === 1, `recargas ${recargasAntes} -> ${sim.recargas}`);
  }
  const extAntesDaQueda = sim.ext.length;

  // queda so do socket do jogo: a pagina continua de pe, mas o jogo perdeu a conexao
  sim.derrubarSocket = true;
  for (const c of socketsVivos) c.close();
  const antesDoSocket = sim.recargas;
  await sleep(30000);
  checar('reconecta quando só o WebSocket do jogo cai', sim.recargas > antesDoSocket, `recargas ${antesDoSocket} -> ${sim.recargas}`);
  sim.derrubarSocket = false;
  await sleep(14000);
  checar('a extensão volta a rodar depois de cada recarga', sim.ext.length > extAntesDaQueda, `${extAntesDaQueda} -> ${sim.ext.length}`);
  checar('com a extensão ligada o painel segue saudável', painel('Conta 1').diag === 'ok', painel('Conta 1').diag || '');
  extLog = null;
  acao('ext-teste', 0, { ligar: false });
  await sleep(9000);
  const extDepoisDeDesligar = sim.ext.length;
  checar('desligar recarrega os painéis do jogo', !!extLog && extLog.ok && extLog.recarregados === 2, JSON.stringify(extLog));
  acao('recarregar-todos');
  await sleep(8000);
  checar('desligada, a extensão não roda mais nem depois de recarregar', sim.ext.length === extDepoisDeDesligar, `${extDepoisDeDesligar} -> ${sim.ext.length}`);


  // A aba extra nao mora na grade: fora do modo abas ela fica escondida de verdade, nao so fora
  // da area (a barra de titulo dela espiava pelos ultimos pixels do app).
  const mapeada = (id) => { try { return /Map State:\s*IsViewable/.test(execFileSync('xwininfo', ['-id', String(id)], { encoding: 'utf8' })); } catch (_) { return false; } };
  checar('na grade a aba extra fica escondida e as contas visíveis', !mapeada(estado[2].alca) && mapeada(estado[0].alca) && mapeada(estado[1].alca),
    `extra=${mapeada(estado[2].alca)} conta1=${mapeada(estado[0].alca)}`);

  // modo abas: o painel escolhido ocupa a area inteira, abaixo da tira de abas
  acao('abas', 2);
  await sleep(5000);
  const gExtra = geometria(estado[2].alca);
  const gConta1 = geometria(estado[0].alca);
  checar('modo abas dá a área inteira pro painel da aba', !!gExtra && gExtra.x === 0 && gExtra.y === 44 + 34 && gExtra.w > 1500,
    JSON.stringify(gExtra));
  checar('no modo abas a aba extra volta a aparecer', mapeada(estado[2].alca), `extra=${mapeada(estado[2].alca)}`);
  checar('os outros painéis continuam do mesmo tamanho, atrás', !!gConta1 && gConta1.w === gExtra.w && gConta1.h === gExtra.h,
    JSON.stringify(gConta1));
  foto('solo-abas.png');
  // O teclado tem de seguir o painel da frente: trocar de aba e continuar digitando no painel
  // anterior era o que impedia preencher usuario e senha.
  checar('o teclado vai pro painel da aba aberta', focoX11() === String(estado[2].alca),
    `foco=${focoX11()} aba=${estado[2].alca}`);
  acao('aba', 0);
  await sleep(4000);
  checar('trocar de aba leva o teclado junto', focoX11() === String(estado[0].alca),
    `foco=${focoX11()} aba=${estado[0].alca}`);
  foto('solo-aba-conta1.png');
  acao('grade');
  await sleep(4000);
  checar('volta pro grid 2x2', (() => { const g = geometria(estado[0].alca); return !!g && g.w < 900 && g.y === 44 + 28; })(),
    JSON.stringify(geometria(estado[0].alca)));
  checar('e a aba extra some de novo', !mapeada(estado[2].alca) && mapeada(estado[0].alca), `extra=${mapeada(estado[2].alca)}`);

  // painel que sai do lugar sozinho (navegador redimensionando a janela) tem que voltar sozinho
  {
    const antes = geometria(painel('Conta 2').alca);
    try {
      require('child_process').execFileSync('xdotool', ['windowsize', String(painel('Conta 2').alca), '1200', '400']);
      require('child_process').execFileSync('xdotool', ['windowmove', String(painel('Conta 2').alca), '30', '300']);
    } catch (_) {}
    await sleep(9000);
    const depois = geometria(painel('Conta 2').alca);
    checar('painel que saiu do lugar volta sozinho', !!antes && !!depois && depois.w === antes.w && depois.h === antes.h && depois.x === antes.x && depois.y === antes.y,
      `${JSON.stringify(antes)} -> ${JSON.stringify(depois)}`);
  }

  // encaixe que falhou tem que se resolver sozinho, sem a pessoa clicar em nada
  {
    const alca = String(painel('Conta 2').alca);
    acao('falha-teste', 1);
    // confiro no proprio X11 em vez do estado amostrado: aqui a verdade e "e filha ou nao"
    let saiu = false;
    for (let i = 0; i < 16 && !saiu; i++) { await sleep(500); saiu = !filhasDe(pai).includes(alca); }
    let voltou = false;
    for (let i = 0; i < 40 && !voltou; i++) { await sleep(500); voltou = filhasDe(pai).includes(alca); }
    checar('encaixe que falha tenta de novo sozinho', saiu && voltou, `soltou=${saiu} voltou=${voltou}`);
  }

  // a aba extra nao pode receber diagnostico de conexao de jogo
  checar('aba extra não é diagnosticada como o jogo', !['queda', 'mudo', 'parado', 'login'].includes((estado[2] || {}).diag),
    `diag=${(estado[2] || {}).diag}`);

  // volta do minimizado: o app refaz o encaixe sozinho, e tudo tem que terminar no lugar e respondendo
  {
    const antes = geometria(painel('Conta 1').alca);
    voltas.length = 0; // o show inicial tambem passa por aqui; conto so a partir desta volta
    acao('voltar-teste', 0);
    await sleep(6000);
    const depois = geometria(painel('Conta 1').alca);
    checar('depois de voltar do minimizado o painel continua encaixado e no lugar',
      filhasDe(pai).includes(String(painel('Conta 1').alca)) && !!antes && !!depois
      && depois.x === antes.x && depois.y === antes.y && depois.w === antes.w && depois.h === antes.h,
      `${JSON.stringify(antes)} -> ${JSON.stringify(depois)}`);
    checar('e continua respondendo ao app', painel('Conta 1').diag === 'ok', painel('Conta 1').diag || '');
    // As piscadas vinham de reencaixar (redimensionar + repintar) todos os paineis em cada passe
    // da volta. Agora a volta so confere e levanta: nenhum passe forca a danca, e os paineis que ja
    // estavam no lugar continuam no lugar sem ela.
    const passes = voltas.slice();
    checar('a volta do minimizado não redimensiona nem repinta painel que já está no lugar',
      passes.length >= 2 && passes.every((v) => v.completos === 0 && v.todosNoLugar === true && v.paineis === 3),
      JSON.stringify(passes));
  }

  // o aviso nao pode flutuar sobre painel encaixado: ele ocupa faixa propria e empurra os paineis
  const antesDoAviso = geometria(painel('Conta 1').alca);
  acao('aviso-teste', 0, 'teste de aviso');
  await sleep(4000);
  const comAviso = geometria(painel('Conta 1').alca);
  checar('aviso empurra os painéis pra baixo em vez de ficar atrás',
    !!antesDoAviso && !!comAviso && comAviso.y === antesDoAviso.y + 30 && comAviso.h === antesDoAviso.h - 30,
    `${JSON.stringify(antesDoAviso)} -> ${JSON.stringify(comAviso)}`);
  acao('fechar-aviso', 0);
  await sleep(3500);
  checar('fechar o aviso devolve o espaço', (() => { const g = geometria(painel('Conta 1').alca); return !!g && g.y === antesDoAviso.y; })(),
    JSON.stringify(geometria(painel('Conta 1').alca)));

  // a configuracao precisa ser janela de verdade, senao abre atras dos paineis
  acao('config', 0);
  await sleep(3000);
  let janelaCfg = '';
  try { janelaCfg = require('child_process').execFileSync('xdotool', ['search', '--name', 'Configura'], { encoding: 'utf8' }).trim(); } catch (_) {}
  checar('configuração abre como janela nativa, não como caixa dentro da página', !!janelaCfg, janelaCfg || 'nenhuma janela encontrada');
  foto('solo-config.png');

  // o recorte esconde a barra que o Chrome desenha: a janela sobe e cresce exatamente esse tanto
  const antesDoRecorte = geometria(painel('Conta 1').alca);
  acao('recorte-teste', 0, 20);
  await sleep(4000);
  const depois = geometria(painel('Conta 1').alca);
  checar('recorte sobe e estica a janela na medida certa',
    !!antesDoRecorte && !!depois && depois.y === antesDoRecorte.y - 20 && depois.h === antesDoRecorte.h + 20
    && depois.x === antesDoRecorte.x && depois.w === antesDoRecorte.w,
    `${JSON.stringify(antesDoRecorte)} -> ${JSON.stringify(depois)}`);
  acao('recorte-teste', 0, 0);
  await sleep(3000);

  // acesso salvo + ida pra tela de login: os campos tem que chegar preenchidos
  acao('creds-teste', 0, { user: 'ash@kanto.com', pass: 'pik@"chu\\123' });
  await sleep(1500);
  acao('ir-login', 0);
  await sleep(9000);
  checar('preenche o login sozinho', sim.campos.u === 'ash@kanto.com' && sim.campos.p === 'pik@"chu\\123',
    JSON.stringify(sim.campos));
  checar('não envia o formulário sozinho', sim.enviou === false);
  foto('solo-login.png');
  acao('recarregar', 0);
  await sleep(6000);

  // modo "entrar com Google": um clique so, e nada de digitar senha na pagina do Google
  acao('metodo-teste', 0, 'google');
  await sleep(1000);
  acao('ir-login', 0);
  // o app espera 15s entre tentativas de login: a janela de conferencia precisa ser maior que isso
  await sleep(20000);
  checar('clica em "Entrar com Google" quando escolhido', sim.cliquesGoogle >= 1, `cliques ${sim.cliquesGoogle}`);
  const cliquesDepois = sim.cliquesGoogle;
  await sleep(12000);
  checar('não fica clicando em loop', sim.cliquesGoogle === cliquesDepois, `cliques ${cliquesDepois} -> ${sim.cliquesGoogle}`);

  // login separado por painel: um entra por usuario e senha, o outro pelo Google, e nao se misturam
  acao('metodo-teste', 0, 'nenhum');            await sleep(800);
  acao('metodo-painel-teste', 0, 'formulario'); await sleep(800);
  acao('metodo-painel-teste', 1, 'google');     await sleep(800);
  acao('ir-login', 1);                          await sleep(3000);
  sim.porPainel = {};
  acao('ir-login', 0);                          await sleep(800);
  acao('ir-login', 1);
  await sleep(24000);
  {
    const vistos = Object.values(sim.porPainel);
    const porFormulario = vistos.filter((x) => x.u === 'ash@kanto.com');
    const peloGoogle = vistos.filter((x) => x.google > 0);
    checar('painel de usuário e senha é preenchido e não clica no Google',
      porFormulario.length === 1 && porFormulario[0].google === 0, JSON.stringify(vistos));
    checar('painel do Google clica no Google e não recebe usuário e senha',
      peloGoogle.length === 1 && peloGoogle[0].u === '' && peloGoogle[0].google === 1, JSON.stringify(vistos));
  }

  acao('fechar-todos');
  await sleep(4000);
  checar('fechar tudo limpa os painéis', estado.every((p) => !p.alca), JSON.stringify(estado.map((p) => p.alca)));

  app.kill();
  console.log('\n' + linhas.join('\n'));
  process.exit(linhas.some((l) => l.startsWith('FALHOU')) ? 1 : 0);
});

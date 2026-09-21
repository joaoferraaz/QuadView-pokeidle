const { app, BrowserWindow, ipcMain, screen, globalShortcut, shell, safeStorage } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const janelas = require('./janelas');
const { Sessao } = require('./cdp');

const PADRAO = {
  url: 'https://poke.idleworld.online/play',
  porta: 47900, // porta base de depuracao do navegador (cada painel usa porta + indice)
  reconectar: true,
  detectarTravado: true,
  minutosTravado: 5,
  abrirAoIniciar: true,
  preencherLogin: true,
  metodoLogin: 'formulario', // 'formulario' | 'google' | 'nenhum'
  navegador: '', // caminho do navegador; vazio = procura sozinho (Edge primeiro)
  argsExtras: '', // parametros extras pro navegador, separados por espaco
  modo: 'grade', // 'grade' = 2x2, 'abas' = tela cheia com abas
  extras: [
    { nome: 'PIW Tools', slug: 'piw-tools', url: 'https://piwtools.com.br/' },
    { nome: 'PokePedia', slug: 'pokepedia', url: 'https://poke.idleworld.online/pokepedia' },
  ],
  recorteTitulo: 34, // altura da barra de titulo que o Chrome desenha dentro da janela
  perfis: [
    { nome: 'Conta 1', slug: 'conta-1', url: '' },
    { nome: 'Conta 2', slug: 'conta-2', url: '' },
    { nome: 'Conta 3', slug: 'conta-3', url: '' },
    { nome: 'Conta 4', slug: 'conta-4', url: '' },
  ],
};

const TOPO = 44;      // barra de cima
const FAIXA_AVISO = 30;
const CABECA = 28;    // faixa de titulo de cada painel (so no modo grade)
const TIRA = 34;      // tira de abas (so no modo abas)
const VAO = 4;

let config = null;
let win = null;
let maximizado = null;
let abaAtiva = 0;
let avisoAtual = '';
let avisoTimer = null;
// Painel encaixado e janela nativa: nada desenhado em HTML aparece por cima dele. Entao o aviso
// nao pode flutuar sobre os paineis, ele ocupa uma faixa propria e empurra todo mundo pra baixo.
const topoAtual = () => TOPO + (avisoAtual ? FAIXA_AVISO : 0);
const paineis = [];
const ehAbas = () => config.modo === 'abas';

// A casca e so uma barra e umas faixas de texto: nao precisa de GPU. Desligar aqui devolve
// placa de video e memoria pros paineis do jogo, que sao quem precisa.
app.disableHardwareAcceleration();

if (process.env.ELECTRON_USER_DATA) app.setPath('userData', process.env.ELECTRON_USER_DATA);
const arqConfig = () => process.env.QV_CONFIG || path.join(app.getPath('userData'), 'config.json');
const pastaPerfis = () => path.join(app.getPath('userData'), 'perfis');

// Icone do app. No exe o Windows ja pega o icone do proprio executavel, mas a janela e a barra
// de tarefas so mostram o desenho certo se ele for apontado aqui tambem (e no modo de teste tambem).
const arqIcone = () => {
  // .ico no Windows; nos testes em Linux o Electron so entende PNG.
  const nome = process.platform === 'win32' ? 'icon.ico' : 'icone-256.png';
  const p = path.join(__dirname, '..', 'build', nome)
    .replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  try { return fs.existsSync(p) ? p : undefined; } catch (_) { return undefined; }
};

const { migrar } = require('./migracao');
const extensoes = require('./extensoes');

function carregarConfig() {
  for (const p of [arqConfig(), path.join(app.getAppPath(), 'config.json')]) {
    try {
      const c = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (c && Array.isArray(c.perfis) && c.perfis.length) return migrar({ ...PADRAO, ...c });
    } catch (_) {}
  }
  return migrar(JSON.parse(JSON.stringify(PADRAO)));
}
const salvarConfig = () => { try { fs.writeFileSync(arqConfig(), JSON.stringify(config, null, 2)); } catch (_) {} };

// Endereco de painel so pode ser pagina da web. Vazio continua valendo (painel segue o endereco
// geral do app). Sem isso daria para salvar um file:// ou javascript: na configuracao, que depois
// viraria o --app= do navegador e o alvo do botao "ir para o login".
function urlDePagina(valor) {
  const t = String(valor == null ? '' : valor).trim();
  if (!t) return '';
  try { return ['http:', 'https:'].includes(new URL(t).protocol) ? t : ''; } catch (_) { return ''; }
}

function acharChrome() {
  if (process.env.QV_CHROME && fs.existsSync(process.env.QV_CHROME)) return process.env.QV_CHROME;
  if (config && config.navegador && fs.existsSync(config.navegador)) return config.navegador;
  // Edge primeiro por ser o que ja vem no Windows. Chrome tambem serve: o controle do app
  // vai pela porta de depuracao do navegador, entao nao depende de instalar nada em perfil.
  const cands = process.platform === 'win32'
    ? [
        `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${process.env['ProgramFiles']}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${process.env['ProgramFiles']}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      ]
    : ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return cands.find((c) => c && fs.existsSync(c)) || null;
}

// Porta ocupada (outra copia do app, outro programa, navegador que ficou de pe) faria o painel
// perder o controle em silencio. Entao procuro uma porta que esteja realmente livre.
function portaEstaLivre(porta) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(porta, '127.0.0.1');
  });
}
async function escolherPorta(base) {
  for (let porta = base; porta < base + 60; porta++) {
    if (usadas.has(porta)) continue;
    if (await portaEstaLivre(porta)) { usadas.add(porta); return porta; }
  }
  return base;
}
const usadas = new Set();

// No Linux (testes) descubro os processos do perfil lendo /proc; no Windows quem faz isso e o script PowerShell.
function pidsDoPerfil(perfil) {
  if (process.platform === 'win32') return [];
  const achados = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8');
      if (cmd.includes(perfil) && !cmd.includes('--type=')) achados.push(Number(d));
    } catch (_) {}
  }
  return achados;
}

// ---------- geometria ----------
// O encaixe fala em pixels de verdade; o Electron fala em pontos. A escala do monitor faz a ponte.
const escala = () => (win ? screen.getDisplayMatching(win.getBounds()).scaleFactor : 1);

function celulas() {
  const [L, A] = win.getContentSize();
  if (ehAbas()) {
    const cheia = { x: 0, y: topoAtual() + TIRA, width: L, height: Math.max(0, A - topoAtual() - TIRA) };
    return paineis.map((p, i) => ({ i, grade: cheia, celula: cheia }));
  }
  const alturaArea = Math.max(0, A - topoAtual());
  const doJogo = paineis.filter((p) => !p.extra).length || paineis.length;
  const cols = doJogo <= 2 ? doJogo : 2;
  const linhas = doJogo <= 2 ? 1 : 2;
  const cl = Math.floor((L - (cols - 1) * VAO) / cols);
  const ca = Math.floor((alturaArea - (linhas - 1) * VAO) / linhas);
  return paineis.map((p, i) => {
    const col = i % cols;
    const lin = Math.floor(i / cols);
    const grade = {
      x: col * (cl + VAO),
      y: topoAtual() + lin * (ca + VAO),
      width: col === cols - 1 ? L - col * (cl + VAO) : cl,
      height: lin === linhas - 1 ? A - (topoAtual() + lin * (ca + VAO)) : ca,
    };
    const cheia = { x: 0, y: topoAtual(), width: L, height: A - topoAtual() };
    return { i, grade, celula: maximizado === i ? cheia : grade };
  });
}

// No modo abas quem mostra nome e status e a tira de abas, entao o painel nao tem faixa propria.
const corpo = (c) => {
  const alto = ehAbas() ? 0 : CABECA;
  return { x: c.x, y: c.y + alto, w: c.width, h: Math.max(0, c.height - alto) };
};
const emPixels = (r) => { const s = escala(); return { x: Math.round(r.x * s), y: Math.round(r.y * s), w: Math.round(r.w * s), h: Math.round(r.h * s) }; };
const recorteEmPixels = () => Math.max(0, Math.round((Number(config.recorteTitulo) || 0) * escala()));

// A janela sobe o tanto da barra de titulo do Chrome e cresce o mesmo tanto; depois recorto
// essa faixa da regiao visivel. Resultado: a area util do jogo cai exatamente na celula.
function comRecorte(px) {
  const r = recorteEmPixels();
  return { x: px.x, y: px.y - r, w: px.w, h: px.h + r, recorte: r };
}
// Nos modos em que os paineis se sobrepoem (abas, ou um maximizado sobre a grade), levantar os de
// tras a cada layout os traz por um instante para a frente do que esta visivel: o painel da frente e
// coberto e descoberto, e isso e uma piscada a cada ronda. Ali so o da frente e levantado; os outros
// ja estao atras dele e nao recebem clique nenhum. Na grade ninguem se sobrepoe, e todos sobem
// (a janela invisivel do app volta por cima deles depois de minimizar ou redimensionar).
const sobrepostos = () => ehAbas() || maximizado !== null;
const deveLevantar = (frente) => frente || !sobrepostos();
// Aba extra nao mora na grade: fora do modo abas ela fica escondida de verdade (ShowWindow), e nao
// so empurrada para uma terceira linha fora da area. Empurrada, a barra de titulo dela ainda
// espiava pelos ultimos pixels do app sempre que o Chrome zerava o recorte.
const deveAparecer = (p) => !(p.extra && !ehAbas());
function itemDeLayout(p, retangulo, frente) {
  const alvo = comRecorte(emPixels(retangulo));
  return { alca: p.alca, x: alvo.x, y: alvo.y, w: alvo.w, h: alvo.h, recorte: alvo.recorte, frente,
    levantar: deveLevantar(frente), visivel: deveAparecer(p) };
}

let alcaPai = null;
function handleDaJanela() {
  if (alcaPai) return alcaPai;
  const b = win.getNativeWindowHandle();
  alcaPai = (b.length === 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0))).toString();
  return alcaPai;
}

let posicionando = false;
let posicionarDeNovo = false;
async function posicionar() {
  if (!win || win.isDestroyed()) return;
  if (posicionando) { posicionarDeNovo = true; return; } // nao empilha chamadas durante o arrasto
  posicionando = true;
  try {
    const cs = celulas();
    const itens = [];
    for (const c of cs) {
      const p = paineis[c.i];
      if (!p.alca || p.solto) continue;
      const noTopo = ehAbas() ? abaAtiva === c.i : maximizado === c.i;
      const alvo = ehAbas() || maximizado === null || maximizado === c.i ? c.celula : c.grade;
      itens.push(itemDeLayout(p, corpo(alvo), noTopo));
    }
    if (itens.length) {
      itens.sort((a, b) => (a.frente ? 1 : 0) - (b.frente ? 1 : 0)); // o da frente por ultimo: termina por cima
      const r = await janelas.moverLote(itens, handleDaJanela());
      // Painel que nao aceitou o tamanho pedido vira aviso em vez de ficar torto em silencio.
      const fora = (r && r.fora) || [];
      for (const p of paineis) {
        const caso = fora.find((f) => String(f.alca) === String(p.alca));
        p.foraDoLugar = caso ? `janela não aceitou o tamanho (pedi ${caso.querido}, ficou ${caso.obtido})` : '';
      }
    }
    empurrar(cs);
  } finally {
    posicionando = false;
    if (posicionarDeNovo) { posicionarDeNovo = false; posicionar(); }
  }
}

// ---------- teclado ----------
// A janela do painel e de outro processo. Clique chega nela por posicao na tela, mas TECLA vai por
// foco, e foco so existe dentro de uma fila de entrada: enquanto as filas do app e do navegador
// estiverem separadas, o que a pessoa digita morre na fila do app. Quem gruda as duas e o encaixe;
// aqui eu so digo qual painel deve ficar com o teclado.
let focoAtual = 0;
const painelDoTeclado = () => {
  if (ehAbas()) return abaAtiva;
  if (maximizado !== null) return maximizado;
  return focoAtual;
};
async function darTeclado(i) {
  const p = paineis[i];
  if (!p || !p.alca || p.solto || !win || win.isDestroyed()) return;
  focoAtual = i;
  await janelas.focar(p.alca, handleDaJanela());
  empurrar();
}

// Quando a pessoa clica DENTRO de um painel, esse clique nao passa pelo app: e o navegador que pega
// o teclado sozinho. O app nao fica sabendo. Enquanto ele supunha que o teclado estava no painel que
// ele mesmo tinha escolhido por ultimo (o primeiro, no comeco), qualquer evento de foco da janela
// puxava o teclado de volta pra la. Era isso que deixava so a Conta 1 digitando, independentemente
// do resto. Entao aqui eu PERGUNTO ao Windows quem esta com o foco, em vez de supor.
async function sincronizarFoco() {
  if (!win || win.isDestroyed()) return null;
  const r = await janelas.quemTemFoco(handleDaJanela());
  const alca = r && r.alca ? String(r.alca) : '';
  if (!alca || alca === '0') return null;
  const achado = paineis.findIndex((p) => p.alca && String(p.alca) === alca && !p.solto);
  if (achado < 0) return null;
  if (achado !== focoAtual) { focoAtual = achado; empurrar(); }
  return achado;
}
// O app so toma o teclado pra si quando ninguem de dentro esta com ele.
async function garantirTeclado() {
  if (await sincronizarFoco() !== null) return;
  await darTeclado(painelDoTeclado());
}
// Depois de mudar o layout o teclado tem de acompanhar o painel que ficou na frente, senao a pessoa
// troca de aba e continua digitando no painel anterior, que nem esta mais visivel. Aqui a troca e
// deliberada (ela pediu a aba ou o maximizar), entao pode mandar mesmo.
const teclado = () => setTimeout(() => darTeclado(painelDoTeclado()), 120);

// ---------- abrir e encaixar ----------
async function abrirPainel(i) {
  const p = paineis[i];
  if (p.alca || p.abrindo) return;
  const chrome = acharChrome();
  if (!chrome) { avisar('Não encontrei o Chrome nem o Edge instalados.'); return; }
  p.abrindo = true;
  p.erro = '';
  empurrar();

  const perfil = path.join(pastaPerfis(), p.slug);
  fs.mkdirSync(perfil, { recursive: true });
  if (p.portaDebug) usadas.delete(p.portaDebug);
  p.portaDebug = await escolherPorta(Number(config.porta || 47900) + i);
  // Nasce ja na posicao final, em coordenada de tela: assim nao existe o pulo de "abriu ali e foi pra ca".
  const cx = corpo(celulas()[i].celula);
  const area = win.getContentBounds();
  const args = [
    `--user-data-dir=${perfil}`,
    // Janela de aplicativo (sem barra de endereco). Abrir em branco daria tempo de instalar o
    // observador antes do jogo, mas tira o modo aplicativo e traz a barra de volta; entao abro
    // no jogo mesmo e recarrego uma vez assim que o observador entra.
    `--app=${p.url || config.url}`,
    `--window-position=${Math.round(area.x + cx.x)},${Math.round(area.y + cx.y - (Number(config.recorteTitulo) || 0))}`,
    `--window-size=${Math.max(400, Math.round(cx.w))},${Math.max(300, Math.round(cx.h + (Number(config.recorteTitulo) || 0)))}`,
    `--remote-debugging-port=${p.portaDebug}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    // Sem isso o navegador acha que a janela filha esta encoberta (app minimizado) e para de desenhar.
    '--disable-features=CalculateNativeWinOcclusion',
  ];
  if (config.argsExtras) args.push(...String(config.argsExtras).split(' ').filter(Boolean));
  if (process.env.QV_CHROME_ARGS) args.push(...process.env.QV_CHROME_ARGS.split(' ').filter(Boolean));
  p.proc = spawn(chrome, args, { stdio: 'ignore' });
  // Navegador fechado por fora (a pessoa clicou no X do Chrome, ou ele caiu) nunca devolvia a porta
  // de depuracao reservada. Numa sessao longa, abrir e fechar paineis ia consumindo a faixa de
  // portas a toa. O painel em si nao e derrubado aqui de proposito: sem ponte ele ja aparece como
  // "ligando o controle do navegador..." com o botao de reabrir.
  const portaDeste = p.portaDebug;   // a do processo QUE ESTA SAINDO: o painel pode ja ter outra
  p.proc.on('error', () => {});   // spawn que falha nao pode virar excecao sem dono no processo principal
  p.proc.on('exit', () => { if (p.portaDebug !== portaDeste) return; usadas.delete(portaDeste); });
  p.perfilDir = perfil;
  prepararPonte(p);

  // A janela do Chrome demora um pouco para existir; procuro ate achar.
  const inicio = Date.now();
  const limite = inicio + 25000;
  while (Date.now() < limite) {
    // Quanto antes eu achar, menos tempo ela fica solta na tela e na barra de tarefas. Enquanto
    // a busca e pelo processo (barata), pergunto a cada 100 ms.
    const rapido = Date.now() - inicio < 8000 && !!p.proc;
    await new Promise((r) => setTimeout(r, rapido ? 100 : 200));
    if (!p.abrindo) return; // cancelado
    // Primeiro pelo processo lancado (rapido). Se em 8 s a janela nao apareceu nele, volto a
    // procurar pelo perfil, que cobre navegador lancado por um processo intermediario.
    const r = await janelas.achar(perfil, pidsDoPerfil(perfil), rapido ? p.proc.pid : 0);
    if (r.ok && r.alca) {
      p.alca = r.alca;
      const enc = await janelas.encaixar(p.alca, handleDaJanela(), { ...comRecorte(emPixels(corpo(celulas()[i].celula))), visivel: deveAparecer(p) });
      if (!enc.ok) { p.erro = `não consegui encaixar (${enc.erro || 'erro'})`; p.solto = true; }
      p.abrindo = false;
      await posicionar();
      // Painel que nasceu ja sendo o da frente comeca com o teclado: da pra digitar sem clicar antes.
      if (!p.solto && painelDoTeclado() === i) await darTeclado(i);
      return;
    }
  }
  // Se nao consegui encaixar mas o navegador subiu (a ponte respondeu), o painel segue util
  // em janela propria em vez de aparecer como fechado com o jogo rodando na tela.
  p.abrindo = false;
  if (temPonte(p)) { p.solto = true; p.soltoPorFalha = true; p.erro = 'não consegui encaixar: tentando de novo'; }
  else p.erro = 'a janela do navegador não apareceu';
  empurrar();
}

async function fecharPainel(i) {
  const p = paineis[i];
  p.abrindo = false;
  if (p.alca) await janelas.fechar(p.alca, handleDaJanela());
  if (p.proc) { try { process.platform === 'win32' ? execFile('taskkill', ['/PID', String(p.proc.pid), '/T', '/F'], () => {}) : p.proc.kill(); } catch (_) {} }
  if (p.sessao) { p.sessao.fechar(); p.sessao = null; }
  if (p.portaDebug) { usadas.delete(p.portaDebug); p.portaDebug = null; }
  p.alca = null; p.solto = false; p.estado = null; p.diag = null; p.proc = null;
  if (maximizado === i) maximizado = null;
  empurrar();
}

async function destacar(i) {
  const p = paineis[i];
  p.soltoPorFalha = false; // solto de propósito: o app nao fica tentando encaixar de volta
  if (!p.alca || p.solto) return;
  if (maximizado === i) maximizado = null;
  const b = win.getBounds();
  await janelas.soltar(p.alca, { x: b.x + 60, y: b.y + 60, w: 1000, h: 700, pai: handleDaJanela() });
  p.solto = true;
  await posicionar();
}

async function encaixarDeVolta(i) {
  const p = paineis[i];
  if (!p.solto) return;
  if (!p.alca) { // encaixe falhou antes: procuro a janela de novo
    const r = await janelas.achar(p.perfilDir, pidsDoPerfil(p.perfilDir || ''), p.proc && p.proc.pid);
    if (!r.ok) { p.erro = `não achei a janela (${r.erro || 'erro'})`; empurrar(); return; }
    p.alca = r.alca;
  }
  const r = await janelas.encaixar(p.alca, handleDaJanela(), { ...comRecorte(emPixels(corpo(celulas()[i].celula))), visivel: deveAparecer(p) });
  if (r.ok) { p.solto = false; p.soltoPorFalha = false; p.erro = ''; }
  else p.erro = `não consegui encaixar de volta (${r.erro || 'erro'})`;
  await posicionar();
}

// ---------- cofre de acesso ----------
// Senha cifrada pelo safeStorage (DPAPI no Windows: so o seu usuario do Windows decifra).
let credsPath = null;
let credsCache = null;
function lerCreds() {
  if (!credsCache) { try { credsCache = JSON.parse(fs.readFileSync(credsPath, 'utf8')); } catch (_) { credsCache = {}; } }
  return credsCache;
}
function gravarCreds(todos) { credsCache = todos; try { fs.writeFileSync(credsPath, JSON.stringify(todos)); } catch (_) {} }
function pegarCreds(slug) {
  const c = lerCreds()[slug];
  if (!c || !c.user || !c.pass) return null;
  try { return { user: c.user, pass: safeStorage.decryptString(Buffer.from(c.pass, 'base64')) }; } catch (_) { return null; }
}
const temCreds = (slug) => { const c = lerCreds()[slug]; return !!(c && c.user && c.pass); };
// Todo canal de IPC confere que quem mandou e uma janela do proprio app (arquivo local). O jogo roda
// num navegador de verdade e nao tem IPC nenhum, entao isso e cinto de seguranca: vale para o dia em
// que alguma janela do app carregar conteudo que nao seja nosso.
const daCasca = (e) => !!e.senderFrame && e.senderFrame.url.startsWith('file://');
// Indice de painel vindo da casca. Fora da faixa, um `paineis[i].algo` estoura no processo principal
// e derruba o app inteiro; aqui a acao so e descartada.
const painelValido = (i) => Number.isInteger(i) && i >= 0 && i < paineis.length;

function janelaDeConfig() {
  if (janelaDeConfig.aberta && !janelaDeConfig.aberta.isDestroyed()) { janelaDeConfig.aberta.focus(); return; }
  const cw = new BrowserWindow({
    parent: win, modal: true, width: 520, height: 800, resizable: true, minimizable: false, maximizable: false,
    title: 'Configuração · QuadView', backgroundColor: '#0a0f18', autoHideMenuBar: true, icon: arqIcone(),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  cw.setMenuBarVisibility(false);
  cw.loadFile(path.join(__dirname, 'config.html'));
  cw.on('closed', () => { janelaDeConfig.aberta = null; });
  janelaDeConfig.aberta = cw;
}

function janelaDeExtensoes() {
  if (janelaDeExtensoes.aberta && !janelaDeExtensoes.aberta.isDestroyed()) { janelaDeExtensoes.aberta.focus(); return; }
  const cw = new BrowserWindow({
    parent: win, modal: true, width: 560, height: 620, resizable: true, minimizable: false, maximizable: false,
    title: 'Extensões · QuadView', backgroundColor: '#0a0f18', autoHideMenuBar: true, icon: arqIcone(),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  cw.setMenuBarVisibility(false);
  cw.loadFile(path.join(__dirname, 'extensoes.html'));
  cw.on('closed', () => { janelaDeExtensoes.aberta = null; });
  janelaDeExtensoes.aberta = cw;
}

// Ligar, desligar ou atualizar extensao so vale no proximo carregamento da pagina, entao os paineis
// do jogo que mudaram sao recarregados. Painel extra (PIW Tools, PokePedia) nao e tocado.
async function aplicarExtensoes() {
  const fontes = extensoes.fontesAtivas();
  let recarregados = 0;
  for (const p of paineis) {
    if (p.extra || !temPonte(p)) continue;
    if (await p.sessao.sincronizarExtensoes(fontes)) { await p.sessao.recarregar(false); recarregados++; }
  }
  return recarregados;
}

function janelaDeAcesso(i) {
  const cw = new BrowserWindow({
    parent: win, modal: true, width: 440, height: 470, resizable: false, minimizable: false, maximizable: false,
    title: `Acesso · ${paineis[i].nome}`, backgroundColor: '#0a0f18', autoHideMenuBar: true, icon: arqIcone(),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  cw.setMenuBarVisibility(false);
  cw.loadFile(path.join(__dirname, 'creds.html'), { query: { i: String(i), nome: paineis[i].nome } });
}

// Preenche usuario e senha na tela de login. A verificacao anti-bot e o clique em Entrar
// continuam com a pessoa: o app nao toca no widget nem envia o formulario.
const METODOS = ['formulario', 'google', 'nenhum'];
const metodoPadrao = () => config.metodoLogin || (config.preencherLogin === false ? 'nenhum' : 'formulario');
// Cada painel pode ter o proprio jeito de entrar (uma conta com usuario e senha, outra com Google).
// Vazio no perfil = segue o padrao do app.
function metodoDoPainel(p) {
  const perfil = (config.perfis || []).find((x) => x.slug === p.slug);
  return perfil && METODOS.includes(perfil.metodoLogin) ? perfil.metodoLogin : metodoPadrao();
}

function preencherLogin(p, forcar) {
  const metodo = metodoDoPainel(p);
  if (metodo === 'nenhum' && !forcar) return;
  if (p.extra) return;
  if (!forcar && Date.now() - (p.ultimoPreenche || 0) < 15000) return;

  if (metodo === 'google') {
    p.ultimoPreenche = Date.now();
    // So o clique no botao. O que vem depois (escolher conta, senha, 2FA) e da pessoa:
    // o app nunca digita senha em pagina do Google.
    if (temPonte(p)) {
      // O botao do Google costuma ser um quadro de outro site, onde o app nao alcanca (nem deve). So
      // aviso que cliquei quando houve mesmo um botao da pagina para clicar.
      p.sessao.chamar('google').then((clicou) => {
        if (clicou) { p.alerta = 'Cliquei em "Entrar com Google": se pedir conta ou senha, é com você'; empurrar(); }
      });
    }
    return;
  }

  const c = pegarCreds(p.slug);
  if (!c) { if (forcar) avisar(`Cadastre o acesso de ${p.nome} na chave da faixa.`); return; }
  p.ultimoPreenche = Date.now();
  if (temPonte(p)) {
    p.sessao.chamar('preencher', c.user, c.pass);
    p.alerta = 'Login preenchido: confirme a verificação e clique em Entrar';
    empurrar();
  }
}

// ---------- ponte com o navegador (porta de depuracao) ----------
// Liga a ponte e recarrega uma vez: so a partir do documento novo o observador esta presente
// desde o inicio, que e o que permite ver o WebSocket que o jogo abre na largada.
async function prepararPonte(p) {
  const limite = Date.now() + 25000;
  while (Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 300));
    if (!p.proc) return;
    if (await ligarPonte(p)) {
      await p.sessao.recarregar(false);
      p.ultimaTentativa = Date.now();
      empurrar();
      return;
    }
  }
}

async function ligarPonte(p) {
  if (!p.sessao) p.sessao = new Sessao(p.portaDebug);
  const alvo = (() => { try { return new URL(p.url || config.url).hostname; } catch (_) { return ''; } })();
  const ok = await p.sessao.conectar(alvo);
  if (ok) {
    p.visto = Date.now();
    // Extensoes so nos paineis do jogo. Entram aqui, antes do recarregamento inicial, pra rodarem
    // desde o comeco do documento, que e o que o PIW-QOL pede (@run-at document-start).
    await p.sessao.sincronizarExtensoes(p.extra ? [] : extensoes.fontesAtivas());
  }
  return ok;
}

const temPonte = (p) => !!(p.sessao && p.sessao.ligada);

async function lerEstado(p) {
  if (!temPonte(p)) return;
  const e = await p.sessao.estado();
  if (!e) {
    // Durante um reload a pagina fica alguns instantes sem o observador. Isso nao e a ponte cair:
    // reinjeto e so desisto depois de tres leituras seguidas sem resposta.
    p.falhasDeLeitura = (p.falhasDeLeitura || 0) + 1;
    if (p.falhasDeLeitura >= 3) p.sessao.ligada = false;
    else await ligarPonte(p);
    return;
  }
  p.falhasDeLeitura = 0;
  p.visto = Date.now();
  p.estado = { ...e, mutacoesRecentes: e.mutacoes };
  if (e.mutacoes > 0) p.paradoDesde = null;
  else if (!p.paradoDesde) p.paradoDesde = Date.now();
  if (p.mudo && e.mudo === false) p.sessao.chamar('mudo', true);
  if (e.naTelaDeLogin) preencherLogin(p);
  else if (p.alerta && (p.alerta.startsWith('Login preenchido') || p.alerta.startsWith('Cliquei'))) p.alerta = '';
}

// A ronda e assincrona e o relogio nao espera: painel lento (a leitura de estado espera ate 8 s)
// fazia a ronda seguinte comecar por cima da anterior, e duas rondas juntas reinjetam o observador
// e disputam a mesma sessao. Uma de cada vez.
let emRonda = false;
async function rondaDeEstado() {
  if (emRonda) return;
  emRonda = true;
  try {
    for (const p of paineis) {
      if (!p.alca && !p.proc) continue;
      if (!temPonte(p)) { await ligarPonte(p); continue; }
      await lerEstado(p);
    }
    empurrar();
  } finally { emRonda = false; }
}

const recarregar = (i, semCache) => {
  const p = paineis[i];
  if (!temPonte(p)) return;
  p.ultimaTentativa = Date.now();
  p.sessao.recarregar(semCache);
};
const som = (i, mudo) => {
  const p = paineis[i];
  p.mudo = mudo;
  if (temPonte(p)) p.sessao.chamar('mudo', mudo);
  empurrar();
};

// ---------- saude ----------
const MAX_TENTATIVAS = 3;
const ESPERA_MS = Number(process.env.QV_ESPERA_MS) || 90 * 1000;
const ESTAVEL_MS = Number(process.env.QV_ESTAVEL_MS) || 60 * 1000;

function diagnostico(p) {
  if (p.abrindo) return { cod: 'ligando', txt: 'abrindo...' };
  if (!p.alca && !temPonte(p)) return { cod: 'fechado', txt: p.erro || 'fechado' };
  if (p.solto) return { cod: 'solto', txt: p.erro || 'em janela própria' };
  if (p.foraDoLugar) return { cod: 'parado', txt: p.foraDoLugar };
  if (!temPonte(p)) return { cod: 'semponte', txt: 'ligando o controle do navegador...' };
  const e = p.estado;
  if (!e) return { cod: 'ligando', txt: 'carregando...' };
  // A aba extra nao e o jogo: nada de diagnostico de conexao de jogo nela.
  if (p.extra) return { cod: 'ok', txt: e.titulo || 'aberta' };
  if (Date.now() - (p.visto || 0) > 30000) return { cod: 'travado', txt: 'página não responde' };
  if (e.naTelaDeLogin) return { cod: 'login', txt: 'caiu na tela de login' };
  if (!e.online) return { cod: 'offline', txt: 'sem internet' };
  if (e.textoDeQueda) return { cod: 'queda', txt: 'jogo avisou desconexão' };
  // O socket do jogo caiu e nao voltou: e queda, sem precisar esperar um tempao de silencio.
  if (e.socketDoJogoAberto === false && e.segundosSemSocket != null && e.segundosSemSocket > 20) {
    return { cod: 'mudo', txt: 'conexão do jogo caiu' };
  }
  if (e.socketsAbertos === 0 && e.segundosSemDado > 60 && e.mutacoesRecentes === 0) return { cod: 'mudo', txt: 'sem sinal do servidor' };
  if (config.detectarTravado && p.paradoDesde && Date.now() - p.paradoDesde > config.minutosTravado * 60000) {
    return { cod: 'parado', txt: `parado há ${config.minutosTravado} min` };
  }
  return { cod: 'ok', txt: 'rodando' };
}

let tentativasDeEncaixe = 0;
let emRondaDeJanelas = false;
async function rondaDeJanelas() {
  if (emRondaDeJanelas || !win || win.isDestroyed() || win.isMinimized()) return;
  emRondaDeJanelas = true;
  try {
    // Reposicionar de novo conserta painel que saiu do lugar sozinho (janela que o navegador
    // redimensionou por conta propria, por exemplo).
    await posicionar();
    // Encaixe que falhou tenta de novo, sem insistir pra sempre.
    const falhos = paineis.filter((p) => p.solto && p.soltoPorFalha && p.alca);
    if (falhos.length && tentativasDeEncaixe < 6) {
      tentativasDeEncaixe++;
      for (const p of falhos) await encaixarDeVolta(p.i);
    }
  } finally { emRondaDeJanelas = false; }
}

function vigiar() {
  for (const p of paineis) {
    const d = diagnostico(p);
    p.diag = d;
    if (!config.reconectar || p.extra) continue; // aba extra nao e o jogo: nada de reconectar sozinho
    if (!['travado', 'queda', 'mudo', 'parado', 'offline'].includes(d.cod)) {
      if (d.cod !== 'ok') { p.okDesde = null; continue; }
      if (!p.okDesde) p.okDesde = Date.now();
      // Logo depois de recarregar a pagina finge estar bem; so limpo o aviso depois de um tempo saudavel.
      if (Date.now() - p.okDesde > ESTAVEL_MS) { p.tentativas = 0; p.alerta = ''; }
      continue;
    }
    p.okDesde = null;
    if (d.cod === 'login') continue;
    if (Date.now() - (p.ultimaTentativa || 0) < ESPERA_MS) continue;
    if (p.tentativas >= MAX_TENTATIVAS) { p.alerta = `Não consegui reconectar (${d.txt}). Precisa de você.`; continue; }
    p.tentativas++;
    p.alerta = `Reconectando (${p.tentativas}/${MAX_TENTATIVAS}): ${d.txt}`;
    recarregar(p.i, p.tentativas > 1);
  }
  empurrar();
}

// ---------- casca ----------
function empurrar(cs) {
  if (!win || win.isDestroyed()) return;
  const celulasAtuais = cs || celulas();
  win.webContents.send('estado', {
    config, maximizado, cabeca: CABECA, tira: TIRA, topo: topoAtual(), topoBase: TOPO,
    faixaAviso: FAIXA_AVISO, aviso: avisoAtual, abaAtiva, modo: config.modo,
    paineis: paineis.map((p, i) => ({
      i, nome: p.nome, extra: !!p.extra, soltoPorFalha: !!p.soltoPorFalha, aberto: !!(p.alca || temPonte(p)), abrindo: !!p.abrindo, solto: !!p.solto, mudo: !!p.mudo,
      temCreds: temCreds(p.slug), metodo: p.extra ? 'nenhum' : metodoDoPainel(p),
      erro: p.erro || '',
      diag: p.diag || diagnostico(p), alerta: p.alerta || '',
      escondido: ehAbas() ? abaAtiva !== i : maximizado !== null && maximizado !== i,
      teclado: focoAtual === i && !!p.alca && !p.solto,
      celula: celulasAtuais[i].celula,
    })),
  });
}
function avisar(t) {
  avisoAtual = t || '';
  clearTimeout(avisoTimer);
  if (avisoAtual) avisoTimer = setTimeout(() => { avisoAtual = ''; posicionar(); }, 20000);
  posicionar();
}

function criarJanela() {
  win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 900, minHeight: 620,
    title: 'QuadView', backgroundColor: '#0a0f18', autoHideMenuBar: true, show: false, icon: arqIcone(),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'casca.html'));
  win.once('ready-to-show', () => { win.show(); if (process.env.QV_TEST) console.log('QVPAI ' + handleDaJanela()); });
  win.webContents.on('did-finish-load', () => empurrar());
  let debounce = null;
  // Segundo passe atrasado: o Windows reordena as janelas filhas DEPOIS do evento de tamanho, e um
  // passe so as vezes chega antes disso.
  let debounce2 = null;
  const reposicionar = () => {
    clearTimeout(debounce); debounce = setTimeout(posicionar, 80);
    clearTimeout(debounce2); debounce2 = setTimeout(posicionar, 500);
  };
  // Quando o app volta pra frente, o teclado vai pro painel ativo SE ninguem de dentro ja estiver
  // com ele. Mandar sem perguntar era o que puxava tudo de volta pra Conta 1.
  win.on('focus', () => { reposicionar(); setTimeout(garantirTeclado, 150); });
  // Volta do minimizado. O evento de restaurar chega ANTES de a janela estar de pe, e mexer nos
  // paineis nessa hora nao tem efeito nenhum (era por isso que as correcoes anteriores nao pegavam,
  // enquanto trocar de aba, que acontece depois, funcionava). Entao refaço o encaixe com atraso,
  // duas vezes, e o segundo passe cobre maquina lenta.
  // Cada volta tinha ate seis passes (restore, show e focus disparam juntos), e cada passe
  // reencaixava os quatro paineis com redimensionamento e repintura forcada. Redimensionar uma
  // janela do Chrome faz o compositor dele refazer a superficie: e um quadro em branco por
  // painel, a "piscada". Agora a volta so confere (pai, posicao, tamanho, visivel) e levanta;
  // a danca completa fica para painel que estiver de fato fora do lugar. O congelamento que a
  // danca curava e resolvido pela flag CalculateNativeWinOcclusion desligada no navegador.
  let acordando = false;
  async function acordarPaineis() {
    if (acordando || !win || win.isDestroyed() || win.isMinimized()) return;
    acordando = true;
    try {
      const cs = celulas();
      const daFrente = ehAbas() ? abaAtiva : maximizado;
      const ordem = paineis.filter((p) => p.alca && !p.solto).sort((a, b) => (a.i === daFrente) - (b.i === daFrente));
      let todosNoLugar = ordem.length > 0;
      let completos = 0;
      for (const p of ordem) { // o painel da frente por ultimo, pra terminar por cima e com o foco
        const c = cs[p.i];
        const frente = p.i === daFrente;
        const alvo = ehAbas() || maximizado === null || maximizado === p.i ? c.celula : c.grade;
        const r = await janelas.reencaixar(p.alca, handleDaJanela(), { ...comRecorte(emPixels(corpo(alvo))), levantar: deveLevantar(frente), visivel: deveAparecer(p) });
        if (!r || !r.ok || r.noLugar === false) todosNoLugar = false;
        if (r && r.completo) completos++;
      }
      if (process.env.QV_TEST) console.log('QVVOLTA ' + JSON.stringify({ paineis: ordem.length, todosNoLugar, completos }));
      await posicionar();
      await garantirTeclado(); // volta do minimizado tem de voltar com teclado tambem
    } finally { acordando = false; }
  }
  let voltaTimers = [];
  const aoVoltar = () => {
    // restore e show chegam juntos: uma agenda so, nao duas.
    voltaTimers.forEach(clearTimeout);
    clearTimeout(debounce); clearTimeout(debounce2); // acordar ja posiciona; o passe do focus seria repetido
    voltaTimers = [setTimeout(acordarPaineis, 250), setTimeout(acordarPaineis, 1100)];
  };
  win.on('restore', aoVoltar);
  win.on('show', aoVoltar);
  win.on('resize', reposicionar);
  win.on('maximize', reposicionar);
  win.on('unmaximize', reposicionar);
  win.on('close', async () => { for (const p of paineis) if (p.alca) await janelas.fechar(p.alca, handleDaJanela()); });
  win.on('closed', () => { win = null; app.quit(); });
}

// Acoes que mexem num painel especifico: sem um indice valido elas estourariam no processo
// principal (paineis[i] indefinido) e derrubariam o app.
const ACOES_COM_PAINEL = new Set(['abrir', 'fechar', 'maximizar', 'aba', 'foco', 'destacar', 'encaixar',
  'recarregar', 'som', 'ir-login', 'acesso', 'preencher', 'reabrir', 'falha-teste', 'navegar-teste',
  'metodo-painel-teste', 'creds-teste']);

function executarAcao({ acao, i, valor }) {
  if (ACOES_COM_PAINEL.has(acao) && !painelValido(i)) return;
  switch (acao) {
    case 'abrir': abrirPainel(i); break;
    case 'fechar': fecharPainel(i); break;
    case 'abrir-todos': paineis.forEach((p, k) => setTimeout(() => abrirPainel(k), k * 250)); break;
    case 'fechar-todos': paineis.forEach((p) => fecharPainel(p.i)); break;
    case 'maximizar':
      if (ehAbas()) { abaAtiva = i; posicionar(); teclado(); break; }
      maximizado = maximizado === i ? null : i; if (maximizado === null) focoAtual = i; posicionar(); teclado(); break;
    case 'grade': config.modo = 'grade'; maximizado = null; salvarConfig(); posicionar(); teclado(); break;
    case 'abas': config.modo = 'abas'; maximizado = null; if (i != null) abaAtiva = i; salvarConfig(); posicionar(); teclado(); break;
    case 'modo': config.modo = ehAbas() ? 'grade' : 'abas'; maximizado = null; salvarConfig(); posicionar(); teclado(); break;
    case 'aba': abaAtiva = i; if (!ehAbas()) { config.modo = 'abas'; salvarConfig(); } posicionar(); teclado(); break;
    case 'foco': darTeclado(i); break;
    case 'destacar': destacar(i); break;
    case 'encaixar': encaixarDeVolta(i); break;
    case 'recarregar': recarregar(i, valor); break;
    case 'recarregar-todos': paineis.forEach((p) => recarregar(p.i, false)); break;
    case 'som': som(i, valor); break;
    case 'som-todos': { const alvo = !paineis.every((p) => p.mudo); paineis.forEach((p) => som(p.i, alvo)); break; }
    case 'ir-login': if (temPonte(paineis[i])) paineis[i].sessao.navegar(new URL('/login', config.url).href); break;
    case 'acesso': janelaDeAcesso(i); break;
    case 'config': janelaDeConfig(); break;
    case 'extensoes': janelaDeExtensoes(); break;
    case 'fechar-aviso': avisar(''); break;
    case 'reabrir': (async () => { await fecharPainel(i); setTimeout(() => abrirPainel(i), 600); })(); break;
    case 'preencher': preencherLogin(paineis[i], true); break;
    case 'falha-teste': { // finge um encaixe que falhou, pra conferir a re-tentativa
      if (!process.env.QV_TEST) break;
      const p = paineis[i];
      janelas.soltar(p.alca, { x: 40, y: 40, w: 700, h: 500, pai: handleDaJanela() }).then(() => {
        p.solto = true; p.soltoPorFalha = true; p.erro = 'falha simulada'; tentativasDeEncaixe = 0; empurrar();
      });
      break;
    }
    case 'navegar-teste': { if (process.env.QV_TEST && temPonte(paineis[i])) paineis[i].sessao.navegar(String(valor)); break; }
    case 'ext-teste': { // so nos testes: liga (com um userscript de mentira no lugar do download) ou desliga
      if (!process.env.QV_TEST) break;
      (async () => {
        const r = await extensoes.definirAtiva('piw-qol', !!valor.ligar, async () => valor.fonte);
        console.log('QVEXT ' + JSON.stringify({ ...r, recarregados: r.ok ? await aplicarExtensoes() : 0 }));
      })();
      break;
    }
    case 'metodo-painel-teste': { if (!process.env.QV_TEST) break; definirMetodo(i, valor); break; }
    case 'metodo-teste': { if (!process.env.QV_TEST) break; config.metodoLogin = valor; break; }
    case 'voltar-teste': { if (!process.env.QV_TEST) break; win.emit('restore'); break; } // finge a volta do minimizado
    case 'aviso-teste': { if (!process.env.QV_TEST) break; avisar(valor); break; }
    case 'recorte-teste': { if (!process.env.QV_TEST) break; config.recorteTitulo = valor; posicionar(); break; }
    case 'creds-teste': { // so nos testes: grava um acesso sem passar pela janela
      if (!process.env.QV_TEST) break;
      const todos = lerCreds();
      todos[paineis[i].slug] = { user: valor.user, pass: safeStorage.encryptString(valor.pass).toString('base64') };
      gravarCreds(todos);
      break;
    }
  }
  empurrar();
}
ipcMain.on('acao', (e, d) => { if (daCasca(e)) executarAcao(d || {}); });
ipcMain.handle('config:ler', (e) => (daCasca(e) ? { ...config, navegadorEmUso: acharChrome() || '' } : null));
ipcMain.handle('config:salvar', (e, novo) => {
  if (!daCasca(e) || !novo || typeof novo !== 'object') return false;
  config = { ...config, ...novo };
  config.url = urlDePagina(novo.url) || config.url || PADRAO.url;
  config.extras = (config.extras || []).map((p, i) => ({
    nome: String(p.nome || `Extra ${i + 1}`).slice(0, 24),
    slug: String(p.slug || `extra-${i + 1}`).replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
    url: urlDePagina(p.url),
  })).filter((p) => p.url).slice(0, 4);
  config.navegador = String(novo.navegador != null ? novo.navegador : config.navegador || '');
  config.argsExtras = String(novo.argsExtras != null ? novo.argsExtras : config.argsExtras || '');
  if (['formulario', 'google', 'nenhum'].includes(novo.metodoLogin)) config.metodoLogin = novo.metodoLogin;
  const metodosAntes = Object.fromEntries((config.perfis || []).map((p) => [p.slug, p.metodoLogin || '']));
  config.perfis = config.perfis.slice(0, 4).map((p, i) => {
    const slug = String(p.slug || `conta-${i + 1}`).replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const metodo = METODOS.includes(p.metodoLogin) ? p.metodoLogin : (metodosAntes[slug] || '');
    return { nome: String(p.nome || `Conta ${i + 1}`).slice(0, 24), slug, url: urlDePagina(p.url), metodoLogin: metodo };
  });
  salvarConfig();
  montarPaineis();
  posicionar();
  return true;
});
ipcMain.on('abrir-pasta', (e) => { if (daCasca(e)) shell.openPath(pastaPerfis()); });
ipcMain.handle('ext:listar', (e) => (daCasca(e) ? extensoes.listar() : []));
ipcMain.handle('ext:ativar', async (e, { id, ativa }) => {
  if (!daCasca(e)) return { ok: false };
  const r = await extensoes.definirAtiva(String(id), !!ativa);
  if (!r.ok) return { ...r, lista: extensoes.listar() };
  return { ok: true, recarregados: await aplicarExtensoes(), lista: extensoes.listar() };
});
ipcMain.handle('ext:atualizar', async (e, id) => {
  if (!daCasca(e)) return { ok: false };
  const r = await extensoes.baixar(String(id));
  if (!r.ok) return { ...r, lista: extensoes.listar() };
  return { ...r, recarregados: r.mudou ? await aplicarExtensoes() : 0, lista: extensoes.listar() };
});
ipcMain.on('ext:pagina', (e, id) => {
  const item = daCasca(e) && extensoes.CATALOGO.find((c) => c.id === id);
  if (item) shell.openExternal(item.pagina); // so endereco do catalogo, nunca o que vier da janela
});
ipcMain.handle('creds:ler', (e, i) => (!daCasca(e) || !painelValido(i)) ? null : ({
  metodo: ((config.perfis || []).find((x) => x.slug === paineis[i].slug) || {}).metodoLogin || '',
  metodoPadrao: metodoPadrao(),
  user: (lerCreds()[paineis[i].slug] || {}).user || '',
  temSenha: temCreds(paineis[i].slug),
  podeCifrar: safeStorage.isEncryptionAvailable(),
}));
function definirMetodo(i, metodo) {
  const perfil = (config.perfis || []).find((x) => x.slug === paineis[i].slug);
  if (!perfil) return;
  perfil.metodoLogin = METODOS.includes(metodo) ? metodo : '';
  paineis[i].ultimoPreenche = 0;
  salvarConfig();
}

ipcMain.handle('creds:salvar', (e, { i, user, pass, metodo } = {}) => {
  if (!daCasca(e) || !painelValido(i)) return false;
  if (metodo !== undefined) definirMetodo(i, metodo);
  // Google ou "nao fazer nada" nao precisam de usuario e senha guardados.
  if (!user && !pass) { empurrar(); preencherLogin(paineis[i], false); return true; }
  if (!safeStorage.isEncryptionAvailable()) return false;
  const todos = lerCreds();
  const antes = todos[paineis[i].slug] || {};
  todos[paineis[i].slug] = {
    user: String(user || '').trim(),
    pass: pass ? safeStorage.encryptString(String(pass)).toString('base64') : antes.pass,
  };
  gravarCreds(todos);
  empurrar();
  preencherLogin(paineis[i], true);
  return true;
});
ipcMain.handle('creds:limpar', (e, i) => {
  if (!daCasca(e) || !painelValido(i)) return false;
  const todos = lerCreds();
  delete todos[paineis[i].slug];
  gravarCreds(todos);
  empurrar();
  return true;
});

function montarPaineis() {
  const antes = paineis.slice();
  paineis.length = 0;
  const lista = [
    ...config.perfis.map((p) => ({ ...p, extra: false })),
    ...(config.extras || []).map((p) => ({ ...p, extra: true })),
  ];
  lista.forEach((perfil, i) => {
    const velho = antes.find((p) => p.slug === perfil.slug);
    paineis.push(velho ? Object.assign(velho, { i, nome: perfil.nome, url: perfil.url, extra: perfil.extra })
      : { i, nome: perfil.nome, slug: perfil.slug, url: perfil.url, extra: perfil.extra,
          alca: null, estado: null, mudo: false, tentativas: 0 });
  });
  if (abaAtiva >= paineis.length) abaAtiva = 0;
  antes.filter((p) => !paineis.includes(p)).forEach((p) => fecharPainel(p.i));
}

function ouvirAcoesDeTeste() {
  const arq = path.join(app.getPath('userData'), 'acao.json');
  let ultimo = 0;
  setInterval(() => {
    try {
      const a = JSON.parse(fs.readFileSync(arq, 'utf8'));
      if (a.t > ultimo) { ultimo = a.t; executarAcao({ acao: a.a, i: a.i || 0, valor: a.v }); }
    } catch (_) {}
  }, 500);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    config = carregarConfig();
    credsPath = path.join(app.getPath('userData'), 'acessos.json');
    // O sandbox de teste no Linux nao tem chaveiro; no Windows o DPAPI esta sempre disponivel.
    if (process.env.QV_TEST && process.platform === 'linux' && !safeStorage.isEncryptionAvailable()) safeStorage.setUsePlainTextEncryption(true);
    extensoes.iniciar(app.getPath('userData'));
    montarPaineis();
    setInterval(rondaDeEstado, Number(process.env.QV_ESTADO_MS) || 5000);
    criarJanela();
    // Abrir sozinho ao iniciar: o app ja sobe com os paineis de pe.
    if (config.abrirAoIniciar !== false) {
      win.webContents.once('did-finish-load', () => {
        paineis.forEach((p, k) => setTimeout(() => abrirPainel(k), 150 + k * 250));
      });
    }
    setInterval(vigiar, Number(process.env.QV_VIGIA_MS) || 10000);
    setInterval(rondaDeJanelas, Number(process.env.QV_RONDA_MS) || 10000);
    // Quem esta com o teclado muda por clique dentro do painel, que o app nao enxerga. Entao eu
    // pergunto de tempos em tempos, so com a janela na frente, e a faixa do painel mostra onde esta.
    setInterval(() => { if (win && !win.isDestroyed() && win.isFocused()) sincronizarFoco(); },
      Number(process.env.QV_FOCO_MS) || 1200);

    for (let n = 1; n <= 8; n++) {
      globalShortcut.register(`Control+${n}`, () => {
        if (n - 1 >= paineis.length) return;
        // fora do modo abas, Ctrl+numero de uma aba extra abre ela em abas (extra nao mora no grid)
        executarAcao({ acao: ehAbas() || paineis[n - 1].extra ? 'aba' : 'maximizar', i: n - 1 });
      });
    }
    globalShortcut.register('Control+0', () => executarAcao({ acao: 'grade' }));
    globalShortcut.register('Control+T', () => executarAcao({ acao: 'modo' }));
    if (process.env.QV_TEST) {
      ouvirAcoesDeTeste();
      setInterval(() => paineis.forEach((p) => p.estado && console.log('QVESTADO ' + JSON.stringify({
        n: p.nome, diag: (p.diag || {}).cod, sock: p.estado.socketDoJogoAberto, semSock: p.estado.segundosSemSocket,
        semDado: p.estado.segundosSemDado, txt: p.estado.textoDeQueda, tent: p.tentativas,
      }))), 3000);
      setInterval(() => console.log('QVSTATE ' + JSON.stringify(paineis.map((p) => ({
        n: p.nome, alca: p.alca, solto: !!p.solto, mudo: !!p.mudo, diag: (p.diag || {}).cod, alerta: p.alerta, erro: p.erro,
        ponte: temPonte(p), porta: p.portaDebug, erroPonte: p.sessao && p.sessao.ultimoErro,
      })))), 3000);
    }
  });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); janelas.encerrar(); });
  app.on('window-all-closed', () => app.quit());
}

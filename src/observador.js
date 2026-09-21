// Este arquivo NAO roda no app: ele e injetado dentro da pagina do jogo no inicio de cada
// navegacao. Fica em arquivo separado de proposito, porque como texto dentro de outro arquivo
// as barras das expressoes regulares se perdem no caminho (foi exatamente o bug que deu).
// A marca __QV_CHAVE__ e trocada pelo nome sorteado a cada execucao.
(() => {
  if (window.__QV_CHAVE__) return;

  const est = { mutou: false, socketDoJogoAberto: false, ultimoDado: Date.now(), mudo: false, fechadoDesde: 0 };
  const contextos = [];

  // O socket do jogo e o que termina em /ws; analytics e terceiros nao contam como queda do jogo.
  const ehDoJogo = (url) => /\/ws\b/i.test(String(url));
  const OrigWS = window.WebSocket;
  if (OrigWS) {
    const Wrapper = function (...args) {
      const s = new OrigWS(...args);
      if (ehDoJogo(args[0])) {
        s.addEventListener('open', () => { est.socketDoJogoAberto = true; est.fechadoDesde = 0; est.ultimoDado = Date.now(); });
        s.addEventListener('message', () => { est.ultimoDado = Date.now(); });
        // Guardo QUANDO caiu: assim o app sabe que o jogo esta sem conexao sem ter que esperar
        // um tempao de silencio pra concluir isso.
        s.addEventListener('close', () => { est.socketDoJogoAberto = false; if (!est.fechadoDesde) est.fechadoDesde = Date.now(); });
      }
      return s;
    };
    Wrapper.prototype = OrigWS.prototype;
    Object.setPrototypeOf(Wrapper, OrigWS);
    try { Object.defineProperty(window, 'WebSocket', { value: Wrapper, writable: true, configurable: true }); } catch (_) {}
  }

  // Som: elemento de midia e tambem WebAudio, que e como jogo costuma tocar efeito.
  const OrigAC = window.AudioContext || window.webkitAudioContext;
  if (OrigAC) {
    const WrapAC = function (...args) {
      const c = new OrigAC(...args);
      // Jogo que cria um contexto por efeito faria esta lista crescer para sempre, e cada contexto
      // preso aqui nunca seria liberado. Guardo os ultimos; mudo/desmudo valem para esses.
      contextos.push(c);
      if (contextos.length > 8) contextos.splice(0, contextos.length - 8);
      if (est.mudo) { try { c.suspend(); } catch (_) {} }
      return c;
    };
    WrapAC.prototype = OrigAC.prototype;
    Object.setPrototypeOf(WrapAC, OrigAC);
    try {
      Object.defineProperty(window, 'AudioContext', { value: WrapAC, writable: true, configurable: true });
      if (window.webkitAudioContext) {
        Object.defineProperty(window, 'webkitAudioContext', { value: WrapAC, writable: true, configurable: true });
      }
    } catch (_) {}
  }
  const tocarOriginal = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) {
    if (est.mudo) this.muted = true;
    return tocarOriginal.apply(this, a);
  };

  // So preciso saber SE a tela mudou desde a ultima leitura. O observador desliga na primeira
  // mudanca e volta no ciclo seguinte: numa pagina que mexe o tempo todo isso quase zera o custo.
  let obs = null;
  const observar = () => {
    if (!document.documentElement) return;
    if (obs) obs.disconnect();
    est.mutou = false;
    obs = new MutationObserver(() => { est.mutou = true; obs.disconnect(); });
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  };
  if (document.documentElement) observar();
  else document.addEventListener('DOMContentLoaded', observar);

  const PADROES_QUEDA = /desconectad|reconect|sess[ãa]o expirad|conex[ãa]o perdid|disconnect|reconnect|session expired|connection lost/i;
  let ciclo = 0;
  let textoDeQueda = false;
  let ultimoGoogle = '';

  // textContent do body inclui o CODIGO das tags script e style. Isso fazia uma palavra escrita
  // dentro do proprio script do jogo contar como aviso de desconexao. Aqui leio so texto de verdade,
  // sem forcar recalculo de layout (innerText forcaria, e custa ~40x numa DOM grande).
  const textoVisivel = () => {
    if (!document.body) return '';
    const anda = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const tag = n.parentElement && n.parentElement.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let texto = '';
    let n;
    while ((n = anda.nextNode()) && texto.length < 6000) texto += n.nodeValue + ' ';
    return texto;
  };

  const api = {
    estado() {
      if (ciclo++ % 2 === 0 || textoDeQueda) {
        textoDeQueda = PADROES_QUEDA.test(textoVisivel());
      }
      const r = {
        url: location.href,
        titulo: document.title,
        online: navigator.onLine,
        naTelaDeLogin: /^\/(login|entrar|signin)\/?$/i.test(location.pathname),
        mutacoes: est.mutou ? 1 : 0,
        socketDoJogoAberto: est.socketDoJogoAberto,
        segundosSemDado: Math.round((Date.now() - est.ultimoDado) / 1000),
        segundosSemSocket: est.fechadoDesde ? Math.round((Date.now() - est.fechadoDesde) / 1000) : null,
        textoDeQueda,
        mudo: est.mudo,
      };
      observar();
      return r;
    },

    mudo(m) {
      est.mudo = !!m;
      document.querySelectorAll('audio, video').forEach((el) => { el.muted = est.mudo; });
      contextos.forEach((c) => { try { if (est.mudo) c.suspend(); else c.resume(); } catch (_) {} });
      return est.mudo;
    },

    async preencher(user, pass) {
      const porValor = (campo, valor) => {
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        desc.set.call(campo, valor); // o setter nativo e o que os frameworks escutam
        campo.dispatchEvent(new Event('input', { bubbles: true }));
        campo.dispatchEvent(new Event('change', { bubbles: true }));
      };
      for (let i = 0; i < 40; i++) {
        const senha = document.querySelector('input[type="password"]');
        const form = senha && (senha.closest('form') || document);
        const usuario = form && form.querySelector('input[autocomplete="username"], input[type="email"], input[type="text"]');
        if (senha && usuario) {
          if (usuario.value !== user) porValor(usuario, user);
          if (senha.value !== pass) porValor(senha, pass);
          return true;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      return false;
    },

    // Um clique, uma vez por pagina. Escolher conta, senha e 2FA seguem sendo da pessoa.
    google() {
      if (ultimoGoogle === location.href) return false;
      const alvo = [...document.querySelectorAll('button, a, div[role="button"]')].find((el) => {
        const texto = (el.textContent || '').trim();
        const rotulo = texto + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.className || '');
        return /google/i.test(rotulo) && texto.length < 60;
      });
      if (!alvo) return false;
      ultimoGoogle = location.href;
      alvo.click();
      return true;
    },
  };

  Object.defineProperty(window, '__QV_CHAVE__', { value: api, writable: false, enumerable: false, configurable: true });
})();

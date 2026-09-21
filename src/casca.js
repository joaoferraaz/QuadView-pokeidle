const ACENTOS = ['var(--cyan)', 'var(--magenta)', 'var(--violet)', 'var(--gold)'];
const ICON = {
  max: '<svg viewBox="0 0 16 16"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"/></svg>',
  min: '<svg viewBox="0 0 16 16"><path d="M2 6h4V2M14 6h-4V2M2 10h4v4M14 10h-4v4"/></svg>',
  destacar: '<svg viewBox="0 0 16 16"><path d="M9 2h5v5M14 2L8 8"/><path d="M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5"/></svg>',
  recarregar: '<svg viewBox="0 0 16 16"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/></svg>',
  som: '<svg viewBox="0 0 16 16"><path d="M2 6h2.5L8 3v10L4.5 10H2z"/><path d="M10.5 5.5a3.5 3.5 0 0 1 0 5"/></svg>',
  mudo: '<svg viewBox="0 0 16 16"><path d="M2 6h2.5L8 3v10L4.5 10H2z"/><path d="M11 6l3 4M14 6l-3 4"/></svg>',
  chave: '<svg viewBox="0 0 16 16"><circle cx="5.5" cy="10.5" r="3"/><path d="M7.7 8.3L13.5 2.5M11 5l2 2M9.5 6.5l1.5 1.5"/></svg>',
  login: '<svg viewBox="0 0 16 16"><path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/><path d="M10 11l3-3-3-3M13 8H6"/></svg>',
  fechar: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  grade: '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>',
  abas: '<svg viewBox="0 0 16 16"><path d="M2 5.5h4.5v-3h7v3M2 5.5V13a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V5.5z"/></svg>',
};
const tira = document.getElementById('tiraAbas');
const abas = [];
const CLASSE = { ok: 'ok', login: 'ruim', offline: 'ruim', queda: 'ruim', travado: 'ruim',
                 parado: 'aviso', mudo: 'aviso', semponte: 'aviso', ligando: 'aviso', solto: 'aviso', fechado: '' };

const raiz = document.getElementById('paineis');
const cels = [];
let cfgAtual = null;

function montar(i) {
  const cab = document.createElement('div');
  cab.className = 'cab';
  cab.style.setProperty('--accent', ACENTOS[i % 4]);
  cab.innerHTML = `<span class="ponto"></span><span class="nome"></span><span class="kbd" title="O que você digitar vai para este painel">teclado</span><span class="st"></span>
    <button data-a="acesso" title="Acesso salvo deste painel (clique com Shift para preencher agora)">${ICON.chave}</button>
    <button data-a="ir-login" title="Ir para a tela de login">${ICON.login}</button>
    <button data-a="som" title="Som"></button>
    <button data-a="recarregar" title="Recarregar (Shift ignora o cache)">${ICON.recarregar}</button>
    <button data-a="destacar" title="Soltar em janela própria">${ICON.destacar}</button>
    <button data-a="fechar" title="Fechar este painel">${ICON.fechar}</button>
    <button data-a="maximizar" title="Maximizar (Ctrl+${i + 1})"></button>`;
  cab.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) window.quad.acao('maximizar', i); });
  cab.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    // Clicar na faixa do painel entrega o teclado pra ele, sem precisar acertar dentro do jogo.
    if (!b) return window.quad.acao('foco', i);
    const p = cels[i].dados;
    if (b.dataset.a === 'som') return window.quad.acao('som', i, !p.mudo);
    if (b.dataset.a === 'acesso' && e.shiftKey) return window.quad.acao('preencher', i);
    // sem controle do navegador nao da pra recarregar a aba: relanço o painel inteiro
    if (b.dataset.a === 'recarregar') return window.quad.acao(p.diag && p.diag.cod === 'semponte' ? 'reabrir' : 'recarregar', i, e.shiftKey);
    window.quad.acao(b.dataset.a, i);
  });

  const vazio = document.createElement('div');
  vazio.className = 'vazio';
  vazio.innerHTML = `<span class="msg"></span><button></button>`;
  vazio.querySelector('button').addEventListener('click', () => {
    const p = cels[i].dados;
    window.quad.acao(p.solto ? 'encaixar' : 'abrir', i);
  });

  raiz.append(cab, vazio);
  return { cab, vazio, dados: {} };
}

const por = (el, r) => { el.style.left = r.x + 'px'; el.style.top = r.y + 'px'; el.style.width = r.width + 'px'; el.style.height = r.height + 'px'; };

function montarAba(i) {
  const el = document.createElement('div');
  el.className = 'aba';
  el.style.setProperty('--accent', ACENTOS[i % 4]);
  el.innerHTML = '<span class="ponto"></span><span class="rotulo"></span>';
  el.addEventListener('click', () => window.quad.acao('aba', i));
  tira.append(el);
  return el;
}

function desenharAviso(s) {
  const el = document.getElementById('aviso');
  el.hidden = !s.aviso;
  el.style.top = s.topoBase + 'px';
  el.style.height = s.faixaAviso + 'px';
  if (s.aviso) el.querySelector('.texto').textContent = s.aviso;
  el.querySelector('.texto').title = s.aviso || '';
}

function desenharAbas(s) {
  const ehAbas = s.modo === 'abas';
  tira.hidden = !ehAbas;
  tira.style.top = s.topo + 'px';
  tira.style.height = s.tira + 'px';
  if (!ehAbas) return;
  while (abas.length < s.paineis.length) abas.push(montarAba(abas.length));
  while (abas.length > s.paineis.length) abas.pop().remove();
  s.paineis.forEach((p, i) => {
    const el = abas[i];
    el.className = `aba ${i === s.abaAtiva ? 'ativa' : ''} ${p.extra ? 'extra' : ''}`;
    el.style.setProperty('--accent', p.extra ? 'var(--verde)' : ACENTOS[i % 4]);
    el.querySelector('.rotulo').textContent = p.nome;
    const ponto = el.querySelector('.ponto');
    ponto.className = `ponto ${CLASSE[p.diag.cod] || ''} ${p.diag.cod === 'ligando' ? 'piscando' : ''}`;
    ponto.title = p.alerta || p.diag.txt;
  });
  // os botoes do painel ativo ficam na propria tira
  let ferramentas = tira.querySelector('.ferramentas');
  if (!ferramentas) {
    ferramentas = document.createElement('div');
    ferramentas.className = 'ferramentas';
    ferramentas.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const p = s.paineis[s.abaAtiva];
      if (b.dataset.a === 'som') return window.quad.acao('som', s.abaAtiva, !p.mudo);
      if (b.dataset.a === 'recarregar') return window.quad.acao(p.diag && p.diag.cod === 'semponte' ? 'reabrir' : 'recarregar', s.abaAtiva, e.shiftKey);
      if (b.dataset.a === 'acesso' && e.shiftKey) return window.quad.acao('preencher', s.abaAtiva);
      window.quad.acao(b.dataset.a, s.abaAtiva);
    });
  }
  const at = s.paineis[s.abaAtiva] || {};
  ferramentas.innerHTML = `
    ${at.extra ? '' : `<button data-a="acesso" class="${at.metodo === 'google' || (at.metodo === 'formulario' && at.temCreds) ? 'on' : ''}" title="Como este painel entra no jogo (Shift+clique tenta agora)">${ICON.chave}</button>
    <button data-a="ir-login" title="Ir para a tela de login">${ICON.login}</button>`}
    <button data-a="som" class="${at.mudo ? 'on' : ''}" title="Som">${at.mudo ? ICON.mudo : ICON.som}</button>
    <button data-a="recarregar" title="Recarregar (Shift ignora o cache)">${ICON.recarregar}</button>
    <button data-a="destacar" title="Soltar em janela própria">${ICON.destacar}</button>
    <button data-a="fechar" title="Fechar este painel">${ICON.fechar}</button>`;
  tira.append(ferramentas);
}

window.quad.onEstado((s) => {
  cfgAtual = s.config;
  desenharAviso(s);
  desenharAbas(s);
  const btModo = document.getElementById('btModo');
  const emAbas = s.modo === 'abas';
  btModo.innerHTML = (emAbas ? ICON.grade : ICON.abas) + (emAbas ? 'Grid' : 'Abas');
  btModo.classList.toggle('on', emAbas);
  // no modo abas o proprio botao de modo ja volta pro grid: nao preciso de dois botoes iguais
  document.getElementById('btGrade').hidden = emAbas;
  document.getElementById('dica').textContent = emAbas
    ? `Ctrl+1..${s.paineis.length} troca de aba · Ctrl+T volta pro grid`
    : 'Ctrl+1..4 maximiza · Ctrl+T abre em abas · Ctrl+0 volta pro grid';
  while (cels.length < s.paineis.length) cels.push(montar(cels.length));
  while (cels.length > s.paineis.length) { const c = cels.pop(); c.cab.remove(); c.vazio.remove(); }

  s.paineis.forEach((p, i) => {
    const c = cels[i];
    c.dados = p;
    const modoAbas = s.modo === 'abas';
    c.cab.hidden = p.escondido || modoAbas;
    por(c.cab, { ...p.celula, height: s.cabeca });

    // A area do jogo e a janela do Chrome encaixada: a casca so desenha algo quando o painel esta vazio.
    const mostrarVazio = !p.escondido && (!p.aberto || p.solto);
    c.vazio.hidden = !mostrarVazio;
    const alto = modoAbas ? 0 : s.cabeca;
    por(c.vazio, { x: p.celula.x, y: p.celula.y + alto, width: p.celula.width, height: Math.max(0, p.celula.height - alto) });
    if (mostrarVazio) {
      c.vazio.querySelector('.msg').textContent = p.solto ? (p.erro || 'Painel solto numa janela própria')
        : p.abrindo ? 'Abrindo o navegador...' : (p.diag.txt || 'fechado');
      const b = c.vazio.querySelector('button');
      b.textContent = p.solto ? 'Encaixar de volta' : 'Abrir';
      b.hidden = !!p.abrindo;
    }

    c.cab.querySelector('.nome').textContent = p.nome;
    // Marca visivel de onde o teclado esta. Vem do Windows, nao de suposicao do app.
    c.cab.querySelector('.kbd').hidden = !p.teclado;
    c.cab.classList.toggle('comTeclado', !!p.teclado);
    const st = c.cab.querySelector('.st');
    st.textContent = p.alerta || p.diag.txt;
    st.className = `st ${p.alerta ? 'alerta' : CLASSE[p.diag.cod] === 'ruim' ? 'ruim' : p.diag.cod === 'ok' ? 'ok' : ''}`;
    const ponto = c.cab.querySelector('.ponto');
    ponto.className = `ponto ${CLASSE[p.diag.cod] || ''} ${p.diag.cod === 'ligando' ? 'piscando' : ''}`;
    const som = c.cab.querySelector('[data-a="som"]');
    som.innerHTML = p.mudo ? ICON.mudo : ICON.som;
    som.classList.toggle('on', p.mudo);
    const max = c.cab.querySelector('[data-a="maximizar"]');
    max.innerHTML = s.maximizado === i ? ICON.min : ICON.max;
    max.classList.toggle('on', s.maximizado === i);
    const chave = c.cab.querySelector('[data-a="acesso"]');
    const pronto = p.metodo === 'google' || (p.metodo === 'formulario' && p.temCreds);
    chave.classList.toggle('on', pronto);
    chave.title = { google: 'Entra com Google', formulario: p.temCreds ? 'Entra com usuário e senha salvos' : 'Usuário e senha: falta cadastrar',
      nenhum: 'Login automático desligado neste painel' }[p.metodo] + ' (clique para mudar)';
    // a peca so aparece quando falta a extensao naquele perfil
    ['ir-login', 'som', 'recarregar', 'destacar', 'fechar'].forEach((a) => {
      c.cab.querySelector(`[data-a="${a}"]`).style.opacity = p.aberto ? '' : '.3';
    });
  });
});

document.getElementById('topo').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-g]');
  if (!b) return;
  window.quad.acao(b.dataset.g);
});

document.getElementById('fecharAviso').addEventListener('click', () => window.quad.acao('fechar-aviso'));

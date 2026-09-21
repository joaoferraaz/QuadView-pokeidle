const $ = (id) => document.getElementById(id);
let atual = null;

function desenharPerfis(c) {
  const wrap = $('perfis');
  wrap.innerHTML = '<label>Painéis</label>';
  for (let i = 0; i < 4; i++) {
    const p = c.perfis[i] || { nome: '', url: '' };
    const linha = document.createElement('div');
    linha.className = 'linha';
    linha.innerHTML = `<input type="text" placeholder="Conta ${i + 1}"><input type="text" placeholder="URL própria (opcional)">`;
    const [nome, url] = linha.querySelectorAll('input');
    nome.value = p.nome || '';
    url.value = p.url || '';
    wrap.append(linha);
  }
}

window.quad.configLer().then((c) => {
  atual = c;
  $('url').value = c.url || '';
  $('navegador').value = c.navegador || '';
  $('argsExtras').value = c.argsExtras || '';
  const nav = c.navegadorEmUso || '';
  $('navEmUso').textContent = nav ? `Em uso: ${nav}` : 'Nenhum navegador encontrado.';
  const wrapExtras = $('extras');
  for (let k = 0; k < 4; k++) {
    const x = (c.extras || [])[k] || { nome: '', url: '' };
    const linha = document.createElement('div');
    linha.className = 'linha';
    linha.innerHTML = '<input type="text" placeholder="Nome da aba"><input type="text" placeholder="https://...">';
    const [nome, url] = linha.querySelectorAll('input');
    nome.value = x.nome || '';
    url.value = x.url || '';
    wrapExtras.append(linha);
  }
  $('abrirAoIniciar').checked = c.abrirAoIniciar !== false;
  $('metodoLogin').value = c.metodoLogin || (c.preencherLogin === false ? 'nenhum' : 'formulario');
  $('reconectar').checked = !!c.reconectar;
  $('travado').checked = !!c.detectarTravado;
  $('minutos').value = c.minutosTravado != null ? c.minutosTravado : 5;
  $('porta').value = c.porta;
  $('recorte').value = c.recorteTitulo != null ? c.recorteTitulo : 34;
  desenharPerfis(c);
});

$('salvar').addEventListener('click', async () => {
  const perfis = [...document.querySelectorAll('#perfis .linha')].map((l, i) => {
    const [nome, url] = [...l.querySelectorAll('input')].map((x) => x.value.trim());
    return { nome: nome || `Conta ${i + 1}`, slug: (atual.perfis[i] || {}).slug || `conta-${i + 1}`, url };
  });
  await window.quad.configSalvar({
    url: $('url').value.trim() || atual.url,
    navegador: $('navegador').value.trim(),
    argsExtras: $('argsExtras').value.trim(),
    extras: [...document.querySelectorAll('#extras .linha')].map((l, k) => {
      const [nome, url] = [...l.querySelectorAll('input')].map((x) => x.value.trim());
      const antigo = (atual.extras || [])[k] || {};
      // o slug e o nome da pasta do perfil: mantenho o antigo pra nao perder o que ja esta logado ali
      return { nome: nome || `Extra ${k + 1}`, slug: antigo.slug || `extra-${Date.now().toString(36)}-${k}`, url };
    }).filter((x) => x.url),
    abrirAoIniciar: $('abrirAoIniciar').checked,
    metodoLogin: $('metodoLogin').value,
    preencherLogin: $('metodoLogin').value !== 'nenhum',
    reconectar: $('reconectar').checked,
    detectarTravado: $('travado').checked,
    minutosTravado: Math.max(1, Number($('minutos').value) || 5),
    porta: Number($('porta').value) || atual.porta,
    recorteTitulo: Math.max(0, Number($('recorte').value) || 0),
    perfis,
  });
  window.close();
});
$('cancelar').addEventListener('click', () => window.close());
$('pasta').addEventListener('click', () => window.quad.abrirPasta());
addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });

// Janela "Extensoes": lista, interruptor de ligar e desligar, versao fixada e botao de atualizar.
const lista = document.getElementById('lista');
const msg = document.getElementById('msg');
const dizer = (t, tipo = '') => { msg.textContent = t; msg.className = tipo; };
const quando = (iso) => { try { return new Date(iso).toLocaleDateString('pt-BR'); } catch (_) { return ''; } };
const paineis = (n) => (n ? ` ${n} ${n === 1 ? 'painel recarregado' : 'painéis recarregados'}.` : '');

function desenhar(itens) {
  lista.replaceChildren(...itens.map((x) => {
    const el = document.createElement('div');
    el.className = 'ext' + (x.ativa ? ' ativa' : '');
    el.innerHTML = `<div class="topo"><div><div class="nome"></div><div class="autor"></div></div><span class="spacer"></span>
      <button class="chave" role="switch"></button></div>
      <div class="desc"></div>
      <div class="pe"><span class="estado"></span><span class="spacer"></span>
      <button class="link" data-a="atualizar">Atualizar</button><button class="link" data-a="pagina">Página do autor</button></div>`;
    el.querySelector('.nome').textContent = x.nome;
    el.querySelector('.autor').textContent = 'por ' + x.autor;
    el.querySelector('.desc').textContent = x.descricao;
    const estado = el.querySelector('.estado');
    if (x.instalada) {
      estado.append('versão ');
      const v = document.createElement('span'); v.className = 'versao'; v.textContent = x.versao; estado.append(v);
      estado.append(` · baixada em ${quando(x.baixadoEm)}`);
      estado.title = 'SHA-256 da cópia em disco: ' + x.sha256;
    } else estado.textContent = 'ainda não baixada (baixa ao ligar)';
    const chave = el.querySelector('.chave');
    chave.setAttribute('aria-checked', String(x.ativa));
    chave.setAttribute('aria-label', `${x.ativa ? 'Desligar' : 'Ligar'} ${x.nome}`);
    const atualizar = el.querySelector('[data-a="atualizar"]');
    atualizar.hidden = !x.instalada;
    const ocupar = (sim) => { chave.disabled = sim; atualizar.disabled = sim; };

    chave.addEventListener('click', async () => {
      const ligar = !x.ativa;
      ocupar(true);
      dizer(ligar && !x.instalada ? 'Baixando do GitHub...' : 'Aplicando...');
      const r = await window.quad.extAtivar(x.id, ligar);
      if (r.lista) desenhar(r.lista);
      if (!r.ok) return dizer(r.erro || 'Não deu certo.', 'ruim');
      dizer(`${x.nome} ${ligar ? 'ligada' : 'desligada'}.${paineis(r.recarregados)}`, 'ok');
    });
    atualizar.addEventListener('click', async () => {
      ocupar(true);
      dizer('Conferindo o GitHub...');
      const r = await window.quad.extAtualizar(x.id);
      if (r.lista) desenhar(r.lista);
      if (!r.ok) return dizer(r.erro || 'Não deu certo.', 'ruim');
      dizer(r.mudou ? `Atualizada para a versão ${r.versao}.${paineis(r.recarregados)}` : `Já está na última versão (${r.versao}).`, 'ok');
    });
    el.querySelector('[data-a="pagina"]').addEventListener('click', () => window.quad.extPagina(x.id));
    return el;
  }));
}

window.quad.extListar().then(desenhar);

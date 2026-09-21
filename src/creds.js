const q = new URLSearchParams(location.search);
const i = Number(q.get('i'));
const $ = (id) => document.getElementById(id);
$('nome').textContent = q.get('nome') || `Conta ${i + 1}`;

const NOMES = { formulario: 'usuário e senha', google: 'Entrar com Google', nenhum: 'não fazer nada' };
let padrao = 'formulario';

// Os campos de usuario e senha so fazem sentido quando o painel entra por formulario.
function ajustar() {
  const escolhido = $('metodo').value;
  const efetivo = escolhido || padrao;
  $('campos').hidden = efetivo !== 'formulario';
  $('explica').textContent = {
    formulario: 'O app preenche usuário e senha na tela de login. A verificação "confirme que é humano" e o clique em Entrar continuam com você. A senha fica só neste computador, cifrada pelo Windows.',
    google: 'O app clica em "Entrar com Google" uma vez. Se este painel já tiver sessão do Google, o login se completa sozinho. Conta, senha e 2FA do Google são sempre você quem faz.',
    nenhum: 'O app não mexe na tela de login deste painel.',
  }[efetivo] + (escolhido ? '' : ` (padrão do app: ${NOMES[padrao]})`);
}
$('metodo').addEventListener('change', ajustar);

window.quad.credsLer(i).then((c) => {
  if (!c) return;
  padrao = c.metodoPadrao || 'formulario';
  $('metodo').value = c.metodo || '';
  ajustar();
  $('user').value = c.user;
  if (c.temSenha) $('pass').placeholder = 'senha salva (deixe vazio para manter)';
  if (!c.podeCifrar) $('msg').textContent = 'Cifragem do sistema indisponível: não dá pra salvar senha com segurança aqui.';
  (c.user ? $('pass') : $('user')).focus();
});

$('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const metodo = $('metodo').value;
  const porFormulario = (metodo || padrao) === 'formulario';
  const user = porFormulario ? $('user').value.trim() : '';
  const pass = porFormulario ? $('pass').value : '';
  const jaTem = $('pass').placeholder.startsWith('senha salva');
  if (porFormulario && (!user || (!pass && !jaTem))) { $('msg').textContent = 'Preencha usuário e senha.'; return; }
  // com senha ja salva e campo vazio, mando o usuario para manter o cadastro como esta
  if (await window.quad.credsSalvar(i, user, pass, metodo)) window.close();
  else $('msg').textContent = 'Não foi possível salvar.';
});
$('limpar').addEventListener('click', async () => { await window.quad.credsLimpar(i); window.close(); });
$('cancelar').addEventListener('click', () => window.close());
addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });

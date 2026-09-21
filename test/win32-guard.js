// Guarda de regressao do bug que deixava o grid preto: mandar painel para o fundo o esconde
// atras da superficie de desenho do proprio app. Aqui so leio o script do Windows.
const fs = require('fs');
const path = require('path');
const ps = fs.readFileSync(path.join(__dirname, '..', 'src', 'win32.ps1'), 'utf8');
const lote = ps.slice(ps.indexOf("'mover-lote'"), ps.indexOf("'mover' {"));
const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const casca = fs.readFileSync(path.join(__dirname, '..', 'src', 'casca.js'), 'utf8');
const jan = fs.readFileSync(path.join(__dirname, '..', 'src', 'janelas.js'), 'utf8');
const checagens = [
  ['desliga a detecção de janela encoberta (painel congelava ao minimizar)', /CalculateNativeWinOcclusion/.test(main)],
  ['refaz o encaixe quando o app volta do minimizado', /win\.on\('restore', aoVoltar\)/.test(main)],
  ['espera a janela estar de pé antes de mexer (o evento chega cedo demais)',
    /setTimeout\(acordarPaineis, 250\)/.test(main) && /setTimeout\(acordarPaineis, 1100\)/.test(main)
    && /win\.isMinimized\(\)\) return/.test(main)],
  ['o reencaixe faz um redimensionamento de verdade, como trocar de aba',
    /'reencaixar'/.test(ps) && /\$c\.w - 8/.test(ps)],
  ['o comando de acordar redesenha a janela', /'acordar'/.test(ps) && /RedrawWindow/.test(ps)],
  ['acordar levanta o painel (senão o app engole os cliques)', (() => {
    const bloco = ps.slice(ps.indexOf("'acordar'"), ps.indexOf("'focar' {"));
    return /SetWindowPos/.test(bloco) && !/SWP_NOZORDER/.test(bloco);
  })()],
  ['escolhe a maior janela do perfil, não a primeira', /MaiorJanelaDe/.test(ps) && !/JanelasDe\(/.test(ps)],
  ['o recorte é reaplicado a cada layout', !/mudouTamanho/.test(ps.slice(ps.indexOf("'mover-lote'"), ps.indexOf("'mover' {")))],
  ['o observador injetado mora em arquivo próprio, fora de string',
    fs.existsSync(path.join(__dirname, '..', 'src', 'observador.js'))],
  ['emparelha a fila de entrada ao voltar do minimizado (AttachThreadInput)',
    /AttachThreadInput/.test(ps) && /\[QV\]::Reativar\(\$h, \$pai\)/.test(ps) && /janelas\.reencaixar/.test(main)],
  ['não existe botão de destravar: a recuperação é automática', !/destravar/i.test(main)],
  ['confere o retângulo que a janela realmente ficou', /RetanguloNoPai/.test(ps) && /foraDoLugar/.test(main)],
  ['existe ronda que conserta janela fora do lugar', /rondaDeJanelas/.test(main) && /setInterval\(rondaDeJanelas/.test(main)],
  ['não manda painel para o fundo (HWND_BOTTOM)', !/\[IntPtr\]1\b/.test(lote)],
  ['todo painel é levantado em todo layout (a janela invisível do app volta pra cima e come os cliques)',
    /HWND_TOP/.test(lote) && !/SWP_NOZORDER/.test(lote)],
  ['o painel da frente vai por último e termina por cima', /itens\.sort\(\(a, b\) => \(a\.frente \? 1 : 0\)/.test(main)],
  ['há segundo passe atrasado depois de redimensionar, maximizar e focar',
    /debounce2 = setTimeout\(posicionar, 500\)/.test(main) && /win\.on\('focus', \(\) => \{ reposicionar\(\)/.test(main)],
  // Teclado: clique chega por posição, tecla chega por foco, e foco vive dentro de uma fila de
  // entrada. Com as filas separadas o que a pessoa digita morre na fila do app.
  ['gruda a fila do navegador, não a do PowerShell',
    /AttachThreadInput\(tFilha, tPai, true\)/.test(ps) && !/AttachThreadInput\(meu, threadFilha, true\)/.test(ps)],
  // Uma thread mora em UMA fila por vez. Se o app grudasse na fila do painel, o segundo painel
  // tiraria o app do primeiro e só uma tela digitaria: é o bug do "só a tela 1".
  ['é o painel que gruda no app, nunca o contrário (senão só um painel digita)',
    !/AttachThreadInput\(tPai, tFilha, true\)/.test(ps)],
  ['o vínculo do painel fica de pé enquanto ele está encaixado', (() => {
    const g = ps.slice(ps.indexOf('public static bool Grudar'), ps.indexOf('public static void Desgrudar'));
    return /AttachThreadInput\(tFilha, tPai, true\)/.test(g) && !/, false\)/.test(g);
  })()],
  ['não gruda duas vezes a mesma janela (o contador interno não zeraria no desgrudar)',
    /grudadas\.Contains\(tFilha\)\) return true/.test(ps) && /grudadas\.Remove\(tFilha\)/.test(ps)],
  ['o encaixe gruda a fila', /\[void\]\[QV\]::Grudar\(\$h, \$pai\)/.test(ps)],
  ['quem sai do encaixe é desgrudado (soltar e fechar)', (() => {
    const soltar = ps.slice(ps.indexOf("'soltar' {"), ps.indexOf("'fechar' {"));
    const fechar = ps.slice(ps.indexOf("'fechar' {"));
    return /Desgrudar/.test(soltar) && /Desgrudar/.test(fechar);
  })()],
  ['dar teclado entra na fila do app e sai dela, sem desfazer o vínculo dos painéis', (() => {
    const d = ps.slice(ps.indexOf('public static void DarTeclado'), ps.indexOf('// Volta do minimizado'));
    return /AttachThreadInput\(meu, tPai, true\)/.test(d) && /AttachThreadInput\(meu, tPai, false\)/.test(d)
      && !/AttachThreadInput\(tFilha, tPai, false\)/.test(d);
  })()],
  ['focar não é SetFocus solto: atravessa processo pela fila',
    /'focar' \{[\s\S]*?DarTeclado/.test(ps)],
  ['a ronda não rouba o primeiro plano de outro programa',
    /GetForegroundWindow\(\) == pai/.test(ps)],
  ['o teclado segue o painel da frente ao trocar de aba e ao maximizar',
    /case 'aba':[\s\S]*?teclado\(\)/.test(main) && /case 'maximizar':[\s\S]*?teclado\(\)/.test(main)],
  ['clicar na faixa do painel entrega o teclado a ele',
    /case 'foco': darTeclado\(i\)/.test(main) && /quad\.acao\('foco', i\)/.test(casca)],
  // A pessoa clica DENTRO do painel; esse clique nao passa pelo app. Se o app supuser onde o
  // teclado esta, ele o puxa de volta pro painel que ele mesmo escolheu: era o "so a Conta 1".
  ['o app pergunta ao Windows quem tem o teclado, em vez de supor',
    /GetGUIThreadInfo/.test(ps) && /'foco-atual'/.test(ps) && /quemTemFoco/.test(jan)
    && /async function sincronizarFoco/.test(main)],
  ['ganhar foco não arranca o teclado de quem já está com ele',
    /win\.on\('focus', \(\) => \{ reposicionar\(\); setTimeout\(garantirTeclado/.test(main)
    && /if \(await sincronizarFoco\(\) !== null\) return;/.test(main)],
  ['a faixa do painel mostra onde o teclado está',
    /teclado: focoAtual === i/.test(main) && /classList\.toggle\('comTeclado'/.test(casca)],
  // Janela filha nunca e "ativada", e e pela ativacao que o navegador pega o teclado. Entao clicar
  // num painel nao movia o foco: clicava na Conta 3 e escrevia na Conta 1.
  ['o clique num painel leva o teclado pra ele (vigia do botão do mouse)',
    /static void Vigiar\(\)/.test(ps) && /GetAsyncKeyState\(1\)/.test(ps) && /WindowFromPoint/.test(ps)
    && /DarTeclado\(new IntPtr\(painel\), new IntPtr\(pai\)\)/.test(ps)],
  ['todo painel encaixado entra na lista do vigia, e sai ao soltar', 
    /Registrar\(filha, pai\);/.test(ps) && /paineisVivos\.Remove\(filha\.ToInt64\(\)\)/.test(ps)],
  ['o vigia cria a própria fila antes de grudar (sem fila o AttachThreadInput falha)', /PeekMessage\(out m/.test(ps)],
  ['o foco numa janela interna do navegador conta para o painel dono', /PainelDe\(g\.hwndFocus\)/.test(ps)],
  ['o C# da ponte não usa sintaxe nova demais para o PowerShell do Windows', !/\?\.|\$"|=> [^{(]*;\s*$/m.test(ps.slice(ps.indexOf('Add-Type @"'), ps.indexOf('"@')))],
  ['painel não sai do encaixe por conta própria no login (a pessoa pediu para não fazer isso)', !/soltoParaLogin|loginDoGoogleEmJanela/.test(main)],
  ['voltar do minimizado devolve o teclado', /garantirTeclado\(\); \/\/ volta do minimizado/.test(main)],
  ['o foco vai junto com o handle do pai (só o da filha não atravessa processo)',
    /focar: \(alca, pai\)/.test(jan) && /janelas\.focar\(p\.alca, handleDaJanela\(\)\)/.test(main)],
  ['esconde a janela antes de encaixar', /ShowWindow\(\$h, \$SW_HIDE\)/.test(ps)],
  ['mostra a janela só depois de posicionada', ps.indexOf('SW_HIDE') < ps.indexOf('$SW_SHOW)   # so aparece')],
];
let falhou = false;
for (const [nome, ok] of checagens) { console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome}`); if (!ok) falhou = true; }
process.exit(falhou ? 1 : 0);

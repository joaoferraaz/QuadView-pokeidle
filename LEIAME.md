# QuadView (janela única, Chrome de verdade por dentro)

Um app só. As 4 sessões rodam em Chrome de verdade, mas as janelas do navegador ficam
encaixadas dentro da janela do QuadView, sem borda e sem barra de endereço. Como quem
desenha a página é o Chrome normal, a verificação "confirme que é humano" funciona.

## Duas formas de usar

**Arquivo único (`QuadView.exe`).** Um executável de ~95 MB que não precisa de Node nem de instalação:
deixe onde quiser, inclusive na área de trabalho, e dê dois cliques. Ele descompacta em pasta temporária
a cada abertura, então demora alguns segundos a mais para subir que a versão em pasta. Como não é
assinado, na primeira vez o Windows mostra o aviso do SmartScreen: "Mais informações" e
"Executar assim mesmo". O ícone é o padrão do Electron.

**Pasta com o código** (o que está descrito abaixo): abre mais rápido e dá para editar.

As duas guardam perfis e configuração no mesmo lugar (`%APPDATA%\quadview-solo`), então os logins que
você já fez valem nas duas, e trocar de uma para a outra não perde nada.

Para gerar o `.exe` você mesma: `npm install` e depois `npm run dist`. Sai em `dist\QuadView.exe`.

## Rodar pela pasta (Windows)

1. Instale o Node.js LTS (https://nodejs.org).
2. Dois cliques em `iniciar.bat` (na primeira vez ele roda `npm install`).

Os 4 painéis abrem sozinhos. Para desligar isso, desmarque "Abrir os painéis ao iniciar" na engrenagem.

### Sem extensão, sem etapa fora do app

Nada para instalar em perfil nenhum. O app controla cada painel pela porta de depuração do próprio
navegador: é assim que som, recarregar, status, reconexão e preenchimento de login funcionam.

Duas regras que valem a pena saber, porque foram medidas e não supostas:

- O app liga o domínio `Page` (necessário: sem ele o observador é aceito mas nunca roda) e **não** liga
  `Runtime` nem `Log`, que são os que deixam rastro perceptível pela página.
- Cada painel abre em modo aplicativo (sem barra de endereço) e recarrega **uma vez** assim que o
  observador entra. Sem esse recarregamento o WebSocket que o jogo abre na largada passaria
  despercebido e a reconexão automática ficaria cega. Abrir em branco antes também resolveria, mas
  tira o modo aplicativo e traz a barra de endereço de volta.

Cada painel usa uma porta local própria, escolhida entre as que estão livres de verdade. A porta
inicial fica na engrenagem. Como a porta não tem senha, qualquer programa da sua máquina poderia
falar com esses navegadores: é o mesmo grau de exposição de qualquer app de automação local, e vale
saber que existe.

### Navegador

Edge por padrão (já vem no Windows), Chrome se não achar o Edge, ou o caminho que você escrever na
engrenagem. Tanto faz para o controle: a ponte é a mesma nos dois. Perfis são por navegador, então
trocar de navegador significa refazer os logins.

## Uso

| Ação | Como |
|---|---|
| Alternar grid 2x2 e tela cheia por abas | botão **Abas** / **Grid** no topo, ou Ctrl+T |
| Trocar de aba (modo abas) | clique na aba ou Ctrl+1 a Ctrl+5 |
| Maximizar um painel (modo grid) | botão na faixa, duplo clique na faixa, ou Ctrl+1 a Ctrl+4 |
| Voltar pro grid 2x2 | botão **Grid** ou Ctrl+0 |
| Soltar um painel em janela própria | botão de seta na faixa. O botão "Encaixar de volta" traz ele de volta |
| Som e recarregar | por painel na faixa; "Recarregar" no topo recarrega os 4 |
| Cadastrar o acesso da conta | chave na faixa. Shift+clique na chave preenche o login na hora |
| Ir pra tela de login | botão de seta pra dentro, na faixa |
| Fechar um painel | X na faixa |
| Nomes, URL por painel, navegador, reconexão, porta | engrenagem no topo |

Redimensionar ou maximizar a janela do app reposiciona as janelas encaixadas junto.

## Os dois modos

**Grid 2x2**: as 4 contas lado a lado, cada uma com sua faixa de título e seus botões.

**Abas**: a conta escolhida ocupa a área inteira e você troca pela tira de abas. Os outros painéis
continuam do mesmo tamanho, atrás do que está na frente, então o idle não para enquanto você olha
outra aba. Os botões do painel ativo ficam na direita da tira.

## Abas extras: PIW Tools e PokePedia

Vêm duas abas extras, cada uma com perfil próprio e separada das contas: **PIW Tools**
(https://piwtools.com.br/) e **PokePedia** (https://poke.idleworld.online/pokepedia). Elas aparecem
na ponta direita da tira de abas, no modo abas, e ficam fora do grid 2x2 (o grid é só das contas do
jogo). No grid, Ctrl+5 e Ctrl+6 abrem direto nelas. Quem já tinha o app configurado recebe a
PokePedia uma única vez; se você remover, ela não volta. A engrenagem aceita até 4 abas extras. A reconexão automática não age nela: é um site de ferramentas, não o jogo.

Pra trocar o endereço, renomear, remover ou acrescentar abas, use "Abas extras" na engrenagem. Pode
apontar pra qualquer domínio: o controle não depende de lista de domínios.

## Login automático

**Cada painel tem o seu jeito de entrar.** Clique na chave da faixa do painel e escolha: usuário e
senha, Entrar com Google, não fazer nada, ou seguir o padrão do app. Assim uma conta que entra por
usuário e senha convive com outra que entra pelo Google. A chave fica acesa quando o painel está
pronto para entrar sozinho (Google escolhido, ou usuário e senha cadastrados).

O padrão do app fica na engrenagem, em "Login automático padrão", com três opções:

1. **Preencher usuário e senha salvos** (padrão). Cadastre o acesso na chave da faixa de cada painel.
2. **Clicar em "Entrar com Google"**. O app dá o clique no botão, uma vez por carregamento. Se aquele
   perfil já tiver sessão do Google, o login se completa sozinho.
3. **Não fazer nada.**

Em todos, o app para no mesmo ponto: **a verificação "confirme que é humano", o botão Entrar e qualquer
senha ou 2FA do Google são você quem faz**. O app nunca digita nada em página do Google, e automatizar
o resto do fluxo é o caminho para o Google ou a Cloudflare marcarem a conta.

O app abre em `https://poke.idleworld.online/play`. Se a sessão estiver viva, cai direto no jogo; se
não, o site manda para a tela de entrar e o login automático age ali.

## Login preenchido sozinho

Cadastre usuário e senha de cada conta na chave da faixa. Sempre que aquele painel cair na tela
de login, o app preenche os dois campos e avisa em dourado. **O clique em Entrar e a verificação
"confirme que é humano" continuam com você**: login automático por trás da verificação anti-bot
é caminho de banimento, então o app não faz.

A senha fica só neste computador, cifrada pelo Windows (DPAPI), em
`%APPDATA%\quadview-solo\acessos.json`. Se a cifragem do sistema não estiver disponível, o app se
recusa a salvar em vez de gravar em texto puro. A página do jogo não tem acesso nenhum ao cofre.

Alternativa sem app nenhum no meio: salve a senha no gerenciador do próprio Chrome, em cada perfil.
Aí o preenchimento é do navegador, o que é o caminho mais tranquilo de todos. As duas formas convivem.

## Reconexão automática

Recarrega a página quando ela cai: até 3 vezes, 90 segundos entre tentativas. Dispara por
página sem responder, aviso de desconexão do jogo, navegador offline, servidor sem mandar
dados, ou tela sem mudar por X minutos (padrão 5, configurável).

Duas coisas que ele não faz, de propósito:

- **Não faz login sozinho.** Se o painel cair em `/login`, ele só avisa. Login automático
  esbarra na verificação anti-bot e é risco de banimento.
- **Não simula atividade no jogo.** O detector de "parado" serve pra achar aba travada. Se o
  jogo pausar de propósito por inatividade, desligue essa opção em vez de usar o recarregamento
  pra contornar a pausa.

## Arquitetura

- `src/main.js`: abre um Chrome por perfil (`--user-data-dir` próprio), acha a janela criada,
  encaixa dentro da janela do app e cuida do layout, do estado e da saúde dos painéis.
- `src/janelas.js`: camada de encaixe. No Windows conversa com a API de janelas por um PowerShell
  que fica vivo (`src/win32.ps1`: SetParent, MoveWindow, estilos). No Linux usa X11 via xdotool,
  que é o caminho usado nos testes automatizados.
- `src/cdp.js`: a ponte com o navegador pela porta de depuração. Registra o observador para todas as
  navegações e manda comandos diretos (navegar, recarregar, avaliar).
- `src/observador.js`: o que roda dentro da página. Observa (URL, mudanças na tela, texto de
  desconexão, WebSocket do jogo, rede) e executa som, preencher login e o clique no Google. Fica em
  arquivo separado de propósito: como texto dentro de outro arquivo, as barras das expressões
  regulares se perdem, e foi exatamente esse o bug que deixou a ponte muda.
- `src/casca.*`: a barra de cima e as faixas de cada painel. O miolo de cada célula é a janela
  do Chrome encaixada, por isso as faixas ficam em tiras reservadas e nunca por cima do jogo.

## Sobre desempenho

O que o app faz pra não atrapalhar:

- **Nasce no lugar.** Cada janela do Chrome é aberta já na posição e no tamanho finais (em coordenada
  de tela), é escondida antes de virar filha e só reaparece encaixada. Não existe mais o "abre num
  canto e pula pro lugar".
- **Um movimento só.** Reposicionar os painéis é uma única chamada ao Windows que move todos juntos
  (DeferWindowPos), em vez de uma chamada por painel. Arrastar e redimensionar a janela fica liso.
- **A casca não usa GPU.** A barra e as faixas são texto: aceleração desligada devolve placa de vídeo
  e memória pros painéis. Medido: 11 processos e 660 MB caíram para 6 processos e 522 MB.
- **O observador quase não custa.** Ler `innerText` para procurar aviso de desconexão força o
  navegador a recalcular o layout inteiro (medido na página do jogo: 5,64 ms contra 0,13 ms sem isso).
  O observador lê só os nós de texto, pulando `script` e `style`, um ciclo sim e outro não (e todo
  ciclo quando já viu sinal de queda), e o detector de mudanças desliga na primeira mudança de cada
  ciclo em vez de contar todas.

**Edge deixa mais rápido que o Chrome?** Não. É o mesmo Blink e o mesmo V8; a diferença é o que roda
em segundo plano, alguns MB e nenhum FPS.

Se o Edge encher a tela com barra lateral ou outras coisas dele, a engrenagem tem um campo de
parâmetros extras, por exemplo `--disable-features=msEdgeSidebarV2`.

O que o app não consegue resolver: são 4 ou 5 instâncias do jogo rodando ao mesmo tempo, e isso custa
o que custa (aqui, cerca de 1 GB por painel). Se a máquina apertar, o caminho é reduzir o número de
painéis ou baixar a qualidade gráfica dentro do jogo. Trocar o Electron por um app nativo economizaria
umas poucas centenas de MB da casca, que é a menor parte da conta.

## O que pode dar errado no Windows

O encaixe usa API de janelas do sistema. Testei toda a lógica no Linux, com as janelas do
Chromium virando filhas da janela do app de verdade, mas **não consegui testar as chamadas do
Windows daqui**. Pontos de atenção:

- **A barra de título do Chrome.** Em modo app o Chrome desenha a própria barrinha de título por
  dentro da janela, e ela não sai mexendo no estilo da janela. O app esconde essa faixa recortando
  a região visível: a janela sobe 34 pixels e cresce o mesmo tanto, e os primeiros 34 pixels ficam
  fora do recorte. Se na sua tela sobrar um pedaço da barra ou faltar um pedaço do jogo, ajuste
  **Recorte do topo** na engrenagem (34 é o padrão em 100% de escala; a barra do Edge pode ter altura um pouco diferente da do Chrome).
- **Nada de HTML aparece sobre um painel.** O painel encaixado é janela nativa de outro processo, e o
  Windows sempre desenha isso por cima do que o app pinta. Por isso a configuração e o acesso são
  janelas de verdade, e o aviso ocupa uma faixa que empurra os painéis para baixo em vez de flutuar
  sobre eles. Qualquer coisa nova que precise aparecer sobre o jogo tem que seguir uma dessas duas
  formas: janela própria ou faixa que reserva espaço.
- **O encaixe é conferido o tempo todo.** A cada 10 segundos o app reposiciona os painéis, o que
  conserta sozinho janela que o navegador redimensionou por conta própria, e tenta reencaixar (até 6
  vezes) painel cujo encaixe falhou. Painel que **você** soltou no botão fica solto: só o que falhou
  é reencaixado.
- **Qual janela é a do jogo.** O app pega a maior janela visível daquele perfil, nunca a primeira que
  aparece, senão uma tela de boas-vindas do navegador acabaria encaixada no lugar do jogo.
- **Ordem das janelas.** Uma janela filha mandada para o fundo fica atrás da superfície de desenho do
  próprio app e some (o painel fica preto). Por isso o app só mexe na ordem de quem precisa ficar na
  frente e nunca rebaixa ninguém. `node test/win32-guard.js` guarda essa regra.
- **Voltar do minimizado.** Janela filha de outro processo tem fila de entrada própria, e depois que
  o app é minimizado e volta ela fica desemparelhada: o painel aparece mas não aceita clique, ou
  congela. O app se recupera sozinho: refaz o encaixe de cada painel (reafirma o pai, redimensiona de
  verdade, levanta, redesenha e emparelha a entrada com `AttachThreadInput`). Detalhe que custou caro:
  o evento de restaurar chega **antes** de a janela estar de pé, e mexer nos painéis nessa hora não tem
  efeito. Por isso a recuperação roda com atraso, em 250 ms e de novo em 1,1 s. Também fica desligada a
  detecção de janela encoberta do navegador (`--disable-features=CalculateNativeWinOcclusion`).
- **Tamanho conferido, não presumido.** Depois de posicionar, o app lê o retângulo que cada janela
  realmente ficou. Se não bate com o pedido, tenta de novo; se ainda assim não bater, o painel mostra
  o aviso com as duas medidas em vez de ficar torto em silêncio.
- **Escala do monitor.** O app converte pontos para pixels usando a escala do monitor onde ele
  está. Em monitores com escalas diferentes, um painel pode ficar torto. Solução: use **Grid**
  pra reposicionar, ou solte o painel na janela própria.
- **Foco do teclado.** Clique dentro do painel antes de digitar. Como a janela é de outro
  processo, algum atalho pode se comportar diferente.
- **Se o encaixe falhar**, o painel não some: ele abre em janela própria, avisa o motivo na
  célula e oferece "Encaixar de volta". Mute, recarregar, status e reconexão continuam funcionando.

## Onde ficam os dados

`%APPDATA%\quadview-solo`: `perfis\` (um por conta, com login e save), `config.json`.
Apagar a pasta de um perfil zera só aquela conta.

## Testes

`xvfb-run node test/e2e-embed.js` (Linux, precisa de xdotool e x11-utils): sobe um jogo falso
que cai de propósito e confere abertura automática, encaixe, maximizar, soltar, encaixar de volta,
geometria do recorte, modo abas, aba extra, reconexão, preenchimento do login e fechar tudo. São 32 verificações, mais `node test/win32-guard.js`, `node test/ponte-guard.js` `node test/migracao-test.js` e `node test/empacotamento-test.js`.

O recorte em si (esconder a barra do Chrome) só existe no Windows; no Linux o teste confere a
geometria, que é a parte que pode sair errada, e não o recorte em si.

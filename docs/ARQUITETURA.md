# Arquitetura e decisões

Este documento é para quem vai mexer no código. Ele explica como as peças se encaixam e, principalmente, por que cada coisa é do jeito que é. Boa parte das regras abaixo nasceu de um bug real, e cada uma tem um teste que impede a volta dele.

## Visão geral

O QuadView não renderiza o jogo. Ele abre um Edge ou Chrome de verdade por conta, cada um com `--user-data-dir` próprio, e transforma a janela desse navegador em janela filha da janela do app. O que o Electron desenha é só a casca: a barra de cima e a faixa de cada painel.

| Arquivo | Papel |
|---|---|
| `src/main.js` | Abre os navegadores, acha e encaixa as janelas, calcula o layout, acompanha a saúde de cada painel, reconecta, cuida do cofre de acesso. |
| `src/janelas.js` | Camada de encaixe. No Windows conversa com `win32.ps1`. No Linux usa X11 (xdotool), que é o caminho dos testes. |
| `src/win32.ps1` | PowerShell que fica vivo e recebe um comando JSON por linha. Tem C# embutido com as chamadas da API do Windows. |
| `src/cdp.js` | Cliente da porta de depuração do navegador (Chrome DevTools Protocol). |
| `src/observador.js` | Script que roda dentro da página do jogo: observa conexão, mudanças de tela e aviso de queda, e executa som, preencher login e o clique do Google. |
| `src/extensoes.js` | Catálogo, download, validação, hash e embrulho dos userscripts. |
| `src/casca.*`, `config.*`, `creds.*`, `extensoes.html` | Interface: casca principal e as janelas de configuração, acesso e extensões. |
| `src/migracao.js` | Oferece abas extras novas para quem já tinha configuração salva, uma vez só. |

## Por que não renderizar o jogo no Electron

A verificação anti-bot do site identificava o Electron e barrava o login. Mascarar o ambiente para passar por ela seria burlar uma proteção, então a decisão foi a oposta: usar o navegador que a pessoa já tem, sem disfarce. O app também nunca resolve a verificação nem envia o formulário de login.

## Controle sem extensão

Versões antigas instalavam uma extensão em cada perfil. O Chrome 137 removeu o `--load-extension` das versões de marca, e pedir para a pessoa instalar extensão à mão quebrava a ideia de abrir e jogar. O controle passou para a porta de depuração (`--remote-debugging-port`, só em 127.0.0.1, porta livre escolhida na hora).

Regras que valem ouro:

- **Sem `Runtime.enable` nem `Log.enable`.** São eles que ligam o relato de console e exceções, o rastro que uma página consegue perceber. Só `Page.enable` é usado, e ele é necessário: sem ele o `Page.addScriptToEvaluateOnNewDocument` é aceito e nunca roda (foi medido).
- **Modo aplicativo de verdade.** O navegador abre com `--app=<url do jogo>`. Abrir em branco para injetar antes tirava o modo aplicativo e trazia a barra de endereço de volta. Por isso o app abre direto no jogo e recarrega uma vez depois de instalar o observador, que assim pega o WebSocket do jogo desde o começo.
- **A ponte só vale quando lê estado.** Canal aberto não prova nada. Três leituras falhas seguidas derrubam a ponte, uma só não (durante um reload a página fica alguns instantes sem o observador).
- **O observador mora em arquivo próprio.** Como texto dentro de outro arquivo, as barras das expressões regulares se perdiam e o script morria calado.

## Encaixe de janelas no Windows

O encaixe é `SetParent` mais troca de estilo para `WS_CHILD`. O resto desta seção é o que isso custa.

**Nada de HTML aparece sobre um painel.** Janela nativa de outro processo é sempre desenhada por cima do que o Electron pinta. Por isso configuração, acesso e extensões são janelas de verdade, e o aviso do topo é uma faixa que empurra os painéis para baixo em vez de flutuar.

**A barra de título do navegador.** Em modo aplicativo o Chrome desenha a própria barra por dentro da janela, e ela não sai por estilo. O app recorta a região visível (`SetWindowRgn`), subindo a janela 34 pixels e escondendo essa faixa. O valor é configurável porque muda com escala e navegador.

**Nasce no lugar.** Cada navegador abre já na posição final em coordenada de tela, é escondido antes de virar filho e só reaparece encaixado. Sem isso a janela surgia num canto e pulava.

**Nunca rebaixar um painel.** Mandar janela filha para o fundo a esconde atrás da superfície de desenho do próprio app: o grid ficava preto. Todo painel é levantado em todo layout, e o da frente vai por último.

**Um movimento só.** O layout inteiro é um `BeginDeferWindowPos`/`EndDeferWindowPos`. Depois o app lê o retângulo que cada janela realmente ficou e, se não bate, tenta de novo e avisa na faixa.

**Voltar do minimizado.** O evento de restaurar chega antes de a janela estar de pé, e mexer nos painéis nessa hora não tem efeito. A recuperação roda com atraso, em 250 ms e de novo em 1,1 s. O navegador também abre com `--disable-features=CalculateNativeWinOcclusion`, senão ele acha que está encoberto e para de desenhar.

**Repintar é piscar.** A volta do minimizado chegou a ter seis passes (restore, show e focus disparam juntos, cada um com dois tempos), e cada passe reencaixava os quatro painéis com redimensionamento e `RedrawWindow`. Some disso vinha `SetWindowRgn`, que não compara: com redraw ele invalida a janela inteira mesmo quando a região é a mesma, e ele rodava em todo layout, inclusive na ronda de 10 segundos. E redimensionar uma janela do Chrome, mesmo por 8 pixels, faz o compositor dele refazer a superfície: um quadro em branco por painel. Regras atuais: a volta do minimizado só confere pai, posição, tamanho e visibilidade (`NoLugar`) e levanta o painel; a "dança" completa de reencaixe (encolhe, cresce, recorta, redesenha) fica para painel que estiver de fato fora do lugar, e nela o tamanho intermediário não é pintado. O congelamento que a dança curava é o que a flag `CalculateNativeWinOcclusion` desligada resolve.

**O recorte é conferido, não lembrado.** `SetWindowRgn` não compara: com redraw ele invalida a janela inteira mesmo com a região igual. Mas guardar "já apliquei" também não serve: o Chrome mexe na região da própria janela quando ela muda de tamanho e zera a nossa (foi assim que as abas extras apareceram espiando pelos últimos pixels do app). A cada layout o app pergunta à janela (`GetWindowRgn` + `GetRgnBox`) e só reaplica quando o recorte não é o pedido.

**Sobrepostos, só o da frente sobe.** No modo abas, e com um painel maximizado sobre a grade, os painéis ocupam o mesmo retângulo. Levantar todos a cada layout traz os de trás por um instante para a frente do visível, e o da frente é coberto e descoberto: era a piscada que só existia no modo abas. Nesses modos os de trás recebem `SWP_NOZORDER`; só o da frente vai para `HWND_TOP`. Na grade ninguém se sobrepõe e todos sobem, porque a janela invisível do app volta por cima deles depois de minimizar ou redimensionar.

**Aba extra escondida de verdade.** Fora do modo abas, as abas extras não moram na grade. Antes eram empurradas para uma terceira linha, fora da área visível; agora recebem `ShowWindow(SW_HIDE)` e voltam com `SW_SHOWNA` ao entrar no modo abas. Escondidas, nada delas aparece e o navegador não gasta desenhando.

**Achar a janela sem WMI.** A janela do navegador é procurada primeiro pelo processo que o app lançou (`EnumWindows` filtrado pelo PID, instantâneo). A consulta por perfil (`Win32_Process`, lenta, e seis painéis disputando a mesma fila do PowerShell) só entra quando esse processo já encerrou (um navegador aberto com o mesmo perfil assumiu a janela) ou depois de 8 segundos sem janela. Antes, a janela ficava segundos solta na tela e na barra de tarefas até ser encaixada. O que resta é o próprio Chrome: a janela dele existe como janela normal (com botão na barra de tarefas) até o app capturá-la, e isso não dá para evitar de fora; dá para encurtar, e a busca por processo roda a cada 100 ms.

**Ronda.** A cada 10 segundos o app reposiciona os painéis e tenta reencaixar (até 6 vezes) o que falhou. Painel que a pessoa soltou de propósito fica solto.

## Teclado, a parte mais traiçoeira

Clique chega numa janela filha de outro processo porque o Windows entrega clique por posição na tela. Tecla vai por foco, e foco existe dentro de uma fila de entrada. Foram quatro bugs em sequência, e os quatro viraram regra:

1. **Filas separadas.** As teclas morriam na fila do app. A cura é `AttachThreadInput`, mantido enquanto o painel está encaixado e desfeito ao soltar ou fechar.
2. **A direção importa.** Uma thread mora em uma fila por vez. Se o app gruda na fila do painel, só o primeiro painel digita. Quem gruda é o painel, na fila do app, e assim os quatro dividem a mesma fila.
3. **O app não pode supor onde está o foco.** O clique dentro do painel não passa pelo Electron. O app achava que o teclado estava onde ele mesmo tinha posto por último e o puxava de volta a cada evento de foco. Agora ele pergunta ao Windows (`GetGUIThreadInfo`) e só toma o teclado quando nenhum painel está com ele. É dessa leitura que sai a etiqueta TECLADO.
4. **Janela filha nunca é ativada.** E é pela ativação que o navegador pega o teclado. Um vigia dentro da ponte observa o botão do mouse (a cada 25 ms) e, se o clique caiu sobre um painel que não tem o foco, entrega o teclado a ele.

Efeito colateral aceito: os painéis e o app dividem uma fila de entrada. Se o navegador de uma conta travar de vez, os outros sentem.

A ronda só devolve foco se o app já estiver em primeiro plano, para não roubar a tela de quem está usando outro programa.

## Reconexão

Os sinais, do mais forte para o mais fraco: WebSocket do jogo fechado (só conta o que termina em `/ws`, analytics e terceiros ficam de fora), texto de desconexão na tela, navegador offline, servidor sem mandar dados, e tela sem mudar por X minutos.

Dois cuidados de desempenho no observador: o texto de queda é procurado andando pelos nós de texto e pulando `script` e `style`, porque `innerText` força o recálculo do layout inteiro (medido na página do jogo: 5,64 ms contra 0,13 ms) e `textContent` lê o código do próprio jogo, onde a palavra "desconectado" aparece e gerava reconexão falsa. E o detector de mudanças desliga na primeira mutação de cada ciclo em vez de contar todas.

## Extensões

O app injeta userscripts pelo mesmo `Page.addScriptToEvaluateOnNewDocument`, depois do observador, e guarda o identificador de cada um para conseguir retirar. Ligar, desligar ou atualizar recarrega só os painéis do jogo.

O embrulho em volta de cada script faz o papel do gerenciador de userscripts:

- **`@match` convertido com domínio e caminho separados.** O curinga de domínio (`https://*.exemplo.com/*`) não pode atravessar barra, senão casaria com `https://outro.site/x.exemplo.com/`.
- **Uma vez por documento**, com uma marca no `window`.
- **Espera o `<html>` existir.** A injeção pela porta de depuração acontece antes de `document.documentElement` existir. O Tampermonkey roda o `document-start` um instante depois, e os scripts contam com isso. O PIW-QOL acessa `document.documentElement.style` na largada e morria inteiro. O embrulho espera o elemento raiz nascer, o que ainda é antes do primeiro script da página. Esse caso tem teste em navegador de verdade (`test/extensoes-navegador-test.js`), porque nenhum teste com página simulada pegava.
- **Acompanha navegação sem recarga.** O jogo guarda a sessão no `sessionStorage`, então todo dia o painel abre em `/login` e, depois do login, o endereço vira `/play` sem documento novo. Script com `@match` só em `/play` nunca era conferido de novo. Quando o endereço entra no `@match`, o embrulho recarrega a página uma vez (com trava de 15 segundos contra círculo), para o script nascer no começo do documento e conseguir trocar o `WebSocket` antes de o jogo abrir o dele.
- **Erro do script aparece.** O embrulho não engole exceção do userscript.

Proteções do lado do app: download só por HTTPS de `raw.githubusercontent.com`, sem seguir redirecionamento e com limite de tamanho; validação do cabeçalho; recusa de qualquer `@grant` que não seja `none`; troca atômica do arquivo (falha no meio mantém a versão anterior); SHA-256 guardado e conferido a cada carga; a janela de extensões só consegue abrir endereços do catálogo, nunca um endereço que venha dela.

O texto final injetado (embrulho mais script) é guardado por hash, porque montá-lo percorre o cabeçalho, converte cada `@match` e cria uma string de centenas de kB, e os seis painéis pediam o dela separado. O que o cache **não** pula é a conferência: o arquivo é lido e comparado com o hash do download a cada chamada, senão uma cópia trocada por fora mantendo data e tamanho entraria sem ser vista. `test/extensoes-test.js` trava as duas metades dessa regra.

Para adicionar uma extensão, inclua uma entrada em `CATALOGO`, em `src/extensoes.js`. Antes, leia o script: o que ele faz no jogo, para onde faz pedidos, se carrega código remoto.

## Segurança

- Todas as janelas do app rodam com `contextIsolation`, `sandbox` e uma política de conteúdo que só aceita script local. **Todos** os canais de IPC conferem que o remetente é uma janela do próprio app (`daCasca`). Antes a conferência estava só nos canais de acesso e extensões; configuração e abrir-pasta ficavam de fora, o que não era explorável hoje (a página do jogo não é um renderizador do Electron e não tem IPC nenhum) mas deixava uma porta aberta para o dia em que alguma janela carregasse conteúdo de fora.
- Índice de painel vindo da casca é conferido antes de virar `paineis[i]`. Um índice fora da faixa numa ação derrubava o processo principal inteiro, ou seja, o app todo, por causa de um erro de uma janela só.
- Endereço de painel salvo na configuração só pode ser `http`/`https`. Sem isso dava para gravar um `file://` que depois viraria o `--app=` do navegador.
- Senhas são cifradas com `safeStorage` (DPAPI no Windows) e nunca saem do processo principal em claro para a casca.
- A página do jogo não tem acesso a nenhum IPC do app.
- A porta de depuração escuta só em 127.0.0.1. Ainda assim, enquanto o app está aberto, um programa local poderia se conectar a ela.

## Desempenho

A casca desliga a aceleração de vídeo (`app.disableHardwareAcceleration()`): ela é só texto, e isso devolve GPU e memória para os painéis (medido: de 11 processos e 660 MB para 6 processos e 522 MB). O grosso do consumo é o jogo em si, cerca de 1 GB por painel, e isso nenhuma casca resolve. Edge e Chrome têm o mesmo desempenho aqui: é o mesmo motor.

Coisas que só aparecem com o app aberto por horas, e que valem a pena não reintroduzir:

- **Rondas que se atropelam.** `rondaDeEstado` e `rondaDeJanelas` são assíncronas e vivem num `setInterval`, que não espera. Painel lento (a leitura de estado espera até 8 s) fazia a ronda seguinte começar por cima da anterior, e duas rondas juntas reinjetam o observador e disputam a mesma sessão. As duas têm trava de reentrada, como `posicionar` já tinha.
- **Relógios de desistência desarmados.** Cada comando para a ponte do PowerShell e cada chamada à porta de depuração armava um `setTimeout` de 6 a 8 segundos que nunca era cancelado quando a resposta chegava. Com uma leitura por painel a cada 5 segundos, era uma fila de temporizadores vivos à toa. Agora chegou a resposta, o relógio cai.
- **O vigia do clique dorme quando não há painel.** Ele acorda 40 vezes por segundo para ver se o botão do mouse desceu. Com todos os painéis fechados isso não servia para nada: a thread agora sai e o próximo encaixe a levanta de novo.
- **Porta de depuração devolvida.** Navegador fechado por fora (a pessoa clica no X do Chrome) não passa por `fecharPainel`, e a porta reservada ficava marcada como em uso para sempre.
- **Nada de segunda cópia do script por painel.** A sessão de cada painel guardava a fonte inteira da extensão para saber se mudou; agora guarda só o hash.
- **Lista de contextos de áudio limitada** no observador: jogo que cria um contexto por efeito faria a lista crescer sem fim dentro da página.

## Empacotamento

`electron-builder`, alvo `portable`. O `win32.ps1` e o ícone saem do `app.asar` (`asarUnpack`), porque o PowerShell não lê de dentro do arquivo. O C# embutido fica restrito à sintaxe do C# 5, que é o que o `Add-Type` do Windows PowerShell 5.1 compila.

O nome do pacote (`quadview-solo`) define a pasta de dados em `%APPDATA%`. Trocar esse nome, ou criar um `productName` na raiz do `package.json`, muda a pasta e faz todo mundo perder os perfis logados.

## Testes

| Comando | O que cobre |
|---|---|
| `npm test` | Regras estáticas do Windows e da ponte, migração, empacotamento e o módulo de extensões. Node puro, roda em qualquer sistema. |
| `npm run test:navegador` | Injeta um userscript num Chromium de verdade, do jeito que o app injeta. |
| `npm run test:e2e` | Sobe um jogo falso que cai de propósito e roda o app inteiro em Linux (Xvfb, xdotool, x11-utils, Chromium em `QV_CHROME`). |

As chamadas da API do Windows não rodam no Linux. Por isso `test/win32-guard.js` lê o código e trava cada correção com o motivo ao lado: não rebaixar painel, quem gruda em quem, não desfazer o vínculo ao dar foco, não roubar primeiro plano, e assim por diante. É um teste mais fraco que executar, e o documento diz isso de propósito: mudança em `win32.ps1` precisa ser testada numa máquina Windows antes de virar versão.

Duas guardas são contra o código morto voltar a se acumular: todo comando do `win32.ps1` tem de ter quem o chame em `janelas.js`, e toda função exportada por `janelas.js` tem de ser usada no `main.js`. Foi assim que `mover`, `recorte`, `acordar` e `reativar` sobreviveram depois de o reencaixe assumir o trabalho dos quatro. A guarda também recorta cada bloco de comando pelo *próximo* comando, seja qual for, em vez de ancorar no nome de um vizinho: ancorar pelo nome fazia remover um comando quebrar regras que não tinham nada a ver com ele.

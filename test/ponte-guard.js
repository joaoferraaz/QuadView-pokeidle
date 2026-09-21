// Regras da ponte com o navegador e da escolha de navegador.
const fs = require('fs');
const path = require('path');
const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const cdp = fs.readFileSync(path.join(__dirname, '..', 'src', 'cdp.js'), 'utf8');
const semComentarios = (t) => t.replace(/\/\/[^\n]*/g, '');

const casos = [
  ['Edge vem antes do Chrome na busca automática', (() => {
    const lista = main.slice(main.indexOf("const cands = process.platform === 'win32'"), main.indexOf('return cands.find'));
    const iEdge = lista.indexOf('Microsoft');
    const iChrome = lista.indexOf('Google');
    return iEdge > -1 && iChrome > -1 && iEdge < iChrome;
  })()],
  ['não existe mais extensão para instalar', !fs.existsSync(path.join(__dirname, '..', 'extension'))
    && !/load-extension/.test(main)],
  ['cada painel abre com porta de depuração própria', /--remote-debugging-port=\$\{p\.portaDebug\}/.test(main)],
  ['a porta é escolhida entre as que estão livres de verdade', /portaEstaLivre/.test(main) && /escolherPorta/.test(main)],
  ['abre em modo aplicativo, sem barra de endereço', /--app=\$\{p\.url \|\| config\.url\}/.test(main)
    && !/--app=about:blank/.test(main)],
  ['recarrega uma vez depois de instalar o observador (senão o socket inicial passa batido)',
    /prepararPonte/.test(main) && /sessao\.recarregar\(false\)/.test(main)],
  ['Page.enable é usado (sem ele o script injetado nunca roda)', /Page\.enable/.test(cdp)],
  ['Runtime.enable e Log.enable seguem fora (é o rastro que a página percebe)',
    !/Runtime\.enable/.test(semComentarios(cdp)) && !/Log\.enable/.test(semComentarios(cdp))],
  ['a ponte só é dada como viva depois de ler o estado', /this\.ligada = !!\(teste && teste\.url\)/.test(cdp)],
  ['leitura falha não derruba a ponte de primeira', /falhasDeLeitura >= 3/.test(main)],
  ['o texto de queda ignora script e style', (() => {
    const obs = fs.readFileSync(path.join(__dirname, '..', 'src', 'observador.js'), 'utf8');
    return /SCRIPT/.test(obs) && /FILTER_REJECT/.test(obs);
  })()],
];
let falhou = false;
for (const [nome, ok] of casos) { console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome}`); if (!ok) falhou = true; }
process.exit(falhou ? 1 : 0);

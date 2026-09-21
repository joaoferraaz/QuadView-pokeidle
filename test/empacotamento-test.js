// O app empacotado guarda o codigo dentro de app.asar; o PowerShell so abre arquivo de verdade.
const fs = require('fs');
const path = require('path');
const janelas = fs.readFileSync(path.join(__dirname, '..', 'src', 'janelas.js'), 'utf8');
const pacote = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const principal = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const ico = path.join(__dirname, '..', 'build', 'icon.ico');

const casos = [
  ['o caminho do script sai de dentro do app.asar', /app\.asar' \+ path\.sep, 'app\.asar\.unpacked/.test(janelas)],
  ['o build desempacota o win32.ps1', (pacote.build.asarUnpack || []).includes('src/win32.ps1')],
  ['o build gera um arquivo único chamado QuadView.exe', (pacote.build.portable || {}).artifactName === 'QuadView.exe'],
  ['o observador entra no pacote (é lido por fs, funciona dentro do asar)',
    (pacote.build.files || []).some((f) => f.startsWith('src'))],
  ['o ícone existe no repositório', fs.existsSync(ico)],
  ['o ícone tem os tamanhos que o Windows pede (16 a 256)', (() => {
    if (!fs.existsSync(ico)) return false;
    const b = fs.readFileSync(ico);
    const n = b.readUInt16LE(4);
    const larguras = new Set();
    for (let k = 0; k < n; k++) { const w = b[6 + k * 16]; larguras.add(w === 0 ? 256 : w); }
    return [16, 24, 32, 48, 64, 128, 256].every((t) => larguras.has(t));
  })()],
  ['o exe do Windows é gravado com o ícone', (pacote.build.win || {}).icon === 'build/icon.ico'],
  ['o ícone entra no pacote e sai do asar (as janelas o leem como arquivo)',
    (pacote.build.files || []).includes('build/icon.ico') && (pacote.build.asarUnpack || []).includes('build/icon.ico')],
  ['as janelas do app apontam o ícone', (principal.match(/icon: arqIcone\(\)/g) || []).length >= 3],
];
let falhou = false;
for (const [nome, ok] of casos) { console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome}`); if (!ok) falhou = true; }
process.exit(falhou ? 1 : 0);

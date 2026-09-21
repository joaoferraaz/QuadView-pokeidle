// A aba nova entra uma vez em config antiga, e nao volta se a pessoa remover.
const { migrar } = require('../src/migracao');
const casos = [];
const antiga = migrar({ extras: [{ nome: 'PIW Tools', slug: 'piw-tools', url: 'https://piwtools.com.br/' }] });
casos.push(['config antiga ganha a PokePedia', antiga.extras.some((x) => x.slug === 'pokepedia') && antiga.extras.length === 2]);
casos.push(['a aba que já existia continua lá', antiga.extras[0].slug === 'piw-tools']);
const removida = migrar({ ...antiga, extras: antiga.extras.filter((x) => x.slug !== 'pokepedia') });
casos.push(['se a pessoa remover, não volta', !removida.extras.some((x) => x.slug === 'pokepedia')]);
const dupla = migrar(migrar({ extras: [] }));
casos.push(['rodar duas vezes não duplica', dupla.extras.filter((x) => x.slug === 'pokepedia').length === 1]);
let falhou = false;
for (const [nome, ok] of casos) { console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome}`); if (!ok) falhou = true; }
process.exit(falhou ? 1 : 0);

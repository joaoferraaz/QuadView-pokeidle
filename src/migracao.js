// Abas extras que chegaram depois da primeira versao. Cada uma entra uma unica vez numa config ja
// salva; se a pessoa remover depois, nao volta.
const EXTRAS_NOVAS = [{ nome: 'PokePedia', slug: 'pokepedia', url: 'https://poke.idleworld.online/pokepedia' }];
function migrar(c) {
  c.extrasOferecidas = Array.isArray(c.extrasOferecidas) ? c.extrasOferecidas : [];
  c.extras = Array.isArray(c.extras) ? c.extras : [];
  for (const nova of EXTRAS_NOVAS) {
    if (c.extrasOferecidas.includes(nova.slug)) continue;
    c.extrasOferecidas.push(nova.slug);
    if (!c.extras.some((x) => x.slug === nova.slug)) c.extras.push({ ...nova });
  }
  return c;
}

module.exports = { migrar, EXTRAS_NOVAS };

// Camada que encaixa janelas de outro programa dentro da janela do app.
// Windows: chama a API nativa por um PowerShell que fica vivo. Linux: usa X11 pelo xdotool (serve pros testes).
const { spawn, execFile } = require('child_process');
const path = require('path');

const ehWindows = process.platform === 'win32';

// ---------- Windows ----------
let ps = null;
let seq = 0;
const esperando = new Map();

function subirPowerShell() {
  if (ps) return ps;
  // No app empacotado o codigo mora dentro de app.asar, que o PowerShell nao consegue abrir.
  // Por isso o win32.ps1 e desempacotado no build e o caminho aponta para a copia de fora.
  const script = path.join(__dirname, 'win32.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let resto = '';
  ps.stdout.on('data', (d) => {
    resto += d.toString();
    let i;
    while ((i = resto.indexOf('\n')) >= 0) {
      const linha = resto.slice(0, i).trim();
      resto = resto.slice(i + 1);
      if (!linha) continue;
      try {
        const r = JSON.parse(linha);
        const cb = esperando.get(r.id);
        if (cb) { esperando.delete(r.id); cb(r); }
      } catch (_) {}
    }
  });
  ps.on('exit', () => { ps = null; esperando.forEach((cb) => cb({ ok: false, erro: 'ponte caiu' })); esperando.clear(); });
  return ps;
}

function chamarWindows(cmd) {
  return new Promise((resolve) => {
    const p = subirPowerShell();
    if (!p) return resolve({ ok: false, erro: 'sem powershell' });
    const id = ++seq;
    esperando.set(id, resolve);
    setTimeout(() => { if (esperando.delete(id)) resolve({ ok: false, erro: 'sem resposta' }); }, 6000);
    p.stdin.write(JSON.stringify({ id, ...cmd }) + '\n');
  });
}

// ---------- Linux (testes) ----------
const rodar = (bin, args) => new Promise((resolve) => {
  execFile(bin, args, (erro, saida) => resolve({ ok: !erro, saida: (saida || '').trim(), erro: erro && erro.message }));
});

async function chamarLinux(c) {
  switch (c.cmd) {
    case 'achar': {
      // A janela do jogo e a maior visivel do perfil: telinha de boas-vindas e popup ficam de fora.
      let melhor = null;
      let melhorArea = 0;
      for (const pid of c.pids || []) {
        const r = await rodar('xdotool', ['search', '--onlyvisible', '--pid', String(pid)]);
        for (const alca of r.saida.split('\n').filter(Boolean)) {
          const g = await rodar('xdotool', ['getwindowgeometry', alca]);
          const m = /Geometry:\s*(\d+)x(\d+)/.exec(g.saida || '');
          if (!m) continue;
          const [larg, alt] = [Number(m[1]), Number(m[2])];
          if (larg < 300 || alt < 200) continue;
          if (larg * alt > melhorArea) { melhorArea = larg * alt; melhor = alca; }
        }
      }
      return melhor ? { ok: true, alca: melhor } : { ok: false, erro: 'sem janela' };
    }
    case 'encaixar':
      await rodar('xdotool', ['windowreparent', c.alca, c.pai]);
      await rodar('xdotool', ['windowmove', c.alca, String(c.x), String(c.y)]);
      await rodar('xdotool', ['windowsize', c.alca, String(c.w), String(c.h)]);
      await rodar('xdotool', ['windowmap', c.alca]);
      return { ok: true };
    case 'mover':
      await rodar('xdotool', ['windowmove', c.alca, String(c.x), String(c.y)]);
      await rodar('xdotool', ['windowsize', c.alca, String(c.w), String(c.h)]);
      if (c.frente) await rodar('xdotool', ['windowraise', c.alca]);
      return { ok: true };
    case 'mover-lote': // todo painel e levantado em todo layout; o da frente vem por ultimo
      for (const it of c.itens) await chamarLinux({ cmd: 'mover', ...it, frente: true });
      return { ok: true };
    case 'focar': await rodar('xdotool', ['windowfocus', c.alca]); return { ok: true };
    case 'foco-atual': { const r = await rodar('xdotool', ['getwindowfocus']); return { ok: true, alca: (r.saida || '').trim() }; }
    case 'soltar': {
      // No X11 a "area de trabalho" e a janela raiz, que tem id proprio (no Windows o equivalente e zero).
      const info = await rodar('xwininfo', ['-root']);
      const m = /Window id:\s*(0x[0-9a-f]+)/i.exec(info.saida || '');
      if (!m) return { ok: false, erro: 'nao achei a janela raiz' };
      await rodar('xdotool', ['windowreparent', c.alca, String(parseInt(m[1], 16))]);
      await rodar('xdotool', ['windowmove', c.alca, String(c.x || 100), String(c.y || 100)]);
      await rodar('xdotool', ['windowsize', c.alca, String(c.w || 900), String(c.h || 700)]);
      return { ok: true };
    }
    case 'acordar': await rodar('xdotool', ['windowmap', c.alca]); return { ok: true };
    case 'reativar': await rodar('xdotool', ['windowfocus', c.alca]); return { ok: true };
    case 'reencaixar':
      await rodar('xdotool', ['windowreparent', c.alca, c.pai]);
      await rodar('xdotool', ['windowsize', c.alca, String(c.w - 8), String(c.h - 8)]);
      await rodar('xdotool', ['windowmove', c.alca, String(c.x), String(c.y)]);
      await rodar('xdotool', ['windowsize', c.alca, String(c.w), String(c.h)]);
      await rodar('xdotool', ['windowmap', c.alca]);
      return { ok: true };
    case 'recorte': return { ok: true }; // no X11 dos testes nao existe a barra do Chrome para recortar
    case 'fechar': await rodar('xdotool', ['windowkill', c.alca]); return { ok: true };
    default: return { ok: false, erro: 'comando desconhecido' };
  }
}

const chamar = (cmd) => (ehWindows ? chamarWindows(cmd) : chamarLinux(cmd));

module.exports = {
  disponivel: () => ehWindows || process.platform === 'linux',
  achar: (perfil, pids) => chamar({ cmd: 'achar', perfil, pids }),
  encaixar: (alca, pai, cx) => chamar({ cmd: 'encaixar', alca, pai, ...cx }),
  mover: (alca, cx, frente) => chamar({ cmd: 'mover', alca, ...cx, frente: !!frente }),
  // O pai vai junto porque no Windows dar teclado a uma janela de outro processo exige emparelhar
  // a fila de entrada das duas; so o handle da filha nao basta.
  focar: (alca, pai) => chamar({ cmd: 'focar', alca, pai }),
  acordar: (alca) => chamar({ cmd: 'acordar', alca }),
  reativar: (alca, pai) => chamar({ cmd: 'reativar', alca, pai }),
  reencaixar: (alca, pai, cx) => chamar({ cmd: 'reencaixar', alca, pai, ...cx }),
  soltar: (alca, cx) => chamar({ cmd: 'soltar', alca, ...(cx || {}) }),
  recorte: (alca, topo, w, h) => chamar({ cmd: 'recorte', alca, topo, w, h }),
  moverLote: (itens, pai) => chamar({ cmd: 'mover-lote', itens, pai }),
  fechar: (alca, pai) => chamar({ cmd: 'fechar', alca, pai }),
  quemTemFoco: (pai) => chamar({ cmd: 'foco-atual', pai }),
  encerrar: () => { if (ps) { try { ps.stdin.end(); ps.kill(); } catch (_) {} ps = null; } },
};

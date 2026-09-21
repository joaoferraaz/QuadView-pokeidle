# Ponte com a API de janelas do Windows. Recebe uma linha JSON por comando na entrada padrao
# e responde uma linha JSON. Fica vivo o tempo todo para nao recompilar o C# a cada chamada.
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Threading;
using System.Runtime.InteropServices;
public class QV {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int ht, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint deQuem, uint paraQuem, bool ligar);
  [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

  // Janela filha de OUTRO processo tem fila de entrada propria. O clique chega nela do mesmo jeito
  // porque o Windows entrega clique por posicao na tela; a TECLA vai por foco, e foco existe dentro
  // de uma fila. Com filas separadas, as teclas param na fila do app e a janela do jogo nunca recebe
  // nada: era exatamente isso que travava digitar usuario e senha. A cura e juntar as filas.
  //
  // A DIRECAO importa e nao e simetrica. Uma thread mora em UMA fila por vez, entao mandar o APP
  // grudar na fila do painel so funciona para um painel: no segundo o app teria de mudar de fila de
  // novo, e os outros tres ficam sem teclado (era o "so a tela 1 digita"). Por isso quem gruda e o
  // PAINEL, na fila do APP: os quatro entram na mesma fila, que continua sendo a do app.
  static uint ThreadDe(IntPtr h) { uint pid; return GetWindowThreadProcessId(h, out pid); }
  static HashSet<uint> grudadas = new HashSet<uint>();

  public static bool Grudar(IntPtr filha, IntPtr pai) {
    uint tPai = ThreadDe(pai), tFilha = ThreadDe(filha);
    if (tPai == 0 || tFilha == 0 || tPai == tFilha) return false;
    Registrar(filha, pai);
    lock (trava) {   // o vigia do clique tambem passa por aqui, em outra thread
      if (grudadas.Contains(tFilha)) return true;   // grudar de novo so empilha contador interno
      bool ok = AttachThreadInput(tFilha, tPai, true);
      if (ok) grudadas.Add(tFilha);
      return ok;
    }
  }

  public static void Desgrudar(IntPtr filha, IntPtr pai) {
    lock (trava) { paineisVivos.Remove(filha.ToInt64()); }
    uint tPai = ThreadDe(pai), tFilha = ThreadDe(filha);
    if (tPai == 0 || tFilha == 0 || tPai == tFilha) return;
    lock (trava) {
      if (!grudadas.Contains(tFilha)) return;
      AttachThreadInput(tFilha, tPai, false);
      grudadas.Remove(tFilha);
    }
  }

  // Entrega o teclado a este painel. SetFocus so vale se quem chama estiver na mesma fila, entao eu
  // entro na fila do app (que e onde os paineis estao), dou o foco e saio. Entrar e sair por ali nao
  // desfaz o vinculo dos paineis, que e de cada painel para o app.
  public static void DarTeclado(IntPtr filha, IntPtr pai) {
    Grudar(filha, pai);
    uint meu = GetCurrentThreadId(), tPai = ThreadDe(pai);
    bool entrei = (meu != tPai) && AttachThreadInput(meu, tPai, true);
    SetForegroundWindow(pai);
    SetActiveWindow(pai);
    SetFocus(filha);
    if (entrei) AttachThreadInput(meu, tPai, false);
  }

  // Volta do minimizado e ronda de conserto: refaz o par sempre, mas so devolve o foco se o app ja
  // estiver na frente. Senao o app roubaria a tela da pessoa a cada 10 segundos enquanto ela usa
  // outro programa.
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public static void Reativar(IntPtr filha, IntPtr pai) {
    Grudar(filha, pai);
    if (GetForegroundWindow() == pai) DarTeclado(filha, pai);
  }

  // Quem esta com o teclado AGORA. Sem isso o app so podia supor, e supor era o erro: ele achava
  // que o teclado estava sempre no primeiro painel e o puxava de volta pra la a cada clique.
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO {
    public int cbSize; public uint flags;
    public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret;
    public RECT rcCaret;
  }
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO gti);
  public static long QuemTemFoco(IntPtr pai) {
    uint t = ThreadDe(pai);
    if (t == 0) return 0;
    GUITHREADINFO g = new GUITHREADINFO();
    g.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
    if (!GetGUIThreadInfo(t, ref g)) return 0;
    // O foco pode estar numa janela interna do navegador; o que interessa e de qual painel ela e.
    long painel = PainelDe(g.hwndFocus);
    return painel != 0 ? painel : g.hwndFocus.ToInt64();
  }

  // ---- o clique leva o teclado junto ----
  // Janela normal ganha o teclado ao ser ATIVADA, e e assim que o navegador espera recebe-lo. Janela
  // filha nunca e ativada: o clique chega, a pagina reage, mas o foco de teclado fica onde estava (no
  // painel em que o app o colocou, a Conta 1). Era o "clico na outra tela e escreve na Conta 1".
  // O app tambem nao ve esse clique, porque ele cai direto na janela do navegador. Entao um vigia
  // aqui dentro observa o botao do mouse: clicou em cima de um painel, o teclado vai para ele.
  static readonly object trava = new object();
  static Dictionary<long, long> paineisVivos = new Dictionary<long, long>();   // painel -> janela do app
  static Thread vigia;
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int tecla);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint qual);
  [StructLayout(LayoutKind.Sequential)] public struct MSG {
    public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt;
  }
  [DllImport("user32.dll")] static extern bool PeekMessage(out MSG m, IntPtr h, uint min, uint max, uint tirar);

  static long PainelDe(IntPtr h) {
    for (int n = 0; n < 32 && h != IntPtr.Zero; n++) {
      lock (trava) { if (paineisVivos.ContainsKey(h.ToInt64())) return h.ToInt64(); }
      h = GetAncestor(h, 1);   // GA_PARENT
    }
    return 0;
  }

  static void Registrar(IntPtr filha, IntPtr pai) {
    lock (trava) {
      paineisVivos[filha.ToInt64()] = pai.ToInt64();
      if (vigia == null) {
        vigia = new Thread(new ThreadStart(Vigiar));
        vigia.IsBackground = true;
        vigia.Start();
      }
    }
  }

  static void Vigiar() {
    MSG m; PeekMessage(out m, IntPtr.Zero, 0, 0, 0);   // cria a fila desta thread; sem fila nao da pra grudar
    bool antes = false;
    while (true) {
      Thread.Sleep(25);
      // Sem painel encaixado nao ha clique para vigiar. A thread sai, e o proximo encaixe a levanta
      // de novo: com todos os paineis fechados o app parava de acordar 40 vezes por segundo a toa.
      lock (trava) { if (paineisVivos.Count == 0) { vigia = null; return; } }
      try {
        bool agora = (GetAsyncKeyState(1) & 0x8000) != 0 || (GetAsyncKeyState(2) & 0x8000) != 0;
        bool desceu = agora && !antes;
        antes = agora;
        if (!desceu) continue;
        POINT p;
        if (!GetCursorPos(out p)) continue;
        long painel = PainelDe(WindowFromPoint(p));
        if (painel == 0) continue;
        long pai = 0;
        lock (trava) { paineisVivos.TryGetValue(painel, out pai); }
        if (pai == 0) continue;
        if (QuemTemFoco(new IntPtr(pai)) == painel) continue;   // ja esta com ele
        DarTeclado(new IntPtr(painel), new IntPtr(pai));
      } catch (Exception) { }
    }
  }
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool RedrawWindow(IntPtr h, IntPtr r, IntPtr rgn, uint flags);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }

  // Retangulo da janela em coordenadas da area do pai: e assim que eu comparo com o alvo.
  public static int[] RetanguloNoPai(IntPtr h, IntPtr pai) {
    RECT r;
    if (!GetWindowRect(h, out r)) return new int[] { 0, 0, 0, 0 };
    POINT canto; canto.X = r.Left; canto.Y = r.Top;
    if (pai != IntPtr.Zero) ScreenToClient(pai, ref canto);
    return new int[] { canto.X, canto.Y, r.Right - r.Left, r.Bottom - r.Top };
  }
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  // Ja esta encaixada, no lugar, no tamanho e com a visibilidade pedida? Quando sim, a volta do
  // minimizado nao precisa da danca de reencaixe: cada repintura forcada e uma piscada no jogo.
  public static bool NoLugar(IntPtr h, IntPtr pai, int x, int y, int w, int ht, bool visivel) {
    if (!IsWindow(h) || IsWindowVisible(h) != visivel) return false;
    if (GetParent(h) != pai) return false;
    int[] r = RetanguloNoPai(h, pai);
    return Math.Abs(r[0] - x) <= 2 && Math.Abs(r[1] - y) <= 2 && Math.Abs(r[2] - w) <= 2 && Math.Abs(r[3] - ht) <= 2;
  }
  [DllImport("user32.dll")] public static extern int SetWindowRgn(IntPtr h, IntPtr rgn, bool redraw);
  [DllImport("user32.dll")] static extern int GetWindowRgn(IntPtr h, IntPtr rgn);
  [DllImport("gdi32.dll")] static extern int GetRgnBox(IntPtr rgn, out RECT r);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);
  // O recorte que a janela tem AGORA e o pedido? O Chrome mexe na regiao da propria janela quando
  // ela muda de tamanho (ele zera a nossa), entao nao da para lembrar o que foi aplicado: tem de
  // perguntar. E perguntar e barato; reaplicar sem precisar e uma repintura inteira.
  public static bool TemRecorte(IntPtr h, int topo, int w, int ht) {
    IntPtr rgn = CreateRectRgn(0, 0, 0, 0);
    try {
      if (GetWindowRgn(h, rgn) != 2) return false;   // 2 = SIMPLEREGION; 0 = sem regiao
      RECT r; if (GetRgnBox(rgn, out r) == 0) return false;
      return r.Left == 0 && r.Top == topo && r.Right == w && r.Bottom == ht;
    } finally { DeleteObject(rgn); }
  }
  [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int a, int b, int c, int d);
  [DllImport("user32.dll")] public static extern IntPtr BeginDeferWindowPos(int n);
  [DllImport("user32.dll")] public static extern IntPtr DeferWindowPos(IntPtr hdwp, IntPtr h, IntPtr after, int x, int y, int w, int ht, uint flags);
  [DllImport("user32.dll")] public static extern bool EndDeferWindowPos(IntPtr hdwp);

  // Em 32 bits so existe a versao Long; estes wrappers escolhem a certa.
  public static IntPtr GetStyle(IntPtr h, int idx) {
    if (IntPtr.Size == 8) return GetWindowLongPtr(h, idx);
    return new IntPtr(GetWindowLong(h, idx));
  }
  public static void SetStyle(IntPtr h, int idx, IntPtr v) {
    if (IntPtr.Size == 8) SetWindowLongPtr(h, idx, v);
    else SetWindowLong(h, idx, v.ToInt32());
  }

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);

  // A janela do jogo e a MAIOR visivel do perfil. Assim uma telinha de boas-vindas ou um
  // popup do navegador nunca e confundida com ela.
  public static IntPtr MaiorJanelaDe(System.Collections.Generic.HashSet<uint> pids, int minL, int minA) {
    IntPtr melhor = IntPtr.Zero; long melhorArea = 0;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!pids.Contains(pid)) return true;
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(128);
      GetClassName(h, sb, 128);
      if (!sb.ToString().StartsWith("Chrome_WidgetWin")) return true;
      RECT r; if (!GetWindowRect(h, out r)) return true;
      long larg = r.Right - r.Left, alt = r.Bottom - r.Top;
      if (larg < minL || alt < minA) return true;
      long area = larg * alt;
      if (area > melhorArea) { melhorArea = area; melhor = h; }
      return true;
    }, IntPtr.Zero);
    return melhor;
  }

}
"@

$GWL_STYLE = -16
$WS_CHILD = 0x40000000
$WS_CAPTION = 0x00C00000
$WS_THICKFRAME = 0x00040000
$WS_MINIMIZEBOX = 0x00020000
$WS_MAXIMIZEBOX = 0x00010000
$WS_SYSMENU = 0x00080000
$WS_OVERLAPPEDWINDOW = 0x00CF0000
$SW_SHOW = 5
$SW_HIDE = 0
$WM_CLOSE = 0x0010

function Responder($obj) { Write-Output ($obj | ConvertTo-Json -Compress) }

# SetWindowRgn nao compara: com redraw ele invalida a janela INTEIRA toda vez, mesmo que a regiao
# seja igual a que ja esta. Como todo layout (ronda de 10 s, foco, volta do minimizado) passava por
# aqui, cada painel repintava do zero a toda hora. Agora so aplico quando a janela nao esta com o
# recorte pedido. Nao vale guardar o que foi aplicado: o Chrome zera a regiao da janela quando ela
# muda de tamanho (foi assim que as abas extras apareceram espiando embaixo do app).
function Recortar([IntPtr]$h, [int]$recorte, [int]$w, [int]$ht, [bool]$redraw) {
  if ([QV]::TemRecorte($h, $recorte, $w, $ht)) { return $false }
  $rgn = [QV]::CreateRectRgn(0, $recorte, $w, $ht)
  [void][QV]::SetWindowRgn($h, $rgn, $redraw)
  return $true
}
# Painel que deve ficar escondido (aba extra fora do modo abas) e escondido de verdade, nao so
# empurrado para fora da area: assim nada dele aparece, e o navegador nem gasta desenhando.
function Mostrar([IntPtr]$h, [bool]$visivel) {
  if ([QV]::IsWindowVisible($h) -eq $visivel) { return }
  if ($visivel) { [void][QV]::ShowWindow($h, 8) } else { [void][QV]::ShowWindow($h, 0) }   # 8 = SW_SHOWNA, 0 = SW_HIDE
}

# Todos os processos do Chrome cujo comando aponta para a pasta deste perfil.
function PidsDoPerfil([string]$perfil) {
  $conjunto = New-Object 'System.Collections.Generic.HashSet[uint32]'
  $alvo = $perfil.ToLower()
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | ForEach-Object {
    if ($_.CommandLine -and $_.CommandLine.ToLower().Contains($alvo)) { [void]$conjunto.Add([uint32]$_.ProcessId) }
  }
  return $conjunto
}

while ($true) {
  $linha = [Console]::In.ReadLine()
  if ($null -eq $linha) { break }
  if ($linha.Trim() -eq '') { continue }
  try {
    $c = $linha | ConvertFrom-Json
    switch ($c.cmd) {
      'achar' {
        # Caminho rapido: o processo que o app lancou e o processo principal do navegador, e a janela
        # e dele. Sem isso cada tentativa era uma consulta WMI (lenta, e seis paineis consultando na
        # mesma fila), e a janela ficava segundos solta na tela antes de ser encaixada.
        $j = [IntPtr]::Zero
        $vivo = $false
        if ($c.pid -and [int64]$c.pid -gt 0) {
          try { [void][System.Diagnostics.Process]::GetProcessById([int][int64]$c.pid); $vivo = $true } catch { $vivo = $false }
          if ($vivo) {
            $so = New-Object 'System.Collections.Generic.HashSet[uint32]'
            [void]$so.Add([uint32][int64]$c.pid)
            $j = [QV]::MaiorJanelaDe($so, 300, 200)
            # Processo vivo e ainda sem janela: e cedo, nao e caso de consulta lenta.
            if ($j -eq [IntPtr]::Zero) { Responder @{ id = $c.id; ok = $false; erro = 'sem janela' }; break }
          }
        }
        if ($j -eq [IntPtr]::Zero) {
          # Caminho lento: processo lancado ja encerrou porque um navegador aberto com este perfil
          # assumiu a janela, ou nao veio pid. Ai a janela pertence a outro processo.
          $pids = PidsDoPerfil $c.perfil
          if ($pids.Count -eq 0) { Responder @{ id = $c.id; ok = $false; erro = 'sem processo' }; break }
          $j = [QV]::MaiorJanelaDe($pids, 300, 200)
        }
        if ($j -eq [IntPtr]::Zero) { Responder @{ id = $c.id; ok = $false; erro = 'sem janela' }; break }
        Responder @{ id = $c.id; ok = $true; alca = $j.ToInt64().ToString() }
      }
      'encaixar' {
        $h = [IntPtr][int64]$c.alca
        $pai = [IntPtr][int64]$c.pai
        [void][QV]::ShowWindow($h, $SW_HIDE)   # some da tela antes de virar filha e ir pro lugar
        $estilo = [QV]::GetStyle($h, $GWL_STYLE).ToInt64()
        $estilo = $estilo -band (-bnot ($WS_CAPTION -bor $WS_THICKFRAME -bor $WS_MINIMIZEBOX -bor $WS_MAXIMIZEBOX -bor $WS_SYSMENU))
        $estilo = $estilo -bor $WS_CHILD
        [QV]::SetStyle($h, $GWL_STYLE, [IntPtr]$estilo)
        [void][QV]::SetParent($h, $pai)
        [void][QV]::MoveWindow($h, [int]$c.x, [int]$c.y, [int]$c.w, [int]$c.h, $false)
        if ($c.recorte -and [int]$c.recorte -gt 0) {
          [void](Recortar $h ([int]$c.recorte) ([int]$c.w) ([int]$c.h) $false)
        }
        if ($c.visivel -ne $false) { [void][QV]::ShowWindow($h, $SW_SHOW) }   # so aparece ja encaixada e no lugar certo
        # Fica grudado enquanto o painel estiver encaixado: e o que faz a tecla digitada chegar nele.
        [void][QV]::Grudar($h, $pai)
        Responder @{ id = $c.id; ok = $true }
      }
      'mover-lote' {
        # Move todos os paineis numa tacada so: o Windows aplica tudo junto, sem cada janela
        # piscando na vez dela. Uma ida e volta em vez de uma por painel.
        $itens = @($c.itens)
        $hdwp = [QV]::BeginDeferWindowPos($itens.Count)
        foreach ($it in $itens) {
          $h = [IntPtr][int64]$it.alca
          if (-not [QV]::IsWindow($h)) { continue }
          # Reproduzido no PC da usuaria: o app tem uma janela filha invisivel que recebe os cliques da
          # casca, e o Windows a devolve para cima dos paineis sempre que a janela e minimizada,
          # maximizada ou redimensionada. O painel segue visivel, mas o clique cai nela. Por isso TODO
          # painel e levantado em TODO layout (nunca rebaixado: isso o esconde). O da frente vem por
          # ultimo na lista e termina por cima.
          # Excecao: quando os paineis se sobrepoem (modo abas, ou um maximizado sobre a grade),
          # levantar os de tras os traz por um instante para a frente do visivel, e o da frente e
          # coberto e descoberto a cada ronda: piscada. Nesses modos o app manda levantar=false para
          # os de tras, que ja estao atras e nao recebem clique; so o da frente sobe.
          $SWP_NOACTIVATE = 0x0010; $SWP_NOZORDER = 0x0004
          $flags = $SWP_NOACTIVATE
          if ($it.levantar -eq $false) { $flags = $flags -bor $SWP_NOZORDER }
          $depois = [IntPtr]0                       # HWND_TOP
          $hdwp = [QV]::DeferWindowPos($hdwp, $h, $depois, [int]$it.x, [int]$it.y, [int]$it.w, [int]$it.h, $flags)
        }
        [void][QV]::EndDeferWindowPos($hdwp)
        foreach ($it in $itens) {
          $h = [IntPtr][int64]$it.alca
          if ([QV]::IsWindow($h)) { Mostrar $h ($it.visivel -ne $false) }
        }
        # Confiro o que a janela REALMENTE ficou. Ela nem sempre obedece de primeira, e sem conferir
        # o painel fica torto para sempre porque eu seguiria mandando a mesma coisa.
        $fora = @()
        foreach ($it in $itens) {
          $h = [IntPtr][int64]$it.alca
          if (-not [QV]::IsWindow($h)) { continue }
          $r = [QV]::RetanguloNoPai($h, [IntPtr][int64]$c.pai)
          if ([math]::Abs($r[0] - [int]$it.x) -gt 2 -or [math]::Abs($r[1] - [int]$it.y) -gt 2 -or
              [math]::Abs($r[2] - [int]$it.w) -gt 2 -or [math]::Abs($r[3] - [int]$it.h) -gt 2) {
            [void][QV]::MoveWindow($h, [int]$it.x, [int]$it.y, [int]$it.w, [int]$it.h, $true)
            $r2 = [QV]::RetanguloNoPai($h, [IntPtr][int64]$c.pai)
            if ([math]::Abs($r2[2] - [int]$it.w) -gt 2 -or [math]::Abs($r2[3] - [int]$it.h) -gt 2) {
              $fora += @{ alca = $it.alca; querido = "$($it.w)x$($it.h)"; obtido = "$($r2[2])x$($r2[3])" }
            }
          }
        }
        $recortados = 0
        foreach ($it in $itens) {
          if (-not ($it.recorte -and [int]$it.recorte -gt 0)) { continue }
          $h = [IntPtr][int64]$it.alca
          if (-not [QV]::IsWindow($h)) { continue }
          # So recorta de novo quando a janela nao esta com o recorte pedido: senao e uma repintura inteira a toa.
          if (Recortar $h ([int]$it.recorte) ([int]$it.w) ([int]$it.h) $true) { $recortados++ }
        }
        Responder @{ id = $c.id; ok = $true; fora = $fora; recortados = $recortados }
      }
      'reencaixar' {
        # Reafirma o pai sem passar por janela solta (nao pisca), forca um redimensionamento de
        # verdade, levanta e emparelha a entrada. E o que trocar de aba faz, so que automatico.
        $h = [IntPtr][int64]$c.alca
        $pai = [IntPtr][int64]$c.pai
        if (-not [QV]::IsWindow($h)) { Responder @{ id = $c.id; ok = $false; erro = 'janela sumiu' }; break }
        # A danca completa (encolhe, cresce, recorta, redesenha) era o que acordava um painel que
        # voltou do minimizado achando que continuava escondido. Mas redimensionar o Chrome e uma
        # piscada por painel, e o app fazia isso varias vezes a cada volta. Agora ela so roda quando
        # o painel esta de fato fora do lugar (pai, posicao, tamanho ou visibilidade errados).
        # Painel que ja esta no lugar so e levantado, sem repintar nada.
        $visivel = ($c.visivel -ne $false)
        $completo = -not [QV]::NoLugar($h, $pai, [int]$c.x, [int]$c.y, [int]$c.w, [int]$c.h, $visivel)
        if ($completo) {
          [void][QV]::SetParent($h, $pai)
          # O tamanho intermediario nunca precisa aparecer: sem pintura aqui, pinta so no final.
          [void][QV]::MoveWindow($h, [int]$c.x, [int]$c.y, [int]$c.w - 8, [int]$c.h - 8, $false)
          [void][QV]::MoveWindow($h, [int]$c.x, [int]$c.y, [int]$c.w, [int]$c.h, $true)
          if ($c.recorte -and [int]$c.recorte -gt 0) {
            [void](Recortar $h ([int]$c.recorte) ([int]$c.w) ([int]$c.h) $true)
          }
          Mostrar $h $visivel
        }
        if ($c.levantar -ne $false) {
          [void][QV]::SetWindowPos($h, [IntPtr]0, 0, 0, 0, 0, 0x0013)   # TOP, sem mover, redimensionar nem ativar
        }
        if ($completo -and $visivel) {
          $RDW_INVALIDATE = 0x0001; $RDW_ALLCHILDREN = 0x0080; $RDW_UPDATENOW = 0x0100
          [void][QV]::RedrawWindow($h, [IntPtr]0, [IntPtr]0, ($RDW_INVALIDATE -bor $RDW_ALLCHILDREN -bor $RDW_UPDATENOW))
        }
        if ($visivel) { [QV]::Reativar($h, $pai) } else { [void][QV]::Grudar($h, $pai) }
        Responder @{ id = $c.id; ok = $true; completo = $completo; noLugar = [QV]::NoLugar($h, $pai, [int]$c.x, [int]$c.y, [int]$c.w, [int]$c.h, $visivel) }
      }
      'focar' {
        # Teclado para este painel. SetFocus sozinho nao atravessa processo: sem grudar a fila ele
        # devolve nulo e some, que era o motivo de nao dar para digitar.
        $h = [IntPtr][int64]$c.alca
        if (-not [QV]::IsWindow($h)) { Responder @{ id = $c.id; ok = $false; erro = 'janela sumiu' }; break }
        [QV]::DarTeclado($h, [IntPtr][int64]$c.pai)
        Responder @{ id = $c.id; ok = $true }
      }
      'foco-atual' {
        # Quem esta com o teclado de verdade, direto do Windows. O app usa isso em vez de supor.
        $alca = [QV]::QuemTemFoco([IntPtr][int64]$c.pai)
        Responder @{ id = $c.id; ok = $true; alca = $alca.ToString() }
      }
      'soltar' {
        $h = [IntPtr][int64]$c.alca
        [QV]::Desgrudar($h, [IntPtr][int64]$c.pai)   # janela solta volta a ter fila propria
        $estilo = [QV]::GetStyle($h, $GWL_STYLE).ToInt64()
        $estilo = ($estilo -band (-bnot $WS_CHILD)) -bor $WS_OVERLAPPEDWINDOW
        [void][QV]::SetWindowRgn($h, [IntPtr]0, $true)  # devolve a janela inteira, com a barra do Chrome
        [void][QV]::SetParent($h, [IntPtr]0)
        [QV]::SetStyle($h, $GWL_STYLE, [IntPtr]$estilo)
        [void][QV]::SetWindowPos($h, [IntPtr]0, [int]$c.x, [int]$c.y, [int]$c.w, [int]$c.h, 0x0020)
        [void][QV]::ShowWindow($h, $SW_SHOW)
        Responder @{ id = $c.id; ok = $true }
      }
      'fechar' {
        $h = [IntPtr][int64]$c.alca
        if ($c.pai) { [QV]::Desgrudar($h, [IntPtr][int64]$c.pai) }  # nao deixa par orfao para tras
        [void][QV]::PostMessage($h, $WM_CLOSE, [IntPtr]0, [IntPtr]0)
        Responder @{ id = $c.id; ok = $true }
      }
      default { Responder @{ id = $c.id; ok = $false; erro = 'comando desconhecido' } }
    }
  } catch {
    try { Responder @{ id = $c.id; ok = $false; erro = $_.Exception.Message } } catch { }
  }
}

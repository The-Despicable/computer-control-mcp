if (-not ("W" -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

public struct RECT { public int Left, Top, Right, Bottom; }
public struct POINT { public int X, Y; }
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct MONITORINFOEX {
  public int Size; public RECT Monitor, Work; public uint Flags;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Device;
}
public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
[StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
[StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }

public static class W {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  public delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, ref RECT rect, IntPtr lParam);

  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll", SetLastError = true)] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorEnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr h, ref MONITORINFOEX info);
  [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr h, int type, out uint x, out uint y);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);

  static int IS = Marshal.SizeOf(typeof(INPUT));

  public static RECT VirtualScreen() {
    RECT vs = new RECT(); bool first = true;
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr h, IntPtr dc, ref RECT r, IntPtr l) {
      if (first) { vs = r; first = false; }
      else {
        if (r.Left < vs.Left) vs.Left = r.Left;
        if (r.Top < vs.Top) vs.Top = r.Top;
        if (r.Right > vs.Right) vs.Right = r.Right;
        if (r.Bottom > vs.Bottom) vs.Bottom = r.Bottom;
      }
      return true;
    }, IntPtr.Zero);
    if (first) { vs.Left = 0; vs.Top = 0; vs.Right = 1920; vs.Bottom = 1080; }
    return vs;
  }

  // CSV columns: "handle,x,y,w,h,primary,scaleKnown,dpi,device" (no pid here; cf. WindowInfo below)
  public static string[] GetMonitors() {
    var list = new List<string>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr h, IntPtr dc, ref RECT r, IntPtr l) {
      var mi = new MONITORINFOEX(); mi.Size = Marshal.SizeOf(typeof(MONITORINFOEX)); mi.Device = new string('\0', 32);
      GetMonitorInfo(h, ref mi);
      uint dx = 0, dy = 0; int known = 0;
      try { if (GetDpiForMonitor(h, 0, out dx, out dy) == 0) known = 1; } catch {}
      bool primary = (mi.Flags & 1) != 0;
      list.Add(h.ToInt64() + "," + r.Left + "," + r.Top + "," + (r.Right - r.Left) + "," + (r.Bottom - r.Top) + ","
        + (primary ? 1 : 0) + "," + known + "," + dx + "," + mi.Device);
      return true;
    }, IntPtr.Zero);
    return list.ToArray();
  }

  // Authoritative window geometry convention: DWM extended-frame bounds
  // (DWMWA_EXTENDED_FRAME_BOUNDS = 38) when they are sane, otherwise
  // GetWindowRect. Used by BOTH window enumeration and foreground/capture so
  // coordinates never disagree by invisible resize borders. DWM can return a
  // degenerate rect (e.g. right<=left) for some windows; never trust that.
  public static RECT FrameRect(IntPtr h) {
    RECT r; GetWindowRect(h, out r);
    try {
      RECT frame;
      int hr = DwmGetWindowAttribute(h, 38, out frame, Marshal.SizeOf(typeof(RECT)));
      if (hr == 0 && frame.Right > frame.Left && frame.Bottom > frame.Top) return frame;
    } catch {}
    return r;
  }

  // "hwnd,pid,x,y,w,h,iconic,title" — pid is the REAL owning process PID
  // (GetWindowThreadProcessId), never the PowerShell host $PID.
  public static string WindowInfo(IntPtr h) {
    if (h == IntPtr.Zero) return "0,0,0,0,0,0,0,";
    uint pid; GetWindowThreadProcessId(h, out pid);
    int len = GetWindowTextLength(h);
    var sb = new StringBuilder(len + 2); GetWindowText(h, sb, sb.Capacity);
    RECT f = FrameRect(h);
    return h.ToInt64() + "," + pid + "," + f.Left + "," + f.Top + "," + (f.Right - f.Left) + "," + (f.Bottom - f.Top) + "," + (IsIconic(h) ? 1 : 0) + "," + sb.ToString();
  }
  public static string ForegroundInfo() { return WindowInfo(GetForegroundWindow()); }

  public static string[] GetWindows() {
    var list = new List<string>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      if (GetWindowTextLength(h) == 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      RECT r = FrameRect(h);
      var sb = new StringBuilder(GetWindowTextLength(h) + 2); GetWindowText(h, sb, sb.Capacity);
      list.Add(h.ToInt64() + "," + pid + "," + r.Left + "," + r.Top + "," + (r.Right - r.Left) + "," + (r.Bottom - r.Top) + "," + (IsIconic(h) ? 1 : 0) + "," + sb.ToString());
      return true;
    }, IntPtr.Zero);
    return list.ToArray();
  }

  static INPUT Mouse(int dx, int dy, uint flags, uint data) {
    INPUT i = new INPUT(); i.type = 0; i.u.mi.dx = dx; i.u.mi.dy = dy;
    i.u.mi.mouseData = data; i.u.mi.dwFlags = flags; return i;
  }
  static INPUT Key(ushort vk, ushort scan, uint flags) {
    INPUT i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; return i;
  }

  public static string MoveTo(int x, int y) {
    RECT vs = VirtualScreen();
    int w = Math.Max(1, vs.Right - vs.Left), h = Math.Max(1, vs.Bottom - vs.Top);
    int nx = (int)Math.Round((x - vs.Left) * 65535.0 / (w - 1));
    int ny = (int)Math.Round((y - vs.Top) * 65535.0 / (h - 1));
    var arr = new INPUT[] { Mouse(nx, ny, 0x0001u | 0x8000u | 0x4000u, 0) };
    return SendInput(1, arr, IS) == 1 ? "ok" : "send_failed";
  }
  public static string Click(int x, int y, string button, int count) {
    uint down, up;
    if (button == "right") { down = 0x0008u; up = 0x0010u; }
    else if (button == "middle") { down = 0x0040u; up = 0x0080u; }
    else { down = 0x0002u; up = 0x0004u; }
    string r = MoveTo(x, y); if (r != "ok") return r;
    for (int i = 0; i < count; i++) {
      var d = new INPUT[] { Mouse(0, 0, down, 0) };
      if (SendInput(1, d, IS) != 1) return "send_failed";
      Thread.Sleep(30);
      var u = new INPUT[] { Mouse(0, 0, up, 0) };
      if (SendInput(1, u, IS) != 1) return "send_failed";
      if (i + 1 < count) Thread.Sleep(80);
    }
    return "ok";
  }
  public static string ScrollAt(int? x, int? y, int delta) {
    if (x.HasValue && y.HasValue) { string r = MoveTo(x.Value, y.Value); if (r != "ok") return r; Thread.Sleep(40); }
    var arr = new INPUT[] { Mouse(0, 0, 0x0800u, (uint)delta) };
    return SendInput(1, arr, IS) == 1 ? "ok" : "send_failed";
  }
  // Basic validated drag: press at (x1,y1), move to (x2,y2) in bounded steps,
  // release. No path scripting / humanization — both endpoints were validated
  // (and re-validated against the live monitors) before this is called.
  public static string Drag(int x1, int y1, int x2, int y2, int durationMs, string button) {
    uint down, up;
    if (button == "right") { down = 0x0008u; up = 0x0010u; }
    else if (button == "middle") { down = 0x0040u; up = 0x0080u; }
    else { down = 0x0002u; up = 0x0004u; }
    string r = MoveTo(x1, y1); if (r != "ok") return r;
    var d = new INPUT[] { Mouse(0, 0, down, 0) };
    if (SendInput(1, d, IS) != 1) return "send_failed";
    int steps = Math.Max(1, Math.Min(60, durationMs / 15));
    for (int i = 1; i <= steps; i++) {
      int cx = x1 + (int)Math.Round((x2 - x1) * (double)i / steps);
      int cy = y1 + (int)Math.Round((y2 - y1) * (double)i / steps);
      string mr = MoveTo(cx, cy);
      if (mr != "ok") {
        var uu = new INPUT[] { Mouse(0, 0, up, 0) }; SendInput(1, uu, IS);
        return mr;
      }
      if (durationMs > 0) Thread.Sleep(Math.Max(1, durationMs / steps));
    }
    var u = new INPUT[] { Mouse(0, 0, up, 0) };
    return SendInput(1, u, IS) == 1 ? "ok" : "send_failed";
  }
  public static string SendUnicode(string text) {
    const uint U = 0x0004u, KU = 0x0002u;
    string t = (text ?? "").Replace("\r\n", "\n").Replace('\r', '\n');
    // Segments keep VK_Enter keystrokes out of Unicode batches: Win11 XAML
    // RichEdit (Notepad) deterministically corrupts Unicode chars arriving in
    // the same SendInput batch as (or closely after) an Enter keystroke
    // (empirical Gate D finding; timing-only tweaks did not fix it).
    var segments = new List<List<INPUT>>();
    var cur = new List<INPUT>();
    foreach (char c in t) {
      if (c == '\n') {
        if (cur.Count > 0) { segments.Add(cur); cur = new List<INPUT>(); }
        var e = new List<INPUT>(); e.Add(Key(0x0D, 0, 0)); e.Add(Key(0x0D, 0, KU));
        segments.Add(e);
      }
      else if (c == '\t') { cur.Add(Key(0x09, 0, 0)); cur.Add(Key(0x09, 0, KU)); }
      else { cur.Add(Key(0, c, U)); cur.Add(Key(0, c, U | KU)); }
    }
    if (cur.Count > 0) { segments.Add(cur); }
    Thread.Sleep(200);
    foreach (var seg in segments) {
      for (int i = 0; i < seg.Count; i += 16) {
        int n = Math.Min(16, seg.Count - i);
        var chunk = seg.GetRange(i, n).ToArray();
        if (SendInput((uint)n, chunk, IS) != (uint)n) return "send_failed";
        Thread.Sleep(100);
      }
      Thread.Sleep(150);
    }
    return "ok";
  }
  public static string SendChord(long[] vks, bool[] ext) {
    const uint KU = 0x0002u, EX = 0x0001u;
    if (vks == null || ext == null || vks.Length == 0 || vks.Length != ext.Length) return "bad_args";
    for (int i = 0; i < vks.Length; i++) {
      var d = new INPUT[] { Key((ushort)vks[i], 0, ext[i] ? EX : 0u) };
      if (SendInput(1, d, IS) != 1) return "send_failed";
      Thread.Sleep(20);
    }
    for (int i = vks.Length - 1; i >= 0; i--) {
      var u = new INPUT[] { Key((ushort)vks[i], 0, (ext[i] ? EX : 0u) | KU) };
      if (SendInput(1, u, IS) != 1) return "send_failed";
      Thread.Sleep(15);
    }
    return "ok";
  }
  public static string FocusWindow(long hwndLong) {
    IntPtr h = new IntPtr(hwndLong);
    if (!IsWindow(h) || !IsWindowVisible(h)) return "not_found";
    if (IsIconic(h)) { ShowWindow(h, 9); Thread.Sleep(200); }
    if (GetForegroundWindow() == h) return "ok";
    SetForegroundWindow(h);
    if (GetForegroundWindow() == h) return "ok";
    var ad = new INPUT[] { Key(0x12, 0, 0) }; SendInput(1, ad, IS);
    var au = new INPUT[] { Key(0x12, 0, 2) }; SendInput(1, au, IS);
    Thread.Sleep(80);
    SetForegroundWindow(h);
    Thread.Sleep(80);
    return GetForegroundWindow() == h ? "ok" : "failed";
  }
  public static string GetCursor() { POINT p; GetCursorPos(out p); return p.X + "," + p.Y; }
}
"@
}

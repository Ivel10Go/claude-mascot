# Emits the on-screen rectangle of every visible top-level window as JSON
# lines, twice a second, until stdin closes.
#
# This runs as a long-lived sidecar rather than being spawned per poll: a
# PowerShell start-up costs ~460ms of CPU, so polling at 2Hz that way would eat
# most of a core. Started once, the enumeration itself is microseconds and the
# process sits at essentially zero.
#
# Written to stdout as newline-delimited JSON so the parent can read it as a
# stream. Exits when its stdin is closed, so it can never outlive the app.

$ErrorActionPreference = 'Stop'

Add-Type -Namespace Win -Name Api -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)]
public struct RECT { public int Left, Top, Right, Bottom; }

public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern int GetWindowTextLengthW(IntPtr h);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern int GetWindowLongW(IntPtr h, int i);
[DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
'@

$GWL_EXSTYLE      = -20
$WS_EX_TOOLWINDOW = 0x00000080
$DWMWA_CLOAKED    = 14

# Anything smaller than this is a tooltip, a badge, or a splash — not something
# a mascot should try to stand on.
$MIN_W = 220
$MIN_H = 120

while ($true) {
    $found = New-Object System.Collections.ArrayList

    $callback = [Win.Api+EnumProc] {
        param([IntPtr]$hWnd, [IntPtr]$lParam)

        if (-not [Win.Api]::IsWindowVisible($hWnd)) { return $true }
        if ([Win.Api]::IsIconic($hWnd)) { return $true }

        # Untitled top-level windows are almost always invisible helpers.
        if ([Win.Api]::GetWindowTextLengthW($hWnd) -eq 0) { return $true }

        $ex = [Win.Api]::GetWindowLongW($hWnd, $GWL_EXSTYLE)
        if ($ex -band $WS_EX_TOOLWINDOW) { return $true }

        # UWP apps keep hidden windows parked off-screen and marked cloaked;
        # they pass every other check and would otherwise appear as platforms.
        $cloaked = 0
        if ([Win.Api]::DwmGetWindowAttribute($hWnd, $DWMWA_CLOAKED, [ref]$cloaked, 4) -eq 0 -and $cloaked -ne 0) {
            return $true
        }

        $r = New-Object Win.Api+RECT
        if (-not [Win.Api]::GetWindowRect($hWnd, [ref]$r)) { return $true }

        $w = $r.Right - $r.Left
        $h = $r.Bottom - $r.Top
        if ($w -lt $MIN_W -or $h -lt $MIN_H) { return $true }

        $sb = New-Object System.Text.StringBuilder 256
        [void][Win.Api]::GetWindowTextW($hWnd, $sb, 256)

        [void]$found.Add(@{ x = $r.Left; y = $r.Top; w = $w; h = $h; t = $sb.ToString() })
        return $true
    }

    [void][Win.Api]::EnumWindows($callback, [IntPtr]::Zero)

    # Z-order is the enumeration order: EnumWindows walks front to back, so the
    # first entry covering a point is the one actually visible there.
    $payload = @{ at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); windows = @($found) }
    # If the parent is gone the pipe is broken and this write throws, which
    # ends the script — that is the orphan guard. Do not poll stdin for it:
    # Console::In.Peek() blocks forever on a stdin that is a console rather
    # than a pipe, which silently freezes the loop after the first tick.
    [Console]::Out.WriteLine((ConvertTo-Json $payload -Compress -Depth 4))
    [Console]::Out.Flush()

    Start-Sleep -Milliseconds 500
}

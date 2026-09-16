. "$PSScriptRoot\_io.ps1"; . "$PSScriptRoot\_win32.ps1"; . "$PSScriptRoot\_state.ps1"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
function Test-OcrAvailable {
  try {
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $e = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    return ($null -ne $e)
  } catch { return $false }
}
# UIA perception only. OCR is performed by the caller (src/core/ocr.ts) via
# ocr.ps1 + per-tile tiling, so tiling/truncation semantics are testable and
# the 2D-tiling bug that silently dropped lower rows cannot recur here.
try {
  [void][W]::SetProcessDPIAware()
  $req = Read-McpRequest
  $state = Get-UiState
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  $mode = [string]$req.mode
  $limit = 10; if ($req.limit) { $limit = [int]$req.limit }
  $needle = $null; if ($req.text) { $needle = ([string]$req.text).ToLowerInvariant() }
  $rx = $null
  if ($req.regex) {
    try { $rx = New-BoundedRegex ([string]$req.regex) 250 }
    catch { Fail "INVALID_ARGUMENT" $_.Exception.Message }
  }
  function Test-Text([string]$s) {
    if ([string]::IsNullOrEmpty($s)) { return $false }
    if ($null -ne $rx) { return (Test-BoundedRegex $rx $s) }
    if ($null -ne $needle) { return $s.ToLowerInvariant().Contains($needle) }
    return $true
  }
  $wantName = $null; if ($req.name) { $wantName = ([string]$req.name).ToLowerInvariant() }
  $wantType = $null; if ($req.control_type) { $wantType = ([string]$req.control_type).ToLowerInvariant() }
  $wantAid = $null; if ($req.automation_id) { $wantAid = [string]$req.automation_id }
  $wantClass = $null; if ($req.class_name) { $wantClass = [string]$req.class_name }
  $ctMap = @{
    button = "Button"; calendar = "Calendar"; checkbox = "CheckBox"; combobox = "ComboBox"; custom = "Custom"
    datagrid = "DataGrid"; dataitem = "DataItem"; document = "Document"; edit = "Edit"; group = "Group"
    header = "Header"; headeritem = "HeaderItem"; hyperlink = "Hyperlink"; image = "Image"; list = "List"
    listitem = "ListItem"; menu = "Menu"; menubar = "MenuBar"; menuitem = "MenuItem"; pane = "Pane"
    progressbar = "ProgressBar"; radiobutton = "RadioButton"; scrollbar = "ScrollBar"; separator = "Separator"
    slider = "Slider"; spinner = "Spinner"; splitbutton = "SplitButton"; statusbar = "StatusBar"; tab = "Tab"
    tabitem = "TabItem"; table = "Table"; text = "Text"; thumb = "Thumb"; titlebar = "TitleBar"
    toolbar = "ToolBar"; tooltip = "ToolTip"; tree = "Tree"; treeitem = "TreeItem"; window = "Window"
  }
  $ctEnum = $null
  if ($wantType) {
    if (-not $ctMap[$wantType]) { Fail "INVALID_ARGUMENT" "unknown control_type '$($req.control_type)'" }
    $ctEnum = [System.Windows.Automation.ControlType]::$($ctMap[$wantType])
  }
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  if ($req.scope -eq "foreground" -and $state.foreground) {
    try { $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$state.foreground.hwnd) } catch { }
  }
  function ConvertTo-Match($el, [string]$text, [string]$source) {
    $cur = $el.Current
    $b = $cur.BoundingRectangle
    $ct = ""
    try { $ct = ($cur.ControlType.ProgrammaticName -replace "^ControlType\.", "") } catch {}
    return @{
      text = $text; source = $source; control_type = $ct; class_name = $cur.ClassName
      automation_id = $cur.AutomationId; process_id = $cur.ProcessId; is_offscreen = $cur.IsOffscreen
      bounds = @{ x = [int][Math]::Floor($b.X); y = [int][Math]::Floor($b.Y)
                  w = [int][Math]::Ceiling($b.Width); h = [int][Math]::Ceiling($b.Height) }
      center = @{ x = [int][Math]::Floor($b.X + $b.Width / 2); y = [int][Math]::Floor($b.Y + $b.Height / 2) }
    }
  }
  $hits = New-Object System.Collections.ArrayList
  $truncated = $false; $visited = 0
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  if ($mode -eq "element" -and $wantAid) {
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $wantAid)
    $found = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    foreach ($el in $found) {
      if ($hits.Count -ge $limit) { $truncated = $true; break }
      $cur = $el.Current
      if ($wantName -and -not $cur.Name.ToLowerInvariant().Contains($wantName)) { continue }
      if ($wantClass -and $cur.ClassName -ne $wantClass) { continue }
      if ($ctEnum -and $cur.ControlType -ne $ctEnum) { continue }
      [void]$hits.Add((ConvertTo-Match $el $cur.Name "uia"))
    }
  } else {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $stack = New-Object System.Collections.Stack
    $stack.Push($root)
    while ($stack.Count -gt 0) {
      if ($sw.ElapsedMilliseconds -gt 8000 -or $visited -gt 20000) { $truncated = $true; break }
      $el = $stack.Pop(); $visited++
      if ($null -eq $el) { continue }
      try {
        $cur = $el.Current
        $name = $cur.Name
        $matched = $false
        if ($mode -eq "element") {
          if ($wantName -and ($null -eq $name -or -not $name.ToLowerInvariant().Contains($wantName))) { $matched = $false }
          elseif ($wantAid -and $cur.AutomationId -ne $wantAid) { $matched = $false }
          elseif ($wantClass -and $cur.ClassName -ne $wantClass) { $matched = $false }
          elseif ($ctEnum -and $cur.ControlType -ne $ctEnum) { $matched = $false }
          else { $matched = $true }
        } else {
          if (Test-Text $name) { $matched = $true }
          else {
            $vp = $null
            try { $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) } catch {}
            if ($vp) {
              try { $v = $vp.Current.Value
                if (Test-Text $v) { $matched = $true; if ([string]::IsNullOrEmpty($name)) { $name = $v } } } catch {}
            }
          }
        }
        if ($matched) {
          [void]$hits.Add((ConvertTo-Match $el ([string]$name) "uia"))
          if ($hits.Count -ge $limit) { break }
        }
        $child = $walker.GetFirstChild($el)
        while ($null -ne $child) { $stack.Push($child); $child = $walker.GetNextSibling($child) }
      } catch { continue }
    }
  }
  $ocrAvailable = Test-OcrAvailable
  $ocrMax = 0
  try { $ocrMax = [int][Windows.Media.Ocr.OcrEngine]::MaxImageDimension } catch { $ocrMax = 0 }
  # PerceiveOutcome: live UI state AND matches together. The TS binding layer
  # requires both — a match list alone must never mint a screen_id.
  Write-McpResult @{ ok = $true; data = @{
    mode = $mode; matches = $hits.ToArray(); engines_used = @("uia")
    ocr_available = $ocrAvailable; ocr_max_dimension = $ocrMax; truncated = $truncated
    visited = $visited; elapsed_ms = $sw.ElapsedMilliseconds
    monitors = $state.monitors; virtual_screen = $state.virtual_screen
    foreground = $state.foreground; cursor = $state.cursor; timestamp = $state.timestamp } }
} catch { if ($null -eq $global:CC_RESULT) { Fail "BACKEND_ERROR" $_.Exception.Message } else { throw } }

# Shared-helper loader. In the persistent worker the helpers are loaded once and
# this becomes a cheap flag check on every subsequent request; standalone
# invocations (spawn fallback / -File) load them here. Avoids re-parsing
# _win32.ps1 (with its C# here-string) and _state.ps1 on every call.
if (-not $global:CC_HELPERS_LOADED) {
  . "$PSScriptRoot\_io.ps1"
  . "$PSScriptRoot\_win32.ps1"
  . "$PSScriptRoot\_state.ps1"
  $global:CC_HELPERS_LOADED = $true
}

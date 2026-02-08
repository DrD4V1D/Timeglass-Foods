$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$devHelper = Join-Path $repoRoot ".dev.ps1"

if (Test-Path -LiteralPath $devHelper) {
  . $devHelper
  Write-Host "TimeglassFoods dev helpers loaded: deploy" -ForegroundColor DarkGreen
} else {
  Write-Host "TimeglassFoods: .dev.ps1 missing at $devHelper" -ForegroundColor Yellow
}

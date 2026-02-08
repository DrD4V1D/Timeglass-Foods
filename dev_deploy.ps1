# dev_deploy.ps1
# Mirrors ./content/* into your Modrinth instance (dev), safely.
# Only syncs: kubejs, ftbquests, config, defaultconfigs, resources

$ErrorActionPreference = "Stop"

function Assert-Dir($path, $label) {
  if (-not (Test-Path -LiteralPath $path -PathType Container)) {
    throw "$label not found: $path"
  }
}

function Robocopy-Mirror($src, $dst) {
  if (-not (Test-Path -LiteralPath $src -PathType Container)) {
    Write-Host "Skip (missing source): $src"
    return
  }

  New-Item -ItemType Directory -Force -Path $dst | Out-Null

  # /MIR mirrors including deletions *within the target folder*
  # /R:2 /W:1 keep it snappy
  # /NFL /NDL /NJH /NJS reduce noise
  $args = @(
    "`"$src`"",
    "`"$dst`"",
    "/MIR",
    "/R:2",
    "/W:1",
    "/NFL",
    "/NDL",
    "/NJH",
    "/NJS"
  )

  & robocopy @args | Out-Null

  # robocopy exit codes: 0-7 are success-ish, >=8 are failures
  if ($LASTEXITCODE -ge 8) {
    throw "Robocopy failed (exit code $LASTEXITCODE) syncing $src -> $dst"
  }

  Write-Host "Synced: $src -> $dst"
}

# ----- Configurable paths -----

$repoRoot = (Resolve-Path ".").Path
$contentRoot = Join-Path $repoRoot "content"

# Your Modrinth dev instance root:
$devRoot = "C:\Users\roush\AppData\Roaming\ModrinthApp\profiles\Timeglass"

# ----- Sanity checks -----

Assert-Dir $contentRoot "Repo content root"
Assert-Dir $devRoot "Modrinth instance"

Write-Host "Repo: $repoRoot"
Write-Host "Content: $contentRoot"
Write-Host "Dev instance: $devRoot"
Write-Host ""

# ----- Sync targets -----

$folders = @("kubejs", "ftbquests", "config", "defaultconfigs", "resources")

foreach ($name in $folders) {
  $src = Join-Path $contentRoot $name
  $dst = Join-Path $devRoot $name
  Robocopy-Mirror $src $dst
}

Write-Host ""
Write-Host "Deploy to dev complete."

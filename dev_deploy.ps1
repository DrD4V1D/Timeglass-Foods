# dev_deploy.ps1
# Mirrors ./content/* into your Modrinth instance (dev), safely.
# Syncs: kubejs, ftbquests, config, defaultconfigs, resources
# Plus Timeglass registry nodes into kubejs/timeglass_registry/nodes

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

# Timeglass registry nodes (source-of-truth) -> runtime KubeJS path
$registryNodesSrc = Join-Path $repoRoot "registry\nodes"
$registryNodesDst = Join-Path $devRoot "kubejs\timeglass_registry\nodes"
Robocopy-Mirror $registryNodesSrc $registryNodesDst

# Build runtime node-id manifest for KubeJS (used to discover tag nodes without Java file APIs)
$nodeIds = @()
Get-ChildItem -Path $registryNodesSrc -Filter *.json -File | ForEach-Object {
  try {
    $obj = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
    if ($null -ne $obj -and $obj.PSObject.Properties.Name -contains "id") {
      $id = [string]$obj.id
      if (-not [string]::IsNullOrWhiteSpace($id)) {
        $nodeIds += $id.Trim()
      }
    }
  } catch {
    Write-Host "Skip invalid node JSON: $($_.FullName)"
  }
}
$nodeIds = $nodeIds | Sort-Object -Unique

$nodeManifest = @{
  generated_at = (Get-Date).ToString("o")
  node_count = $nodeIds.Count
  node_ids = $nodeIds
}
$nodeManifestPath = Join-Path $devRoot "kubejs\timeglass_registry\node_ids.json"
$nodeManifestDir = Split-Path -Parent $nodeManifestPath
New-Item -ItemType Directory -Force -Path $nodeManifestDir | Out-Null
$nodeManifestJson = $nodeManifest | ConvertTo-Json -Depth 5
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($nodeManifestPath, $nodeManifestJson, $utf8NoBom)
Write-Host "Wrote: $nodeManifestPath ($($nodeIds.Count) node ids)"

Write-Host ""
Write-Host "Deploy to dev complete."

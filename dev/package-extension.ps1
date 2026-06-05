param(
  [string]$OutputDir = (Join-Path $PSScriptRoot 'dist')
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir '..')
if (-not (Test-Path -LiteralPath $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
}
$outputRoot = Resolve-Path $OutputDir
$tmpRoot = Join-Path $scriptDir 'tmp'
if (-not (Test-Path -LiteralPath $tmpRoot)) {
  New-Item -ItemType Directory -Path $tmpRoot | Out-Null
}
$stageDir = Join-Path $tmpRoot 'package-extension'

$manifestPath = Join-Path $repoRoot 'manifest.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$version = $manifest.version
if (-not $version) {
  throw 'manifest.json does not contain a version.'
}

$zipPath = Join-Path $outputRoot "ycm-popupdict-v$version.zip"

$payloadFiles = @(
  'manifest.json',
  'background.js',
  'content.css',
  'content.js',
  'lookup_core.js',
  'options.css',
  'options.html',
  'options.js',
  'popup.css',
  'popup.html',
  'popup.js',
  'saved.css',
  'saved.html',
  'saved.js',
  'saved_store.js',
  'sidepanel.css',
  'sidepanel.html',
  'sidepanel.js',
  'shared.js'
)

$payloadDirs = @(
  'assets',
  'icons'
)

if (Test-Path -LiteralPath $stageDir) {
  $resolvedStage = Resolve-Path -LiteralPath $stageDir
  if (-not $resolvedStage.Path.StartsWith((Resolve-Path $tmpRoot).Path)) {
    throw "Refusing to remove unexpected staging directory: $resolvedStage"
  }
  Remove-Item -LiteralPath $stageDir -Recurse -Force
}

New-Item -ItemType Directory -Path $stageDir | Out-Null

foreach ($file in $payloadFiles) {
  $source = Join-Path $repoRoot $file
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Missing package file: $file"
  }
  Copy-Item -LiteralPath $source -Destination (Join-Path $stageDir $file)
}

foreach ($dir in $payloadDirs) {
  $source = Join-Path $repoRoot $dir
  if (-not (Test-Path -LiteralPath $source -PathType Container)) {
    throw "Missing package directory: $dir"
  }
  Copy-Item -LiteralPath $source -Destination (Join-Path $stageDir $dir) -Recurse
}

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $stageDir '*') -DestinationPath $zipPath -CompressionLevel Optimal

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $entries = @($zip.Entries | ForEach-Object { $_.FullName })
  if (-not ($entries -contains 'manifest.json')) {
    throw 'Package validation failed: manifest.json is not at the zip root.'
  }
  foreach ($dir in $payloadDirs) {
    if (-not ($entries | Where-Object { $_.StartsWith("$dir/") -or $_.StartsWith("$dir\") })) {
      throw "Package validation failed: missing $dir/ entries."
    }
  }
}
finally {
  $zip.Dispose()
}

Remove-Item -LiteralPath $stageDir -Recurse -Force

Write-Host "Created Chrome extension package: $zipPath"

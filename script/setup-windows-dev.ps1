param(
  [ValidateSet("install", "verify", "start", "all")]
  [string]$Mode = "all",
  [int]$BackendPort = 4096,
  [int]$AppPort = 4444,
  [switch]$SkipInstall,
  [switch]$NoBuild,
  [switch]$UseWindows
)

$ErrorActionPreference = "Stop"

function Write-Step($Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found on PATH."
  }
}

function Get-RepoRoot {
  $root = git rev-parse --show-toplevel
  if (-not $root) {
    throw "Run this script inside the onecode git repository."
  }
  return (Resolve-Path $root).Path
}

function Run-Checked($File, [string[]]$Arguments, $WorkingDirectory) {
  Write-Host "+ $File $($Arguments -join ' ')" -ForegroundColor DarkGray
  Push-Location $WorkingDirectory
  try {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed with exit code $LASTEXITCODE`: $File $($Arguments -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

function Ensure-Bunfig($RepoRoot) {
  $file = Join-Path $RepoRoot ".bunfig.toml"
  $base = if (Test-Path -LiteralPath (Join-Path $RepoRoot "bunfig.toml")) {
    Get-Content -LiteralPath (Join-Path $RepoRoot "bunfig.toml") -Raw
  } else {
    "[install]`nexact = true`n`n[test]`nroot = `"./do-not-run-tests-from-root`"`n"
  }

  if (-not (Test-Path -LiteralPath $file)) {
    $base | Set-Content -LiteralPath $file -NoNewline
  }

  $text = Get-Content -LiteralPath $file -Raw
  if ($text -notmatch '(?m)^registry\s*=') {
    $text = $text -replace '(?m)^\[install\]\s*$', "[install]`nregistry = `"https://registry.npmmirror.com`""
  }
  if ($text -notmatch '(?m)^linker\s*=') {
    $text = $text -replace '(?m)^\[install\]\s*$', "[install]`nlinker = `"hoisted`""
  }
  $text | Set-Content -LiteralPath $file -NoNewline
}

function Set-Junction($Path, $Target) {
  if (-not (Test-Path -LiteralPath $Target)) {
    throw "Missing junction target: $Target"
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
  if (Test-Path -LiteralPath $Path) {
    & cmd.exe /c rmdir "$Path"
    if ($LASTEXITCODE -ne 0 -and (Test-Path -LiteralPath $Path)) {
      throw "Failed to remove existing junction or directory: $Path"
    }
  }
  New-Item -ItemType Junction -Path $Path -Target $Target | Out-Null
}

function Repair-BunWindowsLinks($RepoRoot) {
  Write-Step "Repairing Bun Windows dependency junctions"

  $links = @(
    @{
      path = "node_modules\.bun\@babel+helper-compilation-targets@7.28.6\node_modules\@babel\helper-compilation-targets\node_modules\lru-cache"
      target = "node_modules\.bun\lru-cache@5.1.1\node_modules\lru-cache"
    },
    @{
      path = "node_modules\.bun\motion@12.34.5+c648e134ecc4467b\node_modules\motion\node_modules\framer-motion"
      target = "node_modules\.bun\framer-motion@12.38.0+c648e134ecc4467b\node_modules\framer-motion"
    },
    @{
      path = "node_modules\.bun\framer-motion@12.38.0+c648e134ecc4467b\node_modules\framer-motion\node_modules\motion-dom"
      target = "node_modules\.bun\motion-dom@12.38.0\node_modules\motion-dom"
    },
    @{
      path = "node_modules\.bun\framer-motion@12.38.0+c648e134ecc4467b\node_modules\framer-motion\node_modules\motion-utils"
      target = "node_modules\.bun\motion-utils@12.36.0\node_modules\motion-utils"
    },
    @{
      path = "node_modules\.bun\motion-dom@12.38.0\node_modules\motion-dom\node_modules\motion-utils"
      target = "node_modules\.bun\motion-utils@12.36.0\node_modules\motion-utils"
    }
  )

  foreach ($item in $links) {
    Set-Junction (Join-Path $RepoRoot $item.path) (Join-Path $RepoRoot $item.target)
  }

  foreach ($name in @("core", "langs", "themes", "types", "engine-javascript", "engine-oniguruma")) {
    Set-Junction `
      (Join-Path $RepoRoot "node_modules\.bun\shiki@3.20.0\node_modules\shiki\node_modules\@shikijs\$name") `
      (Join-Path $RepoRoot "node_modules\.bun\@shikijs+$name@3.20.0\node_modules\@shikijs\$name")
  }
}

function Repair-WindowsCheckout($RepoRoot) {
  Write-Step "Repairing Windows checkout compatibility files"
  git -C $RepoRoot config core.symlinks false
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Could not set core.symlinks=false; continuing with file repair."
  }

  $source = Join-Path $RepoRoot "packages\ui\src\custom-elements.d.ts"
  $target = Join-Path $RepoRoot "packages\app\src\custom-elements.d.ts"
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Missing source declaration: $source"
  }
  Copy-Item -LiteralPath $source -Destination $target -Force
  Repair-PublicAssets $RepoRoot
}

function Repair-PublicAssets($RepoRoot) {
  $assets = @(
    "favicon\apple-touch-icon-v3.png",
    "favicon\apple-touch-icon.png",
    "favicon\favicon-96x96-v3.png",
    "favicon\favicon-96x96.png",
    "favicon\favicon-v3.ico",
    "favicon\favicon-v3.svg",
    "favicon\favicon.ico",
    "favicon\favicon.svg",
    "favicon\site.webmanifest",
    "favicon\web-app-manifest-192x192.png",
    "favicon\web-app-manifest-512x512.png",
    "images\social-share-black.png",
    "images\social-share-zen.png",
    "images\social-share.png"
  )

  $assetMaps = @(
    @{
      public = "packages\app\public"
      strip = 2
    },
    @{
      public = "packages\web\public"
      strip = 2
    },
    @{
      public = "packages\enterprise\public"
      strip = 2
    },
    @{
      public = "packages\console\app\public"
      strip = 2
    }
  )

  foreach ($item in $assetMaps) {
    $publicDir = Join-Path $RepoRoot $item.public
    if (-not (Test-Path -LiteralPath $publicDir)) {
      continue
    }

    foreach ($asset in $assets) {
      $source = Join-Path $RepoRoot "packages\ui\src\assets\$asset"
      if (-not (Test-Path -LiteralPath $source)) {
        continue
      }

      $targetName = Split-Path -Leaf $asset
      if ($targetName -eq "social-share-black.png" -and -not (Test-Path -LiteralPath (Join-Path $publicDir $targetName))) {
        continue
      }
      Copy-Item -LiteralPath $source -Destination (Join-Path $publicDir $targetName) -Force
    }
  }
}

function Install-Dependencies($RepoRoot) {
  Write-Step "Installing dependencies with Bun hoisted linker"
  Ensure-Bunfig $RepoRoot
  Run-Checked "bun" @("install", "--ignore-scripts", "--linker", "hoisted", "--force") $RepoRoot
  Repair-BunWindowsLinks $RepoRoot
  Repair-WindowsCheckout $RepoRoot
}

function Verify-App($RepoRoot, [bool]$Build) {
  Write-Step "Typechecking packages/app"
  Run-Checked "bun" @("typecheck") (Join-Path $RepoRoot "packages\app")
  if ($Build) {
    Write-Step "Building packages/app"
    Run-Checked "bun" @("run", "build") (Join-Path $RepoRoot "packages\app")
  }
}

function Test-Port($Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Start-DevServers($RepoRoot, $BackendPort, $AppPort) {
  Write-Step "Starting dev servers"
  $bun = (Get-Command bun).Source
  $logDir = Join-Path $RepoRoot ".dev-logs"
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null

  if (-not (Test-Port $BackendPort)) {
    $launcher = Join-Path $logDir "start-backend-$BackendPort.cmd"
    @(
      "@echo off",
      "cd /d `"$RepoRoot\packages\opencode`"",
      "`"$bun`" run --conditions=browser ./src/index.ts serve --port $BackendPort"
    ) | Set-Content -LiteralPath $launcher
    & cmd.exe /c start "" "$launcher"
  }

  if (-not (Test-Port $AppPort)) {
    $launcher = Join-Path $logDir "start-app-$AppPort.cmd"
    @(
      "@echo off",
      "cd /d `"$RepoRoot\packages\app`"",
      "`"$bun`" dev -- --host 0.0.0.0 --port $AppPort --strictPort"
    ) | Set-Content -LiteralPath $launcher
    & cmd.exe /c start "" "$launcher"
  }

  Start-Sleep -Seconds 8
  if (-not (Test-Port $AppPort)) {
    throw "App dev server is not listening on port $AppPort. Check the opened cmd window for errors."
  }
  Write-Host "App dev server: http://localhost:$AppPort/" -ForegroundColor Green
}

Require-Command git
Require-Command bun

$repoRoot = Get-RepoRoot
if (-not $UseWindows -and $env:OS -ne "Windows_NT") {
  throw "This script is for Windows PowerShell. Pass -UseWindows only if the platform check is unavailable."
}

switch ($Mode) {
  "install" {
    if (-not $SkipInstall) {
      Install-Dependencies $repoRoot
    }
  }
  "verify" {
    Repair-BunWindowsLinks $repoRoot
    Repair-WindowsCheckout $repoRoot
    Verify-App $repoRoot (-not $NoBuild)
  }
  "start" {
    Start-DevServers $repoRoot $BackendPort $AppPort
  }
  "all" {
    if (-not $SkipInstall) {
      Install-Dependencies $repoRoot
    } else {
      Repair-BunWindowsLinks $repoRoot
      Repair-WindowsCheckout $repoRoot
    }
    Verify-App $repoRoot (-not $NoBuild)
    Start-DevServers $repoRoot $BackendPort $AppPort
  }
}

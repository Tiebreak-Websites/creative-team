# Launch Claude Code with .env vars exported so MCP servers (Framelink, etc.) pick them up.
# Usage: from repo root, run `.\scripts\claude.ps1`
#
# Why this exists: Claude Code does NOT auto-load .env into its process env.
# Project-level MCP servers configured in .mcp.json expect vars like FIGMA_API_KEY
# to be present in the parent shell when `claude` is launched. This wrapper does
# the env-export step for you.

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot '.env'

if (-not (Test-Path $envFile)) {
  Write-Host "❌ No .env at $envFile" -ForegroundColor Red
  Write-Host "   Run: cp .env.example .env  — then fill in your keys."
  exit 1
}

$loaded = @()
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*#') { return }
  if ($_ -match '^\s*$') { return }
  if ($_ -match '^([A-Z_][A-Z0-9_]*)=(.*)$') {
    $name = $Matches[1]
    $value = $Matches[2].Trim('"').Trim("'")
    if ($value) {
      Set-Item -Path "env:$name" -Value $value
      $loaded += $name
    }
  }
}

if ($loaded.Count -gt 0) {
  Write-Host "✓ Loaded $($loaded.Count) env var(s) from .env: $($loaded -join ', ')" -ForegroundColor Green
} else {
  Write-Host "⚠ .env exists but no vars loaded — check syntax (KEY=value, one per line)" -ForegroundColor Yellow
}

Write-Host "Launching Claude Code in $repoRoot..." -ForegroundColor Cyan
Set-Location $repoRoot
& claude $args

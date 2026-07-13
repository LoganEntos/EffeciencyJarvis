# restore-data.ps1 — receive a Taildropped data bundle and unpack it into
# claude-dashboard/data/ on this machine.
#
# The data/ folder (run history, inbox, tasks, schedules, personas, memory) is
# gitignored and does NOT travel with the repo, so it's moved between machines
# out-of-band via Tailscale Taildrop. On the SENDING machine:
#     tailscale file cp claude-hub-data.zip <this-machine-name>:
# Then on THIS machine, run:
#     powershell -File scripts/restore-data.ps1
#
# It pulls any pending Taildrop files, finds claude-hub-data.zip, and extracts
# it over claude-dashboard/data/ (existing files with the same name are
# overwritten; anything only-local is left in place).

$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
$dataDir = Join-Path $repo "claude-dashboard\data"

# Locate the tailscale CLI.
$ts = "C:\Program Files\Tailscale\tailscale.exe"
if (-not (Test-Path $ts)) {
  $c = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($c) { $ts = $c.Source } else { Write-Host "restore: tailscale CLI not found." -ForegroundColor Red; exit 1 }
}

# 1. Pull any pending Taildrop files into a temp inbox.
$inbox = Join-Path $env:TEMP "claude-hub-taildrop"
New-Item -ItemType Directory -Force -Path $inbox | Out-Null
Write-Host "restore: fetching pending Taildrop files into $inbox ..." -ForegroundColor Cyan
& $ts file get $inbox
# (no-op if nothing is pending; the zip may already be here from a prior run)

$zip = Get-ChildItem $inbox -Filter "claude-hub-data*.zip" -ErrorAction SilentlyContinue |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $zip) {
  Write-Host "restore: no claude-hub-data*.zip found in $inbox." -ForegroundColor Red
  Write-Host "         Make sure the sender ran:  tailscale file cp claude-hub-data.zip <this-machine>:" -ForegroundColor Yellow
  exit 1
}
Write-Host "restore: found $($zip.Name) ($([math]::Round($zip.Length/1MB,2)) MB)" -ForegroundColor Cyan

# 2. Extract into data/ (create it if this is a fresh clone).
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
Write-Host "restore: extracting into $dataDir ..." -ForegroundColor Cyan
Expand-Archive -Path $zip.FullName -DestinationPath $dataDir -Force

$count = (Get-ChildItem $dataDir -Recurse -File).Count
Write-Host "restore: done. $count files now in claude-dashboard\data\." -ForegroundColor Green
Write-Host "restore: you can delete $inbox when you're satisfied." -ForegroundColor DarkGray

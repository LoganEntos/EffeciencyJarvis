# sync.ps1 — two-way sync for claude-hub across machines (this PC <-> laptop).
#
# Safe to run any time. It commits nothing on its own except an optional
# work-in-progress snapshot you pass with -Message; it pulls the other
# machine's commits first (rebasing yours on top so history stays linear),
# then pushes. Runtime data/ and local settings stay local (see .gitignore).
#
# Usage:
#   pwsh scripts/sync.ps1                 # pull --rebase then push
#   pwsh scripts/sync.ps1 -Message "wip"  # commit tracked changes first, then sync
#
# First-time setup on a machine (once a GitHub remote exists):
#   git remote add origin <url>   &&   git push -u origin master

param(
  [string]$Message = ""
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

function Fail($msg) { Write-Host "sync: $msg" -ForegroundColor Red; exit 1 }

# 0. Must have a remote to sync with.
$hasRemote = (git remote) -contains "origin"
if (-not $hasRemote) {
  Fail "no 'origin' remote yet. Create a private repo, then:`n  git remote add origin <url>`n  git push -u origin master"
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()

# 1. Optionally snapshot local work so nothing is lost in the rebase.
$dirty = (git status --porcelain)
if ($Message -ne "") {
  if ($dirty) {
    git add -A
    git commit -q -m $Message
    Write-Host "sync: committed local changes as '$Message'" -ForegroundColor Cyan
  } else {
    Write-Host "sync: nothing to commit, skipping snapshot" -ForegroundColor DarkGray
  }
} elseif ($dirty) {
  Write-Host "sync: you have uncommitted changes; they'll be auto-stashed across the pull." -ForegroundColor Yellow
}

# 2. Pull the other machine's commits, rebasing local work on top.
Write-Host "sync: pulling from origin/$branch (rebase, autostash)..." -ForegroundColor Cyan
git pull --rebase --autostash origin $branch
if ($LASTEXITCODE -ne 0) {
  Fail "pull/rebase hit a conflict. Resolve the files, then run:`n  git rebase --continue`n  pwsh scripts/sync.ps1"
}

# 3. Push local commits up.
Write-Host "sync: pushing to origin/$branch..." -ForegroundColor Cyan
git push origin $branch
if ($LASTEXITCODE -ne 0) { Fail "push failed (see message above)." }

Write-Host "sync: up to date." -ForegroundColor Green

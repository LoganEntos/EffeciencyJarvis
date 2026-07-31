# Safe cleanup for a throwaway hub instance (verify/QA on :5758+).
#
# Kills STRICTLY by the port a process is LISTENING on - never by raw PID
# guess, never by process/image name ("stop all node"). Both of those killed
# the real primary hub in the past: a subagent taskkilled its own run's
# recorded hubPid from meta.json (that field is the PRIMARY hub that
# dispatched the run, NOT the throwaway test instance - off-limits, always),
# and a separate run did a blanket "stop all Node processes" during cleanup.
# See claude-dashboard/data/todos/run.md (2026-07-31 entry) for the incident.
#
# Usage:  powershell -File scripts\kill-port.ps1 -Port 5758
#
# Hard guard: refuses port 5757 (the primary hub) outright, and refuses any
# port <= 1024 (never intended for this hub) as a sanity backstop. Never
# accepts a PID as input - there is no argument for one, by design, so this
# script physically cannot be pointed at "kill this PID".
param(
    [Parameter(Mandatory = $true)][int]$Port
)

if ($Port -eq 5757) {
    Write-Host "REFUSED: port 5757 is the primary hub - never kill it from this script." -ForegroundColor Red
    exit 1
}
if ($Port -le 1024) {
    Write-Host "REFUSED: port $Port looks like a system/reserved port, not a throwaway hub instance." -ForegroundColor Red
    exit 1
}

$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $conns) {
    Write-Host "Nothing listening on port $Port - nothing to do."
    exit 0
}

$pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($killPid in $pids) {
    $proc = Get-Process -Id $killPid -ErrorAction SilentlyContinue
    $name = if ($proc) { $proc.ProcessName } else { "unknown" }
    Write-Host "Killing PID $killPid ($name) - listening on port $Port"
    Stop-Process -Id $killPid -Force -ErrorAction SilentlyContinue
}
Write-Host "Done - port $Port cleared."

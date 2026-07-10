# Register (or remove) a user-level Scheduled Task that starts the Claude Code
# Hub dashboard at logon, so http://127.0.0.1:5757 survives reboots.
# Run once from the project root:
#   powershell -File scripts\install-autostart.ps1            # install
#   powershell -File scripts\install-autostart.ps1 -Uninstall # remove
param([switch]$Uninstall)

$taskName = 'ClaudeCodeHub'
$node = 'C:\Program Files\nodejs\node.exe'
$projectRoot = Split-Path -Parent $PSScriptRoot
$serverJs = Join-Path $projectRoot 'claude-dashboard\server.js'

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed scheduled task '$taskName' (if it existed)."
    exit 0
}

if (-not (Test-Path $node)) { Write-Host "node.exe not found at $node" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $serverJs)) { Write-Host "server.js not found at $serverJs" -ForegroundColor Red; exit 1 }

$action = New-ScheduledTaskAction -Execute $node -Argument '"claude-dashboard\server.js"' -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Installed scheduled task '$taskName': hub starts at logon on http://127.0.0.1:5757"
Write-Host "Start it now without logging off:  Start-ScheduledTask -TaskName $taskName"

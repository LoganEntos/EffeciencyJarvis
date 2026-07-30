/*
 * Keep-awake: hold a Windows power availability request while ≥1 run is
 * active, so the machine can't idle-sleep out from under a live claude child.
 * Root cause this fixes (user report 2026-07-30): screen-off → Modern Standby
 * suspended the box mid-run → the child's API connection died → the run
 * errored "connection lost". Only the SYSTEM state is pinned
 * (ES_CONTINUOUS | ES_SYSTEM_REQUIRED = 0x80000001) — the display may still
 * turn off; the machine keeps running. Lid-close / power-button sleep is NOT
 * blocked (deliberate — that path is covered by auto-resume in runs-engine).
 *
 * Zero-dep: Node can't P/Invoke, so one hidden PowerShell child holds the
 * execution state. The state is per-process, so Windows clears it the moment
 * that child dies — a crashed hub can never pin the machine awake (the child
 * also watches the hub PID and exits when it's gone). Static argv array, no
 * shell string, no user input (spawn security invariant).
 */
'use strict';
const { spawn } = require('child_process');

let child = null;

// Re-assert every 30s (some wake paths reset the thread state) and self-exit
// when the hub PID disappears. 2147483649 = ES_CONTINUOUS|ES_SYSTEM_REQUIRED;
// 2147483648 = ES_CONTINUOUS alone (explicit clear on the way out).
const SCRIPT = `Add-Type -Namespace W -Name P -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
while ($true) { [W.P]::SetThreadExecutionState(2147483649) | Out-Null; if (-not (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Seconds 30 }
[W.P]::SetThreadExecutionState(2147483648) | Out-Null`;

function acquire() {
  if (child || process.platform !== 'win32') return null;
  try {
    child = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', SCRIPT],
      { windowsHide: true, stdio: 'ignore' });
    child.on('exit', () => { child = null; });
    child.on('error', () => { child = null; });
    return 'on';
  } catch { child = null; return null; }
}

function release() {
  if (!child) return null;
  try { child.kill(); } catch {}
  child = null;
  return 'off';
}

// Engine hook: called with the current running-run count whenever it changes.
// Returns 'on' exactly once per arm so the caller can surface a status line.
function sync(runningCount) { return runningCount > 0 ? acquire() : release(); }

process.on('exit', () => release());

module.exports = { sync, acquire, release };

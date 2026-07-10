# Smoke test for the Claude Code Hub dashboard.
# Usage:  powershell -File scripts\verify-dashboard.ps1 [-Port 5757]
# Starts nothing — point it at a running server. Asserts every read endpoint
# answers 200 and that mutating endpoints reject requests without the hub token.
param([int]$Port = 5757)

$base = "http://127.0.0.1:$Port"
$fails = 0

function Check($name, $url, [int]$expect = 200) {
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20 -ErrorAction Stop
        $code = [int]$r.StatusCode
    } catch {
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode } else { $code = -1 }
    }
    if ($code -eq $expect) { Write-Host ("  OK   {0,-28} {1}" -f $name, $code) }
    else { Write-Host ("  FAIL {0,-28} got {1}, expected {2}" -f $name, $code, $expect) -ForegroundColor Red; $script:fails++ }
}

function CheckPost($name, $url, $body, [int]$expect) {
    try {
        $r = Invoke-WebRequest -Uri $url -Method POST -Body $body -ContentType 'application/json' `
            -UseBasicParsing -TimeoutSec 20 -ErrorAction Stop
        $code = [int]$r.StatusCode
    } catch {
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode } else { $code = -1 }
    }
    if ($code -eq $expect) { Write-Host ("  OK   {0,-28} {1}" -f $name, $code) }
    else { Write-Host ("  FAIL {0,-28} got {1}, expected {2}" -f $name, $code, $expect) -ForegroundColor Red; $script:fails++ }
}

Write-Host "Smoke-testing hub at $base"
Check "GET /"                  "$base/"
Check "GET /assets/style.css"  "$base/assets/style.css"
Check "GET /assets/app.js"     "$base/assets/app.js"
Check "GET /assets/run.js"     "$base/assets/run.js"
Check "GET /assets/files.js"   "$base/assets/files.js"
Check "GET /assets/graph.js"   "$base/assets/graph.js"
Check "GET /api/overview"      "$base/api/overview"
Check "GET /api/agents"        "$base/api/agents"
Check "GET /api/skills"        "$base/api/skills"
Check "GET /api/commands"      "$base/api/commands"
Check "GET /api/config"        "$base/api/config"
Check "GET /api/sessions"      "$base/api/sessions"
Check "GET /api/activity"      "$base/api/activity"
Check "GET /api/graph/stats"   "$base/api/graph/stats"
Check "GET /api/runs"          "$base/api/runs"
Check "GET /api/files"         "$base/api/files"
Check "GET /api/tasks"         "$base/api/tasks"
Check "GET /api/memory"        "$base/api/memory"
Check "GET /api/memory/search" "$base/api/memory/search?q=test"
Check "GET /api/run/transcript (bad id 404)" "$base/api/run/transcript?id=nope" 404
Check "GET traversal blocked (403)" "$base/api/run/artifact?id=x&file=..%2F..%2Fserver.js" 403
CheckPost "POST /api/run w/o token (403)"        "$base/api/run"        '{"prompt":"x"}' 403
CheckPost "POST /api/run/delete w/o token (403)" "$base/api/run/delete" '{"id":"x"}' 403
CheckPost "POST /api/files/delete w/o token (403)" "$base/api/files/delete" '{"name":"x"}' 403
CheckPost "POST /api/swarm/launch w/o token (403)" "$base/api/swarm/launch" '{"goal":"x"}' 403
CheckPost "POST /api/tasks w/o token (403)"       "$base/api/tasks"       '{"prompt":"x"}' 403
CheckPost "POST /api/memory w/o token (403)"      "$base/api/memory"      '{"text":"x"}' 403

if ($fails -eq 0) { Write-Host "`nAll checks passed." -ForegroundColor Green; exit 0 }
Write-Host "`n$fails check(s) failed." -ForegroundColor Red
exit 1

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

function CheckPut($name, $url, $body, [int]$expect, $headers = $null) {
    try {
        if ($headers) {
            $r = Invoke-WebRequest -Uri $url -Method PUT -Body $body -ContentType 'application/json' -Headers $headers `
                -UseBasicParsing -TimeoutSec 20 -ErrorAction Stop
        } else {
            $r = Invoke-WebRequest -Uri $url -Method PUT -Body $body -ContentType 'application/json' `
                -UseBasicParsing -TimeoutSec 20 -ErrorAction Stop
        }
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
Check "GET /assets/components.css" "$base/assets/components.css"
Check "GET /assets/app.js"     "$base/assets/app.js"
Check "GET /assets/run.js"     "$base/assets/run.js"
Check "GET /assets/run-composer.js" "$base/assets/run-composer.js"
Check "GET /assets/voicecore.js" "$base/assets/voicecore.js"
Check "GET /assets/files.js"   "$base/assets/files.js"
Check "GET /assets/graph.js"   "$base/assets/graph.js"
Check "GET /assets/voice.js"   "$base/assets/voice.js"
Check "GET /assets/voicecfg.js" "$base/assets/voicecfg.js"
Check "GET /assets/voiceconvo.js" "$base/assets/voiceconvo.js"
Check "GET /api/overview"      "$base/api/overview"
Check "GET /api/agents"        "$base/api/agents"
Check "GET /api/skills"        "$base/api/skills"
Check "GET /api/commands"      "$base/api/commands"
Check "GET /api/config"        "$base/api/config"
Check "GET /api/sessions"      "$base/api/sessions"
Check "GET /api/session-summaries" "$base/api/session-summaries"
Check "GET /api/activity"      "$base/api/activity"
Check "GET /api/graph/stats"   "$base/api/graph/stats"
Check "GET /api/runs"          "$base/api/runs"
Check "GET /api/stats/today"   "$base/api/stats/today"
Check "GET /api/files"         "$base/api/files"
Check "GET /api/tasks"         "$base/api/tasks"
Check "GET /api/schedules"     "$base/api/schedules"
Check "GET /api/todos/counts"  "$base/api/todos/counts"
Check "GET /assets/todos.js"   "$base/assets/todos.js"
CheckPut "PUT /api/todos/run w/o token (403)" "$base/api/todos/run" '{"md":"- [ ] x"}' 403

# Authenticated todo checks need the per-boot X-Hub-Token, which is injected
# into the served page's <meta name="hub-token"> — scrape it from GET /.
$hubToken = $null
try {
    $home = Invoke-WebRequest -Uri "$base/" -UseBasicParsing -TimeoutSec 20 -ErrorAction Stop
    if ($home.Content -match 'name="hub-token" content="([0-9a-f]+)"') { $hubToken = $Matches[1] }
} catch {}
if ($hubToken) {
    $hdr = @{ 'X-Hub-Token' = $hubToken }
    CheckPut "PUT /api/todos/run w/ token (200)" "$base/api/todos/run" '{"md":"- [ ] smoke-test-item\n- [x] done-item"}' 200 $hdr
    try {
        $get = Invoke-WebRequest -Uri "$base/api/todos/run" -UseBasicParsing -TimeoutSec 20 -ErrorAction Stop
        if ($get.Content -match 'smoke-test-item') { Write-Host ("  OK   {0,-28} {1}" -f "GET /api/todos/run (md round-trip)", 200) }
        else { Write-Host ("  FAIL {0,-28} md not persisted" -f "GET /api/todos/run (md round-trip)") -ForegroundColor Red; $script:fails++ }
    } catch { Write-Host ("  FAIL {0,-28} request error" -f "GET /api/todos/run (md round-trip)") -ForegroundColor Red; $script:fails++ }
    CheckPut "PUT /api/todos/..%2Fetc%2Fpasswd (400 traversal)" "$base/api/todos/..%2Fetc%2Fpasswd" '{"md":"x"}' 400 $hdr
    CheckPut "PUT /api/todos/nope-tab (400 unknown tab)" "$base/api/todos/nope-tab" '{"md":"x"}' 400 $hdr
    CheckPut "PUT /api/todos/run cleanup (200)" "$base/api/todos/run" '{"md":""}' 200 $hdr
} else {
    Write-Host "  SKIP  could not read hub token from GET / - skipping authenticated todo checks" -ForegroundColor Yellow
}
Check "GET /api/assets"        "$base/api/assets"
Check "GET /api/sources"       "$base/api/sources"
Check "GET /api/personas"      "$base/api/personas"
Check "GET /api/personas/get"  "$base/api/personas/get?id=jarvis"
Check "GET /api/personas/get (bad id 404)" "$base/api/personas/get?id=..%2Fserver" 404
Check "GET /assets/jarvistab.js" "$base/assets/jarvistab.js"
Check "GET /assets/jarvisorb.js"  "$base/assets/jarvisorb.js"
Check "GET /assets/jarvischat.js" "$base/assets/jarvischat.js"
Check "GET /assets/jarvis.css" "$base/assets/jarvis.css"
Check "GET /assets/overview.css" "$base/assets/overview.css"
Check "GET /assets/clientlog.js" "$base/assets/clientlog.js"
Check "GET /api/clientlog"      "$base/api/clientlog"
Check "GET /api/projects"      "$base/api/projects"
Check "GET /assets/projects.js" "$base/assets/projects.js"
Check "GET /assets/projects.css" "$base/assets/projects.css"
Check "GET /assets/projectchat.js" "$base/assets/projectchat.js"
Check "GET /assets/projectdetail.js" "$base/assets/projectdetail.js"
Check "GET /api/projects/pairs"      "$base/api/projects/pairs?slug=vpp-historical-import-test"
Check "GET /api/projects/pairs (traversal 404)" "$base/api/projects/pairs?slug=..%2F..%2Fx" 404
Check "GET /api/projects/pairs (no slug 404)"   "$base/api/projects/pairs" 404
Check "GET /api/agentgraph"    "$base/api/agentgraph"
Check "GET /api/delegations"   "$base/api/delegations"
Check "GET /api/delegations (bad id 404)" "$base/api/delegations?runId=..%2F..%2Fserver" 404
Check "GET /api/hermes"        "$base/api/hermes"
Check "GET /vendor/css/fonts.css" "$base/vendor/css/fonts.css"
Check "GET vendor traversal blocked" "$base/vendor/..%2Fserver.js" 404
Check "GET /manifest.webmanifest"  "$base/manifest.webmanifest"
Check "GET /vendor/icons/hub-icon.svg" "$base/vendor/icons/hub-icon.svg"
Check "GET /vendor/icons/tabler-sprite.svg" "$base/vendor/icons/tabler-sprite.svg"
Check "GET /vendor/icons/bootstrap-sprite.svg" "$base/vendor/icons/bootstrap-sprite.svg"
Check "GET /vendor/icons/pixelart-sprite.svg" "$base/vendor/icons/pixelart-sprite.svg"
Check "GET /vendor/css/pattern.min.css" "$base/vendor/css/pattern.min.css"
Check "GET /api/memory"        "$base/api/memory"
Check "GET /api/memory/search" "$base/api/memory/search?q=test"
Check "GET /api/voice/tts (404)"  "$base/api/voice/tts" 404
Check "GET /api/voice/status"  "$base/api/voice/status"
Check "GET /api/routing"       "$base/api/routing"
Check "GET /api/autopilot"     "$base/api/autopilot"
Check "GET /api/health"        "$base/api/health"
Check "GET /api/health/doc"    "$base/api/health/doc?path=docs/roadmap.md"
Check "GET /api/health/doc (traversal 404)" "$base/api/health/doc?path=..%2F..%2Fserver.js" 404
Check "GET /api/health/doc (non-md 404)" "$base/api/health/doc?path=claude-dashboard%2Fserver.js" 404
Check "GET /assets/health.js"  "$base/assets/health.js"
Check "GET /api/usage"         "$base/api/usage"
Check "GET /api/sharepoint/status" "$base/api/sharepoint/status"
Check "GET /api/sharepoint/index/status" "$base/api/sharepoint/index/status"
Check "GET /api/sharepoint/index/search" "$base/api/sharepoint/index/search?q=test"
Check "GET /api/sharepoint/index/tree" "$base/api/sharepoint/index/tree"
Check "GET /api/sharepoint/index/browse (bad drive 400)" "$base/api/sharepoint/index/browse?drive=%2F..%2Fx" 400
Check "GET /assets/sharepoint.js" "$base/assets/sharepoint.js"
Check "GET /assets/sheetgrid.js" "$base/assets/sheetgrid.js"
Check "GET /api/files/xlsx (bad name 404)" "$base/api/files/xlsx?name=nope.xlsx" 404
Check "GET /api/files/xlsx/cells (bad name 404)" "$base/api/files/xlsx/cells?name=nope.xlsx" 404
Check "GET /api/files/xlsx/cells (traversal 404)" "$base/api/files/xlsx/cells?name=..%2F..%2Fserver.js" 404
Check "GET /api/files/view (bad name 404)" "$base/api/files/view?name=nope.pdf" 404
# self-provisioned fixture: the endpoint must 400 on an inbox file that isn't an xlsx
$fixture = Join-Path $PSScriptRoot '..\claude-dashboard\data\inbox\smoke-nonxlsx.txt'
Set-Content -Path $fixture -Value 'smoke' -Encoding ascii
Check "GET /api/files/xlsx/cells (non-xlsx 400)" "$base/api/files/xlsx/cells?name=smoke-nonxlsx.txt" 400
# /api/files/view only serves images + pdf; a .txt must be rejected (not sniffed)
Check "GET /api/files/view (non-previewable 400)" "$base/api/files/view?name=smoke-nonxlsx.txt" 400
Remove-Item $fixture -Force -ErrorAction SilentlyContinue
Check "GET /api/run/transcript (bad id 404)" "$base/api/run/transcript?id=nope" 404
Check "GET traversal blocked (403)" "$base/api/run/artifact?id=x&file=..%2F..%2Fserver.js" 403
CheckPost "POST /api/run w/o token (403)"        "$base/api/run"        '{"prompt":"x"}' 403
CheckPost "POST /api/run/delete w/o token (403)" "$base/api/run/delete" '{"id":"x"}' 403
CheckPost "POST /api/files/delete w/o token (403)" "$base/api/files/delete" '{"name":"x"}' 403
CheckPost "POST /api/files/move w/o token (403)" "$base/api/files/move" '{"name":"x","project":"y"}' 403
CheckPost "POST /api/clientlog w/o token (403)"  "$base/api/clientlog"  '{"msg":"x"}' 403
CheckPost "POST /api/projects/import w/o token (403)" "$base/api/projects/import" '{}' 403
CheckPost "POST /api/projects/delete w/o token (403)" "$base/api/projects/delete" '{"id":"x"}' 403
CheckPost "POST /api/projects w/o token (403)"        "$base/api/projects"        '{"name":"x"}' 403
CheckPost "POST /api/projects/update w/o token (403)" "$base/api/projects/update" '{"id":"x"}' 403
CheckPost "POST /api/projects/note w/o token (403)"   "$base/api/projects/note"   '{"id":"x","text":"y"}' 403
CheckPost "POST /api/files w/o token (403)"           "$base/api/files"           '{"name":"x.txt","data":""}' 403
CheckPost "POST /api/teams/select w/o token (403)"    "$base/api/teams/select"    '{"id":"lean"}' 403
CheckPost "POST /api/tasks w/o token (403)"       "$base/api/tasks"       '{"prompt":"x"}' 403
CheckPost "POST /api/tasks/done w/o token (403)"  "$base/api/tasks/done"  '{"id":"x"}' 403
CheckPost "POST /api/memory w/o token (403)"      "$base/api/memory"      '{"text":"x"}' 403
CheckPost "POST /api/schedules w/o token (403)"   "$base/api/schedules"   '{"prompt":"x","kind":"daily","at":"08:00"}' 403
CheckPost "POST /api/voice/tts w/o token (403)"   "$base/api/voice/tts"   '{"text":"x"}' 403
CheckPost "POST /api/voice/start w/o token (403)" "$base/api/voice/start" '{}' 403
CheckPost "POST /api/voice/stop w/o token (403)"  "$base/api/voice/stop"  '{}' 403
CheckPost "POST /api/autopilot/toggle w/o token (403)" "$base/api/autopilot/toggle" '{}' 403
CheckPost "POST /api/sharepoint/pull w/o token (403)" "$base/api/sharepoint/pull" '{"drive":"x","item":"y"}' 403
CheckPost "POST /api/sharepoint/auth/start w/o token (403)" "$base/api/sharepoint/auth/start" '{}' 403
CheckPost "POST /api/personas/active w/o token (403)" "$base/api/personas/active" '{"id":"jarvis"}' 403
CheckPost "POST /api/personas/save w/o token (403)" "$base/api/personas/save" '{"id":"x","body":"y"}' 403
CheckPost "POST /api/personas/delete w/o token (403)" "$base/api/personas/delete" '{"id":"x"}' 403
CheckPost "POST /api/personas/rename w/o token (403)" "$base/api/personas/rename" '{"id":"x","newId":"y"}' 403
CheckPost "POST /api/personas/order w/o token (403)" "$base/api/personas/order" '{"ids":[]}' 403
CheckPost "POST /api/personas/guidelines w/o token (403)" "$base/api/personas/guidelines" '{"body":"x"}' 403
CheckPost "POST /api/jarvis/distill w/o token (403)" "$base/api/jarvis/distill" '{"text":"x"}' 403
CheckPost "POST /api/session-summaries/build w/o token (403)" "$base/api/session-summaries/build" '{"ids":[]}' 403
CheckPost "POST /api/voice/open-folder w/o token (403)" "$base/api/voice/open-folder" '{"engine":"kokoro"}' 403

if ($fails -eq 0) { Write-Host "`nAll checks passed." -ForegroundColor Green; exit 0 }
Write-Host "`n$fails check(s) failed." -ForegroundColor Red
exit 1

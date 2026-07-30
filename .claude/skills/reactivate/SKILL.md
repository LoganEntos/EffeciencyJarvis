---
name: reactivate
description: >
  Revive crashed/dead hub run threads after a laptop sleep, hub restart, or
  connection-lost event. TRIGGER: "reactivate", "revive the threads", "restart
  the crashed runs", "reactivate those threads", or any report that runs died
  with "connection lost" / "Hub restarted" and should continue what they
  started. Identifies dead threads, skips ones already resumed, and fires
  resume runs via the hub API. Proven end-to-end 2026-07-30 — follow it
  verbatim; do not re-derive any step.
---

# Reactivate — revive crashed run threads

Goal: under 60 seconds from trigger to revived threads. Everything below is
known-working; no exploration needed.

## Facts (do not rediscover these)

- Run history lives at `claude-dashboard/data/runs/<id>/` — `meta.json`
  (status, sessionId, model), `prompt.txt` (user's words), `output.jsonl`
  (stream; last `result` event = final reply).
- `GET /api/runs` lists runs but omits prompts. There is NO `/api/runs/<id>`
  detail route — read the disk files instead.
- A **thread** = all runs sharing one `sessionId`. A crashed thread is only
  dead if NO later run with the same sessionId completed.
- `sessionId: null` (old cancels) = unresumable — report it, don't retry.
- The per-boot token is a meta tag in the served page.
- `POST /api/run` body: `{"prompt": "...", "model": "", "resume": "<sessionId>"}`
  — empty model keeps the session's original model (sessionModel lookup).
- Slots: MAX_ACTIVE = 2, and one slot is YOUR OWN run. Fire revivals ONE at a
  time; a second simultaneous fire gets queued or refused.
- Pass JSON via `--data @file` — inline quoting through the shell breaks.

## Steps

**1 — find the dead runs (one command):**
```
cd claude-dashboard/data/runs && ls -t | head -20 | while read id; do
  node -e "const m=require('./$id/meta.json');
  if(['error','cancelled'].includes(m.status))
    console.log('$id','|',m.status,'|',m.sessionId,'|',
      require('fs').readFileSync('./$id/prompt.txt','utf8').replace(/\s+/g,' ').slice(0,90))"
done
```

**2 — for each dead run, decide:** already-resumed, unresumable, or revive.
```
grep -l "<sessionId>" */meta.json     # newer done run w/ same session ⇒ already resumed, skip
```
Check the newest matching run's `meta.json` status. Also skim the dead run's
`output.jsonl` tail — if it only has `thinking_tokens` events, the thread lost
nothing; if it died mid-work, name what it was doing in the revival prompt.

**3 — get the token:**
```
curl -s http://127.0.0.1:5757/ | grep -oE 'token" content="[a-f0-9]+"' | grep -oE '[a-f0-9]{16,}'
```

**4 — fire the revival** (one at a time; wait for `{"id":...,"queued":false}`):
```
cat > /tmp/revive.json <<'EOF'
{"model":"","resume":"<SESSION_ID>","prompt":"[Hub reactivation notice - automated continuation fired on the user's behalf; not the user typing.] This thread's last run died (<cause: hub restart / laptop sleep>) before completing. <STATE: what it was doing, what if anything was lost, and what it should now finish or relay to the user. If its last user message was clipped, ask the user to finish the thought.>"}
EOF
curl -s -X POST http://127.0.0.1:5757/api/run -H "Content-Type: application/json" \
  -H "X-Hub-Token: <TOKEN>" --data @/tmp/revive.json
```
The prompt is a continuation NOTICE addressed to that thread's Claude — never
fabricate words as if the user typed them.

**5 — report** in plain text: per thread — revived (new run id), already
complete (which later run finished it), or unresumable (sessionId null).
Nothing else; no HTML, no docs.

## Judgment calls

- If the dead run's work was finished by a DIFFERENT thread (check git log +
  todo lists before assuming), revive with a status-relay prompt instead of a
  redo instruction — never make a thread redo committed work.
- Never restart the 5757 server; it hosts you.
- If more than 2 threads need revival, fire the two most substantive, tell the
  user the rest are queued behind the slot limit.

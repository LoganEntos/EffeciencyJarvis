# HANDOFF → Fable 5 (new thread) — Hub reset bug NOT reproduced yet; PDF work blocked on it

> ## ✅ RESOLVED 2026-07-27 (`b866cfa`) — archived. Do not action this file.
>
> **This session's "could not reproduce" was correct but incomplete**, and its
> prime suspect below was half right. What was actually wrong:
>
> 1. **The reset is real and now fixed.** It doesn't reproduce with two clean
>    sequential sends, which is why the synthetic test came back green. It
>    reproduces on (a) any Jarvis-tab re-render — `renderers.jarvis` rebuilds
>    `#jarvis` wholesale and `jarvischat.js` kept no transcript log to restore
>    from; (b) any page reload — the session id lived only in a JS variable while
>    `app.js` reloads on a stale per-boot token, i.e. every hub restart; (c) any
>    cancel or stream drop — the session id was claimed only from the terminal
>    `result` event, so every cancelled run in history has `sessionId: null` and
>    its thread was unresumable. Incoherence on long threads had a fourth cause:
>    `buildRunHint` re-stacked ~2.9k chars into the user turn of every resumed
>    prompt. All four fixed and verified live.
> 2. **The stale-live-server suspicion was RIGHT and still applies.** The 5757
>    process has been up since 2026-07-26 18:59 and is now ~81 commits behind.
>    Committing a fix does not deliver it — the live hub must be restarted.
> 3. **What both sessions missed:** the autonomous loop was armed the entire
>    time, dispatching unattended opus runs every ~5 min, saturating both run
>    slots (`MAX_ACTIVE = 2`) so real user prompts queued for minutes or were
>    refused, and committing to the repo during debugging. Now OFF.
> 4. **Still open — the user's actual ask in §"User's real ask right now":**
>    they need to convert PDFs and are blocked. Not addressed by this fix.

**Date:** 2026-07-27 (continued)
**Priority:** P0 — user cannot work in the hub front end; also blocked on converting PDFs.

---

## Status: inconclusive, budget spent, stop and re-scope

The previous session spent ~30 min / ~25% of usage investigating the "conversation
resets after every prompt" bug and **could not reproduce it**:

- Booted a throwaway instance on port 5758 (`node claude-dashboard/server.js 5758`
  — **never touch the live 5757 listener**, it may be hosting a run).
- Drove the Jarvis tab (`#jchatIn` / `jarvisChat.send()`) via injected JS in the
  Browser pane: sent a prompt, got a reply, sent a **second unrelated prompt that
  only makes sense if history carried forward** ("what word did I ask you to reply
  with earlier?") — it answered correctly (`PING2`), proving the CLI session
  (`resume: S.sessionId`) and the in-tab `#jconv` transcript both persisted.
- Switched tabs away and back (`goTab('run')` → `goTab('jarvis')`) — session id
  and transcript were untouched.
- Also drove the Run tab (`#promptIn` / `sendPrompt()`) the same way — same result,
  session persisted correctly across turns.
- `scripts/verify-dashboard.ps1 -Port 5758` — **all checks passed**.

**This does not mean the bug is fake.** It means it didn't reproduce via synthetic
JS-injected sends on a throwaway port. It may be specific to:
- the **live 5757 process** (up since 2026-07-26 18:59 — 68 commits ago; if C64–C71
  landed in code but 5757 was never restarted, it's running stale JS/lib code)
- **real keyboard/click interaction** (Enter key, IME, mobile) vs `.value =` + direct
  function call
- **phone / Tailscale** access specifically
- a **specific tab or flow** not yet tried (Projects tab chat, voice mode, SharePoint)
- something that only shows up after the hub has been open a long time (stale
  `HUB_TOKEN` const after a restart — see `app.js:39-51`, `assets/app.js:76-95`)

## Prime suspect not yet ruled out: stale live server

The user's actual complaint is almost certainly against the **live 5757 hub**,
which has been running since before commits C64–C71 (session-continuity-adjacent
fixes: C67 cleared a stale DOM map in `newChat()`, C68 added stdout error guards
to the run engine). **A live server never picks up new code until restarted.**

**First thing to try in the new thread:** ask the user to hit the restart button
in the hub UI (⟲ icon, calls `/api/restart` — supervised handover, safe) or restart
5757 yourself via the hub's own restart endpoint (NOT by killing the process —
see `server.js:181` `Supervised self-restart`), THEN have the user reproduce the
reset live and describe exactly what they see (does the whole page reload? does
the transcript visibly clear? does a NEW session id show in the badge? is it the
Jarvis tab, Run tab, or a Project chat?).

## Ground rules (unchanged, see CLAUDE.md)
- Zero npm deps, localhost only (127.0.0.1), files < 500 lines.
- **Never kill/restart port 5757 directly** — use the supervised `/api/restart`,
  or verify on a throwaway port (`node claude-dashboard/server.js 5758`).
- Read before edit. No `Co-Authored-By` trailers. Commit only working,
  browser-verified stages.
- `.claude/launch.json` at the **outer** `claudeproject` root now has a
  `claude-dashboard-alt` config (port 5758) for `preview_start` — already created,
  reuse it instead of recreating.

## User's real ask right now
The user needs to **convert PDFs** and is blocked because they don't trust the
hub. Two options to offer them up front, cheaply:
1. Use the `pdf` skill directly in this Claude Code session (no hub involved at
   all) to do the PDF conversions right now, in parallel with anyone investigating
   the hub bug.
2. Only investigate the hub reset bug once they've confirmed (a) they restarted
   5757, and (b) can describe the exact repro steps — don't re-run the same
   synthetic browser test again, it already came back clean.

## Files touched this session (uncommitted, still on disk)
- `docs/handoffs/fable5-stability-handoff.md` (this file, rewritten)
- `.claude/launch.json` created at the outer project root (new, for preview_start)
- No code changes made to `claude-dashboard/` — investigation only, nothing to revert.

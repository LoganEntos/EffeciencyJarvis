# Multi-agent deliberation — deep inefficiencies & coherence issues (2026-07-20)

**Mode: exploration/planning only. No code was changed.** Five specialists
(architecture, performance, code-coherence, UX, security) read the live codebase
in parallel and were told to skip surface issues already fixed in 20+ cycles
(file splits, a11y, styling, token-efficiency) and hunt the systemic problems a
per-diff review can't see. Their findings converge on eight cross-cutting themes,
ranked by impact. Individual finding provenance noted as `[arch/perf/code/ux/sec #n]`.

---

## Theme 1 — ONE concept reimplemented 4× is the app's central rot: the live-run/chat client `[arch#1, ux#1, ux#5, code#2]`

Three (really four) chat surfaces — the Run tab, the Jarvis in-tab chat, the
Projects inline chat, and a fire-and-forget path in SharePoint — each
**independently** POST `/api/run`, open an `EventSource`, parse the stream-json
line protocol, track their own `sessionId`/`running`/`seen` lifecycle, and render
bubbles. `runrender.js` shares the *rendering*, but not the *SSE consumption*.

Consequences that are already real, not hypothetical:
- **Feature drift:** Run tab has engine/model/permission-mode/effort/attachments/
  recall; Project chat has only model + distill; Jarvis chat has recall + think
  but no model picker. A bug fixed in one copy (comments literally track "the
  jarvischat known bug") isn't guaranteed fixed in the others.
- **Lost context:** "Escalate to Run tab" from a project chat binds the project
  but **starts a brand-new CLI session** — it never passes the active
  `sessionId`, so the user loses the exact conversation that motivated escalating.
- **Silent protocol drift:** a new stream event type only lands in whichever
  surface the author was looking at.

**Direction:** extract one `hubChat`/`HubRun` client module (compose → send →
subscribe SSE → parse → render → history) parameterized by `{surface,
capabilities, domTarget}`. Three call sites configure it; none re-implement it.
Thread `sessionId` through escalation so it continues the thread.
**This is the highest-leverage fix in the deliberation — it dissolves ux#1, ux#5,
and arch#1 at once.**

## Theme 2 — model list & routing exist in incompatible copies that ALREADY disagree, user-visibly `[arch#2, code#1, code#3, code#4]`

- The client predicts a model with one regex (`analyzePromptComplexity`) while
  the server routes with a **different, longer** regex — the predicted badge and
  the actual model can diverge for the same prompt.
- The selectable model list is hardcoded `<option>` blocks in four files, none
  derived from the server's allowlist — adding "Sonnet 5" server-side doesn't
  surface it in Tasks or Project chat.
- **Tasks vs Schedules accept different model sets:** Schedules takes pinned ids,
  Tasks silently coerces the same pick to `auto` with no error. A natural
  copy-paste extension of the Tasks UI will silently downgrade the user's model.
- Token formatting (`fmtTok` vs Overview's `shortK`) and **duration formatting
  (three implementations)** disagree by tab: a 2m5s run shows as `2m5s`, `125s`,
  and `125.0s` in three tabs; 12,400 tokens shows as `12.4k` vs `12k`.

**Direction:** serve the model list + routing decision from one place (a
`/api/models` endpoint or a constant emitted into the page); show the server's
prediction instead of recomputing it; extract the "aliases-or-pinned-id"
predicate and the token/duration formatters into `util.js`/shared globals and
delete the ad-hoc copies.

## Theme 3 — five run-context injectors are one unnamed pattern, hardcoded into `startRun` `[arch#3]`

Personas, teams, project instructions, memory recall, and file/image attachment
are near-identical "return a block to prepend to the prompt" mechanisms, but
`startRun` hardcodes their order, wrapping, and per-item status lines. Adding a
sixth context source means editing the prompt-assembly block, not registering a
provider.

**Direction:** a `contextProviders` list where each returns `{block, statusLine,
meta}`; `startRun` maps over it. New provider = one registration.

## Theme 4 — unbounded data growth + full-file rewrites on hot paths `[perf#1, perf#3, perf#4, perf#5, arch#4]`

The one genuinely unmitigated scaling risk in the app:
- **Run history has no cap** — already 326 run dirs, each a directory read +
  `meta.json` parse per `listRuns()`, called by four tabs with no shared cache.
  (Contrast memory=2000, clientlog=200, which *are* capped.)
- The Claude session dir is **343 files / 133 MB** and grows every run (including
  internal Haiku one-shots), re-scanned with `statSync` per `/api/sessions` call.
- The **2.5 MB SharePoint index is re-read and re-parsed from disk on every
  request** (search/status/tree/browse) — never cached.
- `memory.json` gets a full read-modify-write (pretty-printed) on **every** run
  completion; error runs also trigger a full linear rescan.
- The orphan reaper re-reads every run's `meta.json` every 60s forever, even for
  long-terminal runs, and blocks boot proportional to run count.
- `data/*.json` is **schemaless & unversioned**; a lazy `artifactCount` backfill
  in a getter is an un-named migration; `session-summaries` entries are never
  pruned when their transcript is deleted.

**Direction:** module-scope cache with short TTL / mtime-invalidation for
`sessions()` and the SharePoint index; a retention/archival policy for run
history (mirror the memory cap); drop pretty-printing on the memory hot store and
debounce bursty writes; reaper works a small "maybe-orphaned" candidate set, not
a blind full scan; add a `_v` schema field + one `migrate()` per store.

## Theme 5 — the same live data is polled by 4–5 surfaces, uncoordinated and not visibility-gated `[perf#1, perf#2, perf#6, ux#2]`

Overview's feed (10s), Live tab (2s), Sessions peek (on-demand), and Jarvis's
activity strip (2.5s) each render the same Claude transcript tail with their own
renderer and cadence; the header `● Live` badge is a fifth independent poll. None
check `document.visibilityState`, so they run with the browser/phone backgrounded.

**Direction:** one shared "session tail" poller (subscribe/publish) feeding all
renderers; gate always-on pollers on visibility. Folds into Theme 1's shared
client layer.

## Theme 6 — security: the trust model is "localhost + whole tailnet = fully trusted", and that's load-bearing & undocumented `[sec#1–#5]` ⚠ highest severity

- **The per-boot token is not a secret against non-browser clients:** `GET /`
  serves it in a meta tag, and `badOrigin` passes when no Origin header is sent
  (every curl / tailnet device / local process). It stops browser CSRF, not
  authentication.
- **Unauthenticated GETs leak secrets:** `/api/admin/file?path=.mcp.json` and
  `/api/config` return MCP server keys/env; `/api/session-tail` & `/api/activity`
  return full transcripts; SharePoint index search enumerates tenant paths. **No
  `Host`-header validation anywhere → DNS-rebinding** lets a visited web page read
  all of these.
- **Confused-deputy RCE:** runs default to `bypassPermissions` (full Bash/MCP/net,
  no allowlist) and **schedules/autopilot hardcode it and fire on a timer with no
  review.** A poisoned inbox/SharePoint doc a scheduled run reads = unattended RCE
  with the operator's Claude token, SharePoint refresh token, and `git push`.
- The `*.ts.net` Origin allowance trusts the entire TLD (Funnel sites included),
  not the user's exact host.
- **Genuinely well-defended (verified):** the artifact CSP sandbox (no
  same-origin, no `http:` connect-src — no exfil channel found), the loopback-only
  voice proxy, no-shell argv spawns everywhere, all path-traversal guards, and no
  state-mutating GET.

**Direction:** validate `Host ∈ {127.0.0.1, localhost, <exact tailnet host>}`;
token-guard the config/file/transcript reads; pin the exact MagicDNS hostname
instead of `*.ts.net`; **don't run ingested-content or scheduled tasks at
`bypassPermissions`** — use a restricted tool set or an approval queue and treat
inbox + SharePoint text as tainted. Make the "localhost+tailnet fully trusted"
assumption explicit either way.

## Theme 7 — structural ownership gaps: shotgun surgery & three meanings of "session" `[arch#6, arch#7, ux#6, ux#7]`

- Adding a tab = coordinated edits in four unrelated spots (nav, section, script
  list, renderer); miss one and it fails silently. Drive nav+sections from one JS
  tab manifest.
- "Session" means three unrelated things (a run's CLI sessionId, this project's
  transcripts, other projects' workspaces) with **two independent `.jsonl`
  parsers**; `CLAUDE_EXE` resolution is copy-pasted in **five** lib files; a
  hardcoded `'bigplans'` fallback string is a rename landmine. Extract one
  `lib/transcripts.js` owning parsing + the exe constant.
- Automation state (Autopilot in Config, Schedules in Tasks, Teams in Agents) has
  no shared home — three tabs to answer "what is the hub doing on its own?" Add a
  small automation status strip (Overview or header), not a new tab.
- Tab groups ("Work/Monitor/Library") don't match real use; regroup by verb.

## Theme 8 — silent-failure & metric-basis inconsistencies `[code#5, code#6]`

- No shared `writeJson`: ~13 modules hand-roll the write; half let failures throw
  (browser sees 500), half swallow silently (UI shows success, nothing saved).
  Add one `U.writeJson` with a deliberate throw-vs-swallow choice.
- The hermes engine writes `meta.tokensIn` with different (non-cache-inclusive)
  semantics than the Claude engine under the same field name; token aggregates
  silently mix two bases if hermes is re-enabled. Normalize or tag hermes metrics.
  (Also: ~350 lines of deprecated-but-fully-maintained hermes/acp surface is being
  carried for an off-by-default feature — worth a keep/cut decision.)

---

## What is genuinely sound — do not relitigate

The `renderers` tab registry (clean self-registration seam), the
`createQueries`/`createEngine` closure-injection split of the run engine, the
supervised-restart handshake, the centralized token guard, consistent
path-traversal guards, the artifact CSP sandbox (strongest part of the app), the
loopback voice proxy, no-shell spawns, capped clientlog, and size-keyed session
summaries. Extend these patterns; don't replace them.

---

## Recommended sequencing (when implementation is greenlit)

1. **Security hardening first (Theme 6)** — cheapest high-severity wins: Host-header
   check, token-guard the secret-leaking GETs, pin the exact tailnet host, and
   decide the autonomy-run permission policy. Small diffs, real risk reduction.
2. **Shared client run/chat module (Theme 1 + 5)** — the biggest structural
   dividend; kills feature drift, the escalate-drops-session bug, and redundant
   polling together.
3. **Single source for models/routing/formatting (Theme 2)** — fixes
   already-visible inconsistencies and the silent Tasks model-downgrade.
4. **Data lifecycle (Theme 4)** — retention cap + caches + schema versioning
   before the history/index sizes bite boot time.
5. **Then the lower-churn structural cleanups (Themes 3, 7, 8).**

Each theme is independently shippable and browser/smoke-verifiable. Nothing here
was implemented — this is the deliberation output for planning.

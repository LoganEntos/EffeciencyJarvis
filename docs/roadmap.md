# Claude Hub — Status & Roadmap (SINGLE SOURCE OF TRUTH)

Last consolidated: **2026-07-22** (cleanup pass — competing roadmaps/status notes
merged here; full history preserved in `docs/archive/`). Ordering rule: items
that make every later item cheaper/better ship first. **Token efficiency is the
north star** — zero-dep, no new always-on MCPs.

Status: ✅ done · 🔜 next · ⬜ queued · 🔮 deferred · 🙋 needs user action

---

## Current state (what is true today)

- **Engine = Claude ONLY** — auto model-routing + 14 model-tiered subagents +
  agent teams. hermes is DEPRECATED (too expensive; hidden behind
  `settings.hermesEnabled`, default off). ruflo/claude-flow retired.
- **Design = clean-dark "amber-agent-orb"** (Lovable 1:1 port; `#0c0b0a` /
  `#17140f` / amber `#e8a33d`; Bricolage Grotesque / JetBrains Mono / Instrument
  Serif, all vendored). All tabs done; ◐ toggles warm/light.
- **No dollar figures anywhere, ever** (user directive) — metrics are tokens
  (`fmtTok`) + completion/routing %. `meta.costUsd` recorded, never displayed.
- **Voice**: three TTS engines — browser speechSynthesis (default), Kokoro-82M
  (`.kokoro/` sidecar), Sesame CSM-1B (`.csm/` sidecar; setup in
  `docs/voice-csm.md`). Conversation engine `assets/voiceconvo.js`: wake
  "Jarvis" → persona ack → open window → close on held silence. Kokoro
  self-heal + TTS reply queue are sacred — do not regress.
- **Personas are two-layer**: `personas/_guidelines.md` output contract (layer 1)
  + persona body (layer 2). Soul: `docs/jarvis-soul.md`. Pipeline trace:
  `docs/jarvis-pipeline-trace.md`.
- **Runs**: bypassPermissions default (acceptEdits silently denies in headless);
  Fable-5 god prompt on opus-tier runs; 5-tier `--effort` selector (tier 5 =
  ULTRA CODE); Jarvis distiller (`lib/distill.js`) shapes >25-word prompts.
- **Git**: private `origin` = github.com/LoganEntos/EffeciencyJarvis;
  `scripts/sync.ps1`; user drives push — never push unprompted.
- Everything shipped through 2026-07-19 (F1 split, Jarvis chat parity, voice orb
  live, persona manager UI, R2/R3/R4/N4, token-burn panel, Lovable ports,
  SharePoint tab, Engram memory, schedules, …) is logged in
  `docs/archive/roadmap-2026-07-19-full.md`.

## 🔜 NOW — execute top-to-bottom

0. ✅ **fix-all sprint COMPLETE** — Phase A loop rebuild `90c7b92` + review
   hardening `cba2e9e` (C25-C27); Phase B covered by the 2026-07-25/26 session
   cycles (items 1-3 + 6 below). Handoff archived. **Loop goes live the moment
   the USER runs `claude` + `/login` once on this node and arms Autopilot + the
   scout schedule in Config.**
1. ✅ **Chat attachments/project fixes** — items 4–5 (click-to-open files, discard
   on navigate) 2026-07-25 (`0ce6ed4`).
2. ✅ **Persona pipeline fixes** — system-layer injection, dual contracts,
   wit-cap scoping 2026-07-25 (`ac5b833`).
3. ✅ **Schedules UI polish** — fold recurring checks into autopilot loop
   2026-07-25 (`9a61682`).
4. **N2 mobile ergonomic pass** — programmatic 375px audit of all 18 tabs done
   2026-07-26 (`a545f9f`): zero horizontal overflow anywhere, clipped selects
   fixed, coarse-pointer targets already 36px. Remaining scope = subjective
   one-handed feel on a real phone → folds into N8 (needs the user's device).
5. **N8 iPhone polish** — builds on N2.
6. ✅ **Size guard CLEAR (2026-07-26):** every file under cap with headroom.
   Splits this session: style.css (`156a920`), jarvistab.js (`67c4004`),
   lib/runs.js (`6a9862e`), run.js + voice.js (`f465850`). Largest (refreshed
   2026-07-28): components.css 482, jarvistab.js 455, sharepoint.js 426 — the
   first two are now within 50 of the cap; still all under 500.

## 🙋 Needs the USER (interactive / system)

- **Real-mic pass** on the voice conversation engine + orb waveform / RTT badge
  (wake word "Jarvis", Bluetooth-headset contention).
- **Real-browser persona-card pass** — drag-to-reorder, inline rename, delete
  confirm, ＋ new-persona at desktop + 375px.
- **Q1 Playwright** (dev-only E2E net, no run tax) — awaiting a "yes".
- **Autostart**: `powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1`.
- **Obsidian export** (Q-Obsidian): confirm + vault path.

## ⬜ Queued / 🔮 deferred (trigger noted)

| Item | Verdict / trigger |
|------|-------------------|
| N10 Council mode | **Lowest priority — build last, if ever** (user call 07-15). `lib/council.js` + `assets/council.js` after run.js headroom exists. |
| browser-use/browser-harness | INCLUDE (user 07-12) — run as a sibling tool or port the CDP-harness pattern as a skill; decide at build time. |
| open-jarvis/OpenJarvis | **SKIP — port nothing** (2026-07-25, `docs/open-jarvis-evaluation.md`). Local-Ollama-first Python/Rust framework; its differentiator (local non-Claude inference) collides with the Claude-only north star, and every surface it offers the hub already has Claude-native. REVISIT-WHEN local/offline inference ever becomes a hub goal. |
| Q2 markdownify-MCP | Only when document workflows are active (MCP taxes every run). |
| Q3 task-master | CLI-only on demand if ever; never an always-on MCP. |
| crawl4ai | SKIP — overlaps Scrapling; rationale in `docs/archive/crawl4ai-evaluation.md`. |
| Obsidian / Tavily / 21st.dev / Base44 / damon-ade / charlie-labs | Parked — triggers in `docs/archive/roadmap-2026-07-19-full.md`. |
| Interactive mid-run approvals | Big run-engine rework; revisit once the autonomous loop is proven. |

## Live reference docs (everything else is in `docs/archive/`)

- `HANDOFF.md` — start here (state + ground rules) → points back at this file
- `docs/handoffs/` — README + the two live work orders (chat fixes, schedules)
  + `improvement-cycle.md` (repeatable one-improvement loop prompt)
- `docs/audit-2026-07-21-chat-attach-projects.md` — live audit backing item 1
- `docs/jarvis-soul.md` · `docs/personas/` · `docs/jarvis-pipeline-trace.md`
- `docs/token-efficiency.md` — coding-behavior deltas wired into every run hint
- `docs/voice-csm.md` — CSM sidecar setup/rebuild
- `docs/sharepoint-graphify-master-prompt.md` · `docs/sharepoint-integration-ideas.md`
- `docs/github-intake-list.md` · `docs/lovable-prompts/`

## Decision log (settled — do not relitigate)

Claude-only engine · zero-dep runtime · localhost-only · no dollars in UI ·
curated ~20-agent roster (never bulk) · no always-on MCPs beyond scrapling ·
Council last-if-ever. Full history: `docs/archive/` (old roadmap, ui-roadmap,
open-issues, hermes adoption/deprecation, autonomy logs, deliberations,
resolved handoffs). `docs/improvement-backlog.md` stays live in docs/ — the
autopilot loop (`lib/autopilot.js`) reads it at runtime.

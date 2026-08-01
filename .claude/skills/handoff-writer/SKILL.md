---
name: handoff-writer
description: >
  Write a session handoff from existing state (HANDOFF.md, docs, run
  metadata) in a fresh, cheap session — never by resuming a long session.
  TRIGGER: "write a handoff", "give me a handoff prompt for the next
  thread", ending a long session and wanting continuity, or any ask to
  summarize "what happened" across recent runs for a future session to
  pick up. Use this instead of resuming a mega-session just to ask it to
  summarize itself.
---

# Handoff writing — do it cheap, do it fresh

Generating a handoff by resuming an already-long session costs real money
for no reason: the resume replays the ENTIRE prior context just to produce
a summary of it. Measured cost of this exact mistake: ~$17 across 3 runs in
one session (two of them 7-12M tokens-in on a single turn) purely to
produce a handoff document. Don't repeat it.

## The right way

1. **Start fresh, or use a cheap agent** (doc-scribe or the current
   orchestrating session with a clean prompt) — do NOT resume/continue an
   existing long-running session for this.
2. **Read state, don't recall it.** Pull from:
   - `HANDOFF.md` (current top-level state)
   - `docs/roadmap.md` (what's planned next)
   - `docs/handoffs/*.md` (recent live work orders — check the newest by
     filename date first)
   - `git log --oneline -20` (what actually shipped, not what was claimed)
   - `data/todos/*.md` (open items, per tab)
   - the specific run(s) whose work needs handing off — read their
     `meta.json`/final result, not their full `output.jsonl` transcript
3. **Write the handoff as a NEW file** in `docs/handoffs/<topic>-<date>.md`,
   matching the existing naming convention (see other files in that
   directory) — not appended to an existing doc, not written into
   `HANDOFF.md` directly (that file gets updated separately, deliberately).
4. **Structure**: what's true right now (state, not narrative), what
   shipped this session (with commit references), what's still open/
   blocking, and a ready-to-paste prompt for the next thread if one is
   wanted.

## What NOT to do

- Don't resume a long session "just to ask it to summarize itself."
- Don't guess at what shipped — check git log, don't trust a prior
  in-conversation claim.
- Don't duplicate `docs/roadmap.md`'s content — link to it, don't restate
  the whole plan.

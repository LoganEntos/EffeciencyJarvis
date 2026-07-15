# Token efficiency — hub-native distillation

Source: `PULSE-TOKEN-EFFICIENCY-COMPACTOR.md` (a portable protocol from another
agent system), uploaded 2026-07-15. Distilled here to the parts that are **not
already** the hub's ethos, and rewritten for this repo. Kept as a reference, not
injected into every run — loading a 500-line protocol into every run's context
would burn the very tokens it aims to save (the protocol's own rule #6).

## Already covered — don't re-adopt
The hub already lives most of PULSE via `CLAUDE.md` + `HANDOFF.md`: zero-dep,
every file < 500 lines, structured/plain-text output over styled reports,
consolidate before crossing limits, delete dead code (git remembers). No change
needed for these.

## The genuinely useful deltas (coding behavior)
- **Write dense, not verbose.** Optional chaining / nullish coalescing / ternaries
  over nested `if`s; object shorthand, destructuring, `.map/.filter/.reduce` where
  it reads cleaner. Comments say WHY, never WHAT.
- **Don't re-read what you already have.** If it's in context this session, or you
  just wrote it, don't re-Read it. The harness tracks file state after an edit.
- **Read the slice, not the file.** Grep for the symbol; Read with offset/limit;
  `tail` a log — don't `cat` 500 lines for one function.
- **Diffs over rewrites.** Edit the lines that change; don't reprint whole files.
- **No preamble, no recap, no filler.** Start with the work; report the result.
  (Jarvis's spoken-reply rule already enforces this on the voice surface.)
- **Structured over prose** for status/comparisons; **code over description** for
  technical answers.

## Where these actually belong
- The spoken/reply brevity is already enforced by the Jarvis persona.
- The coding rules matter on **runs that edit code**. ✅ **Wired 2026-07-15** as a
  terse one-line "Token discipline" clause in `buildRunHint()` (`lib/util.js`) —
  ≈60 tokens/run, net-positive since it can save hundreds on a coding run.

## What NOT to port
PULSE's PA/AF agent roster, its `gemma4` model refs, its `inner-log.md` /
`predictions.jsonl` memory-compaction schedule, and its weekly "compaction sweep"
are that system's plumbing, not ours. The hub's equivalents are `lib/memory.js`
(Engram) and the routing lever — no new machinery needed.

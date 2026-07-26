# Audit — Jarvis persona + prompting pipeline (2026-07-22)

Companion to `docs/jarvis-pipeline-trace.md` (the flow map). This is the
quality diagnosis: what actually happens vs what should, and why replies feel
off. Verified against source this session (`lib/personas.js`, `lib/runs.js`
L155-280, `lib/distill.js`, `personas/*.md`, live prefix measured).

## What actually happens (one paragraph)

Every claude run gets one giant **user-turn** string:
`<output-contract>` (~1.2 KB) + `<persona>` (~0.9 KB) → project instructions →
memory-recall block → **the user's words** → attachment refs → team text →
the hub note from `buildRunHint()` (**~2.9 KB / ~700 tokens** of repo map,
token discipline, UI rules, artifact/vendor/design instructions). Only
opus-tier runs get a true system layer (the Fable-5 god prompt). Voice turns
additionally pass >25-word prompts through the Haiku distiller first, and
model routing can land a persona conversation on haiku.

## The problems, ranked

1. **The persona rides in the wrong layer and loses the recency war.**
   Contract + persona are the FIRST thing in a long user turn; the LAST thing
   the model reads before answering is ~700 tokens of engineering/design
   boilerplate. Long-prompt recency bias means the hub note out-shouts the
   voice contract — exactly the "sounds like a build log, not Jarvis"
   failure. On opus runs the god prompt (a real system layer, "be complete,
   audit every claim") outranks a user-turn persona pleading for 30 words.
   *Fix: inject contract+persona via `--append-system-prompt` on every tier
   (compose with GOD_PROMPT), keep the user turn for the user's words +
   context blocks.*

2. **One contract for two incompatible channels.** The TTS-shaped contract
   ("never say a file/function name", "under a minute", "no lists") is
   injected on EVERY run — including typed Run-tab work orders whose own
   instructions demand tables, file paths, and commit-level detail. The model
   must violate one instruction set every time; which one it violates varies
   per run → inconsistent quality. Name-banning on technical replies also
   reads as vague/evasive on screen ("the shaped prompt" instead of the
   thing's name). *Fix: two layer-1 contracts — `spoken` (current text) and
   `screen` (concise, names/tables allowed). Client already knows the channel
   (voiceconvo/jarvischat vs Run tab); pass `channel` in POST /api/run and
   pick the contract server-side.*

3. **Impossible length caps stacked on real work.** jarvis-wit says "one or
   two sentences, ~thirty words"; the contract says two short paragraphs; the
   task says "print a table of everything you touched". Three ceilings, none
   compatible. The wit cap is right for acks and chat banter, absurd for a
   cleanup debrief. *Fix: scope the 30-word rule to conversational turns
   ("for chat/acks; scale to the deliverable for work debriefs") in the
   persona body.*

4. **Haiku rewrites the user's words before Jarvis hears them.** The
   distiller paraphrases any >25-word spoken prompt; nuance lost there is
   unrecoverable — the run answers the paraphrase. It's a good latency/cost
   call for rambling build asks, wrong for questions and anything emotional/
   precise. (The SYS prompt tries, but Haiku is the weakest writer in the
   chain sitting at the most upstream point.) *Fix: distill only
   imperative/build-shaped turns, or append the original verbatim below the
   rewrite so nothing is lost.*

5. **Persona execution quality tracks the routed tier.** `routeModel()`
   scores complexity, so short conversational turns — the MOST
   persona-dependent ones — land on haiku, the model least able to do dry
   Iron-Man wit. *Fix: when a persona is active and the turn is
   conversational, floor routing at sonnet.*

6. **Minor: persona re-sent every turn incl. `--resume`** — harmless
   token-wise (~0.5k) but it stacks N copies into a resumed thread's history,
   and the model occasionally references the scaffolding ("per the output
   contract…") because it lives in the user turn where it looks like
   content. The system-layer move (fix #1) also solves this leak.

## What's actually fine

Two-layer design (contract leads, character follows) is sound; merge-written
state, traversal-guarded ids, handoff-once mechanics all correct; the ack
path works; TTS queue + wake flow are healthy; the trace doc matches source.

## Recommended order

Fix #1 + #2 together (one change in `lib/runs.js` + a second guidelines file
+ a `channel` field), then #3 (persona text edit, zero code), then #5 (one
routing guard), then #4. Total ≈ a single work order.

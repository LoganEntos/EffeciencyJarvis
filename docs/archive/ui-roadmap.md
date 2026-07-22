# Claude Hub — UI Evolution Roadmap

> UI-specific companion to `docs/roadmap.md`. That doc owns *features*; this doc
> owns *how the surface looks and feels*. Where they overlap (R0 clean Overview,
> R2 navigable libraries, R4 Files thumbnails) this doc gives the visual design;
> the feature roadmap keeps the priority call. Nothing here relitigates a decided
> question (Claude-only engine, zero-dep runtime, localhost-only). Read the
> `redesign-clean-dark` memory and the CLAUDE.md design section first — this
> builds *on* the amber-agent-orb clean-dark language, it does not replace it.

Status legend: 🟢 quick win (hours, CSS-mostly) · 🟠 structural (a day, touches
JS + layout) · 🔴 signature/ambitious (multi-day, Lovable-assisted).

---

## 1. Design thesis — "The Amber Observatory"

The hub is not a SaaS dashboard and should stop drifting toward one. It is a
**warm-lit observation deck for watching autonomous agents work** — a single
operator (you), amber instrument light, and a living machine on the other side of
the glass. Every surface should answer one of three questions: *what is the
machine doing right now, what did it just do, and what will it do next.* The
current build already has the raw material (the canvas orb, conic context rings,
the live agent graph, mono readouts) but it reads as **a themed CRUD dashboard
with an orb bolted on**, not as one instrument. The thesis is to make the whole
app feel like one instrument.

The intent, stated plainly so we can hold the line against AI-slop drift:

- **One dominant color doing real work.** Amber `#e8a33d` is not decoration — it
  is *signal*. Amber = the agent, the live state, the thing to watch. Everything
  else recedes to warm near-black and bone-white text. Green stays quarantined to
  success; red to failure. No second accent, no evenly-distributed palette, never
  the banned purple-on-white.
- **Warmth + depth, never flat.** Backgrounds carry atmosphere (the layered
  radial glow + dot-grid already in `style.css`). We push this further with a
  signature texture (below), not toward flatter minimalism. The R0 "clean &
  minimal" note means *strip editorial magazine cruft and vanity metrics* — it
  does **not** mean flat gray Linear-clone. Clean = calm, information-first,
  generous whitespace, one accent. Distinctive at the same time.
- **The readout language.** Data is presented as instrument readouts, not as
  generic stat cards: hairline tick marks, arc/conic gauges, oscilloscope
  sparklines, tabular-nums JetBrains Mono, `Instrument Serif` reserved for one
  hero number per view. Consistent everywhere → the app reads as one system.

### Two signature motifs (the things that make it *this* app)

**Motif A — The Core (the orb becomes the brand heartbeat).**
Today the orb lives only on the Jarvis tab and as a small header mic orb. Promote
it to the app's persistent heartbeat: **one canvas primitive, one draw function,
rendered at three sizes** — a 20px glyph in the header (always visible, replaces
the flat square `.logo`), the header mic orb, and the 300px Jarvis stage. It
reflects *real system telemetry*, not just voice state:

- idle → slow amber breath
- a run streaming → the core pulses at the token-arrival cadence
- routing decision → a one-shot ring flash tinted by tier (amber=cheap,
  brighter=mid, hot-white=heavy/opus) so you *see* the model choice land
- spend/usage pressure → breath rate rises as the weekly cap approaches
- listening/thinking/speaking → the existing voice states

Result: the machine has a visible pulse on every screen. That is the signature —
no other local dev tool has a living core wired to real run telemetry. It is also
cheap: one shared `core.js` canvas module, `requestAnimationFrame` only while
visible, reduced-motion → static frame (the Jarvis orb already does exactly
this — generalize it).

**Motif B — Filament telemetry texture.**
A coherent "etched instrument" texture that replaces flat card fills and unifies
the data surfaces. Faint amber **filament traces** — thin curved connector lines
and contour hairlines at ~4-7% opacity — layered into panel backgrounds and used
literally as the connectors in the agent graph, the run→artifact links, and the
Projects manifest. Think warmed oscilloscope / circuit-etching, not sci-fi cyan
HUD. Rendered as one reusable SVG/CSS layer (a `--filament` background utility +
the graph's existing canvas links restyled to match). This gives depth (per the
anti-slop rule) and a recognizable through-line: the same hairline vocabulary in
the background, the gauges, and the graph.

Everything below serves these two motifs or clears slop out of their way.

---

## 2. Phased UI changes per surface

### Phase 1 — Quick wins (🟢 CSS-mostly, ship in a session each, no Lovable)

These sharpen the existing language immediately and are low-risk.

1. **Header: replace the flat `.logo` square with the Core glyph.** 🟢
   `index.html` line ~105 + `assets/style.css`. A 20px canvas orb (shared module,
   Motif A) tied to the existing `liveBadge`/`spendBadge` state. Biggest
   perceived-quality jump for the least code — the brand mark comes alive on
   every tab. Impact: high. Effort: low (the draw code exists in `jarvistab.js`).

2. **Unify the "readout" primitives into shared CSS classes.** 🟢
   Right now `overview.js` builds conic rings, plan bars, and the model-mix bar
   with inline styles; `run.js` has the usage gauge (`rungauge.js`); Memory,
   Tasks, Sessions each roll their own stat pills. Extract `.gauge-arc`,
   `.readout`, `.tick-row`, `.sparkline`, `.stat-tile` into `style.css` so every
   tab draws data the same way. Impact: coherence (the thesis' core promise).
   Effort: medium, but pure consolidation — deletes inline-style duplication.

3. **Add the `--filament` background utility (Motif B).** 🟢
   One CSS layer: faint curved-hairline SVG data-URI + contour, gated to
   `data-theme="dark"`, applied to `.card`, `.ovhero`, and the Jarvis/Graph
   stages. Replaces some flat `var(--panel)` fills with textured depth. Impact:
   the signature texture, app-wide, in one file. Effort: low.

4. **Kill remaining vanity/slop in Overview.** 🟢 (partial R0)
   `overview.js` still stacks a hero + plan card + chat card + 5 stat tiles +
   mix bar + memPill/apiPill row + recent runs + raw feed — it's a long scroll of
   competing panels. Quick win: demote `apiPill`/`memPill`/MCP/library counts to
   a single collapsed footer line; drop the "Raw session feed" `<pre>` from the
   default view (move behind a chip). Full rebuild is Phase 3. Impact: calmer
   first screen. Effort: low.

5. **Typography discipline pass.** 🟢
   Audit every `font-size` inline literal (there are dozens: `11.5px`, `12.5px`,
   `10.5px`…). Collapse to a 6-step scale as CSS vars (`--fs-hero`/`--fs-h2`/
   `--fs-body`/`--fs-small`/`--fs-micro`/`--fs-mono`). Reserve `Instrument Serif`
   for exactly one hero number per view (Overview hero, Jarvis persona name) —
   right now it's underused. Impact: the "3x size jumps not timid steps" rule.
   Effort: medium, mechanical.

6. **Files: image thumbnails + day grouping.** 🟢🟠 (R4)
   `files.js` renders a flat list. Add a thumbnail (`<img>` from a
   `/api/files/thumb` or inline for images) and group rows under day headers.
   Small visual, high daily value (you must see what the AI is fed). Impact:
   high for image workflows. Effort: medium (needs a thumbnail endpoint or
   client-side object URLs).

7. **Nav polish.** 🟢
   17 tabs in a 196px rail is a lot. Quick win: the group labels (Work/Monitor/
   Library) already exist — add a collapse toggle per group and persist it, and
   give the active tab's Core-tinted left bar a subtle glow. Impact: navigability.
   Effort: low.

### Phase 2 — Structural (🟠 layout + JS, ship per-tab)

8. **Library tabs (Agents / Skills / Commands): from flat dump to catalog.** 🟠 (R2)
   Three tabs are unstyled flat lists of 60-166 items. Give them a shared catalog
   component: left facet rail (group/tier/source), search that filters live, and
   card tiles showing model-tier chips (the Agents tab already has tier data).
   One `assets/catalog.js` reused by all three. Impact: high (R2 is a standing
   user complaint). Effort: a day. This is the single biggest "flat dump" debt.

9. **Sessions: auto-summary cards.** 🟠 (pairs with R3)
   Once R3 writes cached summaries, Sessions becomes scannable cards (summary +
   metrics + resume) instead of a time list. Visual half of R3. Impact: medium.
   Effort: depends on R3 backend.

10. **Tasks + Schedules: timeline view.** 🟠
    `tasks.js` is a queue list + a schedules list. Reframe as a vertical timeline
    (queued → running → done) with the Core pulse on the active item, and show
    schedules as a "next fire" strip. Impact: makes the autopilot legible.
    Effort: medium.

11. **SharePoint: browser depth.** 🟠
    `sharepoint.js` (269 lines) is functional but plain. Restyle the site→drive→
    folder browser with breadcrumb, filament connectors between levels, and pull/
    push as clearly-directional actions (↓ inbox / ↑ push). Impact: medium.
    Effort: medium.

12. **Global loading/empty/error states.** 🟠
    Skeletons exist unevenly (`files.js` sets `noSkeleton`). Standardize a
    filament-shimmer skeleton and honest empty states (the codebase already
    values "honest empty-state" — S8). Impact: perceived quality. Effort: medium.

### Phase 3 — Signature / ambitious (🔴 Lovable-assisted single-tab overhauls)

13. **Overview → the Observatory cockpit.** 🔴 (R0) — *Lovable prompt below.*
14. **Run → the primary instrument.** 🔴 — *Lovable prompt below.*
15. **Jarvis → the Core stage.** 🔴 — *Lovable prompt below.*
16. **Graph → live telemetry theatre.** 🔴 — *Lovable prompt below.*

These four are where Lovable earns its keep: each is a single dense, visual tab
where a 1:1 port of a strong generated design beats hand-iterating. The prompts in
§3 are self-contained. Do them in the order above — Overview first (highest user
demand, R0), then Run (most-used), then Jarvis (signature), then Graph (hardest,
most novel).

---

## 3. Lovable prompts (paste-ready, one per overhaul)

**How to use these (per the `lovable-ui-pipeline` memory):** paste a prompt into
lovable.com, generate, and return the image/URL. We then port the *visual design*
1:1 into the zero-dep vanilla stack by reading the live Lovable DOM's computed
styles (the method that shipped the clean-dark redesign) — Lovable's React/Tailwind
code is reference only, never imported. Each prompt therefore hard-pins the exact
tokens, Google Fonts, and motion so the output is portable, and instructs Lovable
to use a **single dark theme, static mock data, no routing, no backend, no theme
switcher, and only Lucide icons** (which we already vendor).

Shared constraint block (identical in every prompt — keep it verbatim so ports
stay consistent):

> **Design system — obey exactly, no substitutions.**
> Single dark theme only. Background base `#0c0b0a`. Panels `#17140f`. Hairlines
> `rgba(255,255,255,0.07)` and `rgba(255,255,255,0.14)`. Text `#f2ece0`, muted
> `#a79e8c`, dim `#6d6455`. ONE accent, amber `#e8a33d` (dim `#e8a33d40`, soft
> `#e8a33d1a`) — used only for the live/agent/active signal. Success green
> `#4bc47a`, error red `#e05252` — used ONLY for those states, never decoration.
> No purple, no blue, no second accent, no gradients-on-white.
> Fonts (Google Fonts): **Bricolage Grotesque** for headings/UI (weights 600 &
> 800, tight tracking -0.02em), **JetBrains Mono** for all data/numbers/controls
> (weights 200 & 500, tabular-nums), **Instrument Serif** for exactly ONE hero
> number per screen. Never Inter/Roboto/Arial/system fonts.
> Corners: 4px cards, 3px controls (tight/technical, not rounded-friendly).
> Depth: warm near-black with a layered radial glow (amber, top-center + warm
> bronze, bottom) and a faint dot-grid + thin curved "filament" hairline traces
> at 4-7% opacity — atmospheric, never flat.
> Motion: ONE orchestrated page-load reveal (staggered fade+rise, `animation-delay`
> per element). No scattered hover micro-animations. Respect reduced-motion.
> Icons: Lucide only. No stock images, no illustrations, no emoji.
> Aesthetic north star: a warm amber "observatory / instrument panel" for
> watching AI agents work — calm, information-first, one operator at the glass.

---

### 3A. Lovable prompt — Overview ("the Observatory cockpit")

```
Build a single dark-themed dashboard page called "Overview" — the cockpit of a
local app that runs AI coding agents. It answers one question at a glance: is my
agent work efficient and am I about to hit my usage cap. It is calm and
information-first — NOT a marketing page, no big serif headlines, no vanity KPI
grid.

CURRENT FUNCTIONALITY TO REPRESENT (use static mock data):
- A hero readout: "context window utilization of the current chat" — a big number
  (e.g. 34%) with sub-line "68K of 200K tokens · claude-opus-4-8 · 4m ago".
- Plan-usage gauges (the most important thing): four horizontal meters with %
  fills and reset labels — "Current session 41% · resets in 2h", "Weekly all
  models 63%", "Weekly Fable 78%", "Usage credits 90% · resets Thu". Show a
  burn-rate projection line: "at this rate the weekly cap hits Thursday".
- Efficiency stat tiles: Success 92%, Routing accuracy 88%, Lean-model share 74%,
  Avg run 22s, Active 2.
- A "model mix" bar: a horizontal stacked bar split cheap / mid / heavy tiers
  (amber / brighter-amber / hot red-ish) with a legend, labeled "lean = cheaper
  tiers doing the work".
- A "current chat analytics" card: a circular gauge (context used) beside the
  prompt excerpt, status pill, and chips (model, tier, tokens in→out, duration).
- Recent runs: 5 compact rows (status pill, relative time, model, tokens,
  duration, prompt excerpt) — clickable-looking.

AMBITIOUS FUTURE STATE TO ADD:
- Make the plan-usage gauges the hero of the page (top, largest), rendered as
  elegant arc gauges with tick marks and a needle, not plain bars — this is the
  "should I run now, defer, or delegate to a cheaper model" decision surface.
- A small live "system core": a glowing amber orb in the header area that pulses,
  representing the agent's live state.
- A burn-rate sparkline (oscilloscope style, thin amber line on a ticked axis)
  under the weekly gauge showing usage velocity over the last 7 days.
- A "where the tokens went" horizontal breakdown by task, and a tiny "wasted work"
  readout (failed/retried tool calls).
- Everything laid out on a calm 2-column grid: gauges + core on the left, run
  telemetry on the right. Generous whitespace. One Instrument Serif number (the
  weekly-remaining %) as the single hero.

[PASTE SHARED DESIGN SYSTEM BLOCK HERE]
```

### 3B. Lovable prompt — Run ("the primary instrument")

```
Build a single dark-themed page called "Run" — the main workspace of a local app
where an operator chats with an AI coding agent (the Claude CLI) that works inside
a project folder and streams its work back live. This is the most-used screen; it
must feel like a precision instrument, not a generic chatbot.

CURRENT FUNCTIONALITY TO REPRESENT (static mock):
- A top control bar (compact, monospace controls): engine selector, a "✦ Jarvis"
  toggle (turns rough prompts into clean routed prompts), a model selector
  ("model: auto (routed)" plus tier options), a permissions selector, a "memory
  recall" toggle, a "+ New chat" button, and a small session pill.
- A live usage gauge strip under the bar (compact arc gauges: context used,
  tokens, cost-tier).
- A chat log: user bubbles (right, plain) and assistant bubbles (left). Assistant
  messages contain streamed content plus collapsible "tool call" blocks (a
  monospace summary that expands to show the tool + result) and a "plan" block.
- A live status badge bar: "◉ running", elapsed timer, "⚠ stalled" and
  "process gone" states.
- A composer: an attach strip (chips for attached files/images), a big textarea,
  and Attach / Read-again / Send / Cancel buttons.
- Below: "Run history" — filterable list of past runs with status pills, model,
  tokens, duration, artifact count; each row replays on click.
- Run-produced artifacts (HTML/SVG/PNG) render inline in a sandboxed frame.

AMBITIOUS FUTURE STATE TO ADD:
- A live "agent core" pulse near the status bar that beats at the cadence of
  arriving tokens while streaming, and flashes a tier-tinted ring the moment the
  auto-router picks a model (amber=cheap, brighter=mid, hot-white=heavy) so the
  operator SEES the model decision land.
- Tool-call blocks styled as instrument log lines with hairline connectors
  (filament) linking a tool call to its result, and a thin timeline gutter on the
  left of the chat showing each step's duration as a tick.
- The usage gauge strip animates live during a run.
- Run history rows show a tiny per-run oscilloscope sparkline of token velocity.
- Artifacts get a clean "readout" frame with a caption bar.
- Keep it dense but calm: the chat is the focus, controls recede to mono chips,
  one Instrument Serif accent only on the live elapsed timer.

[PASTE SHARED DESIGN SYSTEM BLOCK HERE]
```

### 3C. Lovable prompt — Jarvis ("the Core stage")

```
Build a single dark-themed page called "Jarvis" — the face of a local AI
assistant. It is a calm, cinematic stage dominated by one large glowing amber orb
(the "Core") that represents the assistant's live state. Voice-first: tap the orb
to talk, hold for a hands-free call.

CURRENT FUNCTIONALITY TO REPRESENT (static mock):
- A large central orb (~300px) with a warm amber glowing core, an aura, and an
  outer ring. It has distinct visual STATES you should show as variants:
  idle (slow breathing glow), listening (concentric sonar ripples), thinking (a
  single orbiting arc), speaking (fast layered pulse), and "in call" (a slowly
  rotating dashed halo around it).
- The active persona's NAME under the orb (big, Instrument Serif), with a one-line
  soul/description under it.
- A row of persona chips to switch persona (e.g. Jarvis, Dispatch, Sage).
- A fold-out "soul editor": a text area to edit the persona's personality prompt,
  with save.
- A short status line under the orb ("tap to talk · hold for a call").

AMBITIOUS FUTURE STATE TO ADD:
- The Core is the app's heartbeat: show faint telemetry orbiting it — thin amber
  filament arcs, a ring of tick marks that light up with audio amplitude when
  listening, and a subtle spectrum/waveform ribbon when speaking.
- A minimal live transcript that fades in below as short captioned lines (what you
  said / what it replied), auto-fading — never a chat wall.
- Persona chips as elegant pills with the active one connected to the orb by a
  filament line.
- A calm "recent voice sessions" strip at the bottom (small cards).
- The whole page is nearly black with a deep radial amber glow behind the orb, so
  the orb feels like it's floating in a warm dark room. Cinematic, minimal, one
  hero element. Almost no chrome.

[PASTE SHARED DESIGN SYSTEM BLOCK HERE]
```

### 3D. Lovable prompt — Graph ("live telemetry theatre")

```
Build a single dark-themed page called "Agent Graph" — a live radial map of the
AI agent crew working on the current task, for a local agent-runner app. This is
the "watch the machine work" screen; it should feel like an observatory display.

CURRENT FUNCTIONALITY TO REPRESENT (static mock):
- A radial node-graph on a dark canvas: a central "Maestro" orchestrator node,
  with a ring of named worker/crew nodes around it (e.g. Scout, Bloodhound,
  Scribe, Wrench, Falcon, Foreman, Spellbook, Envoy) and recruited subagent nodes
  further out. Each node is a labeled circle; the active ones pulse; links between
  nodes are animated (a flowing dash) when work is flowing.
- Node color/label encodes model tier (cheap/mid/heavy).
- Click a node → an inspection panel (right side) with its role, model, status,
  and recent activity.
- A small toolbar: a chip to switch between "live crew" view and a static
  "codebase map" view (a larger force-directed graph of ~20 file/module nodes with
  weighted links), plus a search box that highlights matching nodes.
- Auto-follows the currently-live run.

AMBITIOUS FUTURE STATE TO ADD:
- Make it a telemetry theatre: the central node is the glowing amber "Core" orb;
  links are thin amber "filament" traces that brighten and flow particles from
  caller → callee when a handoff happens; idle links are near-invisible hairlines.
- A live event ticker along the bottom (monospace log lines: "Scout → read 4
  files", "Wrench → edit run.js", oscilloscope-thin).
- Each active node carries a tiny arc gauge (its token spend) and a status ring.
- A timeline scrubber to replay how the crew activated over the run.
- Inspection panel is a clean instrument readout (mono, tick marks, one arc gauge).
- Restrained: mostly dark, amber only on active/live elements, everything else
  hairline. It should look like mission control at 2am, warm not cold.

[PASTE SHARED DESIGN SYSTEM BLOCK HERE]
```

---

## 4. Tradeoffs & honesty

- **The Core (Motif A) is the highest ROI and lowest risk.** The draw code already
  exists in `jarvistab.js`; generalizing it into a shared `assets/core.js` and
  dropping the 20px glyph in the header is a Phase-1 quick win that instantly
  makes the app feel like one instrument. Do it first, before any Lovable work.
  Risk: a persistent `requestAnimationFrame` in the header. Mitigation: the glyph
  animates only on state change / while a run streams, static otherwise — the
  header orb must not burn a rAF loop at idle (see `fixing-motion-performance`).

- **Filament texture (Motif B) can tip into noise.** At the wrong opacity it reads
  as dirty rather than instrumented. Keep it ≤7% opacity, dark-theme only, and
  behind content — ship it behind a quick visual check at 375px and on a real
  monitor before committing. Cheap to back out (one CSS layer).

- **Lovable overhauls are the expensive path — sequence them.** Each is multi-day
  (generate → port computed styles → rewire the live JS → browser-verify → smoke).
  Don't batch all four. Overview (3A) is worth doing first because R0 is a direct
  user request and the current Overview is the most-slop surface. Jarvis (3C) is
  the most self-contained (few moving parts) and the best signature payoff for the
  effort. Graph (3D) is the hardest port (live canvas + physics) — do it last and
  be ready to keep the current agentviz canvas and only restyle it if the port
  fights the zero-dep constraint.

- **17 tabs is the elephant this roadmap doesn't move.** The nav rail is dense and
  several tabs overlap (Live vs Run status, Overview vs Graph, Assets vs Sources).
  A genuine information-architecture consolidation is out of scope here (it's a
  feature decision for `docs/roadmap.md`), but flag it: no amount of restyling
  fixes 17 top-level destinations. Worth a dedicated IA pass before or alongside
  Phase 3. Cheapest partial: collapsible nav groups (item 7).

- **Effort ordering that makes later work cheaper (the roadmap's own rule):** do
  the shared primitives (items 1-3, 5) FIRST. The Core module, the readout CSS
  classes, the filament utility, and the type scale are dependencies of every
  Phase-2/3 item. Building them once means the Lovable ports drop into an existing
  vocabulary instead of each reinventing gauges and tiles. Skipping them makes the
  Lovable overhauls more expensive and less consistent.

- **Reject: a full framework/React rewrite to make Lovable ports trivial.** It
  would delete the zero-dep invariant, the single north-star constraint of this
  repo. The port-computed-styles method already works (it shipped clean-dark).
  Not worth reopening. (Already parked in `roadmap.md` deferred: 21st.dev, Base44.)

- **Reject: theming beyond the two themes we have.** The warm/clean-dark toggle is
  enough. More palettes dilute the "one dominant color doing real work" thesis.
```

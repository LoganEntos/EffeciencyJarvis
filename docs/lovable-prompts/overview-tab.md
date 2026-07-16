# Lovable prompt — Overview tab redesign

Paste into Lovable. Reference screen: `amber-agent-orb.lovable.app` (existing
hub design language — reuse its tokens exactly, don't reinvent).

---

Design a dark operator-cockpit "Overview" dashboard screen for a personal AI
agent hub. This is the landing tab — it should read as command-center status,
not a generic admin panel.

**Design tokens (reuse exactly, this must match the rest of the app):**
- Background `#0c0b0a`, panel `#17140f`, panel-2 `#141210`, hairline `#ffffff12`
  (stronger `#ffffff24`), text `#f2ece0`, muted `#a79e8c`
- Accent amber `#e8a33d` (soft fill `#e8a33d1a`, dim `#e8a33d40`), success
  green `#4bc47a`, error red `#e05252`
- Fonts: **Bricolage Grotesque** for display/headings (800 weight for h1, 600
  for h2), **JetBrains Mono** for every number/metric/label/control,
  **Instrument Serif** reserved for exactly one large hero number
- Shapes: 4px radius cards, 3px radius controls, pill badges at 20px radius,
  subtle inset top-highlight line on panels. No drop shadows, no glassmorphism,
  no purple gradients.

**Critical framing — read this before designing metrics:** there is NO API
that exposes Claude subscription plan usage (session/weekly/credit limits).
Any screen that shows "plan usage %" is showing fabricated numbers. Every
metric on this screen must be something the hub can actually *measure* from
its own run history — real counts, not guesses. Kill the plan-usage bars
entirely; do not include them even as a "coming soon" placeholder.

**Hero (top, full-width):** one big Instrument Serif number = current chat's
context-window utilization (e.g. "34%"), subtext in mono: "68K of 200K
tokens · claude-sonnet-5 · 2m ago". Small conic-gradient ring next to it
(amber under 70%, warm-amber warn 70–90%, red 90%+) showing the same %.

**Row of 5 compact stat cards** (JetBrains Mono numerals, Bricolage label
above in small caps/letterspaced):
1. Success rate — % of finished runs that ended `done` vs `error`/`cancelled`
2. Routing accuracy — % of runs where auto model-routing matched the
   task-complexity heuristic (flag with amber if below target)
3. Lean-model share — % of finished runs on haiku/fable/sonnet vs opus
4. Avg run duration
5. Active runs right now (accent-colored if > 0)

**Model distribution & success-rate panel (this is the centerpiece,
replaces plan-usage bars):** one row per model actually seen in run history,
each row showing:
- model name (mono, e.g. `claude-opus-4-8`)
- a horizontal share bar sized to that model's % of total finished runs,
  colored by cost tier (cheap=amber accent, mid=warm amber, heavy=red)
- share % and raw count (e.g. "62% · 41 runs")
- a success-rate pill (green ≥90%, amber 70–89%, red <70%)
- avg duration and avg token count in dim mono, right-aligned

Sort rows by run count descending. This panel should feel like the emotional
center of the screen — it's the "where is my usage actually going and is it
working" answer, replacing anything about plan/credit consumption.

**Current-chat analytics card:** context ring + model badge + tier badge +
token in/out + duration + memory-recall count + artifact count + the routing
reason if the run was auto-routed. One horizontal card, dense, scannable.

**Below the fold:** system status pills (API auth ready/not, engram memory
count, MCP servers connected, agents/skills/commands library counts), a
"Recent runs" list (clickable rows: status pill, relative time, model,
tokens, duration, prompt excerpt, error excerpt in red if failed), and a
collapsed-by-default raw session log feed in a mono `<pre>` block.

**Future-ambition elements to design placeholders for (don't fully build,
but leave visual room / a "coming soon" ghost state):**
- A small sparkline per model row showing success rate trend over the last
  ~20 runs, not just the current aggregate
- A cost-tier donut (cheap/mid/heavy split) as an alternative view toggle
  next to the model-distribution panel
- A "routing disagreements" drill-down — click routing-accuracy stat to see
  the specific runs where the router picked a model that under- or
  over-shot task complexity
- Time-range selector (today / 7d / 30d / all) that re-slices every metric
  on this screen, defaulting to all-time

Keep density high — this is a power-user cockpit for someone who lives in
this screen daily, not a marketing dashboard. No empty whitespace padding
for its own sake. One staggered fade/slide-up on initial load
(`animation-delay` per section), no other motion.

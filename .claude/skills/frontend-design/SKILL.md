---
name: frontend-design
description: The hub's front-end design system + UI workflow. Use as the FIRST step for any UI work on claude-dashboard — sets the amber-agent-orb stack/tokens, then routes through baseline-ui → fixing-accessibility → fixing-motion-performance.
---

# frontend-design (Claude Code Hub)

The project design skill for `claude-dashboard`. Invoke this FIRST for any UI work,
then run the polish loop. It encodes the shipped **amber-agent-orb** system so UI
changes stay on-brand instead of being eyeballed.

## Stack (non-negotiable)
- **Zero-dependency vanilla JS + CSS.** No React/Tailwind/npm packages in the app.
  Markup: `index.html` + `assets/*.js`. Style: `assets/style.css`. Server:
  `lib/*.js`. Every file stays under 500 lines.
- Localhost-only; per-boot `X-Hub-Token` on all non-GET; argv-array spawns.

## Design system (exact — ported from amber-agent-orb.lovable.app)
Drive everything from CSS variables (clean-dark `:root[data-theme="dark"]` is the
DEFAULT; ◐ toggles warm):
- **Color:** `--bg #0c0b0a` · `--panel #17140f` · `--panel2 #141210` ·
  `--line #ffffff12` · `--line2 #ffffff24` · `--txt #f2ece0` · `--muted #a79e8c` ·
  `--dim #6d6455` · accent **amber `#e8a33d`** (+`--accent-soft 1a`/`--accent-dim 40`) ·
  `--green #4bc47a` · `--red #e05252`. **One accent per view.** No gradients, no
  purple, no glow-as-affordance, no flat fills (layered near-black + faint depth).
- **Type:** `--font-body` **Bricolage Grotesque** (h1 800/-0.02em, h2 600) ·
  `--font-mono` **JetBrains Mono** (ALL data/ids/metrics/controls, 12px) ·
  `--font-serif` **Instrument Serif** (ONLY the Overview usage hero, 96px). All in
  `/vendor/`. Never Inter/Roboto/Arial/system.
- **Shape:** cards/rows radius **4px** (`--r`), selects/buttons/inputs **3px**,
  pills **20px**, panels get an inset top-highlight (`inset 0 1px 0 #ffffff0a`).
  Buttons = amber fill + near-black text, mono 11px.
- **Motion:** ONE staggered page-load reveal; a subtle amber pulse on live state;
  reduced-motion aware; NO perpetual rAF (see below).

## Lovable option (for ambitious tab overhauls)
The user has a **lovable.com subscription** — the same tool the shipped
amber-agent-orb system came from. For any BIG redesign of a single tab, offer
this path before hand-coding the vision:
1. Write the user a **complete Lovable prompt** for that one tab: all current
   features PLUS every planned/ambitious future capability, the exact tokens and
   fonts above, and the tab's real data shapes. One tab per prompt.
2. The user generates it in Lovable and returns a **screenshot (or live URL)**.
3. Port it 1:1 into the real source (proven method: read the live Lovable DOM's
   computed styles, as was done for the original redesign) — vanilla JS/CSS,
   tokens as CSS variables, zero deps.
This gives a prompt → generated-reference → port pipeline instead of designing
blind. Incremental tweaks and polish passes should NOT use this — go straight
to the workflow below.

## Workflow (Design → Craft → A11y → Perf)
1. **Design/Craft** — make the change in the real source, using the tokens/fonts
   above. Reuse existing components (`.card` `.row` `.pill` `.badgebar` `listView`).
   Edit files in place; NEVER build preview/mockup HTML (CLAUDE.md rule).
2. **`/baseline-ui <file>`** — spacing/typography/hierarchy/anti-slop pass.
3. **`/fixing-accessibility <file>`** — ARIA, keyboard, focus, contrast.
4. **`/fixing-motion-performance <file>`** — composite-only motion, no unbounded
   rAF loops, pause off-screen (the class of bug that pegged the Graph tab).
5. **Verify:** reload `http://127.0.0.1:5757`, check the tab + console, run
   `scripts/verify-dashboard.ps1`, commit per working tab.

## Where things live
Nav: Run · Tasks · Files · Sessions · Memory · Overview · Graph · Agents · Skills ·
Commands · Assets · Tools · Config. Renderers: `run.js`+`runhistory.js`,
`overview.js`, `config.js`, `graph.js`+`agentviz.js`, `tasks.js`, `files.js`,
`memory.js`, `assetlib.js`, `admin.js`, `teams.js`; core (`app.js`) = routing +
`listView` + boot.

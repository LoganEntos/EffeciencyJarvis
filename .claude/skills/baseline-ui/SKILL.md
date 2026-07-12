---
name: baseline-ui
description: Fast UI polish pass — spacing, hierarchy, typography, layout, and anti-slop rules. Use when the interface needs cleanup. Adapted for this repo's ZERO-DEP vanilla JS/CSS stack.
---

# Baseline UI

> Adapted from [ibelick/ui-skills](https://github.com/ibelick/ui-skills) (MIT).
> The original targets React + Tailwind; this repo is **zero-dependency vanilla
> JS + CSS**, so the framework rules below are translated to the hub's stack.
> Apply the PRINCIPLE, not the framework specifics.

## How to use
- `/baseline-ui` — apply these constraints to any UI work in this conversation.
- `/baseline-ui <file>` — review the file and output: violations (quote the exact
  line/snippet) · why it matters (one sentence) · a concrete fix.

## Stack (this repo — overrides the upstream Tailwind/React assumptions)
- **Zero dependencies.** Plain Node built-ins + vanilla JS/CSS. NEVER add Tailwind,
  React, `motion/react`, `clsx`, Base UI, Radix, or any npm package to the app.
- Style via **CSS variables** in `assets/style.css` (`--accent` `#e8a33d`, `--bg`
  `#0c0b0a`, `--panel`, `--line`, `--txt`, `--muted`, `--green`, `--red`, `--r`).
- Fonts: **Bricolage Grotesque** (display/body), **JetBrains Mono** (data/metrics),
  **Instrument Serif** (hero numbers only) — all local in `/vendor/`.
- Animation = CSS or hand-written rAF (see `/fixing-motion-performance`).
- Accessibility = native HTML + ARIA (see `/fixing-accessibility`).
- See also `/frontend-design` for the full amber-agent-orb design system.

## Components / interaction
- Use **native elements** for anything with keyboard/focus behavior (`button`,
  `a`, `input`, `dialog`); add `aria-label` to icon-only buttons; never rebuild
  keyboard/focus by hand.
- Use a confirm/AlertDialog for destructive or irreversible actions.
- Use skeleton loaders for loading states (the repo has `.skel`).
- Prefer `100dvh` over `100vh`; respect `safe-area-inset` on fixed elements.
- Show errors next to where the action happens; never block paste in inputs.

## Animation
- NEVER add animation unless requested. Animate only `transform`/`opacity`; NEVER
  animate `width`/`height`/`top`/`left`/`margin`/`padding`. Use `ease-out` on
  entrance; ≤200ms for interaction feedback. **Pause/stop looping animation when
  off-screen** (no perpetual rAF). Respect `prefers-reduced-motion`.

## Typography
- Use `text-wrap: balance` on headings, `text-wrap: pretty` on body.
- Use `font-variant-numeric: tabular-nums` for data/metrics.
- Use `text-overflow: ellipsis` / `-webkit-line-clamp` for dense UI.
- Don't touch `letter-spacing` unless requested (the theme already sets it).

## Layout
- Keep a **fixed z-index scale** (no arbitrary values). Square elements: set width
  and height equal explicitly. Consistent spacing off the existing scale.

## Performance
- NEVER animate large `blur()`/`backdrop-filter` surfaces. NEVER leave `will-change`
  set outside an active animation. Prefer render/CSS over JS where possible.

## Design (anti-slop — matches CLAUDE.md)
- NEVER use gradients unless requested; NEVER purple/multicolor gradients.
- NEVER use glow as a primary affordance.
- **One accent per view** (amber `--accent`); everything else calm mono + hairline
  borders. Use existing theme tokens before introducing new colors.
- Every empty state gets one clear next action.
- Distinctive fonts only (never Inter/Roboto/Arial/system).

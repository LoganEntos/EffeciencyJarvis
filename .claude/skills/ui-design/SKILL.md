---
name: ui-design
description: Design decision library for building distinctive, non-generic UI. Use whenever generating or restyling any frontend, HTML artifact, chart, or visual output — provides curated font pairings, palette formulas, a style catalog, and anti-"AI slop" selection rules. Zero dependencies; pure reference.
---

# UI Design Library

A decision library to make frontends look *designed*, not defaulted. Consult
before writing UI. Based on Anthropic's frontend-aesthetics guidance plus a
curated catalog. Everything here loads from Google Fonts / plain CSS — no
build step, no dependencies.

## The one rule that matters most

Claude converges on generic "AI slop": Inter/Roboto, purple-on-white, flat
backgrounds, timid palettes. **Actively avoid the defaults below.** State your
type + color + motion choices in one line before writing code, then commit.

## Font pairings (pick ONE pairing, load from Google Fonts)

Never: Inter, Roboto, Open Sans, Lato, Arial, system-ui. Don't reflex-pick
Space Grotesk either — it's become its own cliché.

| Aesthetic | Display / heading | Body / secondary |
|---|---|---|
| Editorial / premium | Fraunces (opsz) | Newsreader or Source Serif 4 |
| Technical / dev-tool | Space Mono or JetBrains Mono | IBM Plex Sans |
| Modern startup | Clash Display or Cabinet Grotesque | Satoshi or General Sans |
| Warm / human | Bricolage Grotesque | Hanken Grotesk |
| Brutalist / bold | Archivo Expanded (900) | Archivo (400) |
| Elegant / editorial-tech | Instrument Serif | Geist or Geist Mono |
| Retro-terminal | VT323 or DM Mono | DM Sans |

Contrast is what reads as "designed": pair a display face with a mono or a
serif with a geometric sans. Use **extreme weights** (200 vs 800, not 400 vs
600) and **big size jumps** (clamp() with 3×+ ratio between body and hero),
never timid 1.3× steps.

## Color: dominant + accent, via CSS variables

Formula that beats evenly-distributed palettes:
- **1 dominant** surface/brand hue (sets the mood; ~60% of the page)
- **1 neutral** ramp (bg, panel, line, text — 4–5 steps)
- **1–2 sharp accents** used *sparingly* for action/emphasis (~5%)

Banned cliché: **purple gradient on white**. Instead draw from IDE themes and
cultural palettes:

| Theme | Dominant | Accent | Neutral base |
|---|---|---|---|
| Terminal amber | `#e8a33d` | `#5fd68b` | near-black `#0e0e10` |
| Nord / cool slate | `#88c0d0` | `#a3be8c` | `#2e3440` |
| Solarized dusk | `#268bd2` | `#d33682` | `#002b36` |
| Rosé / warm dark | `#e0a0a0` | `#d7a86e` | `#1a1418` |
| Forest / paper light | `#2f6b4f` | `#c2703d` | `#f4f1ea` |
| Cyber ink | `#00d4ff` | `#ff2e97` | `#0a0a14` |

Always define as `--bg --panel --line --text --muted --accent` CSS variables so
the whole thing is themeable and consistent.

## Backgrounds: depth, never flat

- Layer 2–3 large soft radial gradients at corners (atmosphere)
- Subtle geometric texture: dot grid, faint noise, or 1px hairline grid at low
  opacity
- Never a single solid fill for a hero or full-page background

## Motion: one orchestrated moment > scattered fidgets

- A single staggered page-load reveal (`animation-delay` stepping across
  elements) delivers more delight than many hover micro-interactions
- CSS-only for plain HTML; keep durations 200–500ms, ease-out
- Respect `@media (prefers-reduced-motion: reduce)` — disable transforms there

## Style catalog (name the intent, then execute it)

glassmorphism · brutalism · neo-brutalism · swiss/international · editorial ·
terminal/TUI · claymorphism · retro-futurism · minimalist-luxury ·
data-dense-dashboard · solarpunk · vaporwave. Pick one deliberately to match
the content; don't blend more than two.

## Selection heuristic (fast path)

1. What is the content's *character*? (tool → terminal/technical; report →
   editorial; dashboard → data-dense + one accent)
2. Light or dark? (vary it — don't always ship dark)
3. Pick one font pairing + one palette + one style from the tables above.
4. State the choice in a sentence, then build with CSS variables + one load
   animation + a layered background.

## Checklist before shipping any UI

- [ ] Font is NOT Inter/Roboto/system; weights use real contrast
- [ ] Palette is dominant+accent via CSS variables, not purple-on-white
- [ ] Background has depth (gradients/texture), not a flat fill
- [ ] One orchestrated load animation; reduced-motion respected
- [ ] Choice fits the content's character, stated up front

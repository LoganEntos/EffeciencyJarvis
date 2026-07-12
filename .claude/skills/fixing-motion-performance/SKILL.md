---
name: fixing-motion-performance
description: Fix animation performance — composite-only motion, no unbounded rAF loops, pause off-screen, no layout thrash. Use when adding/reviewing UI animation, transitions, scroll-linked motion, or canvas loops.
---

# fixing-motion-performance

> Ported verbatim from [ibelick/ui-skills](https://github.com/ibelick/ui-skills) (MIT).
> Stack-agnostic (CSS / WAAPI / rAF / IntersectionObserver) — applies as-is to the
> hub's vanilla UI. (Rule #1 below is the class of bug that pegged the Graph tab.)

Fix animation performance issues. Apply rules within the existing stack — do NOT
migrate animation libraries unless explicitly requested.

## how to use
- `/fixing-motion-performance` — apply these constraints to any animation work here.
- `/fixing-motion-performance <file>` — review the file, report violations (quote
  the snippet) · why it matters · a concrete fix.

## rendering steps glossary
- composite: `transform`, `opacity`
- paint: color, borders, gradients, masks, images, filters
- layout: size, position, flow, grid, flex

## rules

### 1. never patterns (critical)
- do not interleave layout reads and writes in the same frame
- do not animate layout continuously on large or meaningful surfaces
- do not drive animation from `scrollTop`/`scrollY`/scroll events
- **no `requestAnimationFrame` loops without a stop condition**
- do not mix multiple animation systems that each measure or mutate layout

### 2. choose the mechanism (critical)
- default to `transform` and `opacity` for motion
- use JS-driven animation only when interaction requires it
- paint/layout animation only on small, isolated surfaces
- one-shot effects are acceptable more often than continuous motion
- prefer downgrading technique over removing motion entirely

### 3. measurement (high)
- measure once, then animate via transform/opacity; batch DOM reads before writes
- do not read layout repeatedly during an animation; prefer FLIP-style transitions

### 4. scroll (high)
- prefer Scroll/View Timelines for scroll-linked motion when available
- use IntersectionObserver for visibility and pausing
- do not poll scroll position; **pause or stop animations when off-screen**

### 5. paint (medium-high)
- paint-triggering animation only on small, isolated elements
- do not animate CSS variables for transform/opacity/position; avoid inherited vars

### 6. layers (medium)
- compositor motion requires layer promotion (never assume it)
- use `will-change` temporarily and surgically; avoid many/large promoted layers

### 7. blur and filters (medium)
- keep blur animation small (≤8px), short, one-time; never continuous or on large surfaces

### 8. view transitions (low)
- only for navigation-level changes; avoid for interaction-heavy or cancellable UI

### 9. tool boundaries (critical)
- do not migrate/rewrite animation libraries; apply rules within the existing system

## common fixes

```css
/* animate transform, not width */
.panel { transition: transform 0.3s; }          /* not: transition: width 0.3s; */
/* scroll-linked via CSS, not JS */
.reveal { animation: fade-in linear; animation-timeline: view(); }
```
```js
// FLIP: measure once, animate via transform
const first = el.getBoundingClientRect();
el.classList.add('moved');
const last = el.getBoundingClientRect();
el.style.transform = `translateX(${first.left - last.left}px)`;
requestAnimationFrame(() => { el.style.transition = 'transform 0.3s'; el.style.transform = ''; });
```

## review guidance
- enforce critical rules first (never-patterns, tool boundaries)
- choose the least expensive rendering work that matches the intent
- for any non-default choice, state the constraint that justifies it.

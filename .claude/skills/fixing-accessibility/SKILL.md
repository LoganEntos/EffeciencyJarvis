---
name: fixing-accessibility
description: Audit and fix HTML accessibility — ARIA labels, keyboard navigation, focus management, contrast, and form errors. Use when adding interactive controls, forms, dialogs, or reviewing WCAG compliance.
---

# fixing-accessibility

> Ported verbatim from [ibelick/ui-skills](https://github.com/ibelick/ui-skills) (MIT).
> Fully stack-agnostic (plain HTML/ARIA) — applies as-is to the hub's vanilla UI.

Fix accessibility issues.

## how to use

- `/fixing-accessibility`
  Apply these constraints to any UI work in this conversation.
- `/fixing-accessibility <file>`
  Review the file against all rules below and report: violations (quote the exact
  line/snippet) · why it matters (one sentence) · a concrete fix.

Do not rewrite large parts of the UI. Prefer minimal, targeted fixes.

## when to apply

- adding/changing buttons, links, inputs, menus, dialogs, tabs, dropdowns
- forms, validation, error states, helper text
- keyboard shortcuts or custom interactions
- focus states, focus trapping, modal behavior
- icon-only controls; hover-only interactions or hidden content

## rules by priority

### 1. accessible names (critical)
- every interactive control must have an accessible name
- icon-only buttons must have `aria-label` or `aria-labelledby`
- every input, select, textarea must be labeled
- links must have meaningful text (no "click here")
- decorative icons must be `aria-hidden`

### 2. keyboard access (critical)
- do not use `div`/`span` as buttons without full keyboard support
- all interactive elements must be reachable by Tab
- focus must be visible for keyboard users
- do not use `tabindex` greater than 0
- Escape must close dialogs/overlays when applicable

### 3. focus and dialogs (critical)
- modals must trap focus while open; restore focus to the trigger on close
- set initial focus inside dialogs
- opening a dialog should not scroll the page unexpectedly

### 4. semantics (high)
- prefer native elements (`button`, `a`, `input`) over role-based hacks
- if a role is used, required aria attributes must be present
- lists must use `ul`/`ol` with `li`; do not skip heading levels
- tables must use `th` for headers when applicable

### 5. forms and errors (high)
- errors linked to fields via `aria-describedby`; required fields announced
- invalid fields set `aria-invalid`; helper text associated with inputs
- disabled submit actions must explain why

### 6. announcements (medium-high)
- critical form errors should use `aria-live`
- loading states should use `aria-busy` or status text
- toasts must not be the only way to convey critical information
- expandable controls must use `aria-expanded` and `aria-controls`

### 7. contrast and states (medium)
- sufficient contrast for text and icons
- hover-only interactions must have keyboard equivalents
- disabled states must not rely on color alone
- do not remove focus outlines without a visible replacement

### 8. media and motion (low-medium)
- images: correct alt text (meaningful or empty)
- respect `prefers-reduced-motion` for non-essential motion
- avoid autoplaying media with sound

### 9. tool boundaries (critical)
- prefer minimal changes; do not refactor unrelated code
- do not add aria when native semantics already solve the problem

## common fixes

```html
<!-- icon-only button: add aria-label -->
<button aria-label="Close"><svg aria-hidden="true">...</svg></button>
<!-- div as button: use native element -->
<button onclick="save()">Save</button>
<!-- form error: link with aria-describedby -->
<input id="email" aria-describedby="email-err" aria-invalid="true"><span id="email-err">Invalid email</span>
```

## review guidance
- fix critical issues first (names, keyboard, focus, tool boundaries)
- prefer native HTML before adding aria; quote the exact snippet, state the
  failure, propose a small fix; for complex widgets prefer accessible primitives.

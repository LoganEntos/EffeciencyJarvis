# Handoff: Files tab — real spreadsheet preview (cell grid with colors)

**Worker:** Opus, xhigh effort. **Scope:** `claude-dashboard/` only. **Do not commit until browser-verified.**

## 1. Goal

The Files tab's expandable cards were just shipped: images render full-size, text/markdown/csv
render inline — but expanding a spreadsheet shows only metadata badges ("3 sheets · 1602×20").
That is useless. The user needs to review the identification-number verification status inside
`CrossreferenceV10.xlsx` — the actual cell VALUES and the green/amber/red fill color-coding —
without opening Excel. His words: *"I need to click the files and VIEW them as a PNG… I'm not
able to review the current status of all of the identification numbers because of this issue."*
"View as a PNG" means: a visual, readable rendering of the sheet, not a metadata blurb.

**Definition of done:** expanding a spreadsheet card shows the actual sheet contents as a
scrollable grid — cell values in rows/columns, cell fill colors preserved where the workbook
defines them (so the verification legend green=verified / amber=partial / red=0% is visible at
a glance), with tabs to switch between the workbook's sheets. Large sheets are truncated with
an explicit flag, never silently. A perfect Excel render is NOT required — a readable,
color-hinted grid is the bar.

## 2. Acceptance criteria

- [ ] Clicking/expanding an `.xlsx`/`.xlsm`/`.xltx` card in the Files tab shows a scrollable
      grid of actual cell values (not just sheet-name badges).
- [ ] A sheet picker (tabs or pills) switches between the workbook's sheets; switching
      lazy-loads each sheet once and caches it in the DOM.
- [ ] Cell fill colors render for at least the verification sheet of
      `CrossreferenceV10.xlsx` in `data/inbox/` — green/amber/red are visually distinct.
- [ ] Truncation cap (~200 rows × 40 cols) enforced server-side AND flagged in the UI with a
      visible pill (e.g. "showing first 200 of 1602 rows"). No silent truncation.
- [ ] New endpoint is GET, uses the existing `inboxFile()` traversal guard, and rejects
      non-spreadsheet extensions. No shell spawns. No new npm dependencies.
- [ ] Every touched file stays UNDER 500 lines (split into new modules where needed).
- [ ] `node --check` passes on every edited JS file.
- [ ] `scripts/verify-dashboard.ps1 -Port 5758` green against a throwaway instance on 5758;
      extend the smoke script with a probe of the new endpoint.
- [ ] Browser-verified live on **5758** with a screenshot of the Files tab showing
      `CrossreferenceV10.xlsx` expanded, colors visible. **NEVER kill/restart the process on
      5757** — the user's live instance picks up server changes on his next restart.
- [ ] Styling matches the clean-dark theme (`:root[data-theme="dark"]`, amber accent
      `#e8a33d`), JetBrains Mono via `/vendor/css/fonts.css` — no CDN fetches, no generic
      fonts.

## 3. Implementation plan

### 3a. Server — new sheet-cells endpoint (do this first)

Everything you need already exists in `claude-dashboard/lib/files.js`:
`inboxFile(name)` (traversal-safe resolver), `zipEntries(buf)` / `zipRead(buf, entry)`
(zero-dep ZIP central-directory reader + raw-deflate inflate via `zlib.inflateRawSync`),
`colToNum(c)` (A1 column letters → index), and `xlsxInfo(full)` (sheet names + dimensions).
**Extend this approach; do not rebuild it.**

`lib/files.js` is currently 267 lines — a cell/style parser will not fit. Create
**`claude-dashboard/lib/xlsxcells.js`** that `require`s (or receives) the zip helpers and
exports something like `xlsxSheetCells(full, sheetIndex, maxRows, maxCols)`. Either export
`zipEntries`/`zipRead`/`colToNum` from `files.js` for reuse, or move all xlsx parsing
(including `xlsxInfo`) into the new module and re-import — your call, but no duplication.

**New endpoint** in `lib/files.js`'s `handle()`:

```
GET /api/files/xlsx/cells?name=<inbox name>&sheet=<0-based index>
```

- Resolve via `inboxFile()`; 404 if missing; 400 unless `/\.(xlsx|xlsm|xltx)$/i`.
- Clamp `sheet` to a valid integer index (`parseInt`, default 0, reject out-of-range with 400
  or clamp — pick one and be consistent).
- Response shape (suggested):
  ```json
  { "name": "CrossreferenceV10.xlsx", "sheet": 0, "sheetName": "SKU Verification",
    "rows": [[{ "v": "ABC-123", "c": "#c6efce" }, { "v": "verified" }, ...], ...],
    "totalRows": 1602, "totalCols": 20, "shownRows": 200, "shownCols": 40,
    "truncated": true }
  ```
  Omit `c` when a cell has no fill; use `null`/`""` for empty cells so column alignment holds.
- **Cap: 200 rows × 40 cols.** Stop parsing rows past the cap (break out of the row scan —
  don't parse the whole sheet then slice). Keep the existing 40 MB uncompressed-sheet bail
  from `xlsxInfo` as an upper guard.

**Parsing guidance (the tricky part):**

1. **Sheet XML** — `xl/worksheets/sheetN.xml`. Cells look like
   `<c r="B4" s="12" t="s"><v>37</v></c>`:
   - `r` = A1 ref (use `colToNum` on the letter part for the column index; row from digits).
   - `t="s"` → `<v>` is an index into shared strings; `t="str"`/formula string → literal;
     `t="b"` → boolean; no `t` → number. `t="inlineStr"` uses `<is><t>text</t></is>`.
   - `s` = index into `<cellXfs>` in styles.xml (the key to fills).
   - Rows: `<row r="4">…</row>` — trust `r` attributes rather than positional counting, and
     fill gaps with empty cells so the grid aligns.
2. **Shared strings** — `xl/sharedStrings.xml`: sequence of `<si>` entries; each is
   `<si><t>text</t></si>` or rich-text `<si><r><t>part</t></r>…</si>` (concatenate all `<t>`
   inside one `<si>`). Beware `<t xml:space="preserve">`. Decode the five XML entities
   (`&amp; &lt; &gt; &quot; &apos;` + numeric `&#…;`). Parse the whole file once per request,
   with regex/index scanning — no XML parser dependency exists, and none is allowed.
3. **Fills** — `xl/styles.xml`:
   - `<cellXfs>` holds `<xf … fillId="N" applyFill="1"/>` in order; cell `s` indexes into it.
   - `<fills>` holds `<fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/>…` in
     order; `fillId` indexes into it. FillIds 0 and 1 are Excel's reserved none/gray125 —
     treat as no color.
   - `fgColor` may carry `rgb="AARRGGBB"` (strip the alpha, emit `#RRGGBB`),
     `indexed="N"` (map via the standard 64-entry indexed palette — hardcode the classic
     table), or `theme="N"` (+ optional `tint`) which needs `xl/theme/theme1.xml`. **Ship
     rgb + indexed first; theme colors are best-effort fallback** (see risks). A cell whose
     fill you can't resolve simply gets no `c` — never crash on it.
4. Compute per-sheet totals from the `<dimension>` tag (already parsed in `xlsxInfo`) for the
   `totalRows`/`totalCols` fields.

Keep `/api/files/xlsx` (metadata) as-is — the UI still uses it for the sheet list.

### 3b. UI — replace the xlsx expand branch with a real grid

In `claude-dashboard/assets/files.js`, `expandCard()`'s `kind === 'xlsx'` branch (currently
just badge pills) becomes:

1. Fetch `/api/files/xlsx?name=…` for the sheet list (keep the count pill, fine).
2. Render sheet tabs (one per sheet, active state styled with the amber accent) + a grid
   container. Load sheet 0 immediately via `/api/files/xlsx/cells?name=…&sheet=0`.
3. Grid renderer: build a `<table>` inside a scroll wrapper. Reuse the existing
   `.dv-tablewrap` / `.dv-table` look (style.css lines ~470-476) as the base but add a
   dedicated class (e.g. `.sheet-grid`) because you need per-cell inline
   `style="background:#c6efce"` fills, a sticky header row (`position:sticky;top:0`), and an
   optional row-number gutter column. Escape every cell value with `esc()` — colors are the
   ONLY inline style you inject, and validate them server- or client-side against
   `/^#[0-9a-fA-F]{6}$/` before injection.
4. Cell text: JetBrains Mono (`var(--font-mono)`), ~12px, right-align numbers if cheap to
   detect, otherwise left-align everything — don't over-engineer.
5. Dark-theme contrast: Excel status fills are pastel (light green `#c6efce`, light red
   `#ffc7ce`, amber `#ffeb9c`) on a dark UI. Either render colored cells with dark text
   (`color:#1a1a1a` on any cell that has a fill) or apply the fill as a strong left-border +
   translucent background. Pick whichever reads better in the screenshot — readable beats
   faithful.
6. Truncation pill above the grid when `truncated` (mirror the existing "large file — showing
   the first 800 KB" pattern at files.js line ~152).
7. Sheet switching: cache each fetched sheet's HTML on the card (e.g.
   `body.dataset` or a JS map keyed by card+sheet) so tab flips don't refetch; show the
   Loading… muted div during fetch; on error show the `.pill err` pattern already used.

`assets/files.js` is 285 lines; the grid + tabs will likely push it past 500. If so, split
the spreadsheet renderer into **`assets/sheetgrid.js`** and add a `<script>` tag for it in
`claude-dashboard/index.html` (load order: before or after `files.js` doesn't matter if you
expose a global function like `renderSheetGrid` — match how the other asset modules share
globals; there is no module system).

### 3c. Styling

Add a `.sheet-grid` block to `claude-dashboard/assets/style.css` near the existing
`.dv-table` rules: sticky `<th>` header (bg `var(--panel2)`, amber text like `.dv-table th`),
1px `var(--line)` gridlines on every cell, `max-height` on the wrapper (the card body already
caps at `60vh` and scrolls — line ~420 — so keep the grid inside that), sheet-tab pills
(active = amber border/text like the app's existing pill idiom). Consult
`.claude/skills/ui-design/` conventions; no new fonts, no CDNs.

## 4. Files to touch

| File | Why |
|---|---|
| `claude-dashboard/lib/xlsxcells.js` (NEW) | Cell-value + sharedStrings + styles/fill parser; keeps `lib/files.js` under 500 lines |
| `claude-dashboard/lib/files.js` | New `GET /api/files/xlsx/cells` route wired to `inboxFile()` + the new module; export zip helpers if the new module reuses them |
| `claude-dashboard/assets/files.js` | Replace the xlsx expand branch: sheet tabs + grid load/cache logic |
| `claude-dashboard/assets/sheetgrid.js` (NEW, only if files.js would cross 500 lines) | Grid renderer |
| `claude-dashboard/index.html` | `<script>` tag for sheetgrid.js (only if created) |
| `claude-dashboard/assets/style.css` | `.sheet-grid`, sheet tabs, colored-cell contrast rules |
| `scripts/verify-dashboard.ps1` | Add a probe: GET `/api/files/xlsx/cells` for an inbox xlsx (or a 404/400 shape check if none present) |

Note: `assets/files.js`, `lib/files.js`, and `style.css` have uncommitted modifications in
the working tree (the card-expand feature just landed) and the user fires parallel
acceptEdits runs from the dashboard — **read current file state before every edit, and
reconcile rather than clobber** if something changed underneath you.

## 5. Test plan

```powershell
# 1. Syntax
node --check claude-dashboard/lib/files.js
node --check claude-dashboard/lib/xlsxcells.js
node --check claude-dashboard/assets/files.js   # and sheetgrid.js if created

# 2. Throwaway instance (NOT 5757)
node claude-dashboard/server.js 5758   # run in background

# 3. Endpoint probes
#    - metadata still works:
#      curl http://127.0.0.1:5758/api/files/xlsx?name=CrossreferenceV10.xlsx
#    - cells: expect rows[][] with v (+ c on colored cells), truncated:true, shownRows<=200
#      curl "http://127.0.0.1:5758/api/files/xlsx/cells?name=CrossreferenceV10.xlsx&sheet=0"
#    - traversal guard: name=../../server.js must 404, sheet=999 must 400/clamp

# 4. Smoke
scripts/verify-dashboard.ps1 -Port 5758

# 5. Browser verify (browser-qa skill / screenshot tooling): open
#    http://127.0.0.1:5758 → Files tab → expand CrossreferenceV10.xlsx →
#    screenshot showing the value grid with green/amber/red fills and the sheet tabs;
#    switch sheets; confirm the truncation pill wording.

# 6. Stop the 5758 instance. Leave 5757 untouched. Commit.
```

## 6. Risks / gotchas

- **xlsx color model is three-headed:** `rgb` (direct ARGB — easy), `indexed` (legacy
  64-color palette — hardcode the table), `theme` + `tint` (requires `xl/theme/theme1.xml`
  `<a:clrScheme>` lookup plus a tint transform). **Acceptable to ship rgb + indexed and
  treat theme as best-effort** (attempt the theme1.xml srgbClr lookup, skip the tint math or
  approximate; if unresolved, emit no color). Verify which model CrossreferenceV10 actually
  uses early — probe the endpoint and check that colored cells come back with `c` before
  polishing the UI.
- **Conditional formatting is NOT cell fills.** If the workbook's green/amber/red comes from
  `<conditionalFormatting>` rules instead of static fills, `s`/fillId will yield nothing.
  Check for this immediately (grep the sheet XML for `<conditionalFormatting`). Evaluating CF
  rules is out of scope — if that's the case, render the value grid without colors, note it in
  the truncation-pill area ("colors are conditional-format rules — not shown"), and say so in
  your report. Do not fake colors.
- **Big sheets / memory:** the whole zip is read into memory (existing pattern, fine at the
  50 MB inbox cap), but the inflated sheet XML can be much larger — keep the existing 40 MB
  usize bail, and stop scanning rows at the cap instead of materializing everything.
- **styles.xml or sharedStrings.xml may be absent** (some generators omit them). Every lookup
  must null-safe to "no color" / raw `<v>` text — never 500 on a weird-but-valid workbook.
- **Merged cells** (`<mergeCells>`): ignoring them is fine — the value sits in the top-left
  cell and other cells render empty. Don't implement spans.
- **Sparse rows/columns:** cells and rows are omitted when empty; align strictly by the `r`
  attributes or the grid will shear.
- **Dates render as serial numbers** (numFmt handling is out of scope). Acceptable — note it,
  don't fix it.
- **XSS surface:** cell values are attacker-ish input (uploaded files) — `esc()` every value;
  fill colors go through the `#RRGGBB` regex before touching `style=`.
- The bar is a **readable, color-hinted grid**, not Excel parity. When in doubt, cut scope
  toward "user can see values + status colors and switch sheets."

## After shipping

Update `HANDOFF.md` and `docs/roadmap.md` (the Files-tab preview entry) to reflect the shipped
grid, and append the result to the current autonomy log if this ran under the autonomy loop.
Commit message style: `files: xlsx cell-grid preview (values + fill colors, sheet tabs)`.

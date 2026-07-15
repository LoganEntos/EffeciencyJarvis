/* Projects tab — the SharePoint file-transfer prompt panel.
   Split out of projects.js to keep that file under the 500-line rule. Provides
   the default "transfer process" prompt + its editable, persisted panel; wired
   from renderers.projects (assets/projects.js) via renderXfer(). The panel is a
   plain <textarea> so the user copies AND edits the prompt in place; edits
   persist to localStorage so tweaks survive reloads. */
'use strict';

// Paste into a project run to pull that project's real source files out of
// SharePoint (discovery via the hub's index, never the live tenant) into
// data/inbox/<slug>/, which the tab reads as the project's files.
const XFER_KEY = 'hub.projects.transferPrompt';
const DEFAULT_TRANSFER_PROMPT = `Attach this project's real source files by pulling them from SharePoint into the project's knowledge folder. Do discovery against the hub's SharePoint index — never enumerate the live tenant.

TARGET (edit per project — slug → the exact filenames named in that project's attached spec):
  • <project-slug>
      - <File A named in the spec's "Knowledge Files">
      - <File B …>

PROCEDURE
1. Read the project's instruction set + attached .md spec first; treat the spec's "Knowledge Files" list as the manifest of exactly what to fetch.
2. Confirm the index is fresh: GET /api/sharepoint/index/status. If it's missing or stale, say so and stop — do NOT hit the live tenant to work around it.
3. For each named file, search the index (data/sharepoint-index.json or /api/sharepoint/index/search?q=…) with 2–4 keywords from the filename. Disambiguate by webUrl PATH + newest lastModified, and honor the spec's warnings: prefer the current-version / canonical-site copy and REJECT stale same-named copies in archive folders.
4. Pull each confirmed match into the project:
   POST /api/sharepoint/pull { drive:<driveId>, item:<itemId>, project:"<project-slug>" }  (include the X-Hub-Token header).
   That writes it to data/inbox/<project-slug>/ — exactly what the Projects tab shows as the project's files. No move needed after.
5. Report a per-project manifest, plain text: file → ✓ saved (size) / ⚠ ambiguous (list candidate paths, pull none) / ✗ not in index. Never fabricate a match or pull a near-name.

RULES: read-only against the tenant except the pull writes; skip anything already in the project folder; nothing over the 50 MB pull cap; if a file isn't in the index, flag the gap — don't guess.`;
const xferGet = () => { try { return localStorage.getItem(XFER_KEY) ?? DEFAULT_TRANSFER_PROMPT; } catch { return DEFAULT_TRANSFER_PROMPT; } };
const xferSet = v => { try { localStorage.setItem(XFER_KEY, v); } catch {} };

// One shared prompt (not per-project) — it IS the transfer process; you tweak
// the slug/filenames per run before pasting.
function renderXfer() {
  const box = $('#pXferPanel'); if (!box) return;
  if (!projShowXfer) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div class="xfer">
      <div class="psection">
        <span class="name">⧉ SharePoint file-transfer prompt
          <span class="muted" style="font-weight:400;font-size:11.5px">— paste into a project run to pull its files from SharePoint · edits saved automatically</span></span>
        <span class="flex" style="gap:8px">
          <button id="xCopy" style="padding:5px 13px;font-size:11.5px">Copy</button>
          <button id="xReset" class="ghost" style="padding:5px 11px;font-size:11px">Reset to default</button>
        </span>
      </div>
      <textarea id="xText" class="xfertext" spellcheck="false">${esc(xferGet())}</textarea>
      <div id="xToast" class="muted" style="font-size:11.5px;min-height:16px;margin-top:4px"></div>
    </div>`;
  const ta = $('#xText'), toast = m => { const t = $('#xToast'); if (t) { t.textContent = m; setTimeout(() => { if (t.textContent === m) t.textContent = ''; }, 1600); } };
  ta.oninput = () => xferSet(ta.value);
  $('#xCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(ta.value); toast('Copied ✓'); }
    catch { ta.select(); try { document.execCommand('copy'); toast('Copied ✓'); } catch { toast('Select-all + Ctrl-C to copy'); } }
  };
  $('#xReset').onclick = () => { xferSet(DEFAULT_TRANSFER_PROMPT); ta.value = DEFAULT_TRANSFER_PROMPT; toast('Reset to default'); };
}

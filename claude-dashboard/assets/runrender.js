/* Run-tab render layer: turns raw stream-json / stderr into chat-log DOM.
   Split out of run.js (C-rule: keep files <500 lines). These are called at
   runtime, so they safely reference run.js globals (chat) and util globals
   (esc, $) regardless of script load order. */
'use strict';

function mdToHtml(text) {
  let s = esc(text);
  const blocks = [];
  s = s.replace(/```\w*\r?\n?([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre>${code.replace(/\s+$/, '')}</pre>`);
    return '\u0000' + (blocks.length - 1) + '\u0000';
  });
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/^#{1,4}\s+(.+)$/gm, '<b class="mdh">$1</b>');
  s = s.replace(/^[-*]\s+/gm, '• ');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a class="link" href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
  return s;
}

// ---- chat log helpers ----
function nearBottom(el) { return el.scrollHeight - el.scrollTop - el.clientHeight < 80; }
function addEl(html, cls) {
  const log = $('#chatLog');
  const stick = nearBottom(log);
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.innerHTML = html;
  log.appendChild(div);
  if (stick) log.scrollTop = log.scrollHeight;
  return div;
}
const addMsg = (text, cls) => addEl(esc(text), 'msg ' + cls);

const toolEls = {}; // tool_use id -> <pre> that receives the tool result

// Copy button — hover-visible, positioned absolute inside .msg.assistant.
// getTextFn is either a string (static) or () => string (live for streaming).
const _COPY_ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const _CHK_ICON  = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
function addCopyBtn(el, getTextFn) {
  const btn = document.createElement('button');
  btn.className = 'msg-copy'; btn.title = 'Copy';
  btn.innerHTML = _COPY_ICON;
  btn.onclick = () => {
    const txt = typeof getTextFn === 'function' ? getTextFn() : String(getTextFn || '');
    navigator.clipboard.writeText(txt).then(() => {
      btn.innerHTML = _CHK_ICON; btn.title = 'Copied!';
      setTimeout(() => { btn.innerHTML = _COPY_ICON; btn.title = 'Copy'; }, 1500);
    }).catch(() => {});
  };
  el.appendChild(btn);
  return btn;
}
function excerpt(v, n) { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + '…' : s; }

// Turn a raw CLI stderr/crash dump into a one-line plain-English headline +
// a collapsed <pre> with the full text — so a Node stack trace doesn't read
// as an illegible wall of "at Object.<anonymous>" noise in the chat log.
function summarizeError(raw) {
  const text = (raw || '').trim();
  if (!text) return 'The command failed with no output.';
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const first = lines[0] || text;
  if (/ENOENT/.test(text)) return "Couldn't find a file or program it needed — " + first;
  if (/EADDRINUSE/.test(text)) return 'That port is already in use by another process.';
  if (/EACCES|permission denied/i.test(text)) return "Permission denied — " + first;
  if (/is not recognized as an internal or external command|command not found/i.test(text)) return 'A required program is missing from PATH — ' + first;
  if (/^(\w*Error|Exception):/.test(first) || /Error:/.test(first)) return first.replace(/^\s*at\s+/, '');
  return first.length > 140 ? first.slice(0, 140) + '…' : first;
}
function errBlock(raw) {
  const headline = esc(summarizeError(raw));
  const full = esc(excerpt(raw, 6000));
  return `<div class="errhead">✗ ${headline}</div>
    <details><summary>show full error</summary><pre>${full}</pre></details>`;
}

// Render one stream-json line into the chat log. Returns the result meta if
// this line was the final result event.
function renderLine(o) {
  if (!o || typeof o !== 'object') return null;
  if (o.type === 'system' && o.subtype === 'init') {
    addMsg(`session ${o.session_id || '?'} · model ${o.model || '?'} · ${(o.tools || []).length} tools`, 'sys');
    return null;
  }
  if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
    for (const b of o.message.content) {
      if (!b) continue;
      if (b.type === 'text' && b.text && b.text.trim()) {
        const rawTxt = b.text.trim(); chat.lastText = rawTxt;
        const msgEl = addEl(mdToHtml(rawTxt), 'msg assistant');
        addCopyBtn(msgEl, rawTxt);
        // live runs only (never history replays): voice the reply as it streams
        if (chat.running && window.HubVoice && HubVoice.onAssistantText) HubVoice.onAssistantText(chat.lastText);
      }
      else if (b.type === 'tool_use') {
        // hermes ACP tool calls carry a human title in input.title; prefer it
        const summ = (b.input && b.input.title) ? b.input.title : excerpt(b.input || {}, 90);
        const el = addEl(`<details><summary>⚒ ${esc(b.name || 'tool')} <span class="muted">${esc(summ)}</span></summary>
          <pre>${esc(JSON.stringify(b.input || {}, null, 2))}</pre></details>`, 'toolblk');
        if (b.id) toolEls[b.id] = el.querySelector('pre');
        chat.hermesEl = null; // a tool block ends the current hermes text bubble
      }
    }
    return null;
  }
  if (o.type === 'user' && o.message && Array.isArray(o.message.content)) {
    for (const b of o.message.content) {
      if (b && b.type === 'tool_result' && b.tool_use_id && toolEls[b.tool_use_id]) {
        const txt = Array.isArray(b.content)
          ? b.content.filter(c => c && c.type === 'text').map(c => c.text).join('\n')
          : (typeof b.content === 'string' ? b.content : JSON.stringify(b.content));
        if (txt) toolEls[b.tool_use_id].textContent += '\n── result ──\n' + excerpt(txt, 3000);
      }
    }
    return null;
  }
  if (o.type === 'result') {
    const secs = o.duration_ms ? (o.duration_ms / 1000).toFixed(1) + 's' : '';
    const turns = o.num_turns ? o.num_turns + ' turns' : '';
    const tok = o.usage ? `${(o.usage.input_tokens || 0) + (o.usage.cache_read_input_tokens || 0) + (o.usage.cache_creation_input_tokens || 0)}→${o.usage.output_tokens || 0} tok` : '';
    const ok = o.subtype === 'success';
    addMsg(`${ok ? '✓ done' : '✗ ' + (o.subtype || 'error')} ${[secs, turns, tok].filter(Boolean).join(' · ')}`, ok ? 'result' : 'errmsg');
    if (!ok && o.result) addEl(errBlock(o.result), 'errblk');
    return o;
  }
  if (o.type === 'hub_stderr') { addEl(errBlock(o.text), 'errblk'); return null; }
  if (o.type === 'hub_status') { addMsg(o.text, 'sys'); return null; }
  if (o.type === 'hermes_log') {
    // live activity tailed from hermes's own log — -z streams no tool events,
    // so this is the window into what the run is actually doing right now.
    addEl(`<span class="logdot">›</span> ${esc(o.text)}`, 'logline');
    return null;
  }
  if (o.type === 'hermes_out' || o.type === 'hermes_text') {
    // hermes agent text — grow into ONE assistant bubble. -z (hermes_out) sent
    // whole lines; ACP (hermes_text) sends streaming chunks, so concatenate raw
    // for chunks and newline-join for legacy lines.
    if (!chat.hermesEl || !chat.hermesEl.isConnected) {
      chat.hermesEl = addEl('', 'msg assistant'); chat.hermesText = ''; chat.hermesCpBtn = null;
    }
    chat.hermesText += o.type === 'hermes_text' ? o.text : ((chat.hermesText ? '\n' : '') + o.text);
    chat.hermesEl.innerHTML = mdToHtml(chat.hermesText);
    // Re-append copy button after each innerHTML reset (streaming overwrites it);
    // create it once and reuse the same element so onclick captures hermesText live.
    if (!chat.hermesCpBtn) chat.hermesCpBtn = addCopyBtn(chat.hermesEl, () => chat.hermesText);
    else chat.hermesEl.appendChild(chat.hermesCpBtn);
    chat.lastText = chat.hermesText.trim(); // feeds voice talk-back like claude runs
    return null;
  }
  if (o.type === 'hermes_thought') { // ACP agent_thought_chunk — dim, ambient
    addEl(`<span class="logdot">💭</span> ${esc(o.text)}`, 'logline thought');
    return null;
  }
  if (o.type === 'hermes_plan') { // ACP plan update — render as a checklist
    const rows = (o.entries || []).map(e => {
      const icon = e.status === 'completed' ? '✅' : (e.status === 'in_progress' ? '🔄' : '⏳');
      return `${icon} ${esc(e.content || '')}`;
    }).join('<br>');
    if (rows) addEl(`<b>plan</b><br>${rows}`, 'msg sys planblk');
    return null;
  }
  return null;
}

// ---- project-run file manifest (data/todos/projects.md, 2026-07-30) ----
// Every project-bound run's meta.json carries meta.projectFiles ({name,ext,
// size}[], up to 50) captured at dispatch time — the same list the manifest
// text handed to Claude. Surface it as a click-to-expand toggle appended onto
// the "▤ project: …" hub_status line already replayed above (lib/runs.js),
// reusing the Projects tab's .pmanifest visual language (projects.css)
// instead of a new panel. Gate visibility on meta.project (not
// projectFiles.length — that array is [] both when no project is bound AND
// when one is bound with an empty manifest); undefined projectFiles
// (pre-2026-07-30 runs) renders nothing, and a missing anchor line (older
// runs, or non-project runs) is a silent no-op — never throws.
function appendProjectFilesToggle(meta) {
  if (!meta || !meta.project || !Array.isArray(meta.projectFiles)) return;
  const log = $('#chatLog');
  if (!log) return;
  let host = null;
  for (const el of log.querySelectorAll('.msg.sys')) {
    if (el.textContent.startsWith('▤ project:')) host = el; // last match wins (there's only ever one)
  }
  if (!host || host.querySelector('.pf-toggle')) return; // no anchor line, or already attached
  const files = meta.projectFiles, n = files.length;
  const btn = document.createElement('button');
  btn.className = 'ghost pf-toggle';
  btn.style.cssText = 'padding:2px 8px;font-size:10px;margin-left:8px;vertical-align:1px';
  btn.textContent = n ? `${n} file${n === 1 ? '' : 's'}` : '0 files';
  btn.setAttribute('aria-expanded', 'false');
  const box = document.createElement('div');
  box.className = 'pmanifest hidden';
  // textContent, not innerHTML — no esc() needed, and no markup can leak through file names.
  box.textContent = n
    ? files.map(f => `${f.name || '(unnamed)'} · ${fmtBytes(f.size)}`).join('\n')
    : '(project manifest was empty at dispatch time)';
  btn.onclick = () => {
    const hidden = box.classList.toggle('hidden');
    btn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
  };
  host.appendChild(btn);
  host.appendChild(box);
}

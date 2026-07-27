/*
 * SharePoint bridge — zero-dep Microsoft Graph client.
 *
 * Auth is OAuth device-code flow: the hub shows a short code, the USER signs
 * in at microsoft.com/devicelogin in their own browser — the hub never sees
 * or handles the password. Tokens (access + refresh) cache in
 * data/sharepoint-auth.json (data/ is gitignored).
 *
 * Endpoints: status/config/auth, live browse (sites → drives → folders),
 * pull (SharePoint file → inbox, optional project folder), push (inbox file →
 * SharePoint folder), and a full-tenant INDEX built via drive delta crawls
 * (data/sharepoint-index.json) so runs can answer "where is X / what exists"
 * without calling Graph or re-scanning directories every time.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const U = require('./util');

const DASH_DIR = path.resolve(__dirname, '..');
const DATA = path.join(DASH_DIR, 'data');
const AUTH_FILE = path.join(DATA, 'sharepoint-auth.json');
const CFG_FILE = path.join(DATA, 'sharepoint.json');
const INDEX_FILE = path.join(DATA, 'sharepoint-index.json');
const GRAPHIFY_FILE = path.join(DATA, 'sharepoint-graphify.json');
const INBOX = path.join(DATA, 'inbox');
const MAX_PULL = 50 * 1024 * 1024; // match the inbox upload cap

// Microsoft Graph Command Line Tools — a Microsoft first-party PUBLIC client
// (no secret exists) with device-code flow enabled in every tenant that hasn't
// explicitly blocked it. A custom app registration can be pasted in Config.
const DEFAULT_CLIENT = '14d82eec-204b-4c2f-b7e8-296a70dab67e';
const SCOPES = 'offline_access User.Read Sites.Read.All Files.ReadWrite.All';
const GRAPH = 'https://graph.microsoft.com/v1.0';

const cfg = () => Object.assign({ tenant: 'organizations', clientId: DEFAULT_CLIENT }, U.safeJson(CFG_FILE) || {});

// ---- tiny https helpers (built-ins only) ----------------------------------
function request(method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request({ method, hostname: u.hostname, path: u.pathname + u.search, headers }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject); // conn drop mid-response (VPN/proxy RST) else crashes the hub
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(new Error('graph request timeout')); });
    if (body) req.write(body);
    req.end();
  });
}
async function postForm(urlStr, params) {
  const body = new URLSearchParams(params).toString();
  const r = await request('POST', urlStr, { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }, body);
  try { return { status: r.status, json: JSON.parse(r.body.toString('utf8')) }; }
  catch { return { status: r.status, json: {} }; }
}
// pre-authed @microsoft.graph.downloadUrl (no bearer needed), capped
function download(urlStr, cap, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error('too many redirects'));
    https.get(urlStr, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(res.headers.location, cap, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('download HTTP ' + res.statusCode)); }
      const chunks = []; let size = 0;
      res.on('data', d => {
        size += d.length;
        if (size > cap) { res.destroy(); return reject(new Error('file exceeds the 50 MB pull cap')); }
        chunks.push(d);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ---- token cache + device-code flow ----------------------------------------
let device = null; // in-flight device login: { user_code, verification_uri, expiresAt, timer, error }
const loadAuth = () => U.safeJson(AUTH_FILE);
function saveAuth(tok) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(tok, null, 2));
}
async function refresh(auth) {
  const c = cfg();
  const r = await postForm(`https://login.microsoftonline.com/${encodeURIComponent(c.tenant)}/oauth2/v2.0/token`, {
    grant_type: 'refresh_token', client_id: c.clientId, refresh_token: auth.refresh_token, scope: SCOPES,
  });
  if (!r.json.access_token) return null;
  const next = { access_token: r.json.access_token, refresh_token: r.json.refresh_token || auth.refresh_token,
    expires_at: Date.now() + (r.json.expires_in || 3600) * 1000 - 60000, account: auth.account || null };
  saveAuth(next);
  return next;
}
async function accessToken() {
  let auth = loadAuth();
  if (!auth || !auth.refresh_token) return null;
  if (!auth.access_token || Date.now() > (auth.expires_at || 0)) auth = await refresh(auth);
  return auth && auth.access_token || null;
}
async function startDeviceLogin() {
  const c = cfg();
  if (device && device.timer) { clearInterval(device.timer); }
  const r = await postForm(`https://login.microsoftonline.com/${encodeURIComponent(c.tenant)}/oauth2/v2.0/devicecode`, {
    client_id: c.clientId, scope: SCOPES,
  });
  if (!r.json.device_code) return { error: r.json.error_description || 'device-code request failed — check tenant/clientId in the config' };
  // Capture per-flow state locally so a concurrent startDeviceLogin (double-click,
  // no client-side disable) can't make this tick read/clear a sibling flow's timer.
  const mine = device = {
    user_code: r.json.user_code, verification_uri: r.json.verification_uri || 'https://microsoft.com/devicelogin',
    expiresAt: Date.now() + (r.json.expires_in || 900) * 1000, error: null, timer: null,
  };
  const dc = r.json.device_code, interval = Math.max(r.json.interval || 5, 5) * 1000;
  const myTimer = mine.timer = setInterval(async () => {
    if (device !== mine) { clearInterval(myTimer); return; } // superseded by a newer flow — stop polling
    if (Date.now() > mine.expiresAt) { clearInterval(myTimer); mine.error = 'code expired — start again'; return; }
    try {
      const t = await postForm(`https://login.microsoftonline.com/${encodeURIComponent(c.tenant)}/oauth2/v2.0/token`, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: c.clientId, device_code: dc,
      });
      if (device !== mine) { clearInterval(myTimer); return; } // await may have straddled a supersession
      if (t.json.access_token) {
        clearInterval(myTimer);
        saveAuth({ access_token: t.json.access_token, refresh_token: t.json.refresh_token,
          expires_at: Date.now() + (t.json.expires_in || 3600) * 1000 - 60000, account: null });
        try {
          const me = await g('/me?$select=displayName,userPrincipalName');
          const auth = loadAuth();
          auth.account = me.userPrincipalName || me.displayName || 'signed in';
          saveAuth(auth);
        } catch {}
        if (device === mine) device = null;
      } else if (t.json.error && t.json.error !== 'authorization_pending' && t.json.error !== 'slow_down') {
        clearInterval(myTimer); mine.error = t.json.error_description || t.json.error;
      }
    } catch {}
  }, interval);
  return { user_code: mine.user_code, verification_uri: mine.verification_uri };
}

// ---- Graph calls ------------------------------------------------------------
async function g(p, method = 'GET', bodyObj = null, ctype = 'application/json') {
  const tok = await accessToken();
  if (!tok) { const e = new Error('not signed in'); e.status = 401; throw e; }
  const urlStr = p.startsWith('http') ? p : GRAPH + p;
  const headers = { Authorization: 'Bearer ' + tok };
  let body = null;
  if (bodyObj !== null) {
    body = Buffer.isBuffer(bodyObj) ? bodyObj : Buffer.from(JSON.stringify(bodyObj));
    headers['Content-Type'] = ctype; headers['Content-Length'] = body.length;
  }
  const r = await request(method, urlStr, headers, body);
  let json = {}; try { json = JSON.parse(r.body.toString('utf8')); } catch {}
  if (r.status >= 400) {
    const e = new Error((json.error && json.error.message) || ('Graph HTTP ' + r.status));
    e.status = r.status; throw e;
  }
  return json;
}
// Graph ids (site: host,guid,guid · drive: b!… · item: 01…) — allow their exact
// alphabet, nothing shell- or path-meaningful beyond it.
const okId = s => typeof s === 'string' && /^[A-Za-z0-9!,._%-]{1,300}$/.test(s);

const mapItem = it => ({
  id: it.id, name: it.name, folder: !!it.folder, childCount: it.folder ? it.folder.childCount : undefined,
  size: it.size || 0, modified: it.lastModifiedDateTime || null, webUrl: it.webUrl || null,
});

// ---- full-tenant index (delta crawl) ---------------------------------------
// Cache the parsed index keyed by file mtime: searchIndex fires per debounced
// keystroke and the status poll hits every 3s during device-code login, so
// re-parsing a multi-MB JSON several times a second stalls live SSE streams.
// A stat() is cheap; JSON.parse of megabytes is not. Invalidated on mtime change
// (buildIndex() rewrites the file) — see the explicit reset after writeFileSync.
let idxCache = { mtimeMs: -1, data: null };
function loadIndex() {
  let st; try { st = fs.statSync(INDEX_FILE); } catch { idxCache = { mtimeMs: -1, data: null }; return null; }
  if (st.mtimeMs === idxCache.mtimeMs) return idxCache.data;
  const data = U.safeJson(INDEX_FILE);
  idxCache = { mtimeMs: st.mtimeMs, data };
  return data;
}
let crawl = { running: false, phase: 'idle', sites: 0, drives: 0, files: 0, folders: 0, error: null, startedAt: null };
async function buildIndex() {
  if (crawl.running) return;
  crawl = { running: true, phase: 'listing sites', sites: 0, drives: 0, files: 0, folders: 0, error: null, startedAt: Date.now() };
  try {
    const sites = (await g("/sites?search=*&$select=id,displayName,webUrl")).value || [];
    const out = { builtAt: new Date().toISOString(), sites: [] };
    for (const s of sites) {
      crawl.sites++;
      const siteOut = { id: s.id, name: s.displayName, webUrl: s.webUrl, drives: [] };
      let drives = [];
      try { drives = (await g(`/sites/${encodeURIComponent(s.id)}/drives?$select=id,name,webUrl`)).value || []; } catch {}
      for (const d of drives) {
        crawl.drives++;
        crawl.phase = `crawling ${s.displayName} / ${d.name}`;
        const files = [];
        let url = `/drives/${encodeURIComponent(d.id)}/root/delta?$select=id,name,size,file,folder,parentReference,lastModifiedDateTime&$top=500`;
        while (url) {
          let page;
          try { page = await g(url); } catch (e) { crawl.phase += ` (skipped: ${e.message})`; break; }
          for (const it of page.value || []) {
            const parent = ((it.parentReference || {}).path || '').split('root:')[1] || '';
            if (it.folder) { crawl.folders++; continue; } // folders are implicit in paths
            if (!it.file) continue;
            crawl.files++;
            files.push({ p: decodeURIComponent(parent) + '/' + it.name, s: it.size || 0, m: (it.lastModifiedDateTime || '').slice(0, 10), id: it.id });
          }
          url = page['@odata.nextLink'] || null;
        }
        siteOut.drives.push({ id: d.id, name: d.name, webUrl: d.webUrl, fileCount: files.length, files });
      }
      out.sites.push(siteOut);
    }
    out.counts = { sites: crawl.sites, drives: crawl.drives, files: crawl.files, folders: crawl.folders };
    out.durationMs = Date.now() - crawl.startedAt;
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(INDEX_FILE, JSON.stringify(out));
    idxCache = { mtimeMs: -1, data: null }; // force reparse on next read of the fresh index
    crawl.phase = 'done';
  } catch (e) { crawl.error = e.message; crawl.phase = 'error'; }
  crawl.running = false;
}
function indexStats() {
  const idx = loadIndex();
  if (!idx) return null;
  return { builtAt: idx.builtAt, counts: idx.counts, durationMs: idx.durationMs, file: 'claude-dashboard/data/sharepoint-index.json' };
}
// Offline BREAKDOWN — navigate the static index as a tree, no Graph calls.
function indexTree() {
  const idx = loadIndex();
  if (!idx) return { error: 'no index yet — build it first' };
  return {
    builtAt: idx.builtAt,
    sites: (idx.sites || []).map(s => ({
      name: s.name, webUrl: s.webUrl,
      drives: (s.drives || []).map(d => ({ id: d.id, name: d.name, fileCount: (d.files || []).length })),
    })).filter(s => s.drives.some(d => d.fileCount)),
  };
}
function browseIndex(driveId, prefix) {
  const idx = loadIndex();
  if (!idx) return { error: 'no index yet — build it first' };
  let drive = null, siteName = '';
  for (const s of idx.sites || []) for (const d of s.drives || []) if (d.id === driveId) { drive = d; siteName = s.name; }
  if (!drive) return { error: 'drive not in index' };
  let pre = '/' + (prefix || '').replace(/^\/+|\/+$/g, '');
  if (pre !== '/') pre += '/';
  const folders = new Map(), files = [];
  for (const f of drive.files || []) {
    if (!f.p.startsWith(pre)) continue;
    const rest = f.p.slice(pre.length), slash = rest.indexOf('/');
    if (slash >= 0) { const n = rest.slice(0, slash); folders.set(n, (folders.get(n) || 0) + 1); }
    else files.push({ name: rest, path: f.p, size: f.s, modified: f.m, id: f.id, driveId: drive.id });
  }
  return {
    site: siteName, drive: drive.name, prefix: pre === '/' ? '' : pre.replace(/^\/|\/$/g, ''),
    folders: [...folders].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
    files: files.sort((a, b) => a.name.localeCompare(b.name)),
  };
}
// Resolve a file's SharePoint webUrl on demand so the user can open it in
// Office/PDF web viewers without downloading (requires sign-in).
async function resolveWebUrl(driveId, itemId) {
  if (!okId(driveId) || !okId(itemId)) return { error: 'bad drive/item id' };
  const it = await g(`/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}?$select=webUrl,name`);
  return { webUrl: it.webUrl || null, name: it.name };
}
// Timestamp when a graphify pass was last kicked off from the tab.
function graphifyStamp() {
  const at = new Date().toISOString();
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(GRAPHIFY_FILE, JSON.stringify({ at }));
  return { at };
}
function graphifyInfo() { const j = U.safeJson(GRAPHIFY_FILE); return j && j.at ? { at: j.at } : null; }
function searchIndex(q) {
  const idx = loadIndex();
  if (!idx) return { error: 'no index yet — build it first' };
  const needle = (q || '').toLowerCase();
  if (!needle) return { hits: [] };
  const hits = [];
  for (const s of idx.sites || []) for (const d of s.drives || []) for (const f of d.files || []) {
    if (f.p.toLowerCase().includes(needle)) {
      hits.push({ site: s.name, drive: d.name, driveId: d.id, itemId: f.id, path: f.p, size: f.s, modified: f.m });
      if (hits.length >= 200) return { hits, truncated: true };
    }
  }
  return { hits };
}

// ---- pull / push ------------------------------------------------------------
const sanitizeSeg = n => {
  const b = path.basename((n || '').trim()).replace(/[^A-Za-z0-9 ._()\-\[\]]/g, '_');
  return (!b || b.startsWith('.')) ? null : b.slice(0, 150);
};
async function pull(driveId, itemId, project) {
  if (!okId(driveId) || !okId(itemId)) return { error: 'bad drive/item id' };
  const it = await g(`/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}?$select=id,name,size,content.downloadUrl`);
  if ((it.size || 0) > MAX_PULL) return { error: 'file exceeds the 50 MB pull cap' };
  const dlUrl = it['@microsoft.graph.downloadUrl'];
  if (!dlUrl) return { error: 'no download URL (is this a folder?)' };
  const name = sanitizeSeg(it.name);
  if (!name) return { error: 'unusable filename' };
  const proj = project ? sanitizeSeg(project) : null;
  const dir = proj ? path.join(INBOX, proj) : INBOX;
  fs.mkdirSync(dir, { recursive: true });
  const buf = await download(dlUrl, MAX_PULL);
  fs.writeFileSync(path.join(dir, name), buf);
  return { ok: true, saved: (proj ? proj + '/' : '') + name, size: buf.length };
}
async function push(name, driveId, parentId) {
  if (!okId(driveId) || !okId(parentId)) return { error: 'bad drive/parent id' };
  // name may be "project/file" — one level, both segments sanitized
  const segs = (name || '').split('/').map(sanitizeSeg);
  if (segs.some(s => !s) || segs.length > 2) return { error: 'bad inbox file name' };
  const full = path.join(INBOX, ...segs);
  let buf; try { buf = fs.readFileSync(full); } catch { return { error: 'inbox file not found' }; }
  const fname = segs[segs.length - 1];
  const base = `/drives/${encodeURIComponent(driveId)}/` + (parentId === 'root' ? 'root' : `items/${encodeURIComponent(parentId)}`);
  if (buf.length <= 4 * 1024 * 1024) {
    const it = await g(`${base}:/${encodeURIComponent(fname)}:/content`, 'PUT', buf, 'application/octet-stream');
    return { ok: true, name: it.name, webUrl: it.webUrl };
  }
  const sess = await g(`${base}:/${encodeURIComponent(fname)}:/createUploadSession`, 'POST', { item: { '@microsoft.graph.conflictBehavior': 'replace' } });
  const CHUNK = 8 * 1024 * 1024;
  let last = null;
  for (let off = 0; off < buf.length; off += CHUNK) {
    const part = buf.slice(off, Math.min(off + CHUNK, buf.length));
    const r = await request('PUT', sess.uploadUrl, {
      'Content-Length': part.length, 'Content-Range': `bytes ${off}-${off + part.length - 1}/${buf.length}`,
    }, part);
    if (r.status >= 400) return { error: 'chunk upload failed (HTTP ' + r.status + ')' };
    try { last = JSON.parse(r.body.toString('utf8')); } catch {}
  }
  return { ok: true, name: last && last.name || fname, webUrl: last && last.webUrl || null };
}

// ---- routes ------------------------------------------------------------------
async function handle(req, res, url) {
  const p = url.pathname;
  if (!p.startsWith('/api/sharepoint')) return false;
  const send = (o, c) => U.sendJson(res, o, c || 200);
  try {
    if (p === '/api/sharepoint/status' && req.method === 'GET') {
      const auth = loadAuth();
      send({
        authed: !!(auth && auth.refresh_token), account: auth && auth.account || null,
        tenant: cfg().tenant, clientId: cfg().clientId, customClient: cfg().clientId !== DEFAULT_CLIENT,
        pending: device ? { user_code: device.user_code, verification_uri: device.verification_uri, error: device.error } : null,
        index: indexStats(), crawl: crawl.running || crawl.phase !== 'idle' ? crawl : null,
        graphify: graphifyInfo(),
      });
    } else if (p === '/api/sharepoint/config' && req.method === 'POST') {
      const b = JSON.parse(await U.readBody(req, 4000) || '{}');
      const next = cfg();
      if (b.tenant && /^[a-z0-9.-]{2,80}$/i.test(b.tenant)) next.tenant = b.tenant;
      if (b.clientId && /^[a-f0-9-]{36}$/i.test(b.clientId)) next.clientId = b.clientId;
      fs.mkdirSync(DATA, { recursive: true });
      fs.writeFileSync(CFG_FILE, JSON.stringify({ tenant: next.tenant, clientId: next.clientId }, null, 2));
      send({ ok: true, tenant: next.tenant, clientId: next.clientId });
    } else if (p === '/api/sharepoint/auth/start' && req.method === 'POST') {
      send(await startDeviceLogin());
    } else if (p === '/api/sharepoint/logout' && req.method === 'POST') {
      try { fs.unlinkSync(AUTH_FILE); } catch {}
      if (device && device.timer) clearInterval(device.timer);
      device = null;
      send({ ok: true });
    } else if (p === '/api/sharepoint/sites' && req.method === 'GET') {
      const r = await g('/sites?search=*&$select=id,displayName,webUrl');
      send((r.value || []).map(s => ({ id: s.id, name: s.displayName, webUrl: s.webUrl })));
    } else if (p === '/api/sharepoint/drives' && req.method === 'GET') {
      const site = url.searchParams.get('site') || '';
      if (!okId(site)) return send({ error: 'bad site id' }, 400), true;
      const r = await g(`/sites/${encodeURIComponent(site)}/drives?$select=id,name,webUrl`);
      send((r.value || []).map(d => ({ id: d.id, name: d.name, webUrl: d.webUrl })));
    } else if (p === '/api/sharepoint/children' && req.method === 'GET') {
      const drive = url.searchParams.get('drive') || '', item = url.searchParams.get('item') || 'root';
      if (!okId(drive) || (item !== 'root' && !okId(item))) return send({ error: 'bad id' }, 400), true;
      const seg = item === 'root' ? 'root' : `items/${encodeURIComponent(item)}`;
      const r = await g(`/drives/${encodeURIComponent(drive)}/${seg}/children?$select=id,name,size,folder,file,webUrl,lastModifiedDateTime&$top=200&$orderby=name`);
      send((r.value || []).map(mapItem));
    } else if (p === '/api/sharepoint/index' && req.method === 'POST') {
      if (crawl.running) return send({ error: 'index build already running' }, 409), true;
      const tok = await accessToken();
      if (!tok) return send({ error: 'not signed in' }, 401), true;
      buildIndex(); // async; poll status
      send({ ok: true, started: true });
    } else if (p === '/api/sharepoint/index/status' && req.method === 'GET') {
      send({ crawl, index: indexStats() });
    } else if (p === '/api/sharepoint/index/search' && req.method === 'GET') {
      send(searchIndex(url.searchParams.get('q') || ''));
    } else if (p === '/api/sharepoint/index/tree' && req.method === 'GET') {
      send(indexTree());
    } else if (p === '/api/sharepoint/index/browse' && req.method === 'GET') {
      const drive = url.searchParams.get('drive') || '';
      if (!okId(drive)) return send({ error: 'bad drive id' }, 400), true;
      send(browseIndex(drive, url.searchParams.get('path') || ''));
    } else if (p === '/api/sharepoint/weburl' && req.method === 'GET') {
      send(await resolveWebUrl(url.searchParams.get('drive') || '', url.searchParams.get('item') || ''));
    } else if (p === '/api/sharepoint/graphify' && req.method === 'POST') {
      send(graphifyStamp());
    } else if (p === '/api/sharepoint/pull' && req.method === 'POST') {
      const b = JSON.parse(await U.readBody(req, 8000) || '{}');
      send(await pull((b.drive || '').toString(), (b.item || '').toString(), (b.project || '').toString()));
    } else if (p === '/api/sharepoint/push' && req.method === 'POST') {
      const b = JSON.parse(await U.readBody(req, 8000) || '{}');
      send(await push((b.name || '').toString(), (b.drive || '').toString(), (b.parent || '').toString()));
    } else {
      send({ error: 'not found' }, 404);
    }
  } catch (e) {
    send({ error: e.message }, e.status === 401 ? 401 : 500);
  }
  return true;
}

module.exports = { handle };

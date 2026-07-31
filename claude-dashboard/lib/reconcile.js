/*
 * Reconciliation — joins pairProject()'s local per-order state (lib/pairing.js)
 * against the offline SharePoint index (lib/sharepoint.js) to answer "does this
 * project's local inbox actually match what's upstream?" Read-only: opens no
 * PDF, calls no Graph endpoint, pulls no bytes — it only compares filenames/
 * paths already sitting in data/sharepoint-index.json against the local inbox
 * folder. It FLAGS, never pulls (see docs/jarvis-orchestrator-plan.md, "Gap G —
 * reconciliation design" for why: the existing "Sync now" manual click is
 * deliberately the only pull path, per the hub's no-client-data rule).
 *
 * normalizeOrderId is verified against the real 54-folder "Closed Order
 * History" tree: 47/54 resolve to exactly one candidate, 7 correctly land in
 * `ambiguous` (one multi-order batch folder, five 2023-era folders whose only
 * numeric fragment is a date-shaped 22.10/22.11, one confirmed no-PI domestic
 * order), and one duplicate-id collision (two folders both containing 22439)
 * is caught below and routed to ambiguous too, not silently overwritten.
 */
'use strict';
const pairing = require('./pairing');
const sharepoint = require('./sharepoint');

const STALE_MS = 2 * 24 * 60 * 60 * 1000; // ~2 days, advisory only

// A hub local order id is a 5-digit 22xxx number (matches every id already in
// use across this project: 22439, 22610-22613, 22355, 22358/22359, 22443, …),
// or one of the two 2022 pioneers VPP1/VPP2 (no 22xxx token at all). Token
// extraction is UNANCHORED (no word-boundary requirement) so glued forms match
// too (Inv22220, inv22157, E22082). A folder typically carries 2-3 numeric
// tokens (a supplier PO/reference number *and* the local order id), so "the
// distinct token set has exactly one member" is the disambiguator — not a
// token-shape regex.
const VPP_RE = /^VPP\d+/;
const ORDER_TOKEN_RE = /22\d{3}/g;
function normalizeOrderId(folderName) {
  const name = (folderName || '').toString();
  const vpp = name.match(VPP_RE);
  if (vpp) return vpp[0];
  const distinct = new Set(name.match(ORDER_TOKEN_RE) || []);
  return distinct.size === 1 ? [...distinct][0] : null;
}

// Subset of a pairProject() order row worth surfacing to a reconcile consumer
// — deliberately drops note/dup/duplicates (pairing-scan-internal detail); the
// reconcile `status` already communicates what pairing's `state` alone can't
// (upstream visibility), so those fields would just be noise here.
function shapeLocal(o) {
  return { state: o.state, pdfs: o.pdfs, csvs: o.csvs, authoritativePdf: o.authoritativePdf, decision: o.decision || null };
}

function reconcileProject(id) {
  // Lazy require: projects.js requires this module at load time (route wiring
  // in its handle()), so a top-level require('./projects') here would be
  // circular and see a half-built module.exports. By call time (a request has
  // arrived) both modules have finished loading — same pattern projects.js's
  // own allRuns() already uses to lazily require ./runs for the same reason.
  const projects = require('./projects');
  const p = projects.get((id || '').toString());
  if (!p) return { error: 'not found' };
  const sf = p.sharepointFolder;
  if (!sf || !sf.driveId || !sf.path) return { error: 'no SharePoint folder is bound to this project yet' };

  const stats = sharepoint.indexStats();
  if (!stats) return { error: 'no index yet — build it first' };

  const upstreamFiles = sharepoint.indexFilesUnder(sf.driveId, sf.path);

  // Group into depth-2 folders (<year>/<order-folder>) under the bound prefix
  // — NOT deepest-folder: order folders are not leaves (Confidential/Shipping
  // Docs/MBS Invoice/Inspection Reports subfolders sit under nearly every
  // order), so deepest-folder over-splits one order into many groups.
  const groups = new Map(); // "year/folderName" -> { year, folderName, orderId, files: [] }
  for (const f of upstreamFiles) {
    const segs = f.parent ? f.parent.split('/') : [];
    if (segs.length < 2) continue; // loose file directly under prefix/year — not inside an order folder
    const key = segs[0] + '/' + segs[1];
    let g = groups.get(key);
    if (!g) groups.set(key, g = { year: segs[0], folderName: segs[1], files: [] });
    g.files.push({ name: f.name, id: f.id, size: f.size, modified: f.modified });
  }

  // Resolve each group's order id, then find ids that 2+ folders collapsed to
  // (the confirmed 22439 collision between two 2026 folders is exactly this)
  // — those route to ambiguous too, not just folders with zero/multiple tokens.
  const byOrderId = new Map(); // orderId -> [group keys]
  for (const [key, g] of groups) {
    g.orderId = normalizeOrderId(g.folderName);
    if (g.orderId) {
      if (!byOrderId.has(g.orderId)) byOrderId.set(g.orderId, []);
      byOrderId.get(g.orderId).push(key);
    }
  }
  const collisions = new Set([...byOrderId].filter(([, keys]) => keys.length > 1).map(([oid]) => oid));

  const local = pairing.pairProject(p.slug);
  const localById = new Map(local.orders.map(o => [o.orderId, o]));

  const orders = [];
  const usedLocalIds = new Set();
  for (const g of groups.values()) {
    const ambiguous = !g.orderId || collisions.has(g.orderId);
    const orderId = ambiguous ? null : g.orderId;
    const upstream = { fileCount: g.files.length, files: g.files };
    let localOrder = null, status;
    if (ambiguous) {
      status = 'ambiguous';
    } else {
      localOrder = localById.get(orderId) || null;
      if (localOrder) { usedLocalIds.add(orderId); status = localOrder.state === 'complete' ? 'complete' : 'local-incomplete'; }
      else status = 'upstream-only';
    }
    // §1 spec: an ambiguous row surfaces the raw folder name "plus every
    // candidate token found" so a human/warden pick isn't just guessing from
    // the folder name alone — zero tokens (empty array), 2+ tokens, or a
    // collision (candidates recomputed from the folder name either way) all
    // land here.
    const candidateTokens = ambiguous ? [...new Set(g.folderName.match(ORDER_TOKEN_RE) || [])] : null;
    orders.push({ orderId, folderName: g.folderName, year: g.year || null, upstream, local: localOrder ? shapeLocal(localOrder) : null, status, candidateTokens });
  }
  // Local orders no upstream folder claimed — flag it, don't guess why
  // (renamed upstream? manually-added local order?).
  for (const lo of local.orders) {
    if (usedLocalIds.has(lo.orderId)) continue;
    orders.push({ orderId: lo.orderId, folderName: null, year: null, upstream: null, local: shapeLocal(lo), status: 'local-only' });
  }

  const counts = { complete: 0, localIncomplete: 0, upstreamOnly: 0, localOnly: 0, ambiguous: 0 };
  for (const o of orders) {
    if (o.status === 'complete') counts.complete++;
    else if (o.status === 'local-incomplete') counts.localIncomplete++;
    else if (o.status === 'upstream-only') counts.upstreamOnly++;
    else if (o.status === 'local-only') counts.localOnly++;
    else counts.ambiguous++;
  }

  return {
    ok: true, projectId: p.id, slug: p.slug,
    bound: { driveId: sf.driveId, path: sf.path, name: sf.name || '' },
    indexBuiltAt: stats.builtAt || null,
    stale: stats.builtAt ? (Date.now() - new Date(stats.builtAt).getTime() > STALE_MS) : false,
    counts, orders,
  };
}

module.exports = { reconcileProject, normalizeOrderId };

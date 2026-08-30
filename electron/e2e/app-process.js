/**
 * OFFLINE 6 — the E2E "device" process.
 *
 * Boots the EXACT production data-layer app (electron/dataLayerApp.js — the
 * same handler table main.js serves over IPC) with a real file-backed SQLite
 * database, then loads the EXACT renderer sync stack (frontend/src/sync,
 * compiled) and runs the real sync engine against a real HTTP backend.
 *
 * What is simulated: only the browser environment around the real code —
 *   * `window` / `navigator.onLine` (the renderer's connectivity surface),
 *   * the IPC bridge (`window.coop` -> the same handler table),
 *   * "the internet": the backend is a local server the harness stops and
 *     starts (Wi-Fi off / on), pointed at by --api-url.
 *
 * Protocol: JSON lines over stdio.
 *   in:  {"id": 1, "op": "customerCreate", "arg": {...}}
 *   out: {"id": 1, "result": ...} | {"id": 1, "error": "message"}
 *       {"ready": true} once booted; {"exited": "clean"} on SIGTERM.
 *
 * SIGTERM = graceful app shutdown (the mirror stays on disk).
 * SIGKILL = crash/kill while operations are pending (Scenario 3).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const key = path.basename(args[i]).replace(/^--/, '');
    if (i + 1 < args.length && !args[i + 1].startsWith('--')) out[key] = args[++i];
    else out[key] = true; // bare flag (e.g. --start-offline)
  }
  return out;
}

const args = parseArgs();
if (!args.db || !args['api-url']) {
  console.error('usage: app-process.js --db <file> --api-url <url> [--token <t>] [--start-offline]');
  process.exit(2);
}
const API_URL = args['api-url'].replace(/\/$/, '');
const TOKEN = args.token || 'e2e';
const START_OFFLINE = !!args['start-offline'];

// ---------------------------------------------------------------------------
// 1. The real data-layer app (same module main.js uses).
// ---------------------------------------------------------------------------
const { createDataLayer } = require('../db');
const { createDataLayerApp } = require('../dataLayerApp');

const dataLayer = createDataLayer(args.db, { force: 'node:sqlite' });
const app = createDataLayerApp(dataLayer);

// ---------------------------------------------------------------------------
// 2. The browser surface the renderer sync stack expects (window/navigator).
// ---------------------------------------------------------------------------
const listeners = { online: [], offline: [] };

// The bridge: the SAME handler table main.js exposes over IPC, shaped
// EXACTLY like preload.js exposes it (coop.db.* + coop.sync.*). Preload
// methods return promises (ipcRenderer.invoke), so every method is wrapped.
const h = app.handlers;
const DEBUG = !!process.env.E2E_DEBUG;
const dbg = (m) => { if (DEBUG) console.error(`[engine ${process.pid}] ${m}`); };
const p = (fn) => (...args) => {
  const LOG = ['syncPendingOps', 'syncIngestMirror', 'syncSetSyncing', 'syncPullCursor', 'syncApplyPushOutcome', 'syncConflicts', 'syncRequeue'];
  if (DEBUG && LOG.includes(fn.name)) {
    dbg(fn.name + (fn.name === 'syncSetSyncing' ? ' ' + JSON.stringify(args[0]) : ''));
  }
  return Promise.resolve(fn(...args)).then(
    (r) => r,
    (e) => { if (DEBUG) dbg(fn.name + ' ERROR: ' + e.message); throw e; },
  );
};
const windowShim = {
  addEventListener: (type, cb) => { if (listeners[type]) listeners[type].push(cb); },
  removeEventListener: (type, cb) => {
    listeners[type] = listeners[type].filter((l) => l !== cb);
  },
  coop: {
    db: {
      businessEnsure: p(h.businessEnsure),
      businessGet: p(h.businessGet),
      businessFirst: p(h.businessFirst),
      customerCreate: p(h.customerCreate),
      customerUpdate: p(h.customerUpdate),
      customerDelete: p(h.customerDelete),
      customerGet: p(h.customerGet),
      customerList: p(h.customerList),
      productCreate: p(h.productCreate),
      productUpdate: p(h.productUpdate),
      productDelete: p(h.productDelete),
      productGet: p(h.productGet),
      productList: p(h.productList),
      orderCreate: p(h.orderCreate),
      orderSetStatus: p(h.orderSetStatus),
      orderGet: p(h.orderGet),
      orderList: p(h.orderList),
      orderListDetailed: p(h.orderListDetailed),
      orderItemsByOrder: p(h.orderItemsByOrder),
      stockAdjust: p(h.stockAdjust),
      stockMovements: p(h.stockMovements),
      customerDiscardLocal: p(h.customerDiscardLocal),
      productDiscardLocal: p(h.productDiscardLocal),
      stockSetLocal: p(h.stockSetLocal),
    },
    sync: {
      status: p(h.syncStatus),
      pendingOps: p(h.syncPendingOps),
      applyPushOutcome: p(h.syncApplyPushOutcome),
      ingestMirror: p(h.syncIngestMirror),
      pullCursor: p(h.syncPullCursor),
      pendingOrderIds: p(h.syncPendingOrderIds),
      setSyncing: p(h.syncSetSyncing),
      conflicts: p(h.syncConflicts),
      requeue: p(h.syncRequeue),
      resolveConflict: p(h.syncResolveConflict),
      onStatus: (cb) => { listeners.__status = cb; },
      onNet: (cb) => { listeners.__net = cb; },
    },
  },
};

function setNavigatorOnline(online) {
  const shim = { onLine: online };
  try {
    Object.defineProperty(globalThis, 'navigator', { value: shim, configurable: true, writable: true });
  } catch {
    globalThis.navigator = shim;
  }
}

function setOnline(online) {
  setNavigatorOnline(online);
  // Tell the renderer stack (its connectivity.ts listens for these events).
  for (const l of listeners[online ? 'online' : 'offline']) l();
  // Tell the main-process state (the pill's "online" flag).
  app.handlers.setOnline(online);
}

// Status broadcasts (main.js does this over webContents.send('coop:sync')).
h._onStatusChange((status) => { if (listeners.__status) listeners.__status(status); });

globalThis.window = windowShim;
setNavigatorOnline(!START_OFFLINE);
app.handlers.setOnline(!START_OFFLINE);

// ---------------------------------------------------------------------------
// 3. The real renderer sync stack (compiled) + its API client.
// ---------------------------------------------------------------------------
const rendererDir = path.join(__dirname, 'renderer');
if (!fs.existsSync(path.join(rendererDir, 'engine.js'))) {
  console.error('renderer stack not built — run `node e2e/build-renderer.js` first');
  process.exit(3);
}

// Axios-shaped client over fetch (the engine consumes an AxiosInstance).
const api = {
  async get(url, opts = {}) {
    let u = API_URL + url;
    if (opts.params) {
      const qs = new URLSearchParams(
        Object.entries(opts.params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]),
      ).toString();
      if (qs) u += `?${qs}`;
    }
    let res;
    try {
      res = await fetch(u, { headers: { Authorization: `Bearer ${TOKEN}` } });
    } catch (e) {
      dbg(`fetch FAILED ${url}: ${e.message}`);
      throw e;
    }
    dbg(`fetch ${res.status} ${url}`);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${url}`);
      err.response = { status: res.status, data };
      throw err;
    }
    return { data };
  },
  async post(url, body) {
    let res;
    try {
      res = await fetch(API_URL + url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(body),
      });
    } catch (e) {
      dbg(`fetch FAILED ${url}: ${e.message}`);
      throw e;
    }
    dbg(`fetch ${res.status} ${url}`);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${url}`);
      err.response = { status: res.status, data };
      throw err;
    }
    return { data };
  },
};

// The real renderer identity bootstrap (frontend/src/repositories/identity.ts
// does this at app start): /auth/me -> local business row.
async function bootstrapIdentity() {
  const { data } = await api.get('/auth/me');
  const row = windowShim.coop.db.businessEnsure({
    client_id: String(data.business_id),
    name: data.business_name,
    currency: data.currency,
  });
  return row;
}

const engine = require(path.join(rendererDir, 'engine.js'));
let engineStarted = false;
function startEngine() {
  if (engineStarted) return;
  engineStarted = true;
  engine.startSyncEngine(api);
}

// ---------------------------------------------------------------------------
// 4. The stdio RPC loop (harness <-> device).
// ---------------------------------------------------------------------------
let nextId = 0;
const rpc = (op, arg) => {
  if (op === 'setOnline') return setOnline(!!arg);
  if (op === 'bootstrapIdentity') return bootstrapIdentity();
  if (op === 'startEngine') return (startEngine(), { started: true });
  if (op === 'syncNow') return (engine.requestManualSync(), { ok: true });
  if (op === 'status') return app.status();
  if (op === 'quit') {
    try { dataLayer.close(); } catch { /* already closed */ }
    process.stdout.write(JSON.stringify({ exited: 'clean' }) + '\n');
    process.exit(0);
  }
  const h = app.handlers[op];
  if (typeof h !== 'function') throw new Error(`unknown op: ${op}`);
  return h(arg);
};

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    const id = msg.id ?? ++nextId;
    Promise.resolve()
      .then(() => rpc(msg.op, msg.arg))
      .then((result) => process.stdout.write(JSON.stringify({ id, result }) + '\n'))
      .catch((e) => process.stdout.write(JSON.stringify({ id, error: String(e && e.message || e) }) + '\n'));
  }
});

process.on('SIGTERM', () => {
  try { dataLayer.close(); } catch { /* best effort */ }
  process.stdout.write(JSON.stringify({ exited: 'clean' }) + '\n');
  process.exit(0);
});

// Boot: the engine always starts (its first cycle does the initial pull
// when online; offline it stays idle and begins cycling on the online
// event). The identity bootstrap needs the network, so on a cold OFFLINE
// start it is skipped — the local business row from the previous run is
// already in the mirror (which is exactly what Scenario 6 proves).
(async () => {
  if (!START_OFFLINE) {
    try {
      await bootstrapIdentity();
    } catch {
      // Backend not reachable yet — the harness can bootstrap manually.
    }
  }
  startEngine();
  process.stdout.write(JSON.stringify({ ready: true }) + '\n');
})();

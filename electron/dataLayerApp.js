/**
 * Co-op data-layer app state + handler table (OFFLINE 6 refactor).
 *
 * The exact allow-listed surface the renderer's bridge calls (preload.js),
 * plus the sync state (online / mirrorReady / syncing / lastSyncAt). Lives
 * in its own module — with NO Electron imports — because it is shared by:
 *   * main.js (the real Electron main process, over IPC), and
 *   * the OFFLINE 6 E2E app process (the same handlers driven over stdio,
 *     the same way the renderer's bridge drives them).
 *
 * One code path for the data layer in production and in the proof.
 *
 * Cold start (OFFLINE 6): if a pull cursor exists in sync_meta, the local
 * DB already holds a mirror from a previous run. The mirror is TRUSTED
 * (possibly stale) and local mode activates immediately — a device that
 * was initialized once works fully offline from a cold launch. The first
 * successful pull (when online) refreshes it. The cursor is only ever
 * written by a successful pull, so its presence means "a mirror exists".
 */
'use strict';

const { getCursor } = require('./sync');

/**
 * @param {object} dataLayer  createDataLayer() result (electron/db).
 * @returns {{ state: object, status: () => object, handlers: object }}
 */
function createDataLayerApp(dataLayer) {
  const state = {
    online: true,
    // Cold-start mirror trust (see module docstring).
    mirrorReady: !!getCursor(dataLayer.db),
    syncing: false,
    lastSyncAt: null,
  };

  function status() {
    return {
      online: state.online,
      pending: dataLayer.queue.countPending(),
      // Ops parked in 'conflict' — visible as "needs attention", never
      // retried automatically (the Sync Center resolves them).
      conflicts: dataLayer.queue.countConflicts(),
      syncing: state.syncing,
      mirrorReady: state.mirrorReady,
      lastSyncAt: state.lastSyncAt,
    };
  }

  // main.js wires this to a webContents.send('coop:sync', ...) broadcast;
  // the E2E app process wires it to its stdio status feed.
  let onStatusChange = null;

  const handlers = {
    businessEnsure: (a) => dataLayer.business.ensure(a),
    businessGet: (id) => dataLayer.business.get(id),
    businessFirst: () => dataLayer.business.first(),
    customerCreate: (a) => dataLayer.customers.create(a.business_id, a.data),
    customerUpdate: (a) => dataLayer.customers.update(a.id, a.data),
    customerDelete: (id) => dataLayer.customers.softDelete(id),
    customerGet: (id) => dataLayer.customers.get(id),
    customerList: (a) => dataLayer.customers.list(a.business_id, a.opts || {}),
    productCreate: (a) => dataLayer.products.create(a.business_id, a.data),
    productUpdate: (a) => dataLayer.products.update(a.id, a.data),
    productDelete: (id) => dataLayer.products.softDelete(id),
    productGet: (id) => dataLayer.products.get(id),
    productList: (a) => dataLayer.products.list(a.business_id, a.opts || {}),
    orderCreate: (a) => dataLayer.orders.create(a.business_id, a.data),
    orderSetStatus: (a) => dataLayer.orders.setStatus(a.business_id, a.order_id, a.status),
    orderGet: (id) => dataLayer.orders.get(id),
    orderList: (a) => dataLayer.orders.list(a.business_id, a.opts || {}),
    orderListDetailed: (a) => dataLayer.orders.listDetailed(a.business_id, a.opts || {}),
    orderItemsByOrder: (a) => dataLayer.orders.itemsByOrder(a.business_id, a.opts || {}),
    stockAdjust: (a) => dataLayer.stock.adjust(a.business_id, a.product_id, a.change, a.reason, a.opts || {}),
    stockMovements: (a) => dataLayer.stock.movements(a.business_id, a.product_id || null),
    // Resolution-only local corrections (Sync Center; no queue ops).
    customerDiscardLocal: (id) => dataLayer.customers.discardLocal(id),
    productDiscardLocal: (id) => dataLayer.products.discardLocal(id),
    stockSetLocal: (a) => dataLayer.stock.setLocalStock(a.product_id, a.value, a.note || null),
    // Sync engine surface (the renderer's engine.ts drives these).
    syncStatus: () => status(),
    syncPendingOps: () => {
      // retryFailed() re-arms 'failed' ops only — 'conflict' ops stay parked.
      dataLayer.queue.retryFailed();
      return dataLayer.queue
        .pending()
        .slice(0, 200)
        .map((o) => ({ id: o.id, entity: o.entity, client_id: o.client_id, operation: o.operation, payload: o.payload }));
    },
    syncApplyPushOutcome: (result) => {
      const { markPushOutcome } = require('./sync');
      const out = markPushOutcome(dataLayer, result);
      if (out.synced || out.conflicts || out.failed) state.lastSyncAt = new Date().toISOString();
      onStatusChange && onStatusChange(status());
      return out;
    },
    syncIngestMirror: (payload) => {
      const { applyPull } = require('./sync');
      // since == null -> full pull (verify counts); else delta (per-row).
      const res = applyPull(dataLayer, payload, { full: payload.since == null });
      state.mirrorReady = true;
      state.lastSyncAt = new Date().toISOString();
      onStatusChange && onStatusChange(status());
      return res;
    },
    syncPullCursor: () => getCursor(dataLayer.db),
    syncPendingOrderIds: () => dataLayer.queue.pendingOrderIds(),
    syncSetSyncing: (b) => {
      state.syncing = !!b;
      onStatusChange && onStatusChange(status());
      return state.syncing;
    },
    syncConflicts: () => dataLayer.queue.conflicts(),
    // Resolution actions on a parked conflict (broadcast so the "needs
    // attention" count updates immediately).
    syncRequeue: (a) => {
      const out = dataLayer.queue.requeue(a.queueId, a.payloadOverride || null);
      if (out) onStatusChange && onStatusChange(status());
      return out;
    },
    syncResolveConflict: (a) => {
      const out = dataLayer.queue.resolveConflict(a.queueId);
      if (out) onStatusChange && onStatusChange(status());
      return out;
    },
    // Connectivity (main.js calls this from its net.on listeners; the E2E
    // app process calls it from the harness' setOnline RPC).
    setOnline: (b) => {
      state.online = !!b;
      onStatusChange && onStatusChange(status());
      return state.online;
    },
  };

  handlers._onStatusChange = (fn) => { onStatusChange = fn; };

  return { state, status, handlers };
}

module.exports = { createDataLayerApp };

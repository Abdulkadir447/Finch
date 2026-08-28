/**
 * Co-op desktop — secure preload bridge (ADR-002).
 *
 * Exposes a minimal, namespaced, promise-based API to the renderer via
 * contextBridge. The renderer NEVER touches Node or SQLite directly:
 *
 *   React renderer
 *     ↓ window.coop.db.*  (this file)
 *     ↓ IPC (ipcRenderer.invoke)
 *     ↓ main process (allow-listed data-layer methods)
 *     ↓ local SQLite
 *
 * Security posture is preserved: contextIsolation stays ON, nodeIntegration
 * stays OFF. Only the explicit methods below cross the bridge — there is no
 * generic "call any method" channel.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Single IPC channel; the main process allow-lists which methods may run.
const call = (method, arg) => ipcRenderer.invoke('coop:db', { method, arg });

contextBridge.exposeInMainWorld('coop', {
  // Local-first core data operations (OFFLINE 1/2 data layer).
  db: {
    businessEnsure: (b) => call('businessEnsure', b),
    customerCreate: (a) => call('customerCreate', a),
    customerUpdate: (a) => call('customerUpdate', a),
    customerDelete: (id) => call('customerDelete', id),
    customerGet: (id) => call('customerGet', id),
    customerList: (bizId) => call('customerList', bizId),
    productCreate: (a) => call('productCreate', a),
    productUpdate: (a) => call('productUpdate', a),
    productDelete: (id) => call('productDelete', id),
    productGet: (id) => call('productGet', id),
    productList: (bizId) => call('productList', bizId),
    orderCreate: (a) => call('orderCreate', a),
    orderSetStatus: (a) => call('orderSetStatus', a),
    orderGet: (id) => call('orderGet', id),
    orderList: (bizId) => call('orderList', bizId),
    stockAdjust: (a) => call('stockAdjust', a),
    stockMovements: (a) => call('stockMovements', a),
  },
  // Sync visibility (the engine itself lands in OFFLINE 3).
  sync: {
    status: () => call('syncStatus', null),
  },
  // Authoritative connectivity (Electron net.isOnline) pushed from main.
  onNet: (cb) => {
    ipcRenderer.on('coop:net', (_e, data) => cb(data));
  },
});

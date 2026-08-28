/**
 * Co-op repositories — the UI's data-access layer (OFFLINE 2).
 *
 * ADR-002 rule: the UI talks to these repositories, never to FastAPI
 * directly, for core mutations. Each repository branches:
 *   - local (desktop)  -> local SQLite immediately + sync queue
 *   - remote (browser) -> the existing HTTP API, unchanged
 *
 * The remote branch is byte-for-byte the previous behaviour, so the app is
 * unchanged in a browser and local-first in the desktop app.
 */
export { fetchIdentity, localBusinessId, type BusinessIdentity } from './identity';
export {
  isLocalModeActive,
  isLocalMirrorReady,
  setLocalMirrorReady,
} from './localMode';
export { makeCustomerRepo, type CustomerRepo, type CustomerValues } from './customers';
export { makeProductRepo, type ProductRepo, type ProductValues } from './products';
export { makeInventoryRepo, type InventoryRepo, type AdjustInput } from './inventory';
export {
  makeOrderRepo,
  type OrderRepo,
  type OrderInput,
  type OrderStatusValue,
} from './orders';

/**
 * Stock status helpers — shared by the Products and Inventory modules.
 *
 * Mutually exclusive status (UXDS 11.6), identical to the backend
 * definitions (backend/main.py _strictly_low_stock_case /
 * _out_of_stock_case):
 *   out  → current_stock === 0
 *   low  → 0 < current_stock <= reorder_level
 *   in   → current_stock > reorder_level
 */
export type StockStatus = 'in' | 'low' | 'out';

/** CoopBadge variant per status (In Stock = primary, Low = warning, Out = critical). */
export const STOCK_STATUS_BADGE: Record<StockStatus, 'primary' | 'warning' | 'critical'> = {
  in: 'primary',
  low: 'warning',
  out: 'critical',
};

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  in: 'In Stock',
  low: 'Low Stock',
  out: 'Out of Stock',
};

export function stockStatusOf(currentStock: number, reorderLevel: number): StockStatus {
  if (currentStock <= 0) return 'out';
  if (currentStock <= reorderLevel) return 'low';
  return 'in';
}

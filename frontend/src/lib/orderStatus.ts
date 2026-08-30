/**
 * Order status presentation — single source of truth shared by the Orders
 * module, the Dashboard's Recent Orders, and the order timeline.
 *
 * Badge variants follow the Stitch order designs:
 *   Pending = primary tint · Confirmed = warning tint · Shipped = neutral ·
 *   Delivered = success · Cancelled = critical
 */
import type { CoopBadgeVariant } from '../components/ui/CoopBadge';
import type { OrderStatus } from '../pages/Orders/useOrders';

export const ORDER_STATUS_VARIANT: Record<OrderStatus, CoopBadgeVariant> = {
  pending: 'primary',
  confirmed: 'warning',
  shipped: 'neutral',
  delivered: 'success',
  cancelled: 'critical',
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** Canonical fulfillment flow (cancelled is a branch off it). */
export const FULFILLMENT_FLOW: OrderStatus[] = ['pending', 'confirmed', 'shipped', 'delivered'];

export const orderNumber = (id: number) => `#ORD-${String(id).padStart(4, '0')}`;

export interface TimelineNode {
  label: string;
  time: string | null; // ISO or null (future/unknown)
  state: 'done' | 'current' | 'todo' | 'cancelled';
}

/**
 * Build the order timeline from REAL data only: created_at, updated_at and
 * the current status position in the fulfillment flow. No fabricated event
 * times — completed milestones use the timestamps we actually have.
 */
export function orderTimeline(status: OrderStatus, createdAt: string, updatedAt: string | null): TimelineNode[] {
  const placed: TimelineNode = {
    label: 'Order Placed',
    time: createdAt,
    state: 'done',
  };
  if (status === 'cancelled') {
    return [
      placed,
      { label: 'Cancelled', time: updatedAt, state: 'cancelled' },
    ];
  }
  const idx = FULFILLMENT_FLOW.indexOf(status);
  const nodes: TimelineNode[] = [placed];
  FULFILLMENT_FLOW.forEach((s, i) => {
    if (i === 0) return; // "pending" = the placed state itself
    nodes.push({
      label: ORDER_STATUS_LABEL[s],
      time: i === idx ? updatedAt : null,
      state: i < idx ? 'done' : i === idx ? 'current' : 'todo',
    });
  });
  return nodes;
}

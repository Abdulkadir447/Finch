/**
 * Co-op Design System — Shape, space, elevation & layering tokens
 * (Stitch Stage R0 + R1).
 *
 * Spacing rhythm is strictly an 8px grid. Shape language is "Restrained
 * Modern": 12px for primary containers, 8px for small elements (chips,
 * segmented controls), no square corners anywhere.
 */

// ---------------------------------------------------------------------------
// Spacing — 8px grid
// ---------------------------------------------------------------------------
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
} as const;

export type SpacingToken = keyof typeof spacing;

// ---------------------------------------------------------------------------
// Radius
// ---------------------------------------------------------------------------
export const radius = {
  /** Small utility (tags, kbd). */
  sm: 4,
  /** Chips, badges, segmented controls (DESIGN.md "Small Elements"). */
  md: 8,
  /** Cards, modals, inputs, primary buttons (DESIGN.md "Standard Elements"). */
  lg: 12,
  /** Oversized containers / modal radius. */
  xl: 16,
  full: 9999,
} as const;

// ---------------------------------------------------------------------------
// Elevation (DESIGN.md "Elevation & Depth")
// Level 0 — flat canvas
// Level 1 — 1px border, no shadow (default card)
// Level 2 — 1px border + subtle 4px-blur shadow (hover/active)
// Level 3 — 12px blur + border (overlays: modals, menus)
// ---------------------------------------------------------------------------
export const shadow = {
  /** Level 2 — card hover lift, diffused indigo tint. */
  lift: '0 4px 12px rgba(91, 95, 239, 0.08)',
  /** Soft neutral lift (KPI card hover). */
  soft: '0 8px 24px rgba(21, 24, 29, 0.04)',
  /** Brand tile (sidebar logo). */
  brandTile: '0 4px 12px rgba(91, 95, 239, 0.2)',
  /** Level 3 — overlays (modal/dropdown). */
  overlay: '0 12px 32px rgba(91, 95, 239, 0.18)',
  /** Level 3 — top bar when scrolled. */
  bar: '0 1px 2px rgba(21, 24, 29, 0.04)',
} as const;

// ---------------------------------------------------------------------------
// Layering
// ---------------------------------------------------------------------------
export const z = {
  sidebar: 40,
  topBar: 50,
  drawerOverlay: 45,
} as const;

// ---------------------------------------------------------------------------
// Layout metrics
// ---------------------------------------------------------------------------
export const layout = {
  sidebarWidth: 240,
  topBarHeight: 64,
  contentGap: 24, // between major sections (spacing.lg)
  contentPadding: 24, // desktop content gutter (spacing.lg)
} as const;

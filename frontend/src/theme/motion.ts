/**
 * Co-op Design System — Motion tokens.
 *
 * Quiet, fast transitions (150–300 ms) with a soft ease-out curve. Interactive
 * elements compress slightly on press (`active:scale-95` in the reference
 * mockups) and shadows fade in on hover — never bouncy, never slow.
 */

export const motion = {
  duration: {
    fast: 150, // color/scale micro-interactions
    mid: 200, // standard transitions (hover, expand)
    slow: 300, // layout shifts (sidebar, drawers)
  },
  easing: {
    standard: 'cubic-bezier(0.16, 1, 0.3, 1)', // ease-out, premium feel
    inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  },
  // Active-press compression used across buttons/rows.
  activeScale: 0.95,
} as const;

export const transition = (prop: string, speed: 'fast' | 'mid' | 'slow' = 'mid') =>
  `${prop} ${motion.duration[speed]}ms ${motion.easing.standard}`;

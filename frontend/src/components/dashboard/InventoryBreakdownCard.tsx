import React from 'react';
import { radius, type } from '../../theme';
import { useCoopTheme } from '../../theme-provider';
import { formatCompact } from '../../pages/Dashboard/kpiConfig';
import type { CategoryValue } from '../../pages/Dashboard/useDashboardData';
import { CoopEmptyState } from '../ui';

const LEGEND_COLORS = ['primary', 'secondary', 'warning', 'info', 'outline'] as const;

/**
 * Inventory Breakdown card (Stitch dashboard): donut of inventory value by
 * category with a compact total in the center, plus a custom legend with
 * per-category percentages.
 *
 * Real data only: /dashboard/inventory/by-category. With no products the
 * card shows the shared empty state.
 */
const InventoryBreakdownCard: React.FC<{
  categories: CategoryValue[];
  total: number;
}> = ({ categories, total }) => {
  const { colors } = useCoopTheme();

  const colorFor = (i: number): string => {
    const key = LEGEND_COLORS[i % LEGEND_COLORS.length];
    if (key === 'primary') return colors.primary;
    if (key === 'secondary') return colors.secondary;
    if (key === 'warning') return colors.warning;
    if (key === 'info') return colors.info;
    return colors.outlineVariant;
  };

  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);

  return (
    <div
      style={{
        background: colors.surfaceContainerLowest,
        border: `1px solid ${colors.borderSubtle}`,
        borderRadius: radius.lg,
        padding: 20,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ ...type.titleMd, color: colors.onSurface, marginBottom: 16 }}>
        Inventory Breakdown
      </div>

      {categories.length === 0 ? (
        <CoopEmptyState
          title="No inventory yet"
          description="Add products in the Products module to see value by category."
          compact
        />
      ) : (
        <>
          {/* Donut with centered total */}
          <div
            style={{
              position: 'relative',
              width: 190,
              height: 190,
              margin: '0 auto',
            }}
          >
            <svg viewBox="0 0 42 42" width="100%" height="100%" role="img" aria-label="Inventory value by category">
              <circle cx="21" cy="21" r="15.9" fill="none" stroke={colors.surfaceContainer} strokeWidth="5" />
              {(() => {
                let offset = 25; // start at 12 o'clock
                return categories.map((c, i) => {
                  const fraction = total > 0 ? (c.value / total) * 100 : 0;
                  const el = (
                    <circle
                      key={c.category}
                      cx="21"
                      cy="21"
                      r="15.9"
                      fill="none"
                      stroke={colorFor(i)}
                      strokeWidth="5"
                      strokeDasharray={`${Math.max(fraction - 1.2, 0.4)} ${100 - Math.max(fraction - 1.2, 0.4)}`}
                      strokeDashoffset={offset}
                      strokeLinecap="butt"
                    />
                  );
                  offset -= fraction;
                  return el;
                });
              })()}
            </svg>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ ...type.sectionHeading, color: colors.onSurface, fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>
                {formatCompact(total)}
              </span>
            </div>
          </div>

          {/* Custom legend: dot · category … percentage (right) */}
          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {categories.map((c, i) => (
              <div key={c.category} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  aria-hidden
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: radius.sm,
                    background: colorFor(i),
                    flexShrink: 0,
                  }}
                />
                <span style={{ ...type.bodyCompact, color: colors.onSurfaceVariant, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.category}
                </span>
                <span style={{ ...type.bodyCompact, fontWeight: 600, color: colors.onSurface, fontVariantNumeric: 'tabular-nums' }}>
                  {pct(c.value)}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default InventoryBreakdownCard;

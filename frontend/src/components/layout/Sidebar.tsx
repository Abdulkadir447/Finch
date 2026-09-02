/**
 * Co-op Sidebar (Stitch app-shell, left rail).
 *
 * 240px, white, 1px border-subtle right edge, flat (no shadow). Anatomy:
 *   1. Brand — Co-op mark (two partner tiles + spark) + wordmark
 *      and the "Premium SaaS" label-caps subtitle.
 *   2. Primary nav — Overview / Reports / Products / Inventory / Orders /
 *      Customers / Import. Active = surface-container-low fill + primary
 *      text + semibold.
 *   3. Secondary nav — Settings.
 *   4. Bottom action — "Upgrade Plan" (secondary button).
 *
 * Collapsed state (Stage 2): 72px icon rail with tooltips, toggled from the
 * rail itself; the preference persists (`coop:sidebar-collapsed`).
 * On < md the sidebar is rendered as a slide-in drawer (AppShell controls
 * the open state); on desktop it is fixed.
 */
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Tooltip } from 'antd';
import { radius, shadow, spacing, transition, z } from '../../theme';
import { useCoopTheme } from '../../theme-provider';
import { NAV_ITEMS, NAV_SECONDARY } from './nav';
import { CoopLogo, CoopMark } from '../brand/CoopLogo';

export const SIDEBAR_WIDTH = 240;
export const SIDEBAR_COLLAPSED_WIDTH = 72;

export interface SidebarProps {
  /** Desktop collapsed state (AppShell-managed, persisted). */
  collapsed?: boolean;
  /** Toggles the desktop collapsed state. */
  onToggleCollapse?: () => void;
  /** Mobile drawer state (AppShell-managed). Ignored on desktop. */
  open?: boolean;
  onClose?: () => void;
}

interface RailContentProps {
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
}

const navItemBase = (active: boolean, collapsed: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: collapsed ? '11px 0' : '9px 12px',
  justifyContent: collapsed ? 'center' : 'flex-start',
  borderRadius: radius.md,
  border: 'none',
  background: active ? 'var(--coop-nav-active-bg)' : 'transparent',
  color: active ? 'var(--coop-nav-active-color)' : 'var(--coop-nav-color)',
  fontWeight: active ? 600 : 400,
  fontSize: 14,
  lineHeight: '20px',
  cursor: 'pointer',
  textAlign: 'left',
  transition: transition('background-color, color'),
});

const SidebarContent: React.FC<RailContentProps> = ({ collapsed, onToggleCollapse, onNavigate }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { colors } = useCoopTheme();

  const allItems = NAV_ITEMS.concat(NAV_SECONDARY);
  // Exact match first, then child routes (e.g. /customers/:id keeps the
  // "Customers" item active).
  const activeKey =
    allItems.find((i) => i.path === location.pathname)?.key ??
    allItems.find((i) => i.path !== '/' && location.pathname.startsWith(`${i.path}/`))?.key;

  const go = (path: string) => {
    navigate(path);
    onNavigate?.();
  };


  // CSS variables keep the nav colors in one place per theme.
  const vars = {
    '--coop-nav-active-bg': collapsed || !activeKey ? colors.surfaceContainerLow : colors.surfaceContainerLow,
    '--coop-nav-active-color': colors.primary,
    '--coop-nav-color': colors.onSurfaceVariant,
  } as React.CSSProperties;

  const item = (item: { key: string; label: string; path: string; icon: React.ReactNode }) => {
    const active = activeKey === item.key;
    const btn = (
      <button
        key={item.key}
        type="button"
        style={navItemBase(active, collapsed)}
        onClick={() => go(item.path)}
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? item.label : undefined}
      >
        <span style={{ fontSize: 18, display: 'inline-flex' }}>{item.icon}</span>
        {!collapsed && <span>{item.label}</span>}
      </button>
    );
    return collapsed ? (
      <Tooltip key={item.key} title={item.label} placement="right" mouseEnterDelay={0.35}>
        {btn}
      </Tooltip>
    ) : (
      btn
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', ...vars }}>
      {/* Brand */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          padding: `0 ${collapsed ? 0 : spacing.sm}px ${spacing.xl}px`,
        }}
      >
        {collapsed ? <CoopMark size={40} title="Co-op" /> : <CoopLogo size={40} subtitle="Premium SaaS" />}
      </div>

      {/* Primary nav */}
      <nav
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', gap: 4 }}
        aria-label="Primary"
      >
        {NAV_ITEMS.map((i) => item(i))}

        <div
          aria-hidden
          style={{ height: 1, background: colors.borderSubtle, margin: `${spacing.md}px ${collapsed ? 0 : spacing.sm}px` }}
        />

        {/* Secondary nav */}
        {NAV_SECONDARY.map((i) => item(i))}
      </nav>

      {/* Bottom: collapse toggle + upgrade action */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: `${spacing.md}px ${collapsed ? 0 : spacing.sm}px 0` }}>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            width: '100%',
            height: 36,
            borderRadius: radius.md,
            border: 'none',
            background: 'transparent',
            color: colors.outline,
            cursor: 'pointer',
            transition: transition('background-color, color'),
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceContainerLow)}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            style={{
              transition: 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1)',
              transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          >
            <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {!collapsed && <span style={{ fontSize: 13, fontWeight: 500 }}>Collapse</span>}
        </button>

        <button
          type="button"
          onClick={() => go('/billing')}
          aria-label="Upgrade Plan"
          title="Upgrade Plan"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: 8,
            width: '100%',
            height: 40,
            padding: collapsed ? 0 : '0 12px',
            borderRadius: radius.lg,
            border: `1px solid ${colors.outlineVariant}`,
            background: colors.surfaceContainerLowest,
            color: colors.primary,
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
            transition: transition('background-color, box-shadow'),
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceContainerLow)}
          onMouseLeave={(e) => (e.currentTarget.style.background = colors.surfaceContainerLowest)}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 19V5m0 0-6 6m6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {!collapsed && 'Upgrade Plan'}
        </button>
      </div>
    </div>
  );
};

const Sidebar: React.FC<SidebarProps> = ({ collapsed = false, onToggleCollapse, open = false, onClose }) => {
  const { colors } = useCoopTheme();
  const width = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  return (
    <>
      {/* Desktop rail (fixed) */}
      <aside
        style={{
          position: 'fixed',
          inset: `0 auto 0 0`,
          width,
          zIndex: z.sidebar,
          background: colors.surfaceContainerLowest,
          borderRight: `1px solid ${colors.borderSubtle}`,
          padding: `${spacing.lg}px ${collapsed ? spacing.sm : spacing.md}px`,
          display: 'block',
          transition: `width 300ms cubic-bezier(0.16, 1, 0.3, 1), background-color 300ms, border-color 300ms`,
        }}
        className="coop-sidebar-desktop"
        aria-label="Sidebar"
      >
        <SidebarContent collapsed={collapsed} onToggleCollapse={onToggleCollapse} />
      </aside>

      {/* Mobile drawer overlay */}
      <div
        aria-hidden={!open}
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: isDrawerDark() ? 'rgba(10, 10, 14, 0.55)' : 'rgba(27, 27, 35, 0.35)',
          zIndex: z.drawerOverlay,
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: transition('opacity'),
        }}
        className="coop-sidebar-overlay"
      />
      <aside
        aria-hidden={!open}
        style={{
          position: 'fixed',
          inset: `0 auto 0 0`,
          width: 280,
          maxWidth: '85vw',
          zIndex: z.drawerOverlay + 1,
          background: colors.surfaceContainerLowest,
          borderRight: `1px solid ${colors.borderSubtle}`,
          padding: `${spacing.lg}px ${spacing.md}px`,
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1)',
          display: 'block',
          boxShadow: open ? shadow.overlay : 'none',
        }}
        className="coop-sidebar-drawer"
        aria-label="Mobile sidebar"
      >
        <SidebarContent collapsed={false} onNavigate={onClose} />
      </aside>
    </>
  );
};

function isDrawerDark(): boolean {
  return document.documentElement.dataset.theme === 'dark';
}

export default Sidebar;

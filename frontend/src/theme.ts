/**
 * Finch Design System — Visual Tokens (UXDS Chapter 1: Design Vision & Principles)
 *
 * Philosophy: "Your Business, Smarter."
 *   - Clarity First: information is easy to scan and understand.
 *   - Neutral surfaces dominate; a single accent color carries meaning.
 *   - Generous spacing, rounded corners, subtle shadows, clear hierarchy.
 *   - Light and dark themes provide equivalent usability (WCAG 2.1 AA contrast).
 *
 * These tokens are the single source of truth for the Ant Design 5 ConfigProvider.
 */

import type { ThemeConfig } from 'antd';
import { theme as antdTheme } from 'antd';

// ---------------------------------------------------------------------------
// Brand & Semantic Color Palette
// ---------------------------------------------------------------------------
// A calm, professional indigo/violet accent communicates "intelligent" and
// "trustworthy" (UXDS 1.6 Brand Personality) without overwhelming neutral UI.
export const brand = {
  primary: '#5B5BD6', // accent — important actions & status only
  primaryHover: '#6E6EE0',
  primaryActive: '#4A4AC4',
  primarySurface: '#EEEEFB', // tinted background for selected/hover states
};

// Neutral scale (cool grays) keeps the interface quiet and content-forward.
// Numeric keys require bracket access (e.g. neutral[0]).
export const neutral: Record<number, string> = {
  0: '#FFFFFF',
  50: '#F7F8FA',
  100: '#EEF0F4',
  200: '#E2E5EB',
  300: '#CAD0DA',
  400: '#9AA3B2',
  500: '#6B7484',
  600: '#4B5260',
  700: '#353B47',
  800: '#23272F',
  900: '#15181D',
  950: '#0C0E12',
};

// Semantic colors carry status meaning independent of hue (UXDS 1.17 — color
// independent status indicators). Used for badges, alerts, low-stock, etc.
export const semantic = {
  success: '#2E9E5B',
  successBg: '#E7F6EC',
  warning: '#E0A106',
  warningBg: '#FDF3DA',
  error: '#D64545',
  errorBg: '#FBE9E9',
  info: '#2D8FD5',
  infoBg: '#E6F2FB',
};

// ---------------------------------------------------------------------------
// Typography Scale (UXDS 1.12 — readability first, clear hierarchy)
// ---------------------------------------------------------------------------
export const fontFamily =
  '"Inter", "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';

export const fontSize = {
  caption: 12,
  body: 14,
  subhead: 16,
  title: 20,
  heading: 24,
  display: 32,
};

// ---------------------------------------------------------------------------
// Spacing & Shape (UXDS 1.13 Layout — generous, consistent spacing)
// ---------------------------------------------------------------------------
export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
};

export const shadow = {
  sm: '0 1px 2px rgba(21, 24, 29, 0.06)',
  md: '0 4px 16px rgba(21, 24, 29, 0.08)',
  lg: '0 12px 32px rgba(21, 24, 29, 0.12)',
};

// ---------------------------------------------------------------------------
// Light Theme
// ---------------------------------------------------------------------------
export const light: ThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    colorPrimary: brand.primary,
    colorPrimaryHover: brand.primaryHover,
    colorPrimaryActive: brand.primaryActive,
    colorInfo: brand.primary,
    colorSuccess: semantic.success,
    colorWarning: semantic.warning,
    colorError: semantic.error,
    colorLink: brand.primary,

    colorBgBase: neutral[0],
    colorBgLayout: neutral[50],
    colorBgContainer: neutral[0],
    colorBgElevated: neutral[0],
    colorBorder: neutral[200],
    colorBorderSecondary: neutral[100],
    colorTextBase: neutral[800],
    colorText: neutral[800],
    colorTextSecondary: neutral[500],
    colorTextTertiary: neutral[400],

    fontFamily,
    fontSize: fontSize.body,
    fontSizeHeading1: fontSize.display,
    fontSizeHeading2: fontSize.heading,
    fontSizeHeading3: fontSize.title,
    fontSizeHeading4: fontSize.subhead,
    lineHeight: 1.6,

    borderRadius: radius.md,
    borderRadiusLG: radius.lg,
    borderRadiusSM: radius.sm,

    controlHeight: 38,
    controlHeightLG: 44,
    controlHeightSM: 30,

    boxShadow: shadow.md,
    boxShadowSecondary: shadow.sm,
    boxShadowTertiary: shadow.lg,

    motionDurationMid: '0.2s',
    motionDurationSlow: '0.3s',
  },
  components: {
    Layout: {
      headerBg: neutral[0],
      bodyBg: neutral[50],
      siderBg: neutral[0],
      headerHeight: 64,
      headerPadding: '0 24px',
    },
    Menu: {
      itemSelectedBg: brand.primarySurface,
      itemSelectedColor: brand.primaryActive,
      itemHoverBg: neutral[100],
      itemBorderRadius: radius.sm,
    },
    Card: {
      borderRadiusLG: radius.lg,
      boxShadowTertiary: shadow.sm,
    },
    Button: {
      controlHeight: 38,
      primaryShadow: 'none',
      borderRadius: radius.sm,
    },
    Table: {
      headerBg: neutral[50],
      headerColor: neutral[600],
      rowHoverBg: neutral[50],
      borderRadiusLG: radius.md,
    },
  },
};

// ---------------------------------------------------------------------------
// Dark Theme — equivalent usability, not just inverted colors (UXDS 1.11)
// ---------------------------------------------------------------------------
export const dark: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorPrimary: brand.primaryHover,
    colorPrimaryHover: '#8585E8',
    colorPrimaryActive: brand.primary,
    colorInfo: brand.primaryHover,
    colorSuccess: semantic.success,
    colorWarning: semantic.warning,
    colorError: '#E86161',
    colorLink: brand.primaryHover,

    colorBgBase: neutral[950],
    colorBgLayout: neutral[900],
    colorBgContainer: neutral[900],
    colorBgElevated: neutral[800],
    colorBorder: neutral[800],
    colorBorderSecondary: neutral[800],
    colorTextBase: neutral[100],
    colorText: neutral[100],
    colorTextSecondary: neutral[400],
    colorTextTertiary: neutral[500],

    fontFamily,
    fontSize: fontSize.body,
    fontSizeHeading1: fontSize.display,
    fontSizeHeading2: fontSize.heading,
    fontSizeHeading3: fontSize.title,
    fontSizeHeading4: fontSize.subhead,
    lineHeight: 1.6,

    borderRadius: radius.md,
    borderRadiusLG: radius.lg,
    borderRadiusSM: radius.sm,

    controlHeight: 38,
    controlHeightLG: 44,
    controlHeightSM: 30,

    boxShadow: shadow.lg,
    boxShadowSecondary: shadow.md,

    motionDurationMid: '0.2s',
    motionDurationSlow: '0.3s',
  },
  components: {
    Layout: {
      headerBg: neutral[950],
      bodyBg: neutral[900],
      siderBg: neutral[950],
      headerHeight: 64,
      headerPadding: '0 24px',
    },
    Menu: {
      itemSelectedBg: 'rgba(91, 91, 214, 0.18)',
      itemSelectedColor: '#A9A9F2',
      itemHoverBg: neutral[800],
      itemBorderRadius: radius.sm,
    },
    Card: {
      borderRadiusLG: radius.lg,
    },
    Button: {
      controlHeight: 38,
      primaryShadow: 'none',
      borderRadius: radius.sm,
    },
    Table: {
      headerBg: neutral[900],
      headerColor: neutral[400],
      rowHoverBg: neutral[800],
      borderRadiusLG: radius.md,
    },
  },
};

export const theme = { light, dark };
export type ThemeMode = 'light' | 'dark';

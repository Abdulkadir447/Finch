/**
 * Co-op theme provider (Stage 2: Light/dark theme + global transitions).
 *
 * Owns the active theme mode and hands out the RESOLVED palette, so every
 * design-layer component reads `useCoopTheme().colors` instead of the raw
 * light palette — light and dark then stay in lockstep, including the antd
 * ConfigProvider tree.
 *
 * Mode resolution (Settings → Appearance):
 *   * `light` / `dark` — explicit, persisted instantly.
 *   * `system` (default) — follows the OS `prefers-color-scheme`, live.
 * `toggle()` always lands on an explicit mode (never "system"), so the
 * TopBar switch behaves predictably.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ConfigProvider } from 'antd';
import { colors as lightColors } from './theme/colors';
import { darkColors } from './theme/dark';
import { coopTheme, ThemeMode } from './theme';

const STORAGE_KEY = 'coop:theme';

export interface CoopThemeContextValue {
  mode: ThemeMode;
  isDark: boolean;
  /** The active palette — use this, never the raw light `colors`. */
  colors: typeof lightColors;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const CoopThemeContext = createContext<CoopThemeContextValue>({
  mode: 'system',
  isDark: false,
  colors: lightColors,
  setMode: () => undefined,
  toggle: () => undefined,
});

const MODES: ThemeMode[] = ['light', 'dark', 'system'];

function resolveInitialMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
  } catch {
    /* private mode — fall through to the OS preference */
  }
  return 'system';
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false;
  } catch {
    return false;
  }
}

export const CoopThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>(resolveInitialMode);
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);

  // Live-follow the OS preference while in "system" mode.
  useEffect(() => {
    let media: MediaQueryList | null = null;
    try {
      media = window.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
    } catch {
      return;
    }
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    setSystemDark(media.matches);
    media.addEventListener?.('change', onChange);
    return () => media?.removeEventListener?.('change', onChange);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(MODES.includes(next) ? next : 'system');
  }, []);

  const isDark = mode === 'system' ? systemDark : mode === 'dark';

  const toggle = useCallback(() => {
    setModeState(isDark ? 'light' : 'dark');
  }, [isDark]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* private mode — persistence is a nicety, not a requirement */
    }
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  }, [mode, isDark]);

  // Both palettes share the exact same token shape (colors.ts / dark.ts);
  // the double cast documents that they are interchangeable.
  const value = useMemo<CoopThemeContextValue>(
    () => ({
      mode,
      isDark,
      colors: isDark ? (darkColors as unknown as typeof lightColors) : lightColors,
      setMode,
      toggle,
    }),
    [mode, isDark, setMode, toggle],
  );

  return (
    <CoopThemeContext.Provider value={value}>
      <ConfigProvider theme={isDark ? coopTheme.dark : coopTheme.light}>
        {children}
      </ConfigProvider>
    </CoopThemeContext.Provider>
  );
};

export function useCoopTheme(): CoopThemeContextValue {
  return useContext(CoopThemeContext);
}

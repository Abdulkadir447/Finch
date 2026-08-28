/**
 * Co-op theme provider (Stage 2: Light/dark theme + global transitions).
 *
 * Owns the active theme mode and hands out the RESOLVED palette, so every
 * design-layer component reads `useCoopTheme().colors` instead of the raw
 * light palette — light and dark then stay in lockstep, including the antd
 * ConfigProvider tree.
 *
 * Mode resolution: stored preference (`coop:theme`) wins; otherwise the OS
 * `prefers-color-scheme`. Toggling persists instantly.
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
  mode: 'light',
  isDark: false,
  colors: lightColors,
  setMode: () => undefined,
  toggle: () => undefined,
});

function resolveInitialMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export const CoopThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>(resolveInitialMode);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
  }, []);

  const toggle = useCallback(() => {
    setModeState((m) => (m === 'dark' ? 'light' : 'dark'));
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* private mode — persistence is a nicety, not a requirement */
    }
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  // Both palettes share the exact same token shape (colors.ts / dark.ts);
  // the double cast documents that they are interchangeable.
  const value = useMemo<CoopThemeContextValue>(
    () => ({
      mode,
      isDark: mode === 'dark',
      colors: mode === 'dark' ? (darkColors as unknown as typeof lightColors) : lightColors,
      setMode,
      toggle,
    }),
    [mode, setMode, toggle],
  );

  return (
    <CoopThemeContext.Provider value={value}>
      <ConfigProvider theme={mode === 'dark' ? coopTheme.dark : coopTheme.light}>
        {children}
      </ConfigProvider>
    </CoopThemeContext.Provider>
  );
};

export function useCoopTheme(): CoopThemeContextValue {
  return useContext(CoopThemeContext);
}

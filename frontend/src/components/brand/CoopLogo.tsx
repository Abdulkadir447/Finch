import React from 'react';
import { useCoopTheme } from '../../theme-provider';

/**
 * Co-op brand mark — "two partners, one spark".
 *
 * Two overlapping rounded squares (cooperation), a deeper shared overlap
 * (the common ground), and a four-point spark at the center (intelligence).
 * Built from the design system's purple family so it feels native in both
 * light and dark modes. Inline SVG = crisp at any size, themeable,
 * accessible.
 */
export interface CoopMarkProps {
  size?: number;
  className?: string;
  /** Accessible label (default describes the mark). */
  title?: string;
}

export const CoopMark: React.FC<CoopMarkProps> = ({ size = 32, className, title }) => {
  const id = React.useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b5fef" />
          <stop offset="1" stopColor="#4143d5" />
        </linearGradient>
        <linearGradient id={`${id}-b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8a4cfc" />
          <stop offset="1" stopColor="#712ae2" />
        </linearGradient>
        <linearGradient id={`${id}-o`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#474adb" />
          <stop offset="1" stopColor="#4143d5" />
        </linearGradient>
      </defs>
      <rect x="4" y="9" width="27" height="27" rx="9" fill={`url(#${id}-a)`} />
      <rect x="17" y="12" width="27" height="27" rx="9" fill={`url(#${id}-b)`} />
      <rect x="17" y="12" width="14" height="24" rx="8" fill={`url(#${id}-o)`} />
      <path
        d="M24 15 Q25.2 21.2 31 24 Q25.2 26.8 24 33 Q22.8 26.8 17 24 Q22.8 21.2 24 15 Z"
        fill="#ffffff"
      />
    </svg>
  );
};

export interface CoopLogoProps {
  /** Mark size in px (wordmark scales with it). */
  size?: number;
  /** Hide the wordmark (icon-only usage). */
  iconOnly?: boolean;
  className?: string;
  /** Small-caps subtitle under the wordmark (sidebar usage). */
  subtitle?: string;
}

/**
 * Co-op combined lockup: mark + "Co-op" wordmark.
 * The wordmark is real text (crisp, selectable, theme-aware) rather than
 * a raster/SVG font.
 */
export const CoopLogo: React.FC<CoopLogoProps> = ({ size = 32, iconOnly = false, className, subtitle }) => {
  const { colors } = useCoopTheme();
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: Math.max(8, size * 0.26) }}>
      <CoopMark size={size} title="Co-op" />
      {!iconOnly && (
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1, minWidth: 0 }}>
          <span
            style={{
              fontSize: Math.round(size * 0.62),
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: colors.primary,
              whiteSpace: 'nowrap',
            }}
          >
            Co-op
          </span>
          {subtitle && (
            <span
              style={{
                fontSize: Math.max(9, Math.round(size * 0.24)),
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: colors.onSurfaceVariant,
                whiteSpace: 'nowrap',
              }}
            >
              {subtitle}
            </span>
          )}
        </span>
      )}
    </span>
  );
};

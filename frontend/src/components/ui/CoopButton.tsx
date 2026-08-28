/**
 * CoopButton — the Co-op action primitive (Stage R1 "Buttons").
 *
 * Variants:
 *   primary   solid primary, white text, hover → primaryContainer
 *   secondary white, 1px outline-variant border, primary text
 *   ghost     primary text, hover → surface-container-low
 *   danger    solid error, white text
 *   ai        signature gradient + sparkle (AI triggers only)
 *
 * Wraps antd Button so loading/disabled/href/icon behave identically to the
 * rest of the app; colors resolve from the active theme (light/dark).
 */
import React from 'react';
import { Button } from 'antd';
import type { ButtonProps } from 'antd';
import { radius, shadow, transition } from '../../theme';
import { useCoopTheme } from '../../theme-provider';
import { SparkleIcon } from './icons';

export type CoopButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ai';
export type CoopButtonSize = 'sm' | 'md' | 'lg';

export interface CoopButtonProps extends Omit<ButtonProps, 'variant' | 'size'> {
  variant?: CoopButtonVariant;
  size?: CoopButtonSize;
  block?: boolean;
}

const SIZE: Record<CoopButtonSize, { h: number; px: number; fs: number }> = {
  sm: { h: 30, px: 12, fs: 12 },
  md: { h: 38, px: 16, fs: 13 },
  lg: { h: 44, px: 24, fs: 14 },
};

const CoopButton: React.FC<CoopButtonProps> = ({
  variant = 'primary',
  size = 'md',
  block = false,
  icon,
  children,
  style,
  ...rest
}) => {
  const { colors, isDark } = useCoopTheme();
  const s = SIZE[size];

  const baseStyle: React.CSSProperties = {
    height: s.h,
    padding: `0 ${s.px}px`,
    fontSize: s.fs,
    fontWeight: 600,
    borderRadius: radius.lg,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    transition: `${transition('background-color, color, border-color, box-shadow')}, transform 150ms`,
  };

  let variantStyle: React.CSSProperties;
  switch (variant) {
    case 'secondary':
      variantStyle = {
        background: colors.surfaceContainerLowest,
        border: `1px solid ${colors.outlineVariant}`,
        color: colors.primary,
        boxShadow: 'none',
      };
      break;
    case 'ghost':
      variantStyle = {
        background: 'transparent',
        border: '1px solid transparent',
        color: colors.primary,
        boxShadow: 'none',
      };
      break;
    case 'danger':
      variantStyle = {
        background: colors.error,
        border: `1px solid ${colors.error}`,
        color: colors.onError,
        boxShadow: 'none',
      };
      break;
    case 'ai':
      variantStyle = {
        background: `linear-gradient(135deg, ${colors.primaryContainer} 0%, ${colors.secondaryContainer} 100%)`,
        border: '1px solid transparent',
        color: colors.onPrimary,
        boxShadow: isDark ? shadow.overlay : shadow.lift,
      };
      break;
    case 'primary':
    default:
      variantStyle = {
        background: isDark ? colors.primaryContainer : colors.primary,
        border: `1px solid ${isDark ? colors.primaryContainer : colors.primary}`,
        color: colors.onPrimary,
        boxShadow: 'none',
      };
  }

  const isAi = variant === 'ai';
  return (
    <Button
      icon={isAi ? <SparkleIcon size={15} color={colors.onPrimary} /> : icon}
      style={{ ...baseStyle, ...variantStyle, ...(block ? { width: '100%' } : {}), ...style }}
      type={variant === 'primary' || variant === 'danger' || variant === 'ai' ? 'primary' : variant === 'secondary' ? 'default' : 'text'}
      danger={variant === 'danger' ? true : undefined}
      size={size === 'sm' ? 'small' : size === 'lg' ? 'large' : 'middle'}
      block={block}
      {...rest}
    >
      {children}
    </Button>
  );
};

export default CoopButton;

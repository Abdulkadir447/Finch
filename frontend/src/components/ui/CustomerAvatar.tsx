import React from 'react';
import { radius } from '../../theme';
import { useCoopTheme } from '../../theme-provider';

export interface CustomerAvatarProps {
  name: string;
  size?: number;
}

/**
 * Customer avatar — initials on the brand-tinted disc (Stitch catalog
 * pattern). Real images are not part of the customer model, so initials
 * are the honest representation.
 */
const CustomerAvatar: React.FC<CustomerAvatarProps> = ({ name, size = 38 }) => {
  const { colors } = useCoopTheme();
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: radius.full,
        background: colors.primaryFixed,
        color: colors.onPrimaryFixedVariant,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: Math.round(size * 0.34),
        flexShrink: 0,
        letterSpacing: '0.02em',
      }}
    >
      {initials || '?'}
    </span>
  );
};

export default CustomerAvatar;

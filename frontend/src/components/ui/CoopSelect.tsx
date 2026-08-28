/**
 * CoopSelect — the Co-op dropdown/select primitive (Stage 1 "Dropdowns").
 *
 * Wraps antd Select with the Co-op chrome: an optional label-caps label
 * above, the token focus treatment, and a consistent options shape. Wraps
 * antd Select so async/combobox/show-search behaviour is unchanged; only the
 * presentation is standardized to the Co-op design layer.
 */
import React from 'react';
import { Select } from 'antd';
import type { SelectProps } from 'antd';
import { spacing, type } from '../../theme';
import { useCoopTheme } from '../../theme-provider';

export interface CoopOption {
  value: string | number;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface CoopSelectProps
  extends Omit<SelectProps, 'options' | 'label'> {
  /** Field label rendered above (label-caps, uppercase). */
  label?: string;
  /** Options in the Co-op { value, label, disabled? } shape. */
  options?: CoopOption[];
}

const CoopSelect: React.FC<CoopSelectProps> = ({
  label,
  options,
  style,
  ...rest
}) => {
  const { colors } = useCoopTheme();

  const select = (
    <Select
      options={options}
      style={{ width: '100%', ...style }}
      {...rest}
    />
  );

  if (!label) return select;

  return (
    <div style={{ width: '100%' }}>
      <label
        style={{
          display: 'block',
          marginBottom: 4,
          ...type.labelCaps,
          textTransform: 'uppercase',
          color: colors.onSurfaceVariant,
        }}
      >
        {label}
      </label>
      {select}
    </div>
  );
};

export default CoopSelect;

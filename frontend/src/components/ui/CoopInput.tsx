/**
 * CoopInput — the Co-op form-field primitive (Stage R1 "Form Fields").
 *
 * Label (label-caps, uppercase) + antd Input/TextArea with the token focus
 * treatment (primary border + soft 3px halo). Search adds the icon prefix
 * and the app's consistent placeholder voice.
 */
import React from 'react';
import { Input } from 'antd';
import type { InputProps, InputRef } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { spacing, type } from '../../theme';
import { useCoopTheme } from '../../theme-provider';

export interface CoopInputProps extends Omit<InputProps, 'label'> {
  /** Field label rendered above the input. */
  label?: string;
  /** Render the search icon prefix (and default width 320). */
  search?: boolean;
  /** Render as a multi-line textarea. */
  textarea?: boolean;
  rows?: number;
  ref?: React.Ref<InputRef>;
}

const CoopInput = React.forwardRef<InputRef, CoopInputProps>(
  ({ label, search = false, textarea = false, rows = 3, placeholder, style, prefix, ...rest }, ref) => {
    const { colors } = useCoopTheme();

    const labelStyle: React.CSSProperties = {
      display: 'block',
      marginBottom: spacing.xs,
      ...type.labelCaps,
      textTransform: 'uppercase',
      color: colors.onSurfaceVariant,
    };

    const inputStyle: React.CSSProperties = {
      width: '100%',
      ...(search ? {} : { maxWidth: 420 }),
      ...style,
    };

    const control = textarea ? (
      // TextArea has no icon prefix — drop it for the multi-line variant.
      // `rest` is InputProps (input events); the cast is safe for the shared
      // props consumers actually pass (value/onChange/maxLength/rules…).
      <Input.TextArea
        ref={ref as React.Ref<React.ComponentRef<typeof Input.TextArea>>}
        rows={rows}
        placeholder={placeholder ?? 'Write details here'}
        style={inputStyle}
        {...(rest as React.ComponentProps<typeof Input.TextArea>)}
      />
    ) : (
      <Input
        ref={ref}
        allowClear
        prefix={prefix ?? (search ? <SearchOutlined style={{ color: colors.outline }} /> : undefined)}
        placeholder={placeholder ?? (search ? 'Search…' : undefined)}
        style={inputStyle}
        {...rest}
      />
    );

    if (!label) return control;
    return (
      <div style={{ width: '100%' }}>
        <label style={labelStyle}>{label}</label>
        {control}
      </div>
    );
  },
);

CoopInput.displayName = 'CoopInput';
export default CoopInput;

/**
 * FilePreview — shows what the parser saw (spec item 1/2): file name, format,
 * row count, detected dataset + confidence, and a sample of the rows.
 */
import React from 'react';
import { radius, type } from '../../theme';
import { useCoopTheme } from '../../theme-provider';
import { CoopBadge, CoopCard } from '../../components/ui';
import type { PreviewPayload, SchemaPayload } from '../types';

export interface FilePreviewProps {
  preview: PreviewPayload;
  schemas: SchemaPayload | null;
  onEntityChange: (entity: string) => void;
}

const FilePreview: React.FC<FilePreviewProps> = ({ preview, schemas, onEntityChange }) => {
  const { colors } = useCoopTheme();
  const cols = preview.columns.slice(0, 8);

  return (
    <CoopCard>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span style={{ ...type.titleMd, color: colors.onSurface }}>{preview.filename}</span>
        <CoopBadge variant="neutral">{preview.fmt.toUpperCase()}</CoopBadge>
        <CoopBadge variant="primary">{preview.row_count.toLocaleString()} rows</CoopBadge>
        {preview.entity && (
          <span style={{ ...type.bodyCompact, color: colors.onSurfaceVariant }}>
            Detected as{' '}
            <strong style={{ color: colors.onSurface }}>
              {schemas?.datasets[preview.entity]?.label ?? preview.entity}
            </strong>
            {preview.entity_confidence >= 0.6 ? '' : ' (low confidence)'}
          </span>
        )}
        <select
          value={preview.entity ?? ''}
          onChange={(e) => onEntityChange(e.target.value)}
          aria-label="Dataset type"
          style={{
            marginLeft: 'auto',
            border: `1px solid ${colors.outlineVariant}`,
            borderRadius: radius.md,
            padding: '6px 10px',
            background: colors.surfaceContainerLowest,
            color: colors.onSurface,
            fontSize: 13,
          }}
        >
          {Object.entries(schemas?.datasets ?? {}).map(([k, d]) => (
            <option key={k} value={k}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      <div style={{ overflowX: 'auto', borderRadius: radius.md, border: `1px solid ${colors.borderSubtle}` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', ...type.bodyCompact }}>
          <thead>
            <tr style={{ background: colors.surfaceContainerLow }}>
              {cols.map((c, i) => (
                <th
                  key={i}
                  style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    ...type.labelCaps,
                    color: colors.outline,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c || `Column ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.sample_rows.slice(0, 3).map((r, ri) => (
              <tr key={ri} style={{ borderTop: `1px solid ${colors.borderSubtle}` }}>
                {cols.map((_, ci) => (
                  <td
                    key={ci}
                    style={{
                      padding: '8px 12px',
                      color: colors.onSurfaceVariant,
                      whiteSpace: 'nowrap',
                      maxWidth: 220,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {r[ci] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CoopCard>
  );
};

export default FilePreview;

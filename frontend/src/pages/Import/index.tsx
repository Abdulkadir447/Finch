/**
 * Intelligent Import (v1 "Instant Onboarding") — Pass 1 + 2 UI.
 *
 * Flow:
 *   1. Upload (drag & drop .csv/.xlsx) -> server parses + detects dataset
 *      + SUGGESTS a column mapping with confidence (AI/alias mapper)
 *   2. Review the mapping (edit any target, or ignore a column) -> Run import
 *   3. Result: created / skipped / row errors + "View your Day 1 Briefing"
 *
 * Trust model: the mapper only suggests; the user confirms; the server
 * executes. No blind AI writes.
 */
import React, { useCallback, useRef, useState } from 'react';
import { message } from 'antd';
import {
  CheckCircleFilled,
  ExclamationCircleFilled,
  InboxOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { radius, spacing, type } from '../../theme';
import { useCoopTheme } from '../../theme-provider';
import { useApiClient, ApiError } from '../../services/api/client';
import PageHeader from '../../components/layout/PageHeader';
import { CoopBadge, CoopButton, CoopCard, CoopEmptyState } from '../../components/ui';

// ---------------------------------------------------------------------------
// Types (mirror the backend payloads)
// ---------------------------------------------------------------------------
interface MappingSuggestion {
  column: string;
  target: string | null;
  confidence: number;
  label: 'High' | 'Medium' | 'Review';
  hints: string[];
}

interface PreviewPayload {
  filename: string;
  fmt: string;
  row_count: number;
  columns: string[];
  sample_rows: string[][];
  entity: string | null;
  entity_confidence: number;
}

/** POST /imports/map — the mapper only ever sees headers + a 50-row sample. */
interface MapResponse {
  entity: string;
  mappings: Array<{
    column: string;
    field: string | null;
    confidence: number;
    label: 'High' | 'Medium' | 'Review';
    hints: string[];
  }>;
}

interface SchemasPayload {
  datasets: Record<
    string,
    { label: string; description: string; fields: Record<string, { label: string; required: boolean; kind: string }> }
  >;
}

/** POST /imports/commit — the only mutating import endpoint. */
interface ImportResult {
  entity: string;
  batch_id: number;
  total_rows: number;
  created: Record<string, number>;
  skipped: Record<string, number>;
  errors: Array<{ row: number; detail: string }>;
  warnings: string[];
}

type Step = 'upload' | 'mapping' | 'result';

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------
const Steps: React.FC<{ step: Step }> = ({ step }) => {
  const { colors } = useCoopTheme();
  const steps: Array<{ key: Step; label: string }> = [
    { key: 'upload', label: 'Upload' },
    { key: 'mapping', label: 'Review mapping' },
    { key: 'result', label: 'Done' },
  ];
  const activeIdx = steps.findIndex((s) => s.key === step);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: spacing.lg }}>
      {steps.map((s, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        return (
          <React.Fragment key={s.key}>
            {i > 0 && (
              <span aria-hidden style={{ width: 24, height: 2, background: colors.borderSubtle }} />
            )}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '6px 12px',
                borderRadius: radius.full,
                background: active ? colors.primary : done ? colors.primaryFixed : colors.surfaceContainerLow,
                color: active ? colors.onPrimary : done ? colors.onPrimaryFixedVariant : colors.onSurfaceVariant,
                fontWeight: 600,
                fontSize: 12.5,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: active ? 'rgba(255,255,255,0.25)' : done ? colors.primary : colors.surfaceContainer,
                  color: active || done ? colors.onPrimary : colors.outline,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {done ? <CheckCircleFilled style={{ color: colors.onPrimary }} /> : i + 1}
              </span>
              {s.label}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
const ImportPage: React.FC = () => {
  const { colors } = useCoopTheme();
  const navigate = useNavigate();
  const api = useApiClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [schemas, setSchemas] = useState<SchemasPayload | null>(null);
  const [suggestions, setSuggestions] = useState<MappingSuggestion[]>([]);
  const [dataset, setDataset] = useState<string>('products');
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pendingFileRef = useRef<File | null>(null);
  // Guard against out-of-order /imports/map responses (fast dataset switches).
  const mapReqRef = useRef(0);

  const loadSchemas = useCallback(async () => {
    if (schemas) return;
    try {
      const { data } = await api.get<SchemasPayload>('/imports/schema');
      setSchemas(data);
    } catch {
      /* non-fatal: mapping review still works from the preview payload */
    }
  }, [api, schemas]);

  const loadMapping = useCallback(
    async (entity: string, columns: string[], sampleRows: string[][]) => {
      const req = ++mapReqRef.current;
      try {
        const { data } = await api.post<MapResponse>('/imports/map', {
          entity,
          headers: columns,
          sample_rows: sampleRows,
        });
        if (req !== mapReqRef.current) return; // a newer request superseded this one
        const next: MappingSuggestion[] = data.mappings.map((s) => ({
          column: s.column,
          target: s.field,
          confidence: s.confidence,
          label: s.label,
          hints: s.hints,
        }));
        setSuggestions(next);
        const m: Record<string, string | null> = {};
        next.forEach((s) => {
          m[s.column] = s.target;
        });
        setMapping(m);
      } catch {
        /* non-fatal: the user can map columns by hand */
      }
    },
    [api],
  );

  const handleFile = useCallback(
    async (file: File) => {
      const name = file.name.toLowerCase();
      if (!name.endsWith('.csv') && !name.endsWith('.xlsx') && !name.endsWith('.txt')) {
        message.error('Use a .csv or .xlsx file.');
        return;
      }
      pendingFileRef.current = file;
      setUploading(true);
      setError(null);
      try {
        const fd = new FormData();
        fd.append('file', file);
        const { data } = await api.post<PreviewPayload>('/imports/preview', fd);
        setPreview(data);
        const entity = data.entity || 'products';
        setDataset(entity);
        setStep('mapping');
        void loadSchemas();
        void loadMapping(entity, data.columns, data.sample_rows);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Could not read the file.');
      } finally {
        setUploading(false);
      }
    },
    [api, loadSchemas, loadMapping],
  );

  const runImport = useCallback(async () => {
    if (!preview) return;
    setRunning(true);
    setError(null);
    try {
      const fd = new FormData();
      // Re-upload the same file with the confirmed mapping (stateless v1).
      const file = pendingFileRef.current;
      if (!file) throw new Error('File lost — please upload it again.');
      fd.append('file', file);
      fd.append('entity', dataset);
      fd.append('mapping', JSON.stringify(mapping));
      const { data } = await api.post<ImportResult>('/imports/commit', fd);
      setResult(data);
      setStep('result');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The import failed.');
    } finally {
      setRunning(false);
    }
  }, [api, dataset, mapping, preview]);

  // Keep a reference to the uploaded file for the commit call.
  const wrapHandleFile = useCallback(
    (file: File) => {
      pendingFileRef.current = file;
      void handleFile(file);
    },
    [handleFile],
  );

  const fields = schemas?.datasets[dataset]?.fields;
  const matchedCount = suggestions.filter((s) => s.target).length;
  const reviewCount = suggestions.filter((s) => !s.target).length;

  const reset = () => {
    setStep('upload');
    setPreview(null);
    setSuggestions([]);
    setMapping({});
    setResult(null);
    setError(null);
    pendingFileRef.current = null;
    mapReqRef.current += 1; // invalidate any in-flight /imports/map response
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const createdTotal = result
    ? Object.values(result.created).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div style={{ maxWidth: 960 }}>
      <PageHeader
        title="Import your business data"
        subtitle="Bring your history from your old system. Co-op maps the columns, you confirm, and your Day 1 Briefing is ready."
      />
      <Steps step={step} />

      {error && step !== 'result' && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            borderRadius: radius.lg,
            background: `rgba(186, 26, 26, 0.08)`,
            border: '1px solid rgba(186, 26, 26, 0.25)',
            ...type.bodyCompact,
            color: colors.error,
            marginBottom: spacing.md,
          }}
        >
          <ExclamationCircleFilled />
          {error}
          {step === 'upload' && (
            <CoopButton size="sm" variant="secondary" onClick={reset} style={{ marginLeft: 'auto' }}>
              Try another file
            </CoopButton>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------- Upload */}
      {step === 'upload' && (
        <CoopCard>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) wrapHandleFile(f);
            }}
            style={{
              border: `2px dashed ${dragOver ? colors.primary : colors.outlineVariant}`,
              borderRadius: radius.xl,
              padding: '56px 24px',
              textAlign: 'center',
              background: dragOver ? colors.primaryFixed : colors.surfaceContainerLow,
              transition: 'all 150ms',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.txt"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) wrapHandleFile(f);
              }}
            />
            <span
              aria-hidden
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: colors.primaryFixed,
                color: colors.onPrimaryFixedVariant,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
                marginBottom: 16,
              }}
            >
              <InboxOutlined />
            </span>
            <div style={{ ...type.titleMd, color: colors.onSurface, marginBottom: 6 }}>
              Drag & drop your spreadsheet here
            </div>
            <div style={{ ...type.bodyCompact, color: colors.onSurfaceVariant, marginBottom: 18 }}>
              CSV or Excel (.xlsx) export from your old system — products, customers or sales history.
            </div>
            <CoopButton
              icon={<UploadOutlined />}
              loading={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? 'Reading file…' : 'Choose a file'}
            </CoopButton>
          </div>
          <div style={{ ...type.bodyCompact, fontSize: 12, color: colors.outline, marginTop: 14, textAlign: 'center' }}>
            Excel: first worksheet only, clean tables. Nothing is written until you review the mapping and confirm.
          </div>
        </CoopCard>
      )}

      {/* -------------------------------------------------------- Mapping */}
      {step === 'mapping' && preview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          <CoopCard>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <span style={{ ...type.titleMd, color: colors.onSurface }}>{preview.filename}</span>
              <CoopBadge variant="neutral">{preview.fmt.toUpperCase()}</CoopBadge>
              <CoopBadge variant="primary">{preview.row_count} rows</CoopBadge>
              {preview.entity && (
                <span style={{ ...type.bodyCompact, color: colors.onSurfaceVariant }}>
                  Detected as <strong>{schemas?.datasets[preview.entity]?.label ?? preview.entity}</strong>
                  {preview.entity_confidence >= 0.6 ? '' : ' (low confidence)'}
                </span>
              )}
            </div>
            {/* Sample preview */}
            <div style={{ overflowX: 'auto', borderRadius: radius.md, border: `1px solid ${colors.borderSubtle}` }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', ...type.bodyCompact }}>
                <thead>
                  <tr style={{ background: colors.surfaceContainerLow }}>
                    {preview.columns.slice(0, 8).map((c) => (
                      <th
                        key={c}
                        style={{
                          padding: '8px 12px',
                          textAlign: 'left',
                          ...type.labelCaps,
                          color: colors.outline,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sample_rows.slice(0, 3).map((r, ri) => (
                    <tr key={ri} style={{ borderTop: `1px solid ${colors.borderSubtle}` }}>
                      {preview.columns.slice(0, 8).map((_, ci) => (
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

          <CoopCard
            title="Check the column mapping"
            subtitle="Co-op suggested these matches — adjust any of them, or ignore a column."
            extra={
              <select
                value={dataset}
                onChange={(e) => {
                  const next = e.target.value;
                  setDataset(next);
                  // Re-suggest against the chosen dataset (new target fields).
                  if (preview) void loadMapping(next, preview.columns, preview.sample_rows);
                }}
                aria-label="Dataset type"
                style={{
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
            }
          >
            <div style={{ ...type.bodyCompact, marginBottom: 12, color: colors.onSurfaceVariant }}>
              <strong style={{ color: colors.onSurface }}>{matchedCount}</strong> of {suggestions.length} columns
              matched{reviewCount > 0 ? (
                <> — <strong style={{ color: colors.warning }}>{reviewCount} need your review</strong></>
              ) : ' ✓'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {suggestions.map((s) => (
                <div
                  key={s.column}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: radius.md,
                    border: `1px solid ${mapping[s.column] ? colors.borderSubtle : 'rgba(224, 161, 6, 0.45)'}`,
                    background: mapping[s.column] ? 'transparent' : `rgba(224, 161, 6, 0.06)`,
                  }}
                >
                  <span
                    style={{
                      ...type.bodyCompact,
                      fontWeight: 600,
                      color: colors.onSurface,
                      minWidth: 140,
                      maxWidth: 220,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {s.column}
                  </span>
                  <span aria-hidden style={{ color: colors.outline }}>→</span>
                  <select
                    value={mapping[s.column] ?? ''}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, [s.column]: e.target.value || null }))
                    }
                    aria-label={`Target field for ${s.column}`}
                    style={{
                      flex: 1,
                      minWidth: 180,
                      border: `1px solid ${colors.outlineVariant}`,
                      borderRadius: radius.md,
                      padding: '6px 10px',
                      background: colors.surfaceContainerLowest,
                      color: colors.onSurface,
                      fontSize: 13,
                    }}
                  >
                    <option value="">— Ignore this column —</option>
                    {fields
                      ? Object.entries(fields).map(([k, f]) => (
                          <option key={k} value={k}>
                            {f.label}
                            {f.required ? ' *' : ''}
                          </option>
                        ))
                      : null}
                  </select>
                  <CoopBadge
                    variant={s.label === 'High' ? 'primary' : s.label === 'Medium' ? 'info' : 'warning'}
                  >
                    {s.label}
                  </CoopBadge>
                  {s.hints[0] && (
                    <span style={{ ...type.bodyCompact, fontSize: 11.5, color: colors.outline, width: '100%', marginLeft: 44 }}>
                      {s.hints[0]}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CoopCard>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <CoopButton variant="secondary" onClick={reset}>
              Start over
            </CoopButton>
            <CoopButton loading={running} onClick={runImport}>
              {running ? 'Importing…' : `Import ${preview.row_count} rows`}
            </CoopButton>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- Result */}
      {step === 'result' && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          {createdTotal === 0 ? (
            <CoopCard>
              <CoopEmptyState
                title="Nothing was imported"
                description={
                  result.errors.length > 0
                    ? 'Every row had a problem — see the details below.'
                    : 'All rows already existed or were skipped. See the skipped counts below.'
                }
              />
            </CoopCard>
          ) : (
            <CoopCard
              title="Import complete"
              subtitle={`Co-op imported ${createdTotal} record${createdTotal === 1 ? '' : 's'} from ${result.total_rows} rows.`}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                {Object.entries(result.created)
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => (
                    <div
                      key={k}
                      style={{
                        padding: '14px 16px',
                        borderRadius: radius.md,
                        background: colors.primaryFixed,
                        ...type.bodyCompact,
                        color: colors.onPrimaryFixedVariant,
                      }}
                    >
                      <div style={{ ...type.sectionHeading, fontSize: 22, color: colors.onPrimaryFixedVariant }}>
                        {v}
                      </div>
                      {k.replace(/_/g, ' ')}
                    </div>
                  ))}
                {Object.entries(result.skipped)
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => (
                    <div
                      key={k}
                      style={{
                        padding: '14px 16px',
                        borderRadius: radius.md,
                        background: colors.surfaceContainerLow,
                        ...type.bodyCompact,
                        color: colors.onSurfaceVariant,
                      }}
                    >
                      <div style={{ ...type.sectionHeading, fontSize: 22 }}>{v}</div>
                      {k.replace(/_/g, ' ')}
                    </div>
                  ))}
              </div>
              {result.warnings.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                  {result.warnings.map((w) => (
                    <div
                      key={w}
                      style={{
                        display: 'flex',
                        gap: 8,
                        ...type.bodyCompact,
                        fontSize: 12.5,
                        color: colors.onSurfaceVariant,
                      }}
                    >
                      <ExclamationCircleFilled style={{ color: colors.warning, marginTop: 2 }} />
                      {w}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                <CoopButton variant="secondary" onClick={reset}>
                  Import another file
                </CoopButton>
                <CoopButton onClick={() => navigate('/briefing')}>View your Day 1 Briefing</CoopButton>
              </div>
            </CoopCard>
          )}

          {result.errors.length > 0 && (
            <CoopCard title="Rows that couldn't be imported" subtitle="These rows were skipped — fix them in the source file and re-import.">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {result.errors.map((e) => (
                  <div
                    key={`${e.row}-${e.detail}`}
                    style={{
                      display: 'flex',
                      gap: 10,
                      padding: '8px 12px',
                      borderRadius: radius.md,
                      background: `rgba(186, 26, 26, 0.06)`,
                      ...type.bodyCompact,
                      fontSize: 12.5,
                    }}
                  >
                    <span style={{ color: colors.error, fontWeight: 700 }}>Row {e.row}</span>
                    <span style={{ color: colors.onSurfaceVariant }}>{e.detail}</span>
                  </div>
                ))}
              </div>
            </CoopCard>
          )}
        </div>
      )}
    </div>
  );
};


export default ImportPage;

/**
 * Intelligent Import — shared types (v1 Instant Onboarding).
 *
 * Mirrors the backend /imports/* payloads. The import flow is a 5-stage
 * trust model: preview (parse) -> map (AI suggests) -> review (user edits)
 * -> validate (read-only) -> commit (the only write, in one transaction).
 */

/** One column -> Co-op field suggestion from the mapper. */
export interface MappingSuggestion {
  column: string;
  field: string | null;
  confidence: number;
  label: 'High' | 'Medium' | 'Review';
  hints: string[];
}

export interface PreviewPayload {
  filename: string;
  fmt: string;
  row_count: number;
  columns: string[];
  sample_rows: string[][];
  entity: string | null;
  entity_confidence: number;
}

export interface MapPayload {
  entity: string;
  mappings: MappingSuggestion[];
}

export interface SchemaField {
  label: string;
  required: boolean;
  kind: string;
}

export interface SchemaDataset {
  label: string;
  description: string;
  fields: Record<string, SchemaField>;
}

export interface SchemaPayload {
  datasets: Record<string, SchemaDataset>;
}

export interface ValidationPayload {
  entity: string;
  total_rows: number;
  valid_rows: number;
  duplicates: Record<string, number>;
  unknown_refs: Record<string, number>;
  would_create: Record<string, number>;
  errors: Array<{ row: number; detail: string }>;
  error_fields: Record<string, number>;
  warnings: string[];
}

export interface CommitPayload {
  entity: string;
  batch_id: number;
  total_rows: number;
  created: Record<string, number>;
  skipped: Record<string, number>;
  errors: Array<{ row: number; detail: string }>;
  warnings: string[];
}

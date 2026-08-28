/**
 * Intelligent Import — API client (v1 Instant Onboarding).
 *
 * The five stages, each a single endpoint. The mapper (stage 2) receives
 * ONLY headers + a sample of rows — never the full file (spec item 2).
 * Only /imports/commit mutates the database (spec item 7).
 */
import { ApiError, useApiClient } from '../../services/api/client';
import type {
  CommitPayload,
  MapPayload,
  PreviewPayload,
  SchemaPayload,
  ValidationPayload,
} from '../types';

export interface ImportMapping {
  entity: string;
  /** { source_column: target_field_key | null } */
  mapping: Record<string, string | null>;
}

/** Stage 1 — parse + detect dataset (server-side, returns headers+sample). */
export async function previewImport(
  api: ReturnType<typeof useApiClient>,
  file: File,
): Promise<PreviewPayload> {
  const fd = new FormData();
  fd.append('file', file);
  const { data } = await api.post<PreviewPayload>('/imports/preview', fd);
  return data;
}

/** Stage 2 — AI suggests a mapping from headers + sample only (no file). */
export async function mapImport(
  api: ReturnType<typeof useApiClient>,
  entity: string,
  headers: string[],
  sampleRows: string[][],
): Promise<MapPayload> {
  const { data } = await api.post<MapPayload>('/imports/map', {
    entity,
    headers,
    sample_rows: sampleRows,
  });
  return data;
}

/** Stage 3 — read-only validation pass (NO writes, spec item 6). */
export async function validateImport(
  api: ReturnType<typeof useApiClient>,
  file: File,
  { entity, mapping }: ImportMapping,
): Promise<ValidationPayload> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('entity', entity);
  fd.append('mapping', JSON.stringify(mapping));
  const { data } = await api.post<ValidationPayload>('/imports/validate', fd);
  return data;
}

/** Stage 4 — the ONLY mutating call: one transaction, batch-stamped. */
export async function commitImport(
  api: ReturnType<typeof useApiClient>,
  file: File,
  { entity, mapping }: ImportMapping,
): Promise<CommitPayload> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('entity', entity);
  fd.append('mapping', JSON.stringify(mapping));
  const { data } = await api.post<CommitPayload>('/imports/commit', fd);
  return data;
}

/** Strict Co-op schema for the mapping UI (the mapper may only target these). */
export async function fetchImportSchema(
  api: ReturnType<typeof useApiClient>,
): Promise<SchemaPayload> {
  const { data } = await api.get<SchemaPayload>('/imports/schema');
  return data;
}

export { ApiError };

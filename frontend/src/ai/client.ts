/**
 * Co-op AI — backend client (AI Platform phase).
 *
 * Talks to /ai/chat and /ai/usage. The backend guarantees the trust model:
 * verified context -> model -> structured answer contract -> validated
 * action drafts -> metered usage. This client never invents data itself;
 * it just transports the verified, structured result.
 */
import type { AxiosInstance } from 'axios';

export interface AiChatLink {
  label: string;
  to: string;
}

export interface AiChatAction {
  type: string;
  /** DRAFT_ORDER: already the DraftOrder shape (resolved ids/prices). */
  parameters: {
    customer: { id: number; full_name: string; email: string };
    lines: Array<{ product_id: number; name: string; sku: string; quantity: number; unit_price: number }>;
    total: number;
    note?: string;
  };
}

export interface AiChatResult {
  type: 'answer' | 'clarify';
  kind: 'fact' | 'calculation' | 'forecast' | 'suggestion' | 'draft' | 'clarify' | 'error';
  title: string;
  message: string;
  basis: { period: string | null; sources: string[] };
  follow_ups: string[];
  links: AiChatLink[];
  actions: AiChatAction[];
  actions_rejected: Array<{ type: string; reason: string }>;
  source: 'assistant';
  model: string | null;
  credits_used: number;
}

export interface AiUsageMonth {
  month: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  credits_used: number;
}

/** One grounded AI turn. Throws on 503 (assistant unavailable). */
export async function aiChat(
  api: AxiosInstance,
  question: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<AiChatResult> {
  const { data } = await api.post<AiChatResult>('/ai/chat', { question, history });
  return data;
}

/** Real metered AI usage for the current month (billing's source of truth). */
export async function fetchAiUsage(api: AxiosInstance): Promise<AiUsageMonth> {
  const { data } = await api.get<AiUsageMonth>('/ai/usage');
  return data;
}

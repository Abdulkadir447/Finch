/**
 * Co-op AI — conversation state + history (Stage 2.2, Layer 2).
 *
 * Conversations persist locally (localStorage) so history survives reloads
 * — the assistant itself stays stateless and data-driven.
 */
import { useCallback, useEffect, useState } from 'react';
import { askCoop } from './ask';
import type { AiDataBundle } from './data';
import type { AiMessage, Conversation } from './types';

const STORAGE_KEY = 'coop:ai-conversations';
const MAX_CONVERSATIONS = 20;
const MAX_MESSAGES = 100;

let seq = 0;
const uid = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

function loadStored(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Conversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useConversation(bundle: AiDataBundle) {
  const [conversations, setConversations] = useState<Conversation[]>(loadStored);
  const [activeId, setActiveId] = useState<string | null>(null);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations.slice(0, MAX_CONVERSATIONS)));
    } catch {
      /* storage full/blocked — history is a nicety */
    }
  }, [conversations]);

  const startNew = useCallback(() => {
    const c: Conversation = {
      id: uid(),
      title: 'New conversation',
      messages: [],
      created: Date.now(),
      updated: Date.now(),
    };
    setConversations((prev) => [c, ...prev].slice(0, MAX_CONVERSATIONS));
    setActiveId(c.id);
    return c.id;
  }, []);

  const select = useCallback((id: string) => setActiveId(id), []);

  const remove = useCallback(
    (id: string) => {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      setActiveId((cur) => (cur === id ? null : cur));
    },
    [],
  );

  const clearAll = useCallback(() => {
    setConversations([]);
    setActiveId(null);
  }, []);

  /** Ask a question: appends the user message + the grounded answer. */
  const ask = useCallback(
    (question: string) => {
      const text = question.trim();
      if (!text) return;
      let convId = activeId;
      if (!convId) {
        const c: Conversation = {
          id: uid(),
          title: text.length > 42 ? `${text.slice(0, 42)}…` : text,
          messages: [],
          created: Date.now(),
          updated: Date.now(),
        };
        convId = c.id;
        setConversations((prev) => [c, ...prev].slice(0, MAX_CONVERSATIONS));
        setActiveId(c.id);
      }

      const userMsg: AiMessage = { id: uid(), role: 'user', text, ts: Date.now() };
      const answer = askCoop(text, bundle);
      const coopMsg: AiMessage = { id: uid(), role: 'coop', answer, ts: Date.now() };

      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                updated: Date.now(),
                // Title a fresh conversation with its first question.
                title:
                  c.messages.length === 0 && c.title === 'New conversation'
                    ? text.length > 42
                      ? `${text.slice(0, 42)}…`
                      : text
                    : c.title,
                messages: [...c.messages, userMsg, coopMsg].slice(-MAX_MESSAGES),
              }
            : c,
        ),
      );
    },
    [activeId, bundle],
  );

  return { conversations, active, startNew, select, remove, clearAll, ask };
}

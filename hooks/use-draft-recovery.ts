'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';

// ── Constants ──

const STORAGE_PREFIX = 'kh-bid-draft-';
const DEBOUNCE_MS = 1_000;
const AUTO_SAVE_INTERVAL_MS = 30_000;
const MAX_STORED_DRAFTS = 20;
const STALE_DAYS = 7;

// ── Types ──

interface StoredDraft {
  content: string;
  savedAt: string;
  responseVersion: number | null;
}

export interface DraftRecoveryState {
  /** Whether a recovered draft was found on mount */
  hasDraft: boolean;
  /** The recovered draft content (null if none) */
  draftContent: string | null;
  /** Save current content to localStorage (debounced) */
  saveDraft: (content: string) => void;
  /** Clear the localStorage draft (call on successful server save) */
  clearDraft: () => void;
  /** Timestamp of last localStorage save */
  lastSavedAt: Date | null;
}

// ── Helpers ──

function buildKey(bidId: string, questionId: string): string {
  return `${STORAGE_PREFIX}${bidId}-${questionId}`;
}

function isLocalStorageAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const testKey = '__kh_storage_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

function getStoredDraft(key: string): StoredDraft | null {
  if (!isLocalStorageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (!parsed.content || !parsed.savedAt) return null;

    // Discard stale drafts (older than 7 days)
    const savedDate = new Date(parsed.savedAt);
    const ageMs = Date.now() - savedDate.getTime();
    if (ageMs > STALE_DAYS * 24 * 60 * 60 * 1000) {
      window.localStorage.removeItem(key);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeDraft(key: string, content: string, responseVersion: number | null): Date | null {
  if (!isLocalStorageAvailable()) return null;

  const now = new Date();
  const entry: StoredDraft = {
    content,
    savedAt: now.toISOString(),
    responseVersion,
  };

  try {
    window.localStorage.setItem(key, JSON.stringify(entry));
    pruneOldDrafts();
    return now;
  } catch {
    // Quota exceeded or other error — fail silently
    return null;
  }
}

function removeDraft(key: string): void {
  if (!isLocalStorageAvailable()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Fail silently
  }
}

/**
 * Prune oldest drafts if we exceed the maximum count.
 * Keeps only the newest MAX_STORED_DRAFTS entries.
 */
function pruneOldDrafts(): void {
  if (!isLocalStorageAvailable()) return;

  try {
    const draftKeys: Array<{ key: string; savedAt: number }> = [];

    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;

      const raw = window.localStorage.getItem(key);
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw) as StoredDraft;
        draftKeys.push({
          key,
          savedAt: new Date(parsed.savedAt).getTime(),
        });
      } catch {
        // Malformed entry — remove it
        window.localStorage.removeItem(key);
      }
    }

    if (draftKeys.length <= MAX_STORED_DRAFTS) return;

    // Sort oldest first
    draftKeys.sort((a, b) => a.savedAt - b.savedAt);

    const toRemove = draftKeys.length - MAX_STORED_DRAFTS;
    for (let i = 0; i < toRemove; i++) {
      window.localStorage.removeItem(draftKeys[i].key);
    }
  } catch {
    // Fail silently
  }
}

// ── Hook ──

/**
 * Draft recovery hook — persists editor content to localStorage
 * as a crash-recovery layer. Distinct from `useDraftStream` which
 * handles real-time AI draft generation via SSE.
 */
export function useDraftRecovery(
  bidId: string,
  questionId: string | null,
  responseVersion: number | null,
): DraftRecoveryState {
  // Track a version counter to force re-reads after clear
  const [readVersion, setReadVersion] = useState(0);
  // Track lastSavedAt separately for writes (not from initial stored draft)
  const [writeSavedAt, setWriteSavedAt] = useState<Date | null>(null);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestContentRef = useRef<string | null>(null);
  const responseVersionRef = useRef<number | null>(responseVersion);

  // Keep version ref in sync via effect (not during render)
  useEffect(() => {
    responseVersionRef.current = responseVersion;
  }, [responseVersion]);

  const storageKey = questionId ? buildKey(bidId, questionId) : null;

  // Derive draft state from localStorage synchronously (no setState in effects)
  // readVersion is incremented on clear to trigger re-computation
  const storedDraft = useMemo(() => {
    // readVersion dependency ensures re-read after clear
    void readVersion;
    if (!storageKey) return null;
    const draft = getStoredDraft(storageKey);
    if (!draft) return null;

    // Silently discard draft if the server response is newer than when
    // the draft was saved — another user may have saved a newer version
    if (
      responseVersion !== null &&
      draft.responseVersion !== null &&
      responseVersion > draft.responseVersion
    ) {
      removeDraft(storageKey);
      return null;
    }

    return draft;
  }, [storageKey, readVersion, responseVersion]);

  const hasDraft = storedDraft !== null;
  const draftContent = storedDraft?.content ?? null;
  const storedSavedAt = storedDraft?.savedAt ?? null;

  // Derive lastSavedAt: prefer the write timestamp, fall back to stored draft
  const lastSavedAt = useMemo(() => {
    if (writeSavedAt) return writeSavedAt;
    if (storedSavedAt) return new Date(storedSavedAt);
    return null;
  }, [writeSavedAt, storedSavedAt]);

  // Periodic auto-save interval (30s)
  useEffect(() => {
    if (!storageKey) return;

    autoSaveTimerRef.current = setInterval(() => {
      if (latestContentRef.current !== null) {
        const saved = writeDraft(storageKey, latestContentRef.current, responseVersionRef.current);
        if (saved) {
          setWriteSavedAt(saved);
        }
      }
    }, AUTO_SAVE_INTERVAL_MS);

    return () => {
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current);
      }
    };
  }, [storageKey]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const saveDraft = useCallback(
    (content: string) => {
      if (!storageKey) return;

      latestContentRef.current = content;

      // Debounce the actual write
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        const saved = writeDraft(storageKey, content, responseVersionRef.current);
        if (saved) {
          setWriteSavedAt(saved);
        }
      }, DEBOUNCE_MS);
    },
    [storageKey],
  );

  const clearDraft = useCallback(() => {
    if (!storageKey) return;

    removeDraft(storageKey);
    latestContentRef.current = null;
    setWriteSavedAt(null);

    // Increment readVersion to trigger useMemo re-computation
    setReadVersion((v) => v + 1);

    // Cancel any pending debounced write
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, [storageKey]);

  return {
    hasDraft,
    draftContent,
    saveDraft,
    clearDraft,
    lastSavedAt,
  };
}

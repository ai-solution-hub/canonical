import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDraftRecovery } from '@/hooks/streaming/use-draft-recovery';

describe('useDraftRecovery', () => {
  const bidId = 'bid-123';
  const questionId = 'q-456';
  const storageKey = `kh-bid-draft-${bidId}-${questionId}`;

  let storage: Record<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    storage = {};

    // Mock localStorage
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete storage[key];
      }),
      key: vi.fn((index: number) => Object.keys(storage)[index] ?? null),
      get length() {
        return Object.keys(storage).length;
      },
      clear: vi.fn(() => {
        storage = {};
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ----------------------------------------------------------
  // Initial state
  // ----------------------------------------------------------

  it('starts with no draft when localStorage is empty', () => {
    const { result } = renderHook(() =>
      useDraftRecovery(bidId, questionId, null),
    );

    expect(result.current.hasDraft).toBe(false);
    expect(result.current.draftContent).toBeNull();
    expect(result.current.lastSavedAt).toBeNull();
  });

  it('detects an existing draft on mount', () => {
    const savedAt = new Date().toISOString();
    storage[storageKey] = JSON.stringify({
      content: '<p>Recovered text</p>',
      savedAt,
      responseVersion: 2,
    });

    const { result } = renderHook(() =>
      useDraftRecovery(bidId, questionId, null),
    );

    expect(result.current.hasDraft).toBe(true);
    expect(result.current.draftContent).toBe('<p>Recovered text</p>');
    expect(result.current.lastSavedAt).toEqual(new Date(savedAt));
  });

  // ----------------------------------------------------------
  // saveDraft
  // ----------------------------------------------------------

  it('saves to localStorage with correct key format after debounce', () => {
    const { result } = renderHook(() =>
      useDraftRecovery(bidId, questionId, 3),
    );

    act(() => {
      result.current.saveDraft('<p>Hello world</p>');
    });

    // Before debounce fires, nothing in storage yet
    expect(storage[storageKey]).toBeUndefined();

    // Advance past the 1000ms debounce
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(storage[storageKey]).toBeDefined();
    const parsed = JSON.parse(storage[storageKey]);
    expect(parsed.content).toBe('<p>Hello world</p>');
    expect(parsed.responseVersion).toBe(3);
    expect(parsed.savedAt).toBeDefined();
  });

  it('updates lastSavedAt after saving', () => {
    const { result } = renderHook(() =>
      useDraftRecovery(bidId, questionId, 1),
    );

    expect(result.current.lastSavedAt).toBeNull();

    act(() => {
      result.current.saveDraft('<p>Content</p>');
    });

    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(result.current.lastSavedAt).toBeInstanceOf(Date);
  });

  it('debounces multiple rapid saves', () => {
    const { result } = renderHook(() =>
      useDraftRecovery(bidId, questionId, 1),
    );

    act(() => {
      result.current.saveDraft('<p>First</p>');
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    act(() => {
      result.current.saveDraft('<p>Second</p>');
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    // First debounce was cancelled, second hasn't fired yet
    expect(storage[storageKey]).toBeUndefined();

    act(() => {
      vi.advanceTimersByTime(600);
    });

    // Only the second save should be persisted
    const parsed = JSON.parse(storage[storageKey]);
    expect(parsed.content).toBe('<p>Second</p>');
  });

  // ----------------------------------------------------------
  // clearDraft
  // ----------------------------------------------------------

  it('clears the draft from localStorage', () => {
    storage[storageKey] = JSON.stringify({
      content: '<p>Old draft</p>',
      savedAt: new Date().toISOString(),
      responseVersion: 1,
    });

    const { result } = renderHook(() =>
      useDraftRecovery(bidId, questionId, 1),
    );

    expect(result.current.hasDraft).toBe(true);

    act(() => {
      result.current.clearDraft();
    });

    expect(result.current.hasDraft).toBe(false);
    expect(result.current.draftContent).toBeNull();
    expect(result.current.lastSavedAt).toBeNull();
    expect(storage[storageKey]).toBeUndefined();
  });

  it('cancels pending debounced write on clear', () => {
    const { result } = renderHook(() =>
      useDraftRecovery(bidId, questionId, 1),
    );

    act(() => {
      result.current.saveDraft('<p>Pending save</p>');
    });

    act(() => {
      result.current.clearDraft();
    });

    // Advance past debounce — nothing should be written
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(storage[storageKey]).toBeUndefined();
  });

  // ----------------------------------------------------------
  // Stale draft pruning
  // ----------------------------------------------------------

  it('discards drafts older than 7 days', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    storage[storageKey] = JSON.stringify({
      content: '<p>Ancient draft</p>',
      savedAt: eightDaysAgo.toISOString(),
      responseVersion: 1,
    });

    const { result } = renderHook(() =>
      useDraftRecovery(bidId, questionId, 1),
    );

    expect(result.current.hasDraft).toBe(false);
    expect(result.current.draftContent).toBeNull();
    // Should have been removed from storage
    expect(storage[storageKey]).toBeUndefined();
  });

  // ----------------------------------------------------------
  // Null question ID
  // ----------------------------------------------------------

  it('handles null questionId gracefully', () => {
    const { result } = renderHook(() =>
      useDraftRecovery(bidId, null, null),
    );

    expect(result.current.hasDraft).toBe(false);
    expect(result.current.draftContent).toBeNull();

    // saveDraft should be a no-op
    act(() => {
      result.current.saveDraft('<p>Test</p>');
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(Object.keys(storage).length).toBe(0);
  });

  // ----------------------------------------------------------
  // localStorage unavailability
  // ----------------------------------------------------------

  it('handles localStorage unavailability gracefully', () => {
    // Simulate localStorage being unavailable (e.g. SSR or privacy mode)
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => { throw new Error('SecurityError'); }),
      setItem: vi.fn(() => { throw new Error('SecurityError'); }),
      removeItem: vi.fn(() => { throw new Error('SecurityError'); }),
      key: vi.fn(() => null),
      length: 0,
      clear: vi.fn(),
    });

    const { result } = renderHook(() =>
      useDraftRecovery(bidId, questionId, 1),
    );

    // Should not crash
    expect(result.current.hasDraft).toBe(false);

    // saveDraft should be a no-op
    act(() => {
      result.current.saveDraft('<p>Test</p>');
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // No error thrown
    expect(result.current.hasDraft).toBe(false);
  });

  // ----------------------------------------------------------
  // Question change
  // ----------------------------------------------------------

  it('re-checks localStorage when questionId changes', () => {
    const otherQuestionId = 'q-789';
    const otherKey = `kh-bid-draft-${bidId}-${otherQuestionId}`;

    storage[otherKey] = JSON.stringify({
      content: '<p>Other question draft</p>',
      savedAt: new Date().toISOString(),
      responseVersion: 1,
    });

    const { result, rerender } = renderHook(
      ({ qId }) => useDraftRecovery(bidId, qId, null),
      { initialProps: { qId: questionId } },
    );

    expect(result.current.hasDraft).toBe(false);

    // Switch to the other question that has a draft
    rerender({ qId: otherQuestionId });

    expect(result.current.hasDraft).toBe(true);
    expect(result.current.draftContent).toBe('<p>Other question draft</p>');
  });

  // ----------------------------------------------------------
  // Auto-save interval
  // ----------------------------------------------------------

  it('auto-saves content periodically via 30-second interval', () => {
    const { result } = renderHook(() =>
      useDraftRecovery(bidId, questionId, 1),
    );

    // Stage content in the ref via saveDraft (but don't wait for debounce)
    act(() => {
      result.current.saveDraft('<p>Interval content</p>');
    });

    // Advance past the 30-second auto-save interval
    act(() => {
      vi.advanceTimersByTime(31_000);
    });

    expect(storage[storageKey]).toBeDefined();
    const parsed = JSON.parse(storage[storageKey]);
    expect(parsed.content).toBe('<p>Interval content</p>');
  });

  // ----------------------------------------------------------
  // Malformed data
  // ----------------------------------------------------------

  it('ignores malformed JSON in localStorage', () => {
    storage[storageKey] = 'not valid json {{{';

    const { result } = renderHook(() =>
      useDraftRecovery(bidId, questionId, 1),
    );

    expect(result.current.hasDraft).toBe(false);
    expect(result.current.draftContent).toBeNull();
  });

  it('ignores entries missing required fields', () => {
    storage[storageKey] = JSON.stringify({
      savedAt: new Date().toISOString(),
      // Missing content field
    });

    const { result } = renderHook(() =>
      useDraftRecovery(bidId, questionId, 1),
    );

    expect(result.current.hasDraft).toBe(false);
  });
});

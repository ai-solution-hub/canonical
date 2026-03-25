import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, fireEvent } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockToast } = vi.hoisted(() => ({
  mockToast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({ toast: mockToast }));

import { useItemDetailShortcuts } from '@/hooks/use-item-detail-shortcuts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createParams(overrides: Partial<Parameters<typeof useItemDetailShortcuts>[0]> = {}) {
  return {
    itemId: 'item-1',
    toggleRead: vi.fn(),
    handleStarToggle: vi.fn(),
    handlePriorityCycle: vi.fn(),
    toggleReader: vi.fn(),
    readerOpen: false,
    toggleDetached: vi.fn(),
    canEdit: true,
    title: 'Test Title',
    answerStandard: 'Standard',
    answerAdvanced: 'Advanced',
    setIsEditing: vi.fn(),
    setEditTitle: vi.fn(),
    setEditStandard: vi.fn(),
    setEditAdvanced: vi.fn(),
    setEditDirty: vi.fn(),
    router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() } as Parameters<typeof useItemDetailShortcuts>[0]['router'],
    detailMode: 'editor' as const,
    toggleDetailMode: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useItemDetailShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // m — toggle read
  // -------------------------------------------------------------------------

  it('calls toggleRead on "m" keypress', () => {
    const params = createParams();
    renderHook(() => useItemDetailShortcuts(params));

    fireEvent.keyDown(window, { key: 'm' });

    expect(params.toggleRead).toHaveBeenCalledWith('item-1');
    expect(mockToast).toHaveBeenCalledWith('Read state toggled', { duration: 1500 });
  });

  it('does not call toggleRead when meta key is held', () => {
    const params = createParams();
    renderHook(() => useItemDetailShortcuts(params));

    fireEvent.keyDown(window, { key: 'm', metaKey: true });

    expect(params.toggleRead).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // s — star toggle
  // -------------------------------------------------------------------------

  it('calls handleStarToggle on "s" keypress when canEdit is true', () => {
    const params = createParams({ canEdit: true });
    renderHook(() => useItemDetailShortcuts(params));

    fireEvent.keyDown(window, { key: 's' });

    expect(params.handleStarToggle).toHaveBeenCalledOnce();
  });

  it('does not call handleStarToggle with shift held', () => {
    const params = createParams();
    renderHook(() => useItemDetailShortcuts(params));

    fireEvent.keyDown(window, { key: 's', shiftKey: true });

    expect(params.handleStarToggle).not.toHaveBeenCalled();
  });

  it('does not call handleStarToggle on "s" when canEdit is false (viewer)', () => {
    const params = createParams({ canEdit: false });
    renderHook(() => useItemDetailShortcuts(params));

    fireEvent.keyDown(window, { key: 's' });

    expect(params.handleStarToggle).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // p — priority cycle
  // -------------------------------------------------------------------------

  it('calls handlePriorityCycle on "p" keypress when canEdit is true', () => {
    const params = createParams({ canEdit: true });
    renderHook(() => useItemDetailShortcuts(params));

    fireEvent.keyDown(window, { key: 'p' });

    expect(params.handlePriorityCycle).toHaveBeenCalledOnce();
  });

  it('does not call handlePriorityCycle on "p" when canEdit is false (viewer)', () => {
    const params = createParams({ canEdit: false });
    renderHook(() => useItemDetailShortcuts(params));

    fireEvent.keyDown(window, { key: 'p' });

    expect(params.handlePriorityCycle).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // e — edit mode
  // -------------------------------------------------------------------------

  it('calls setIsEditing on "e" when canEdit is true', () => {
    const params = createParams({ canEdit: true });
    renderHook(() => useItemDetailShortcuts(params));

    fireEvent.keyDown(window, { key: 'e' });

    expect(params.setIsEditing).toHaveBeenCalledOnce();
  });

  it('does not call setIsEditing when canEdit is false', () => {
    const params = createParams({ canEdit: false });
    renderHook(() => useItemDetailShortcuts(params));

    fireEvent.keyDown(window, { key: 'e' });

    expect(params.setIsEditing).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // r — toggle reader
  // -------------------------------------------------------------------------

  it('calls toggleReader on "r" keypress', () => {
    const params = createParams();
    renderHook(() => useItemDetailShortcuts(params));

    fireEvent.keyDown(window, { key: 'r' });

    expect(params.toggleReader).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Shift+R — detach or navigate to /review
  // -------------------------------------------------------------------------

  it('calls toggleDetached on Shift+R when reader is open', () => {
    const params = createParams({ readerOpen: true });
    renderHook(() => useItemDetailShortcuts(params));

    fireEvent.keyDown(window, { key: 'R', shiftKey: true });

    expect(params.toggleDetached).toHaveBeenCalledOnce();
    expect(params.router.push).not.toHaveBeenCalled();
  });

  it('navigates to /review on Shift+R when reader is closed', () => {
    const params = createParams({ readerOpen: false });
    renderHook(() => useItemDetailShortcuts(params));

    fireEvent.keyDown(window, { key: 'R', shiftKey: true });

    expect(params.router.push).toHaveBeenCalledWith('/review');
    expect(params.toggleDetached).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Shift+D — toggle detail mode
  // -------------------------------------------------------------------------

  it('calls toggleDetailMode on Shift+D when canEdit is true', () => {
    const params = createParams({ canEdit: true });
    renderHook(() => useItemDetailShortcuts(params));

    fireEvent.keyDown(window, { key: 'D', shiftKey: true });

    expect(params.toggleDetailMode).toHaveBeenCalledOnce();
  });

  it('does not call toggleDetailMode on Shift+D when canEdit is false', () => {
    const params = createParams({ canEdit: false });
    renderHook(() => useItemDetailShortcuts(params));

    fireEvent.keyDown(window, { key: 'D', shiftKey: true });

    expect(params.toggleDetailMode).not.toHaveBeenCalled();
  });

  it('does not call toggleDetailMode on Shift+D when toggleDetailMode is not provided', () => {
    const params = createParams({ canEdit: true, toggleDetailMode: undefined });
    renderHook(() => useItemDetailShortcuts(params));

    fireEvent.keyDown(window, { key: 'D', shiftKey: true });

    // Should not throw — the guard in the hook prevents the call
  });

  it('does not call toggleDetailMode on plain "d" (no shift)', () => {
    const params = createParams({ canEdit: true });
    renderHook(() => useItemDetailShortcuts(params));

    fireEvent.keyDown(window, { key: 'd' });

    expect(params.toggleDetailMode).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Reader mode — editing shortcuts disabled
  // -------------------------------------------------------------------------

  describe('reader mode (detailMode=reader)', () => {
    it('does not call handleStarToggle on "s" in reader mode', () => {
      const params = createParams({ canEdit: true, detailMode: 'reader' });
      renderHook(() => useItemDetailShortcuts(params));

      fireEvent.keyDown(window, { key: 's' });

      expect(params.handleStarToggle).not.toHaveBeenCalled();
    });

    it('does not call handlePriorityCycle on "p" in reader mode', () => {
      const params = createParams({ canEdit: true, detailMode: 'reader' });
      renderHook(() => useItemDetailShortcuts(params));

      fireEvent.keyDown(window, { key: 'p' });

      expect(params.handlePriorityCycle).not.toHaveBeenCalled();
    });

    it('does not call setIsEditing on "e" in reader mode', () => {
      const params = createParams({ canEdit: true, detailMode: 'reader' });
      renderHook(() => useItemDetailShortcuts(params));

      fireEvent.keyDown(window, { key: 'e' });

      expect(params.setIsEditing).not.toHaveBeenCalled();
    });

    it('still calls toggleRead on "m" in reader mode (reading shortcut)', () => {
      const params = createParams({ canEdit: true, detailMode: 'reader' });
      renderHook(() => useItemDetailShortcuts(params));

      fireEvent.keyDown(window, { key: 'm' });

      expect(params.toggleRead).toHaveBeenCalledWith('item-1');
    });

    it('still calls toggleReader on "r" in reader mode (reading shortcut)', () => {
      const params = createParams({ canEdit: true, detailMode: 'reader' });
      renderHook(() => useItemDetailShortcuts(params));

      fireEvent.keyDown(window, { key: 'r' });

      expect(params.toggleReader).toHaveBeenCalledOnce();
    });

    it('still calls toggleDetailMode on Shift+D in reader mode', () => {
      const params = createParams({ canEdit: true, detailMode: 'reader' });
      renderHook(() => useItemDetailShortcuts(params));

      fireEvent.keyDown(window, { key: 'D', shiftKey: true });

      expect(params.toggleDetailMode).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // Editor mode — all shortcuts active
  // -------------------------------------------------------------------------

  describe('editor mode (detailMode=editor)', () => {
    it('calls handleStarToggle on "s" in editor mode', () => {
      const params = createParams({ canEdit: true, detailMode: 'editor' });
      renderHook(() => useItemDetailShortcuts(params));

      fireEvent.keyDown(window, { key: 's' });

      expect(params.handleStarToggle).toHaveBeenCalledOnce();
    });

    it('calls handlePriorityCycle on "p" in editor mode', () => {
      const params = createParams({ canEdit: true, detailMode: 'editor' });
      renderHook(() => useItemDetailShortcuts(params));

      fireEvent.keyDown(window, { key: 'p' });

      expect(params.handlePriorityCycle).toHaveBeenCalledOnce();
    });

    it('calls setIsEditing on "e" in editor mode', () => {
      const params = createParams({ canEdit: true, detailMode: 'editor' });
      renderHook(() => useItemDetailShortcuts(params));

      fireEvent.keyDown(window, { key: 'e' });

      expect(params.setIsEditing).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // Backwards compatibility — no detailMode provided
  // -------------------------------------------------------------------------

  describe('backwards compatibility (no detailMode)', () => {
    it('editing shortcuts work when detailMode is undefined', () => {
      const params = createParams({ canEdit: true, detailMode: undefined });
      renderHook(() => useItemDetailShortcuts(params));

      fireEvent.keyDown(window, { key: 's' });
      fireEvent.keyDown(window, { key: 'p' });
      fireEvent.keyDown(window, { key: 'e' });

      expect(params.handleStarToggle).toHaveBeenCalledOnce();
      expect(params.handlePriorityCycle).toHaveBeenCalledOnce();
      expect(params.setIsEditing).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // Form element suppression
  // -------------------------------------------------------------------------

  it('suppresses shortcuts when focus is in an INPUT', () => {
    const params = createParams();
    renderHook(() => useItemDetailShortcuts(params));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: 'm' });
    fireEvent.keyDown(input, { key: 's' });
    fireEvent.keyDown(input, { key: 'p' });

    expect(params.toggleRead).not.toHaveBeenCalled();
    expect(params.handleStarToggle).not.toHaveBeenCalled();
    expect(params.handlePriorityCycle).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it('suppresses shortcuts when focus is in a TEXTAREA', () => {
    const params = createParams();
    renderHook(() => useItemDetailShortcuts(params));

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    fireEvent.keyDown(textarea, { key: 'e' });
    expect(params.setIsEditing).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
  });

  it('suppresses Shift+D when focus is in an INPUT', () => {
    const params = createParams({ canEdit: true });
    renderHook(() => useItemDetailShortcuts(params));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: 'D', shiftKey: true });

    expect(params.toggleDetailMode).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });
});

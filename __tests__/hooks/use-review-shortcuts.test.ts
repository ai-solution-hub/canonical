import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, fireEvent } from '@testing-library/react';
import { useReviewShortcuts } from '@/hooks/use-review-shortcuts';

describe('useReviewShortcuts', () => {
  const handlers = {
    onVerify: vi.fn(),
    onFlag: vi.fn(),
    onSkip: vi.fn(),
    onBack: vi.fn(),
    onExit: vi.fn(),
    onEdit: vi.fn(),
    onTogglePanel: vi.fn(),
    enabled: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ----------------------------------------------------------
  // Enter — Verify
  // ----------------------------------------------------------

  it('calls onVerify when Enter is pressed', () => {
    renderHook(() => useReviewShortcuts(handlers));
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(handlers.onVerify).toHaveBeenCalledOnce();
  });

  // ----------------------------------------------------------
  // f — Flag
  // ----------------------------------------------------------

  it('calls onFlag when "f" is pressed', () => {
    renderHook(() => useReviewShortcuts(handlers));
    fireEvent.keyDown(document, { key: 'f' });
    expect(handlers.onFlag).toHaveBeenCalledOnce();
  });

  // ----------------------------------------------------------
  // ArrowRight — Skip
  // ----------------------------------------------------------

  it('calls onSkip when ArrowRight is pressed', () => {
    renderHook(() => useReviewShortcuts(handlers));
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(handlers.onSkip).toHaveBeenCalledOnce();
  });

  // ----------------------------------------------------------
  // ArrowLeft — Back
  // ----------------------------------------------------------

  it('calls onBack when ArrowLeft is pressed', () => {
    renderHook(() => useReviewShortcuts(handlers));
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(handlers.onBack).toHaveBeenCalledOnce();
  });

  // ----------------------------------------------------------
  // Escape — Exit review
  // ----------------------------------------------------------

  it('calls onExit when Escape is pressed outside an input', () => {
    renderHook(() => useReviewShortcuts(handlers));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(handlers.onExit).toHaveBeenCalledOnce();
  });

  it('blurs the active input on Escape instead of calling onExit', () => {
    renderHook(() => useReviewShortcuts(handlers));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(document.activeElement).not.toBe(input);
    expect(handlers.onExit).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  // ----------------------------------------------------------
  // e — Edit
  // ----------------------------------------------------------

  it('calls onEdit when "e" is pressed', () => {
    renderHook(() => useReviewShortcuts(handlers));
    fireEvent.keyDown(document, { key: 'e' });
    expect(handlers.onEdit).toHaveBeenCalledOnce();
  });

  // ----------------------------------------------------------
  // l — Toggle panel
  // ----------------------------------------------------------

  it('calls onTogglePanel when "l" is pressed', () => {
    renderHook(() => useReviewShortcuts(handlers));
    fireEvent.keyDown(document, { key: 'l' });
    expect(handlers.onTogglePanel).toHaveBeenCalledOnce();
  });

  // ----------------------------------------------------------
  // ? — Toggle help overlay
  // ----------------------------------------------------------

  it('toggles showHelp when "?" (Shift+/) is pressed', () => {
    const { result } = renderHook(() => useReviewShortcuts(handlers));
    expect(result.current.showHelp).toBe(false);

    act(() => {
      fireEvent.keyDown(document, { key: '?', shiftKey: true });
    });
    expect(result.current.showHelp).toBe(true);

    act(() => {
      fireEvent.keyDown(document, { key: '?', shiftKey: true });
    });
    expect(result.current.showHelp).toBe(false);
  });

  // ----------------------------------------------------------
  // Suppressed in form elements
  // ----------------------------------------------------------

  it('does not fire shortcuts when focus is in a textarea', () => {
    renderHook(() => useReviewShortcuts(handlers));
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    fireEvent.keyDown(textarea, { key: 'f' });
    fireEvent.keyDown(textarea, { key: 'e' });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(handlers.onFlag).not.toHaveBeenCalled();
    expect(handlers.onEdit).not.toHaveBeenCalled();
    expect(handlers.onVerify).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
  });

  // ----------------------------------------------------------
  // enabled = false — All shortcuts disabled
  // ----------------------------------------------------------

  it('does not fire any shortcut when enabled is false', () => {
    renderHook(() => useReviewShortcuts({ ...handlers, enabled: false }));

    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.keyDown(document, { key: 'f' });
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(handlers.onVerify).not.toHaveBeenCalled();
    expect(handlers.onFlag).not.toHaveBeenCalled();
    expect(handlers.onSkip).not.toHaveBeenCalled();
    expect(handlers.onExit).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------
  // Escape closes help overlay before calling onExit
  // ----------------------------------------------------------

  it('closes help overlay on Escape before calling onExit', () => {
    const { result } = renderHook(() => useReviewShortcuts(handlers));

    // Open help first
    act(() => {
      fireEvent.keyDown(document, { key: '?', shiftKey: true });
    });
    expect(result.current.showHelp).toBe(true);

    // Escape should close help, not call onExit
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(result.current.showHelp).toBe(false);
    expect(handlers.onExit).not.toHaveBeenCalled();
  });
});

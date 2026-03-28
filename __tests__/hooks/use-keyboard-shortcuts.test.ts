import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, fireEvent } from '@testing-library/react';

describe('useKeyboardShortcuts', () => {
  const onFocusSearch = vi.fn();
  const onNavigate = vi.fn();
  const onSelect = vi.fn();
  const onEscape = vi.fn();
  const onGoToReview = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Dynamically import after mocks are set up (no external module mocks needed)
  async function renderShortcuts(
    overrides: Partial<Parameters<typeof import('@/hooks/ui/use-keyboard-shortcuts')['useKeyboardShortcuts']>[0]> = {},
  ) {
    const { useKeyboardShortcuts } = await import('@/hooks/ui/use-keyboard-shortcuts');
    return renderHook(() =>
      useKeyboardShortcuts({
        onFocusSearch,
        onNavigate,
        onSelect,
        onEscape,
        onGoToReview,
        ...overrides,
      }),
    );
  }

  // ----------------------------------------------------------
  // / — Focus search
  // ----------------------------------------------------------

  it('calls onFocusSearch when "/" is pressed', async () => {
    await renderShortcuts();
    fireEvent.keyDown(document, { key: '/' });
    expect(onFocusSearch).toHaveBeenCalledOnce();
  });

  it('does not call onFocusSearch when "/" is pressed with meta key', async () => {
    await renderShortcuts();
    fireEvent.keyDown(document, { key: '/', metaKey: true });
    expect(onFocusSearch).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------
  // Escape — Blur active element / call onEscape
  // ----------------------------------------------------------

  it('calls onEscape when Escape is pressed outside an input', async () => {
    await renderShortcuts();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it('blurs the active input when Escape is pressed inside an input', async () => {
    await renderShortcuts();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(document.activeElement).not.toBe(input);
    expect(onEscape).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  // ----------------------------------------------------------
  // j / k — Navigate down / up
  // ----------------------------------------------------------

  it('calls onNavigate("down") when "j" is pressed', async () => {
    await renderShortcuts();
    fireEvent.keyDown(document, { key: 'j' });
    expect(onNavigate).toHaveBeenCalledWith('down');
  });

  it('calls onNavigate("up") when "k" is pressed', async () => {
    await renderShortcuts();
    fireEvent.keyDown(document, { key: 'k' });
    expect(onNavigate).toHaveBeenCalledWith('up');
  });

  // ----------------------------------------------------------
  // Enter — Select
  // ----------------------------------------------------------

  it('calls onSelect when Enter is pressed', async () => {
    await renderShortcuts();
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledOnce();
  });

  // ----------------------------------------------------------
  // Shift+R — Go to review
  // ----------------------------------------------------------

  it('calls onGoToReview when Shift+R is pressed', async () => {
    await renderShortcuts();
    fireEvent.keyDown(document, { key: 'R', shiftKey: true });
    expect(onGoToReview).toHaveBeenCalledOnce();
  });

  // ----------------------------------------------------------
  // g g — Go to first item (double tap within 500ms)
  // ----------------------------------------------------------

  it('calls onNavigate("first") on double-g within 500ms', async () => {
    await renderShortcuts();

    // First g sets the timestamp
    fireEvent.keyDown(document, { key: 'g' });
    expect(onNavigate).not.toHaveBeenCalled();

    // Advance a small amount, then second g triggers
    vi.advanceTimersByTime(200);
    fireEvent.keyDown(document, { key: 'g' });
    expect(onNavigate).toHaveBeenCalledWith('first');
  });

  it('does not navigate to first on double-g when more than 500ms apart', async () => {
    await renderShortcuts();

    fireEvent.keyDown(document, { key: 'g' });
    vi.advanceTimersByTime(600);
    fireEvent.keyDown(document, { key: 'g' });
    expect(onNavigate).not.toHaveBeenCalledWith('first');
  });

  // ----------------------------------------------------------
  // Shift+G — Go to last item
  // ----------------------------------------------------------

  it('calls onNavigate("last") when Shift+G is pressed', async () => {
    await renderShortcuts();
    fireEvent.keyDown(document, { key: 'G', shiftKey: true });
    expect(onNavigate).toHaveBeenCalledWith('last');
  });

  // ----------------------------------------------------------
  // ? — Toggle shortcuts overlay
  // ----------------------------------------------------------

  it('toggles showShortcuts when "?" (Shift+/) is pressed', async () => {
    const { result } = await renderShortcuts();
    expect(result.current.showShortcuts).toBe(false);

    act(() => {
      fireEvent.keyDown(document, { key: '?', shiftKey: true });
    });
    expect(result.current.showShortcuts).toBe(true);

    act(() => {
      fireEvent.keyDown(document, { key: '?', shiftKey: true });
    });
    expect(result.current.showShortcuts).toBe(false);
  });

  // ----------------------------------------------------------
  // Suppressed in form elements
  // ----------------------------------------------------------

  it('does not fire shortcuts when focus is in a textarea', async () => {
    await renderShortcuts();
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    fireEvent.keyDown(textarea, { key: '/' });
    fireEvent.keyDown(textarea, { key: 'j' });
    fireEvent.keyDown(textarea, { key: 'k' });

    expect(onFocusSearch).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
  });

  it('does not fire shortcuts when focus is in a contentEditable element', async () => {
    await renderShortcuts();
    const div = document.createElement('div');
    div.contentEditable = 'true';
    // jsdom does not set isContentEditable automatically, so define it manually
    Object.defineProperty(div, 'isContentEditable', { value: true });
    document.body.appendChild(div);
    div.focus();

    fireEvent.keyDown(div, { key: '/' });
    fireEvent.keyDown(div, { key: 'j' });

    expect(onFocusSearch).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();

    document.body.removeChild(div);
  });

  // ----------------------------------------------------------
  // enabled = false — All shortcuts disabled
  // ----------------------------------------------------------

  it('does not fire any shortcut when enabled is false', async () => {
    await renderShortcuts({ enabled: false });

    fireEvent.keyDown(document, { key: '/' });
    fireEvent.keyDown(document, { key: 'j' });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Enter' });

    expect(onFocusSearch).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onEscape).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

import { useEffect } from 'react';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { toast } from 'sonner';
import type { DetailMode } from '@/hooks/ui/use-detail-mode';

interface UseItemDetailShortcutsParams {
  itemId: string;
  toggleRead: (id: string) => void;
  handleStarToggle: () => void;
  handlePriorityCycle: () => void;
  toggleReader: () => void;
  readerOpen: boolean;
  toggleDetached: () => void;
  canEdit: boolean;
  /** Start inline editing a field (E key targets suggested_title) */
  startEdit: (field: string) => void;
  /** Cancel current inline edit (Escape key) */
  cancelEdit: () => void;
  /** Currently editing field (null when no edit in progress) */
  editingField: string | null;
  router: AppRouterInstance;
  /** Current detail mode — enables mode-aware shortcut behaviour */
  detailMode?: DetailMode;
  /** Callback to toggle detail mode (with unsaved changes guard) */
  toggleDetailMode?: () => void;
}

/**
 * Registers keyboard shortcuts for the item detail page.
 *
 * Shortcuts:
 *  m — toggle read state (all modes)
 *  s — toggle star (editor mode only)
 *  p — cycle priority (editor mode only)
 *  e — toggle inline edit: start suggested_title when idle, cancel when editing
 *  Escape — cancel current inline edit
 *  r — toggle reader panel (all modes)
 *  Shift+R — toggle detached reader (if open) or navigate to /review
 *  Shift+D — toggle detail mode between reader and editor
 *
 * When in reader mode, editing shortcuts (E, S, P) are disabled.
 * Reading shortcuts (M, R) remain active in all modes.
 */
export function useItemDetailShortcuts({
  itemId,
  toggleRead,
  handleStarToggle,
  handlePriorityCycle,
  toggleReader,
  readerOpen,
  toggleDetached,
  canEdit,
  startEdit,
  cancelEdit,
  editingField,
  router,
  detailMode,
  toggleDetailMode,
}: UseItemDetailShortcutsParams): void {
  // Whether editing shortcuts should be active (only in editor mode or when no mode set)
  const editShortcutsEnabled = canEdit && detailMode !== 'reader';

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )
        return;

      // m — toggle read (active in all modes)
      if (e.key === 'm' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        toggleRead(itemId);
        toast('Read state toggled', { duration: 1500 });
      }
      // s — star toggle (editor mode only)
      if (
        e.key === 's' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        editShortcutsEnabled
      ) {
        e.preventDefault();
        handleStarToggle();
      }
      // p — priority cycle (editor mode only)
      if (
        e.key === 'p' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        editShortcutsEnabled
      ) {
        e.preventDefault();
        handlePriorityCycle();
      }
      // e — toggle inline edit: start suggested_title when idle, cancel when editing
      if (
        e.key === 'e' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        editShortcutsEnabled
      ) {
        e.preventDefault();
        if (editingField) {
          cancelEdit();
        } else {
          startEdit('suggested_title');
        }
      }
      // Escape — cancel current inline edit
      if (e.key === 'Escape' && editingField) {
        e.preventDefault();
        cancelEdit();
      }
      // r — toggle reader panel (active in all modes)
      if (
        e.key === 'r' &&
        !e.shiftKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        toggleReader();
      }
      // Shift+R — toggle detached reader or navigate to /review
      if (
        e.key === 'R' &&
        e.shiftKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        if (readerOpen) {
          toggleDetached();
        } else {
          router.push('/review');
        }
      }
      // Shift+D — toggle detail mode (editor <-> reader)
      if (
        e.key === 'D' &&
        e.shiftKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        canEdit &&
        toggleDetailMode
      ) {
        e.preventDefault();
        toggleDetailMode();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    itemId,
    toggleRead,
    router,
    handleStarToggle,
    handlePriorityCycle,
    toggleReader,
    readerOpen,
    toggleDetached,
    canEdit,
    startEdit,
    cancelEdit,
    editingField,
    editShortcutsEnabled,
    detailMode,
    toggleDetailMode,
  ]);
}

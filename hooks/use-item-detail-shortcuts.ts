import { useEffect } from 'react';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { toast } from 'sonner';

interface UseItemDetailShortcutsParams {
  itemId: string;
  toggleRead: (id: string) => void;
  handleStarToggle: () => void;
  handlePriorityCycle: () => void;
  toggleReader: () => void;
  readerOpen: boolean;
  toggleDetached: () => void;
  canEdit: boolean;
  title: string;
  answerStandard: string | null | undefined;
  answerAdvanced: string | null | undefined;
  setIsEditing: React.Dispatch<React.SetStateAction<boolean>>;
  setEditTitle: (v: string) => void;
  setEditStandard: (v: string) => void;
  setEditAdvanced: (v: string) => void;
  setEditDirty: (v: boolean) => void;
  router: AppRouterInstance;
}

/**
 * Registers keyboard shortcuts for the item detail page.
 *
 * Shortcuts:
 *  m — toggle read state
 *  s — toggle star
 *  p — cycle priority
 *  e — toggle edit mode (editors only)
 *  r — toggle reader panel
 *  Shift+R — toggle detached reader (if open) or navigate to /review
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
  title,
  answerStandard,
  answerAdvanced,
  setIsEditing,
  setEditTitle,
  setEditStandard,
  setEditAdvanced,
  setEditDirty,
  router,
}: UseItemDetailShortcutsParams): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )
        return;

      if (e.key === 'm' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        toggleRead(itemId);
        toast('Read state toggled', { duration: 1500 });
      }
      if (e.key === 's' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        handleStarToggle();
      }
      if (e.key === 'p' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        handlePriorityCycle();
      }
      if (e.key === 'e' && !e.metaKey && !e.ctrlKey && !e.altKey && canEdit) {
        e.preventDefault();
        setIsEditing((prev) => {
          if (!prev) {
            setEditTitle(title);
            setEditStandard(answerStandard ?? '');
            setEditAdvanced(answerAdvanced ?? '');
            setEditDirty(false);
          }
          return !prev;
        });
      }
      if (e.key === 'r' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        toggleReader();
      }
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
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [itemId, answerStandard, answerAdvanced, toggleRead, router, handleStarToggle, handlePriorityCycle, toggleReader, readerOpen, toggleDetached, canEdit, title, setIsEditing, setEditTitle, setEditStandard, setEditAdvanced, setEditDirty]);
}

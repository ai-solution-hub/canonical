'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useReadMarks } from '@/contexts/read-marks-context';
import { useTranscript } from '@/hooks/use-transcript';
import { useReaderPreferences } from '@/hooks/use-reader-preferences';
import { useUserRole } from '@/hooks/use-user-role';
import { useInlineFieldEdit } from '@/hooks/use-inline-field-edit';
import { useQAEditMode } from '@/hooks/use-qa-edit-mode';
import { useVisionAnalysis } from '@/hooks/use-vision-analysis';
import type { VisionAnalysisResult } from '@/hooks/use-vision-analysis';
import { useQAProvenance } from '@/hooks/use-qa-provenance';
import { useTopicLayerContent } from '@/hooks/use-topic-layer-content';
import { createClient } from '@/lib/supabase/client';
import { getDisplayTitle } from '@/lib/format';
import { toast } from 'sonner';

import type { ItemData } from '@/app/item/[id]/item-detail-client';
import type { ContentListItem, TranscriptChapter } from '@/types/content';
import type { Priority } from '@/components/shared/priority-selector';
import type { UseInlineFieldEditReturn } from '@/hooks/use-inline-field-edit';
import type { UseQAEditModeReturn } from '@/hooks/use-qa-edit-mode';
import type { UseQAProvenanceReturn } from '@/hooks/use-qa-provenance';
import type {
  ReaderFontSize,
  ReaderMaxWidth,
  PanelLayout,
  FloatingPosition,
  FloatingSize,
} from '@/hooks/use-reader-preferences';
import type { TranscriptSegment, TranscriptHighlight } from '@/types/content';
import type { LayerContentMap } from '@/hooks/use-topic-layer-content';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseItemDetailDataOptions {
  initialItem: ItemData;
  relatedItems: Array<ContentListItem & { similarity: number }>;
}

/**
 * The complete data and handler set returned by useItemDetailData.
 * Both ReaderView and EditorView consume this interface.
 */
export interface ItemDetailData {
  // --- Core item state ---
  item: ItemData;
  setItem: React.Dispatch<React.SetStateAction<ItemData>>;
  relatedItems: Array<ContentListItem & { similarity: number }>;

  // --- Derived values ---
  title: string;
  isQAPair: boolean;
  hasReaderContent: boolean;
  transcriptChapters: TranscriptChapter[] | undefined;
  visionAnalysis: VisionAnalysisResult | undefined;
  isMobile: boolean;

  // --- Roles ---
  canEdit: boolean;
  canAdmin: boolean;

  // --- Router ---
  router: AppRouterInstance;

  // --- Read marks ---
  toggleRead: (id: string) => void;

  // --- Transcript ---
  segments: TranscriptSegment[] | null;
  highlights: TranscriptHighlight[] | null;

  // --- Reader preferences ---
  fontSize: ReaderFontSize;
  maxWidth: ReaderMaxWidth;
  panelLayout: PanelLayout;
  readerOpen: boolean;
  isDetached: boolean;
  detachedPosition: FloatingPosition | null;
  detachedSize: FloatingSize | null;
  setFontSize: (size: ReaderFontSize) => void;
  setMaxWidth: (width: ReaderMaxWidth) => void;
  setPanelLayout: (layout: PanelLayout) => void;
  setReaderOpen: (open: boolean) => void;
  toggleReader: () => void;
  toggleDetached: () => void;
  setDetachedPosition: (pos: FloatingPosition) => void;
  setDetachedSize: (size: FloatingSize) => void;
  showSplitReader: boolean;

  // --- Inline field edit ---
  inlineEdit: UseInlineFieldEditReturn;

  // --- Q&A edit mode ---
  qaEditMode: UseQAEditModeReturn;

  // --- Vision analysis ---
  isAnalysing: boolean;
  handleVisionAnalysis: () => Promise<void>;

  // --- Q&A provenance ---
  qaProvenance: UseQAProvenanceReturn;

  // --- Topic layer content ---
  layerContent: LayerContentMap;
  isLayerContentLoading: boolean;

  // --- Copy handlers ---
  copied: boolean;
  handleCopyLink: () => Promise<void>;
  handleCopyAnswer: (variant?: 'standard' | 'advanced') => Promise<void>;

  // --- Star / priority ---
  handleStarToggle: () => Promise<void>;
  handlePriorityCycle: () => Promise<void>;

  // --- Active tab content (for TableOfContents) ---
  getActiveTabContent: () => string;

  // --- Tab edit config ---
  tabEditConfig: TabEditConfig | undefined;

  // --- Inline edit helpers (bridged from inlineEdit) ---
  startEdit: (field: string) => void;
  cancelEdit: () => void;
  saveEdit: (field: string, value: unknown) => Promise<void>;
}

/** Tab edit config type — shared between views */
export interface TabEditConfig {
  editingField: TabField | null;
  editValue: string;
  isSaving: boolean;
  onStartEdit: (field: TabField) => void;
  onEditValueChange: (value: string) => void;
  onSaveEdit: (field: string) => Promise<void>;
  onCancelEdit: () => void;
}

type TabField = 'brief' | 'detail' | 'reference' | 'content';
const tabFields: readonly TabField[] = ['brief', 'detail', 'reference', 'content'] as const;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Extracts ALL data fetching, state, and mutations from item-detail-client.tsx
 * into a shared hook. Both ReaderView and EditorView consume this.
 */
export function useItemDetailData({
  initialItem,
  relatedItems,
}: UseItemDetailDataOptions): ItemDetailData {
  const router = useRouter();
  const { canEdit, canAdmin } = useUserRole();
  const [item, setItem] = useState<ItemData>(initialItem);

  // --- Mobile detection ---
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1023px)');
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // --- Transcript ---
  const { segments, highlights } = useTranscript({
    itemId: item.id as string,
    initialSegments: null,
    initialHighlights: null,
  });

  // --- Copy link ---
  const [copied, setCopied] = useState(false);

  // --- Reader preferences ---
  const {
    fontSize,
    maxWidth,
    panelLayout,
    readerOpen,
    isDetached,
    detachedPosition,
    detachedSize,
    setFontSize,
    setMaxWidth,
    setPanelLayout,
    setReaderOpen,
    toggleReader,
    toggleDetached,
    setDetachedPosition,
    setDetachedSize,
  } = useReaderPreferences();
  const showSplitReader = readerOpen && !isDetached;

  // --- Inline field edit ---
  const inlineEdit = useInlineFieldEdit<ItemData>({
    itemId: item.id,
    onItemUpdate: setItem,
  });

  // --- Derived values ---
  const title = getDisplayTitle({
    suggested_title: item.suggested_title,
    title: item.title,
    content: item.content,
  });

  const isQAPair = item.content_type === 'q_a_pair';

  // --- Q&A edit mode ---
  const qaEditMode = useQAEditMode({
    itemId: item.id,
    title,
    answerStandard: item.answer_standard,
    answerAdvanced: item.answer_advanced,
    isQAPair,
    onFieldSaved: useCallback((field: string, value: string | null) => {
      setItem((prev) => ({ ...prev, [field]: value }));
    }, []),
  });

  // --- Vision analysis ---
  const { isAnalysing, handleVisionAnalysis } = useVisionAnalysis({
    itemId: item.id,
    onAnalysisComplete: useCallback((result: VisionAnalysisResult) => {
      setItem((prev) => ({
        ...prev,
        metadata: { ...prev.metadata, vision_analysis: result },
      }));
    }, []),
  });
  const visionAnalysis = item.metadata?.vision_analysis as VisionAnalysisResult | undefined;

  // --- Q&A provenance ---
  const qaProvenance = useQAProvenance({
    itemId: item.id,
    isQAPair,
    metadata: item.metadata,
    onMetadataUpdate: useCallback(
      (updater: (prev: Record<string, unknown> | null) => Record<string, unknown> | null) => {
        setItem((prev) => {
          const newMetadata = updater(prev.metadata);
          return {
            ...prev,
            metadata: newMetadata,
          };
        });
      },
      [],
    ),
  });

  // --- Topic layer content ---
  const { layerContent, isLoading: isLayerContentLoading } = useTopicLayerContent(
    qaProvenance.topicLayers,
    item.id as string,
  );

  // --- Read marks ---
  const { toggleRead, loadReadMarks, checkReadStatus } = useReadMarks();

  useEffect(() => {
    loadReadMarks();
  }, [loadReadMarks]);

  useEffect(() => {
    if (item?.id) {
      checkReadStatus([item.id]);
    }
  }, [item?.id, checkReadStatus]);

  // --- Copy link handler ---
  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy link');
    }
  }, []);

  // --- Star toggle ---
  const handleStarToggle = useCallback(async () => {
    const newStarred = !item.starred;
    setItem((prev) => ({
      ...prev,
      starred: newStarred,
    }));
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('toggle_star', {
        p_item_id: item.id,
        p_starred: newStarred,
      });
      if (error) {
        console.error('Failed to toggle star:', error.message);
        setItem((prev) => ({
          ...prev,
          starred: !newStarred,
        }));
        toast.error('Failed to update star');
        return;
      }
      toast(newStarred ? 'Starred' : 'Unstarred', { duration: 1500 });
    } catch (err) {
      console.error('Failed to toggle star:', err);
      setItem((prev) => ({
        ...prev,
        starred: !newStarred,
      }));
      toast.error('Failed to update star');
    }
  }, [item.id, item.starred]);

  // --- Priority cycle ---
  const handlePriorityCycle = useCallback(async () => {
    const cycle: Priority[] = [null, 'high', 'medium', 'low'];
    const currentIdx = cycle.indexOf((item.priority as Priority) ?? null);
    const next = cycle[(currentIdx + 1) % cycle.length];
    setItem((prev) => ({ ...prev, priority: next }));
    try {
      const res = await fetch(`/api/items/${item.id}/priority`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: next }),
      });
      if (!res.ok) throw new Error();
      toast(next ? `Priority: ${next}` : 'Priority cleared', { duration: 1500 });
    } catch (err) {
      console.error('Failed to cycle priority:', err);
      setItem((prev) => ({ ...prev, priority: item.priority }));
    }
  }, [item.id, item.priority]);

  // --- Copy answer (Q&A pairs) ---
  const handleCopyAnswer = useCallback(
    async (variant?: 'standard' | 'advanced') => {
      let text: string;
      if (variant === 'standard') {
        text = item.answer_standard ?? item.content ?? '';
      } else if (variant === 'advanced') {
        text = item.answer_advanced ?? item.content ?? '';
      } else {
        text = item.content ?? '';
      }
      try {
        await navigator.clipboard.writeText(text);
        const isVerified = !!item.verified_at;
        const label = variant
          ? `${variant.charAt(0).toUpperCase() + variant.slice(1)} answer copied`
          : 'Answer copied';

        if (isVerified) {
          toast.success(label);
        } else {
          toast(label, {
            description: 'Unverified \u2014 consider reviewing before submitting',
            duration: 4000,
          });
        }
      } catch {
        toast.error('Failed to copy answer');
      }
    },
    [item.content, item.answer_standard, item.answer_advanced, item.verified_at],
  );

  // --- Active tab content (for TableOfContents) ---
  const getActiveTabContent = useCallback((): string => {
    if (item.brief) return item.brief;
    if (item.summary_data?.executive) return item.summary_data.executive;
    if (item.ai_summary) return item.ai_summary;
    if (item.content) return item.content;
    return '';
  }, [item.brief, item.summary_data, item.ai_summary, item.content]);

  // --- Before-unload guard for dirty edits ---
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (qaEditMode.editDirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [qaEditMode.editDirty]);

  // --- Derived: transcript chapters ---
  const transcriptChapters =
    item.metadata &&
    Array.isArray((item.metadata as Record<string, unknown>).chapters)
      ? ((item.metadata as Record<string, unknown>).chapters as TranscriptChapter[])
      : undefined;

  // --- Derived: has reader content ---
  const hasReaderContent = !!(item.metadata?.reader_html) && !isQAPair;

  // --- Bridged inline edit helpers ---
  const startEdit = (field: string) => {
    inlineEdit.startEdit(field, (item as unknown as Record<string, unknown>)[field]);
  };
  const cancelEdit = inlineEdit.cancelEdit;
  const saveEdit = inlineEdit.saveEdit;

  // --- Tab edit config construction ---
  const tabEditingField: TabField | null = tabFields.includes(
    inlineEdit.editingField as TabField,
  )
    ? (inlineEdit.editingField as TabField)
    : null;

  const tabEditConfig: TabEditConfig | undefined = canEdit
    ? {
        editingField: tabEditingField,
        editValue: inlineEdit.editValue,
        isSaving: qaEditMode.isSavingTab,
        onStartEdit: (field: TabField) => startEdit(field),
        onEditValueChange: inlineEdit.setEditValue,
        onSaveEdit: async (field: string) => {
          qaEditMode.setIsSavingTab(true);
          try {
            await saveEdit(field, inlineEdit.editValue);
          } finally {
            qaEditMode.setIsSavingTab(false);
          }
        },
        onCancelEdit: cancelEdit,
      }
    : undefined;

  return {
    // Core item state
    item,
    setItem,
    relatedItems,

    // Derived values
    title,
    isQAPair,
    hasReaderContent,
    transcriptChapters,
    visionAnalysis,
    isMobile,

    // Roles
    canEdit,
    canAdmin,

    // Router
    router,

    // Read marks
    toggleRead,

    // Transcript
    segments,
    highlights,

    // Reader preferences
    fontSize,
    maxWidth,
    panelLayout,
    readerOpen,
    isDetached,
    detachedPosition,
    detachedSize,
    setFontSize,
    setMaxWidth,
    setPanelLayout,
    setReaderOpen,
    toggleReader,
    toggleDetached,
    setDetachedPosition,
    setDetachedSize,
    showSplitReader,

    // Inline field edit
    inlineEdit,

    // Q&A edit mode
    qaEditMode,

    // Vision analysis
    isAnalysing,
    handleVisionAnalysis,

    // Q&A provenance
    qaProvenance,

    // Topic layer content
    layerContent,
    isLayerContentLoading,

    // Copy handlers
    copied,
    handleCopyLink,
    handleCopyAnswer,

    // Star / priority
    handleStarToggle,
    handlePriorityCycle,

    // Active tab content
    getActiveTabContent,

    // Tab edit config
    tabEditConfig,

    // Inline edit helpers
    startEdit,
    cancelEdit,
    saveEdit,
  };
}

'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import {
  ExternalLink,
  FileText,
  BookOpen,
  Copy,
  Pencil,
  Eye,
  Loader2,
  MoreHorizontal,
  Trash2,
  ChevronDown,
} from 'lucide-react';
import { ReadToggleButton } from '@/components/read-toggle-button';
import { StarButton } from '@/components/star-button';
import { PrioritySelector, type Priority } from '@/components/priority-selector';
import { useReadMarks } from '@/contexts/read-marks-context';
import { useTranscript } from '@/hooks/use-transcript';
import { useReaderPreferences } from '@/hooks/use-reader-preferences';
import { TranscriptReader } from '@/components/transcript-reader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Thumbnail } from '@/components/thumbnail';
import { ContentTabs } from '@/components/content-tabs';
import { MetadataSidebar } from '@/components/metadata-sidebar';
import { RelatedItems } from '@/components/related-items';
import { RelatedByTags } from '@/components/related-by-tags';
import { VersionHistory } from '@/components/version-history';
import { ContentTypeHeader } from '@/components/content-type-header';
import { VerificationBadge } from '@/components/verification-badge';
import dynamic from 'next/dynamic';

const PdfViewer = dynamic(
  () => import('@/components/pdf-viewer').then((mod) => mod.PdfViewer),
  { ssr: false, loading: () => <div className="h-9 w-24 animate-pulse rounded bg-accent" /> },
);
const ImageGallery = dynamic(
  () => import('@/components/image-gallery').then((mod) => mod.ImageGallery),
  { ssr: false, loading: () => <div className="h-32 animate-pulse rounded-lg bg-accent" /> },
);
import { FloatingReader } from '@/components/floating-reader';
import { ReaderPanel } from '@/components/reader-panel';

import { TableOfContents } from '@/components/table-of-contents';
import { OrganiseSection } from '@/components/organise-section';
import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { DeleteContentDialog } from '@/components/delete-content-dialog';
import { useUserRole } from '@/hooks/use-user-role';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { createClient } from '@/lib/supabase/client';
import { getDisplayTitle } from '@/lib/format';
import { cn } from '@/lib/utils';
import { validateEditableField } from '@/lib/validation';
import { isFeatureEnabled, CLIENT_CONFIG } from '@/lib/client-config';
import { getLayerLabel } from '@/lib/validation/layer-schemas';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

import type {
  ContentListItem,
  SummaryData,
  TranscriptChapter,
} from '@/types/content';
import type { Layout } from 'react-resizable-panels';

export interface ItemData {
  id: string;
  title: string | null;
  suggested_title: string | null;
  content: string | null;
  ai_summary: string | null;
  ai_keywords: string[] | null;
  primary_domain: string | null;
  primary_subtopic: string | null;
  secondary_domain: string | null;
  secondary_subtopic: string | null;
  content_type: string | null;
  platform: string | null;
  author_name: string | null;
  source_url: string | null;
  file_path: string | null;
  source_domain: string | null;
  thumbnail_url: string | null;
  captured_date: string | null;
  classification_confidence: number | null;
  classification_reasoning: string | null;
  classified_at: string | null;
  summary_data: SummaryData | null;
  priority: string | null;
  user_tags: string[] | null;
  freshness: string | null;
  governance_review_status: string | null;
  metadata: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  // Phase 5 fields
  verified_at?: string | null;
  verified_by?: string | null;
  source_document?: string | null;
  source_bid?: string | null;
  brief?: string | null;
  detail?: string | null;
  reference?: string | null;
  answer_standard?: string | null;
  answer_advanced?: string | null;
}

// ---------------------------------------------------------------------------
// AI Processing Indicators (classify / summarise prompts)
// ---------------------------------------------------------------------------

function AiProcessingIndicators({
  item,
  onItemUpdated,
}: {
  item: ItemData;
  onItemUpdated: React.Dispatch<React.SetStateAction<ItemData>>;
}) {
  const [classifying, setClassifying] = useState(false);
  const [summarising, setSummarising] = useState(false);

  const needsClassification = !item.classified_at;
  const needsSummary = !item.ai_summary;

  if (!needsClassification && !needsSummary) return null;

  const handleClassify = async () => {
    setClassifying(true);
    try {
      const res = await fetch(`/api/items/${item.id}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Classification failed');
        return;
      }
      onItemUpdated((prev) => ({
        ...prev,
        primary_domain: data.primary_domain,
        primary_subtopic: data.primary_subtopic,
        secondary_domain: data.secondary_domain,
        secondary_subtopic: data.secondary_subtopic,
        ai_keywords: data.ai_keywords,
        ai_summary: data.ai_summary,
        suggested_title: data.suggested_title,
        classification_confidence: data.classification_confidence,
        classification_reasoning: data.classification_reasoning,
        classified_at: new Date().toISOString(),
      }));
      toast.success('Classification complete');
    } catch {
      toast.error('Failed to classify content');
    } finally {
      setClassifying(false);
    }
  };

  const handleSummarise = async () => {
    setSummarising(true);
    try {
      const res = await fetch('/api/summaries/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Summary generation failed');
        return;
      }
      onItemUpdated((prev) => ({
        ...prev,
        ai_summary: data.ai_summary ?? prev.ai_summary,
        summary_data: data.summary_data ?? prev.summary_data,
      }));
      toast.success('Summary generated');
    } catch {
      toast.error('Failed to generate summary');
    } finally {
      setSummarising(false);
    }
  };

  return (
    <div className="mb-6 flex flex-col gap-2">
      {needsClassification && (
        <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-4 py-2.5">
          <span className="text-xs text-muted-foreground">
            Classification pending
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClassify}
            disabled={classifying}
            className="h-7 gap-1.5 text-xs"
          >
            {classifying ? (
              <Loader2 className="size-3 animate-spin" />
            ) : null}
            {classifying ? 'Classifying...' : 'Classify now'}
          </Button>
        </div>
      )}
      {needsSummary && (
        <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-4 py-2.5">
          <span className="text-xs text-muted-foreground">
            Summary not yet generated
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSummarise}
            disabled={summarising}
            className="h-7 gap-1.5 text-xs"
          >
            {summarising ? (
              <Loader2 className="size-3 animate-spin" />
            ) : null}
            {summarising ? 'Generating...' : 'Generate summary'}
          </Button>
        </div>
      )}
    </div>
  );
}

interface ItemDetailClientProps {
  item: ItemData;
  relatedItems: Array<ContentListItem & { similarity: number }>;
}

export function ItemDetailClient({
  item: initialItem,
  relatedItems,
}: ItemDetailClientProps) {
  const router = useRouter();
  const { canEdit, canAdmin } = useUserRole();
  const [item, setItem] = useState<ItemData>(initialItem);
  const {
    segments,
    highlights,
  } = useTranscript({
    itemId: item.id as string,
    initialSegments: null,
    initialHighlights: null,
  });
  const [copied, setCopied] = useState(false);
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

  // Editable field states
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveAnnouncement, setSaveAnnouncement] = useState('');


  // Unified edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editStandard, setEditStandard] = useState('');
  const [editAdvanced, setEditAdvanced] = useState('');

  // Tab-level editing state (brief / detail / reference / content)
  const [isSavingTab, setIsSavingTab] = useState(false);


  // Vision analysis state
  const [isAnalysing, setIsAnalysing] = useState(false);
  const visionAnalysis = item.metadata?.vision_analysis as
    | { analysis: string; analysed_at: string; model: string; tokens_used: number }
    | undefined;

  const title = getDisplayTitle({
    suggested_title: item.suggested_title,
    title: item.title,
    content: item.content,
  });

  const isQAPair = item.content_type === 'q_a_pair';

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy link');
    }
  }, []);

  const handleVisionAnalysis = useCallback(async () => {
    setIsAnalysing(true);
    try {
      const res = await fetch(`/api/items/${item.id}/vision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Vision analysis failed');
        return;
      }
      // Update local item state with the analysis
      setItem((prev) => ({
        ...prev,
        metadata: {
          ...prev.metadata,
          vision_analysis: {
            analysis: data.analysis,
            analysed_at: new Date().toISOString(),
            model: data.model,
            tokens_used: data.tokens_used,
          },
        },
      }));
      toast.success('Visual analysis complete');
    } catch {
      toast.error('Failed to perform visual analysis');
    } finally {
      setIsAnalysing(false);
    }
  }, [item.id]);

  const startEdit = (field: string) => {
    setEditingField(field);
    setEditValue(String((item as unknown as Record<string, unknown>)[field] ?? ''));
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue('');
  };

  const saveEdit = async (field: string, value: unknown) => {
    if (!validateEditableField(field)) {
      console.error(`Field "${field}" is not editable`);
      toast.error('This field cannot be edited');
      return;
    }

    const previousValue = (item as unknown as Record<string, unknown>)[field];

    // Optimistic update
    setItem((prev) => ({ ...prev, [field]: value }));
    setEditingField(null);

    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, value }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Update failed');
      }

      setSaveSuccess(field);
      setSaveAnnouncement('Title saved');
      setTimeout(() => {
        setSaveSuccess(null);
        setSaveAnnouncement('');
      }, 1500);
    } catch {
      // Rollback
      setItem((prev) => ({ ...prev, [field]: previousValue }));
      setSaveAnnouncement('Save failed');
      setTimeout(() => setSaveAnnouncement(''), 1500);
      toast.error('Failed to save — please try again');
    }
  };

  const { toggleRead, loadReadMarks, checkReadStatus } = useReadMarks();

  // Trigger lazy loading of read marks counts for this page
  useEffect(() => { loadReadMarks(); }, [loadReadMarks]);

  // Check read status for this specific item
  useEffect(() => {
    if (item?.id) {
      checkReadStatus([item.id]);
    }
  }, [item?.id, checkReadStatus]);

  // Star toggle handler for keyboard shortcut
  const handleStarToggle = useCallback(async () => {
    const newStarred = item.metadata?.starred !== true;
    setItem((prev) => ({
      ...prev,
      metadata: { ...prev.metadata, starred: newStarred || undefined },
    }));
    try {
      const supabase = createClient();
      await supabase.rpc('toggle_star', {
        p_item_id: item.id,
        p_starred: newStarred,
      });
      toast(newStarred ? 'Starred' : 'Unstarred', { duration: 1500 });
    } catch {
      // Rollback
      setItem((prev) => ({
        ...prev,
        metadata: { ...prev.metadata, starred: !newStarred || undefined },
      }));
    }
  }, [item.id, item.metadata]);

  // Cycle priority: null -> high -> medium -> low -> null
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
    } catch {
      setItem((prev) => ({ ...prev, priority: item.priority }));
    }
  }, [item.id, item.priority]);

  // Unified edit mode: enter/exit
  const enterEditMode = useCallback(() => {
    setIsEditing(true);
    setEditTitle(title);
    setEditStandard(item.answer_standard ?? '');
    setEditAdvanced(item.answer_advanced ?? '');
    setEditDirty(false);
  }, [title, item.answer_standard, item.answer_advanced]);

  const cancelEditMode = useCallback(() => {
    setIsEditing(false);
    setEditDirty(false);
    setEditTitle('');
  }, []);

  const handleSaveAll = useCallback(async () => {
    try {
      // Save title if changed
      if (editTitle && editTitle !== title) {
        const res = await fetch(`/api/items/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ field: 'suggested_title', value: editTitle }),
        });
        if (!res.ok) throw new Error('Failed to save title');
        setItem((prev) => ({ ...prev, suggested_title: editTitle }));
      }
      // Save Q&A fields if changed
      if (isQAPair) {
        if (editStandard !== (item.answer_standard ?? '')) {
          const res = await fetch(`/api/items/${item.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ field: 'answer_standard', value: editStandard || null }),
          });
          if (!res.ok) throw new Error('Failed to save standard answer');
          setItem((prev) => ({ ...prev, answer_standard: editStandard || null }));
        }
        if (editAdvanced !== (item.answer_advanced ?? '')) {
          const res = await fetch(`/api/items/${item.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ field: 'answer_advanced', value: editAdvanced || null }),
          });
          if (!res.ok) throw new Error('Failed to save advanced answer');
          setItem((prev) => ({ ...prev, answer_advanced: editAdvanced || null }));
        }
      }
      setIsEditing(false);
      setEditDirty(false);
      toast.success('Changes saved');
    } catch {
      toast.error('Failed to save — please try again');
    }
  }, [editTitle, title, item.id, isQAPair, editStandard, editAdvanced, item.answer_standard, item.answer_advanced]);

  // Copy answer handler (Q&A pairs)
  const handleCopyAnswer = useCallback(async (variant?: 'standard' | 'advanced') => {
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
      toast.success(variant ? `${variant.charAt(0).toUpperCase() + variant.slice(1)} answer copied` : 'Answer copied');
    } catch {
      toast.error('Failed to copy answer');
    }
  }, [item.content, item.answer_standard, item.answer_advanced]);

  // Helper: get active tab content for TableOfContents
  const getActiveTabContent = useCallback((): string => {
    if (item.brief) return item.brief;
    if (item.summary_data?.executive) return item.summary_data.executive;
    if (item.ai_summary) return item.ai_summary;
    if (item.content) return item.content;
    return '';
  }, [item.brief, item.summary_data, item.ai_summary, item.content]);

  // Navigate away prompt when dirty
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (editDirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [editDirty]);

  // Keyboard shortcuts: m = toggle read, s = toggle star, p = cycle priority, r = toggle reader, e = edit, Shift+R = review
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
        toggleRead(item.id as string);
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
            setEditStandard(item.answer_standard ?? '');
            setEditAdvanced(item.answer_advanced ?? '');
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
  }, [item.id, item.answer_standard, item.answer_advanced, toggleRead, router, handleStarToggle, handlePriorityCycle, toggleReader, readerOpen, toggleDetached, canEdit, title]);

  const transcriptChapters =
    item.metadata &&
    Array.isArray((item.metadata as Record<string, unknown>).chapters)
      ? ((item.metadata as Record<string, unknown>)
          .chapters as TranscriptChapter[])
      : undefined;

  const handleLayoutChanged = useCallback(
    (layout: Layout) => {
      setPanelLayout(layout);
    },
    [setPanelLayout],
  );

  const hasReaderContent = !!(item.metadata?.reader_html) && !isQAPair;

  // Q&A provenance: which bids use this pair
  const [usedInWorkspaces, setUsedInWorkspaces] = useState<Array<{ id: string; name: string; type: string }>>([]);

  // Q&A related: other pairs from the same source document
  const [relatedQA, setRelatedQA] = useState<Array<{ id: string; title: string | null }>>([]);

  useEffect(() => {
    if (!isQAPair) return;
    const fetchWorkspaces = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('content_item_workspaces')
        .select('workspace_id, workspaces:workspace_id(id, name, type)')
        .eq('content_item_id', item.id);
      if (data) {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const workspaces = (data as any[])
          .map((d) => d.workspaces)
          .filter(Boolean)
          .filter((w) => w.type === 'bid');
        /* eslint-enable @typescript-eslint/no-explicit-any */
        setUsedInWorkspaces(workspaces as Array<{ id: string; name: string; type: string }>);
      }
    };
    fetchWorkspaces();
  }, [item.id, isQAPair]);

  useEffect(() => {
    if (!isQAPair) return;
    const sourceFile = (item.metadata as Record<string, unknown> | null)?.source_file as string | undefined;
    if (!sourceFile) return;
    const fetchRelated = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('content_items')
        .select('id, title')
        .eq('content_type', 'q_a_pair')
        .eq('metadata->>source_file', sourceFile)
        .neq('id', item.id)
        .order('title')
        .limit(10);
      if (data) setRelatedQA(data as Array<{ id: string; title: string | null }>);
    };
    fetchRelated();
  }, [item.id, item.metadata, isQAPair]);

  // Layer switcher: items sharing the same topic_id
  const [topicLayers, setTopicLayers] = useState<
    Array<{ id: string; title: string | null; layer: string | null; content_type: string | null }>
  >([]);

  useEffect(() => {
    if (!isFeatureEnabled('content_layers')) return;
    const fetchLayers = async () => {
      try {
        const res = await fetch(`/api/items/${item.id}/layers`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.layers?.length > 0) {
          setTopicLayers(
            data.layers as Array<{ id: string; title: string | null; layer: string | null; content_type: string | null }>,
          );
        }
      } catch {
        // Non-critical — fail silently
      }
    };
    fetchLayers();
  }, [item.id]);

  // Inline layer editing handler
  const handleLayerChange = useCallback(
    async (newLayer: string | null) => {
      const prevMetadata = item.metadata;
      // Optimistic update
      setItem((prev) => ({
        ...prev,
        metadata: {
          ...prev.metadata,
          ...(newLayer ? { layer: newLayer } : {}),
          ...(!newLayer ? (() => { const m = { ...prev.metadata }; delete m.layer; return m; })() : {}),
        },
      }));
      try {
        const res = await fetch(`/api/items/${item.id}/metadata`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ layer: newLayer }),
        });
        if (!res.ok) throw new Error();
        toast.success(newLayer ? `Layer set to ${getLayerLabel(newLayer)}` : 'Layer cleared');
      } catch {
        // Rollback
        setItem((prev) => ({ ...prev, metadata: prevMetadata }));
        toast.error('Failed to update layer');
      }
    },
    [item.id, item.metadata],
  );

  // Build editConfig for ContentTabs — bridges existing saveEdit / startEdit
  const tabFields = ['brief', 'detail', 'reference', 'content'] as const;
  type TabField = (typeof tabFields)[number];
  const tabEditingField: TabField | null = tabFields.includes(editingField as TabField)
    ? (editingField as TabField)
    : null;

  const tabEditConfig = canEdit
    ? {
        editingField: tabEditingField,
        editValue,
        isSaving: isSavingTab,
        onStartEdit: (field: TabField) => startEdit(field),
        onEditValueChange: setEditValue,
        onSaveEdit: async (field: string) => {
          setIsSavingTab(true);
          try {
            await saveEdit(field, editValue);
          } finally {
            setIsSavingTab(false);
          }
        },
        onCancelEdit: cancelEdit,
      }
    : undefined;

  const contentTabsElement = (
    <ContentTabs
      itemId={item.id as string}
      summaryData={item.summary_data ?? null}
      contentType={item.content_type as string}
      content={item.content}
      aiSummary={item.ai_summary}
      brief={item.brief}
      detail={item.detail}
      reference={item.reference}
      readerHtml={item.metadata?.reader_html as string | undefined}
      hideFullText={
        item.content_type === 'transcript' &&
        !!transcriptChapters &&
        transcriptChapters.length > 0
      }
      platform={item.platform}
      metadata={item.metadata}
      authorName={item.author_name}
      sourceUrl={item.source_url}
      transcriptChapters={transcriptChapters}
      segments={segments}
      highlights={highlights}
      frameable={item.metadata?.frameable === true}
      canEdit={canEdit}
      editConfig={tabEditConfig}
      className="mb-6"
    />
  );

  // Item detail content -- extracted to keep the PanelGroup JSX clean
  const itemDetailContent = (
    <>
      {/* Screen reader: save announcements */}
      <div aria-live="polite" className="sr-only">{saveAnnouncement}</div>

      {/* Screen reader: keyboard shortcut help */}
      <div className="sr-only" role="note" aria-label="Keyboard shortcuts">
        Available shortcuts: M to toggle read, S to toggle star, P to cycle priority, E to toggle edit, R to open reader panel.
      </div>

      {/* Breadcrumb navigation */}
      {isQAPair ? (
        <nav aria-label="Breadcrumb" className="mb-4">
          <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <li>
              <Link href="/library" className="hover:text-foreground transition-colors">
                Q&A Library
              </Link>
            </li>
            {item.primary_domain && (
              <>
                <li aria-hidden="true">/</li>
                <li>{item.primary_domain}</li>
              </>
            )}
          </ol>
        </nav>
      ) : (
        <BreadcrumbNav
          domain={item.primary_domain as string | null}
          title={title}
          className="mb-4"
        />
      )}

      {/* Layer switcher — shows linked items sharing the same topic_id */}
      {isFeatureEnabled('content_layers') && topicLayers.length > 1 && (
        <nav aria-label="Content layers" className="mb-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground mr-1">Layers:</span>
            {topicLayers.map((layerItem) => {
              const isCurrent = layerItem.id === item.id;
              const label = layerItem.layer
                ? getLayerLabel(layerItem.layer)
                : layerItem.title ?? 'Untitled';
              return isCurrent ? (
                <Badge
                  key={layerItem.id}
                  variant="default"
                  className="text-xs"
                >
                  {label}
                </Badge>
              ) : (
                <Link key={layerItem.id} href={`/item/${layerItem.id}`}>
                  <Badge
                    variant="outline"
                    className="text-xs cursor-pointer hover:bg-accent transition-colors"
                  >
                    {label}
                  </Badge>
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Main content */}
        <article className="min-w-0 flex-1">
          {/* Thumbnail (not shown for Q&A pairs) */}
          {item.thumbnail_url && !isQAPair ? (
            <Thumbnail
              src={item.thumbnail_url as string | null}
              alt={title}
              contentType={item.content_type as string}
              domain={item.primary_domain as string}
              sizes="(max-width: 640px) 100vw, (max-width: 1280px) 80vw, 800px"
              className="mb-6 max-w-2xl"
            />
          ) : null}

          {/* Title + inline badges */}
          <div className="mb-2">
            {isEditing ? (
              <Input
                autoFocus
                value={editTitle}
                onChange={(e) => {
                  setEditTitle(e.target.value);
                  setEditDirty(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveAll();
                  if (e.key === 'Escape') cancelEditMode();
                }}
                className="text-xl font-bold"
              />
            ) : (
              <h1 className="text-fluid-xl font-bold leading-tight">{title}</h1>
            )}
            {/* Inline badges */}
            {(item.verified_at || item.source_document) && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <VerificationBadge verified={!!item.verified_at} size="md" />
                {item.source_document && (
                  <span className="text-xs text-muted-foreground">
                    Source: <span className="font-medium text-foreground/80">{item.source_document}</span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Editing banner */}
          {isEditing && (
            <div className="mb-4 flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-50 px-4 py-2 text-sm dark:bg-amber-950/30">
              <span className="font-medium text-amber-800 dark:text-amber-300">
                Editing{editDirty ? ' \u2014 unsaved changes' : ''}
              </span>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveAll}>Save</Button>
                <Button size="sm" variant="outline" onClick={cancelEditMode}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Action bar (Item 7) */}
          <div className="sticky top-0 z-10 mb-6 flex flex-wrap items-center gap-2 bg-background py-2 sm:static sm:z-auto">
            <ReadToggleButton itemId={item.id as string} />
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={isEditing ? cancelEditMode : enterEditMode}
                className="gap-1.5"
              >
                <Pencil className="size-3.5" />
                {isEditing ? 'Cancel edit' : 'Edit'}
              </Button>
            )}
            {isQAPair && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Copy className="size-3.5" />
                    Copy answer
                    <ChevronDown className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {item.answer_standard && (
                    <DropdownMenuItem onClick={() => handleCopyAnswer('standard')}>
                      Copy Standard
                    </DropdownMenuItem>
                  )}
                  {item.answer_advanced && (
                    <DropdownMenuItem onClick={() => handleCopyAnswer('advanced')}>
                      Copy Advanced
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => handleCopyAnswer()}>
                    Copy All
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <StarButton
              itemId={item.id}
              starred={item.metadata?.starred === true}
              size="md"
            />
            <PrioritySelector
              itemId={item.id}
              priority={(item.priority as Priority) ?? null}
              size="md"
              onChanged={(p) => setItem((prev) => ({ ...prev, priority: p }))}
            />

            {/* Overflow menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="size-9 p-0" aria-label="More actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {hasReaderContent && (
                  <DropdownMenuItem onClick={toggleReader}>
                    <BookOpen className="size-4" />
                    {readerOpen ? 'Close Reader' : 'Open Reader'}
                  </DropdownMenuItem>
                )}
                {item.source_url && (
                  <DropdownMenuItem onClick={() => window.open(item.source_url as string, '_blank')}>
                    <ExternalLink className="size-4" />
                    Open original
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleCopyLink}>
                  <Copy className="size-4" />
                  {copied ? 'Copied!' : 'Copy link'}
                </DropdownMenuItem>
                {item.content_type === 'pdf' && (item.source_url || item.file_path) && (
                  <DropdownMenuItem onClick={() => {
                    /* PDF viewer is dynamic, trigger it via the existing PdfViewer */
                    const btn = document.querySelector<HTMLButtonElement>('[data-pdf-trigger]');
                    btn?.click();
                  }}>
                    <FileText className="size-4" />
                    View PDF
                  </DropdownMenuItem>
                )}
                {item.content_type === 'pdf' && (
                  <DropdownMenuItem onClick={handleVisionAnalysis} disabled={isAnalysing}>
                    <Eye className="size-4" />
                    {isAnalysing ? 'Analysing\u2026' : 'Visual Analysis'}
                  </DropdownMenuItem>
                )}
                {canAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => {
                        const btn = document.querySelector<HTMLButtonElement>('[data-delete-trigger]');
                        btn?.click();
                      }}
                    >
                      <Trash2 className="size-4" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Hidden triggers for dynamic components */}
            {item.content_type === 'pdf' && (item.source_url || item.file_path) && (
              <div className="hidden">
                <PdfViewer
                  sourceUrl={item.source_url ?? undefined}
                  filePath={item.file_path ?? undefined}
                  title={title}
                />
              </div>
            )}
            {canAdmin && (
              <div className="hidden">
                <DeleteContentDialog
                  itemId={item.id}
                  itemTitle={title}
                />
              </div>
            )}
          </div>

          {/* Content-type specific header */}
          <ContentTypeHeader
            contentType={item.content_type}
            platform={item.platform}
            metadata={item.metadata}
            sourceUrl={item.source_url}
            authorName={item.author_name}
          />

          {/* AI processing indicators (classify / summarise — not for Q&A pairs) */}
          {canEdit && item.content && !isQAPair && (
            <AiProcessingIndicators
              item={item}
              onItemUpdated={setItem}
            />
          )}

          {/* Content display — Q&A pair gets dedicated layout, others get tabs */}
          {isQAPair ? (
            <div className="mb-6 space-y-4">
              {(item.answer_standard || isEditing) && (
                <div className="rounded-xl border border-border bg-card">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Standard Answer
                    </span>
                    {!isEditing && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => handleCopyAnswer('standard')}
                      >
                        <Copy className="size-3" />
                        Copy
                      </Button>
                    )}
                  </div>
                  <div className="p-4">
                    {isEditing ? (
                      <textarea
                        value={editStandard}
                        onChange={(e) => { setEditStandard(e.target.value); setEditDirty(true); }}
                        className="w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        placeholder="Standard answer..."
                      />
                    ) : (
                      <p className="text-sm leading-relaxed whitespace-pre-line">{item.answer_standard}</p>
                    )}
                  </div>
                </div>
              )}
              {(item.answer_advanced || isEditing) && (
                <div className="rounded-xl border border-border bg-card">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Advanced Answer
                    </span>
                    {!isEditing && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => handleCopyAnswer('advanced')}
                      >
                        <Copy className="size-3" />
                        Copy
                      </Button>
                    )}
                  </div>
                  <div className="p-4">
                    {isEditing ? (
                      <textarea
                        value={editAdvanced}
                        onChange={(e) => { setEditAdvanced(e.target.value); setEditDirty(true); }}
                        className="w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        placeholder="Advanced answer..."
                      />
                    ) : (
                      <p className="text-sm leading-relaxed whitespace-pre-line">{item.answer_advanced}</p>
                    )}
                  </div>
                </div>
              )}
              {!item.answer_standard && !item.answer_advanced && !isEditing && item.content && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-sm leading-relaxed whitespace-pre-line">{item.content}</p>
                </div>
              )}
              {!item.answer_standard && !item.answer_advanced && !isEditing && !item.content && (
                <div className="rounded-xl border border-border bg-card p-8 text-center">
                  <p className="text-sm text-muted-foreground">No answer recorded yet.</p>
                </div>
              )}
            </div>
          ) : (
            contentTabsElement
          )}

          {/* Q&A provenance: bids using this pair */}
          {isQAPair && usedInWorkspaces.length > 0 && (
            <div className="mb-6 rounded-xl border border-border bg-card p-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Used in {usedInWorkspaces.length} bid{usedInWorkspaces.length !== 1 ? 's' : ''}
              </h3>
              <div className="flex flex-wrap gap-2">
                {usedInWorkspaces.map((w) => (
                  <Link
                    key={w.id}
                    href={`/bid/${w.id}`}
                    className="rounded-md border border-border px-2.5 py-1 text-sm text-foreground hover:bg-accent transition-colors"
                  >
                    {w.name}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Q&A related pairs from the same source document */}
          {isQAPair && relatedQA.length > 0 && (
            <div className="mb-6 rounded-xl border border-border bg-card p-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Related Q&A pairs (same source)
              </h3>
              <ul className="space-y-1">
                {relatedQA.map((q) => (
                  <li key={q.id}>
                    <Link
                      href={`/item/${q.id}`}
                      className="block rounded px-2 py-1.5 text-sm text-foreground hover:bg-accent transition-colors"
                    >
                      {q.title ?? 'Untitled'}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Table of Contents (not shown for Q&A pairs) */}
          {!isQAPair && (
            <TableOfContents content={getActiveTabContent()} className="mb-6" />
          )}

          {/* Vision analysis (PDF items) */}
          {visionAnalysis && (
            <section className="mb-6">
              <h2 className="mb-2 text-sm font-semibold">Visual Analysis</h2>
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-wrap">
                {visionAnalysis.analysis}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Analysed {new Date(visionAnalysis.analysed_at).toLocaleDateString('en-GB')} · {visionAnalysis.model} · {visionAnalysis.tokens_used.toLocaleString()} tokens
              </p>
            </section>
          )}

          {/* Extracted images gallery (PDF items) */}
          {item.content_type === 'pdf' &&
            (item.file_path || item.source_url) && (
              <ImageGallery
                itemId={item.id}
                hasExtractedImages={
                  Array.isArray(
                    (item.metadata as Record<string, unknown> | null)
                      ?.extracted_images,
                  )
                }
                className="mb-6"
              />
            )}

          {/* Transcript reader (for transcripts with chapters) */}
          {item.content &&
            item.content_type === 'transcript' &&
            transcriptChapters &&
            transcriptChapters.length > 0 && (
              <section className="mb-8">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Transcript
                </h2>
                <TranscriptReader
                  content={item.content}
                  chapters={transcriptChapters}
                  segments={segments ?? undefined}
                  highlights={highlights ?? undefined}
                />
              </section>
            )}

          {/* Content Layer selector */}
          {isFeatureEnabled('content_layers') && canEdit && (
            <section className="mb-6 border-t border-border pt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Content Layer
              </h3>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => handleLayerChange(null)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    !item.metadata?.layer
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-muted text-foreground hover:bg-accent'
                  }`}
                >
                  No layer
                </button>
                {CLIENT_CONFIG.layer_vocabulary.map((layer) => {
                  const isActive = item.metadata?.layer === layer.key;
                  return (
                    <button
                      key={layer.key}
                      type="button"
                      onClick={() => handleLayerChange(layer.key)}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        isActive
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-muted text-foreground hover:bg-accent'
                      }`}
                    >
                      {layer.label}
                    </button>
                  );
                })}
              </div>
              {!!item.metadata?.layer && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {CLIENT_CONFIG.layer_vocabulary.find(
                    (l) => l.key === (item.metadata?.layer as string),
                  )?.description}
                </p>
              )}
            </section>
          )}

          {/* Read-only layer badge (for viewers) */}
          {isFeatureEnabled('content_layers') && !canEdit && !!item.metadata?.layer && (
            <section className="mb-6 border-t border-border pt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Content Layer
              </h3>
              <Badge variant="outline" className="text-xs border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400">
                {getLayerLabel(item.metadata.layer as string)}
              </Badge>
            </section>
          )}

          {/* Draft toggle (editors only, when draft_status feature enabled) */}
          {isFeatureEnabled('draft_status') && canEdit && (
            <section className="mb-6 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </h3>
                <button
                  type="button"
                  onClick={async () => {
                    const isDraft = item.governance_review_status === 'draft';
                    const newStatus = isDraft ? null : 'draft';
                    setItem((prev) => ({ ...prev, governance_review_status: newStatus }));
                    try {
                      const supabase = createClient();
                      const { error } = await supabase
                        .from('content_items')
                        .update({ governance_review_status: newStatus })
                        .eq('id', item.id);
                      if (error) throw error;
                      toast.success(isDraft ? 'Published' : 'Marked as draft');
                    } catch {
                      setItem((prev) => ({ ...prev, governance_review_status: isDraft ? 'draft' : null }));
                      toast.error('Failed to update status');
                    }
                  }}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    item.governance_review_status === 'draft'
                      ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-400'
                      : 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-700 dark:bg-green-950 dark:text-green-400',
                  )}
                >
                  {item.governance_review_status === 'draft' ? 'Draft — click to publish' : 'Published — click to draft'}
                </button>
              </div>
            </section>
          )}

          {/* OrganiseSection (Item 6) — replaces separate keywords/workspaces/tags */}
          <OrganiseSection
            itemId={item.id}
            keywords={(item.ai_keywords as string[]) ?? []}
            workspaces={[]}
            tags={(item.user_tags as string[]) ?? []}
            canEdit={canEdit}
            onKeywordsChanged={(kw) => setItem((prev) => ({ ...prev, ai_keywords: kw }))}
            onTagsChanged={(newTags) => setItem((prev) => ({ ...prev, user_tags: newTags }))}
            onWorkspacesChanged={() => {}}
            className="mb-6"
          />
        </article>

        {/* Metadata sidebar */}
        <MetadataSidebar
          item={item}
          editingField={editingField}
          editValue={editValue}
          saveSuccess={saveSuccess}
          startEdit={startEdit}
          saveEdit={saveEdit}
          readOnly={!canEdit}
        />
      </div>

      {/* Version history */}
      <VersionHistory
        itemId={item.id}
        currentContent={item.content ?? ''}
        currentTitle={getDisplayTitle({
          suggested_title: item.suggested_title,
          title: item.title,
          content: item.content,
        })}
        onRollback={() => router.refresh()}
        className="mt-8"
      />

      {/* Related content */}
      <RelatedItems relatedItems={relatedItems} />

      {/* Related by shared tags */}
      {(item.user_tags?.length ?? 0) > 0 && (
        <RelatedByTags
          itemId={item.id}
          tags={(item.user_tags as string[]) ?? []}
        />
      )}
    </>
  );

  const readerPanelProps = {
    readerHtml: item.metadata?.reader_html as string | undefined,
    contentType: item.content_type,
    title,
    fontSize,
    maxWidth,
    onFontSizeChange: setFontSize,
    onMaxWidthChange: setMaxWidth,
    onClose: () => setReaderOpen(false),
    platform: item.platform,
    metadata: item.metadata,
    authorName: item.author_name,
    sourceUrl: item.source_url,
    filePath: item.file_path,
    content: item.content,
    transcriptChapters,
    segments,
    highlights,
    frameable: item.metadata?.frameable === true,
    onDetachToggle: toggleDetached,
  };

  return (
    <>
    <PanelGroup
      orientation="horizontal"
      onLayoutChanged={handleLayoutChanged}
      defaultLayout={showSplitReader ? panelLayout : undefined}
      className="min-h-[calc(100vh-4rem)]"
    >
      <Panel
        id="detail"
        defaultSize={showSplitReader ? `${panelLayout.detail ?? 55}%` : '100%'}
        minSize="30%"
      >
        <div className="mx-auto max-w-7xl overflow-y-auto px-4 py-6 sm:px-6">
          {itemDetailContent}
        </div>
      </Panel>
      {showSplitReader && (
        <>
          <PanelResizeHandle className="w-1.5 bg-border transition-colors hover:bg-primary/20 data-[active]:bg-primary/30" />
          <Panel
            id="reader"
            defaultSize={`${panelLayout.reader ?? 45}%`}
            minSize="25%"
          >
            <div className="h-full border-l border-border bg-background">
              <ReaderPanel
                {...readerPanelProps}
                isDetached={false}
              />
            </div>
          </Panel>
        </>
      )}
    </PanelGroup>
    {readerOpen && isDetached && (
      <FloatingReader
        readerHtml={item.metadata?.reader_html as string | undefined}
        contentType={item.content_type}
        title={title}
        fontSize={fontSize}
        maxWidth={maxWidth}
        onFontSizeChange={setFontSize}
        onMaxWidthChange={setMaxWidth}
        onClose={() => setReaderOpen(false)}
        onDock={toggleDetached}
        position={detachedPosition}
        size={detachedSize}
        onPositionChange={setDetachedPosition}
        onSizeChange={setDetachedSize}
        platform={item.platform}
        metadata={item.metadata}
        authorName={item.author_name}
        sourceUrl={item.source_url}
        filePath={item.file_path}
        content={item.content}
        transcriptChapters={transcriptChapters}
        segments={segments}
        highlights={highlights}
      />
    )}
    </>
  );
}

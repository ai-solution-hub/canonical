'use client';

import {
  Component,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Sparkles, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { queryKeys } from '@/lib/query/query-keys';
import { useUserRole } from '@/hooks/use-user-role';
import { useDraftStream } from '@/hooks/streaming/use-draft-stream';
import { useExtendTheme } from '@/components/procurement/extend/use-extend-theme';
import { DocxEditorPreview } from '@/components/procurement/extend/docx-editor';
import { XlsxEditorPreview } from '@/components/procurement/extend/xlsx-editor';
import {
  ThemedDocxViewer,
  ThemedXlsxViewer,
} from '@/components/procurement/extend/themed-viewers';

/**
 * ID-147 {147.13} — DOCX/Excel editor wiring + fill mechanism (TECH §5
 * DR-066, PRODUCT §F1/§F2/§F4/§F5). Wires the vendored (147.6, experimental
 * maturity) DOCX/Excel Editor shells as the in-place edit affordance over a
 * rendered procurement form document.
 *
 * §F2 (ruled): "fill a missing answer" dispatches the EXISTING Claude-side
 * draft/fill backend (`useDraftStream` — SSE draft-stream,
 * `form_responses` write) — this component is the edit AFFORDANCE, never a
 * second in-editor persistence engine. A second write path would fork
 * answer state away from the answer-quality backend that already owns
 * review/versioning.
 *
 * §F1 "manual in-editor edits persist via the editor's own save bound to
 * the document's storage_path": the vendored editor shells
 * (`docx-editor.tsx`/`xlsx-editor.tsx`) ship ONLY a client-side
 * download-to-disk export (no `onSave`/`onChange`/ref — verified empirically,
 * DR-066 "editor SHELL", 147.6 vendor-in) — there is no programmatic hook to
 * intercept in-editor content. The re-upload control below reuses the
 * EXISTING, already admin/editor-gated `POST /api/procurement/[id]/tender`
 * endpoint (`upsert: true`, same `tender-documents` bucket key) as the save
 * target for a locally re-saved DOCX — no new backend, matching the §F2
 * "not a bespoke persistence engine" ruling extended to manual edits. That
 * route currently only accepts PDF/DOCX (not XLSX); an XLSX save surfaces
 * the route's real, honest rejection via toast rather than a silent/fake
 * success — flagged as a follow-up (extend that route's MIME allowlist),
 * out of THIS Subtask's file ownership (components/procurement/extend/**
 * only).
 *
 * §F4: edit/fill affordances are gated on `useUserRole().canEdit`
 * (admin/editor) — reviewer/viewer render the read-only themed viewer only,
 * matching the sibling `question-answer-editor.tsx` / `requirement-catalogue-editor.tsx`
 * convention. This is a UX-layer gate on top of the server-side
 * `getAuthorisedClient(['admin','editor'])` already enforced independently
 * by both routes this component calls (`draft-stream`/`draft`, `tender`) —
 * not a substitute for it.
 *
 * §F5: because the editors are experimental maturity, an `EditorErrorBoundary`
 * catches a render-time init failure and falls back to the read-only themed
 * viewer for that document with a soft, readable error — never a blank pane.
 */

export type EditableDocumentKind = 'docx' | 'xlsx';

export interface MissingAnswer {
  questionId: string;
  questionText: string;
}

export interface DocumentEditorPanelProps {
  procurementId: string;
  kind: EditableDocumentKind;
  /**
   * `tender-documents` bucket key this document's manual-edit "save"
   * re-upload targets — the same key `GET [id]` lists under
   * `tender_documents[].path`. Read/loading of `src` itself is NOT this
   * component's job (src/data-fetching wiring is ID-147.18's state-contract
   * work, matching the `ThemedDocxViewer`/`ThemedXlsxViewer` "shell only"
   * boundary) — the caller passes an already-resolved signed URL.
   */
  documentPath: string;
  fileName?: string;
  src?: string;
  /** Unanswered `form_questions` slots surfaced alongside this document (§F2). */
  missingAnswers?: MissingAnswer[];
  className?: string;
}

const EMPTY_MISSING_ANSWERS: MissingAnswer[] = [];

/**
 * React error boundaries are class-only (no hook equivalent) — this is the
 * §F5 "an editor that fails to initialise" catch point. Vendored editor
 * shells expose no `onError` callback, so a render-time throw is the only
 * failure signal available to wrap.
 */
class EditorErrorBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { onError: () => void; children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

/** POSTs a re-saved document to the existing admin/editor-gated tender-upload endpoint. */
function useSaveEditedDocument(procurementId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/procurement/${procurementId}/tender`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error ??
            `Failed to save document (${res.status})`,
        );
      }
      return data as { path: string; filename: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.procurement.detail(procurementId),
      });
    },
  });
}

export function DocumentEditorPanel({
  procurementId,
  kind,
  documentPath,
  fileName,
  src,
  missingAnswers = EMPTY_MISSING_ANSWERS,
  className,
}: DocumentEditorPanelProps) {
  // `documentPath` is the authoritative "which document" identifier (the
  // `tender-documents` bucket key) — `fileName` falls back to its basename
  // when the caller doesn't supply a separate display name, so the
  // save-target guard below always has a real filename to check against.
  const resolvedFileName = fileName ?? documentPath.split('/').pop();
  const { canEdit } = useUserRole();
  const { isDark, onIsDarkChange } = useExtendTheme();
  const [editorFailed, setEditorFailed] = useState(false);
  const [fillingQuestionId, setFillingQuestionId] = useState<string | null>(
    null,
  );
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stream = useDraftStream(procurementId);
  const saveMutation = useSaveEditedDocument(procurementId);

  const isFilling =
    stream.phase !== 'idle' &&
    stream.phase !== 'done' &&
    stream.phase !== 'error';
  const { phase: streamPhase, error: streamError } = stream;
  const toastedPhaseRef = useRef<string | null>(null);

  // §F2 — the stream's `done`/`error` phases surface the fill outcome; no
  // second write path is invoked here, only UI feedback for the EXISTING
  // draft lane's own result. `toastedPhaseRef` guards against re-toasting on
  // every render while the terminal phase is held steady (a ref write, not
  // a state update, so this never cascades a re-render).
  useEffect(() => {
    if (fillingQuestionId === null) return;
    if (streamPhase !== 'done' && streamPhase !== 'error') return;
    if (toastedPhaseRef.current === streamPhase) return;
    toastedPhaseRef.current = streamPhase;

    if (streamPhase === 'done') {
      toast.success('Answer filled and saved.');
    } else {
      toast.error(streamError ?? 'Failed to fill answer.');
    }
  }, [streamPhase, streamError, fillingQuestionId]);

  function handleFill(questionId: string) {
    toastedPhaseRef.current = null;
    setFillingQuestionId(questionId);
    stream.startDraft(questionId);
  }

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    // The tender-upload endpoint keys the storage object by the uploaded
    // file's OWN name (`${id}/${file.name}`, upsert:true) — the re-upload
    // must carry the SAME filename as this document to land at the SAME
    // storage_path, otherwise it silently creates a different object
    // instead of persisting THIS document's edits.
    if (resolvedFileName && file.name !== resolvedFileName) {
      toast.error(
        `To save edits to this document, upload a file named "${resolvedFileName}".`,
      );
      return;
    }

    try {
      await saveMutation.mutateAsync(file);
      toast.success('Document saved.');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save document.',
      );
    }
  }

  const ReadOnlyViewer =
    kind === 'docx' ? (
      <ThemedDocxViewer fileName={resolvedFileName} src={src} />
    ) : (
      <ThemedXlsxViewer fileName={resolvedFileName} src={src} />
    );

  // §F4 — reviewer/viewer roles never mount the editor at all.
  if (!canEdit) {
    return <div className={cn('space-y-3', className)}>{ReadOnlyViewer}</div>;
  }

  // §F5 — a previously-caught editor init failure degrades to the
  // read-only viewer, with a soft, non-colour-only error notice.
  if (editorFailed) {
    return (
      <div className={cn('space-y-3', className)}>
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span>
            This document editor could not be loaded. Showing the read-only view
            instead.
          </span>
        </div>
        {ReadOnlyViewer}
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <EditorErrorBoundary onError={() => setEditorFailed(true)}>
        {kind === 'docx' ? (
          <DocxEditorPreview
            fileName={resolvedFileName}
            isDark={isDark}
            onIsDarkChange={onIsDarkChange}
            src={src}
          />
        ) : (
          <XlsxEditorPreview
            fileName={resolvedFileName}
            isDark={isDark}
            onIsDarkChange={onIsDarkChange}
            src={src}
          />
        )}
      </EditorErrorBoundary>

      {/* §F1 — manual-edit save, bound to the document's storage_path via
          the existing tender-upload endpoint (no bespoke persistence). */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={saveMutation.isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          {saveMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Upload className="size-4" aria-hidden="true" />
          )}
          Save edited document
        </Button>
        <label htmlFor={fileInputId} className="sr-only">
          Save edited document
        </label>
        <input
          ref={fileInputRef}
          id={fileInputId}
          type="file"
          className="sr-only"
          accept={
            kind === 'docx'
              ? '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              : '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          }
          onChange={handleFileSelected}
        />
      </div>

      {/* §F2 — fill-a-missing-answer affordance, dispatching the existing
          Claude-side draft lane (useDraftStream), never a bespoke write. */}
      {missingAnswers.length > 0 && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-xs font-medium text-muted-foreground">
            Missing answers
          </p>
          <ul className="space-y-2">
            {missingAnswers.map((answer) => {
              const isThisFilling =
                isFilling && fillingQuestionId === answer.questionId;
              return (
                <li
                  key={answer.questionId}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="text-sm">{answer.questionText}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isFilling}
                    onClick={() => handleFill(answer.questionId)}
                  >
                    {isThisFilling ? (
                      <Loader2
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Sparkles className="size-4" aria-hidden="true" />
                    )}
                    Fill
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

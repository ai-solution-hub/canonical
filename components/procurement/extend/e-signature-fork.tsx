'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { FilePenIcon, Pen01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type SignaturePad from 'signature_pad';

import { cn } from '@/lib/utils';
import { PDFViewer } from '@/components/procurement/extend/pdf-viewer';
import { PdfBlockResizableShell } from '@/components/procurement/extend/pdf-block-resizable-shell';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { buildSignedPdfBytes } from '@/components/procurement/extend/build-signed-pdf';
import {
  usePersistSignedDocument,
  type PersistSignedDocumentResult,
} from '@/components/procurement/extend/use-persist-signed-document';

/**
 * ID-147 {147.14} — forked E-Signature block (PRODUCT.md §F3/§F4/§F5,
 * TECH.md §5). The vendored `ESignatureBlock`
 * (`components/procurement/extend/e-signature.tsx`, {147.6}) exposes only
 * `file?:string` — internal single hardcoded field, no callbacks, no
 * persistence, no network (grounding §3/§12, DR-066). It stays UNTOUCHED
 * (still covered by {147.6}'s own smoke test); this is a NEW sibling
 * component, NOT a drop-in — the fork:
 *
 * (a) drives signature-field PLACEMENT from the `fields` prop ("our
 *     data") instead of a hardcoded default, and supports N fields, not
 *     one;
 * (b) adds an `onSigned` persistence callback wired to
 *     `usePersistSignedDocument`, which writes the completed signed PDF
 *     to storage as a `form_attachments` row, `role='form_source'`
 *     (`form_instance_id` set — the `form_attachments_form_source_scoped`
 *     CHECK, migration `20260716113306_id147_form_attachments.sql`), by
 *     POSTing to the EXISTING hardened `/api/procurement/[id]/attachments`
 *     route (ID-147.8) rather than writing to Supabase directly (TECH.md
 *     §1 step 5, DR-063 "Extend ships zero backend").
 *
 * §F4 — place/complete signature fields is admin/editor-gated. `canSign`
 * is caller-derived (matches `question-answer-editor.tsx`'s `canEdit`
 * convention — typically from `useUserRole()`); reviewer/viewer pass
 * `canSign={false}` and see every field read-only with no sign/save
 * controls rendered at all. Server-side, the attachments route this
 * persists through independently re-enforces the same gate via
 * `getAuthorisedClient(['admin', 'editor'])` + `authFailureResponse(auth)`
 * — `canSign` is a UX gate on top of that server-side enforcement, not a
 * substitute for it.
 *
 * §F5 — because the editor is experimental maturity, a field-data
 * initialisation failure (e.g. malformed placement geometry) shows a
 * soft error and falls back to the read-only `PDFViewer` for the
 * document, never a blank pane (`ESignatureForkBoundary` below).
 *
 * Deliberate fork-budget cuts (kept in scope, out of scope noted): the
 * vendored shell's local-download affordance (`downloadSignedPdf` /
 * anchor-click) is DROPPED — persistence (b) is the stated deliverable,
 * and offering both would exceed "budget the fork explicitly, not a
 * drop-in". Drag-and-drop / manual field *placement* UI is NOT added —
 * TECH §5(a) reads as "placement comes from our data", not "the user
 * places fields freehand"; PRODUCT §F3's "place ... signature fields"
 * describes the field-appears-and-gets-signed action as a whole, driven
 * by data in this v1.
 */

// ---------------------------------------------------------------------------
// Field placement + signed-state types
// ---------------------------------------------------------------------------

export interface SignatureFieldBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Signature-field placement, driven from OUR data (§F3(a)). `imageDataUrl`
 * is optional — a field may already carry a captured signature (e.g. from
 * an earlier session, reloaded from data), or arrive unsigned and be
 * signed in this session via the dialog.
 */
export interface SignatureFieldPlacement {
  id: string;
  label: string;
  /** 1-indexed PDF page number. */
  page: number;
  bbox: SignatureFieldBoundingBox;
  imageDataUrl?: string;
}

interface SignatureFieldState extends SignatureFieldPlacement {
  imageDataUrl?: string;
}

/** Layout space the field bounding boxes are captured in (matches the vendored shell). */
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const DEFAULT_ZOOM = 1;
const SIGNATURE_PAD_PADDING = 8;
const SIGNATURE_PAD_BACKGROUND_COLOR = '#ffffff';
const SIGNATURE_PAD_PEN_COLOR = '#000000';
const DEFAULT_SIGNATURE_ASPECT_RATIO = 3;
const DEFAULT_SIGNED_PDF_FILENAME = 'signed-document.pdf';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validates one field's placement data. Called during render (not an
 * effect) so a malformed field throws synchronously and is caught by
 * `ESignatureForkBoundary` — the §F5 "fails to initialise" trigger.
 */
function assertValidField(field: SignatureFieldPlacement): void {
  if (!field.id || !field.label) {
    throw new Error(
      'E-Signature fork: a signature field is missing an id/label.',
    );
  }
  if (!Number.isInteger(field.page) || field.page < 1) {
    throw new Error(
      `E-Signature fork: field "${field.id}" has an invalid page number.`,
    );
  }
  const { bbox } = field;
  if (
    !bbox ||
    !isFiniteNumber(bbox.x) ||
    !isFiniteNumber(bbox.y) ||
    !isFiniteNumber(bbox.width) ||
    !isFiniteNumber(bbox.height) ||
    bbox.width <= 0 ||
    bbox.height <= 0
  ) {
    throw new Error(
      `E-Signature fork: field "${field.id}" has an invalid bounding box.`,
    );
  }
}

function bboxToStyle(bbox: SignatureFieldBoundingBox): React.CSSProperties {
  return {
    left: `${(bbox.x / PAGE_WIDTH) * 100}%`,
    top: `${(bbox.y / PAGE_HEIGHT) * 100}%`,
    width: `${(bbox.width / PAGE_WIDTH) * 100}%`,
    height: `${(bbox.height / PAGE_HEIGHT) * 100}%`,
  };
}

function getSignatureAspectRatio(bbox?: SignatureFieldBoundingBox): number {
  if (!bbox || bbox.width <= 0 || bbox.height <= 0) {
    return DEFAULT_SIGNATURE_ASPECT_RATIO;
  }

  return bbox.width / bbox.height;
}

function getSignatureGuideSize({
  containerWidth,
  containerHeight,
  aspectRatio,
}: {
  containerWidth: number;
  containerHeight: number;
  aspectRatio: number;
}): { width: number; height: number } {
  const maxWidth = Math.max(containerWidth - SIGNATURE_PAD_PADDING * 2, 1);
  const maxHeight = Math.max(containerHeight - SIGNATURE_PAD_PADDING * 2, 1);

  if (maxWidth / maxHeight > aspectRatio) {
    const height = maxHeight;
    return {
      width: height * aspectRatio,
      height,
    };
  }

  const width = maxWidth;
  return {
    width,
    height: width / aspectRatio,
  };
}

function getSignatureDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

// ---------------------------------------------------------------------------
// Sign dialog — draws one field's signature (forked verbatim from the
// vendored shell's per-field dialog, generalised to any field's bbox)
// ---------------------------------------------------------------------------

function SignatureDialog({
  open,
  fieldBbox,
  initialValue,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  fieldBbox: SignatureFieldBoundingBox;
  initialValue?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (value: string) => void;
}) {
  const canvasContainerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const signaturePadRef = React.useRef<SignaturePad | null>(null);
  const [isReady, setIsReady] = React.useState(false);
  const [hasSignature, setHasSignature] = React.useState(false);
  const [guideSize, setGuideSize] = React.useState<{
    width: number;
    height: number;
  } | null>(null);
  const signatureAspectRatio = React.useMemo(
    () => getSignatureAspectRatio(fieldBbox),
    [fieldBbox],
  );

  React.useEffect(() => {
    if (!open) {
      setGuideSize(null);
      return;
    }

    let frameId = 0;
    let resizeObserver: ResizeObserver | null = null;

    const updateGuideSize = (container?: HTMLDivElement | null) => {
      const currentContainer = container ?? canvasContainerRef.current;
      if (
        !currentContainer ||
        currentContainer.clientWidth <= 0 ||
        currentContainer.clientHeight <= 0
      ) {
        return false;
      }

      const nextSize = getSignatureGuideSize({
        containerWidth: currentContainer.clientWidth,
        containerHeight: currentContainer.clientHeight,
        aspectRatio: signatureAspectRatio,
      });

      setGuideSize((previousSize) => {
        if (
          previousSize &&
          Math.abs(previousSize.width - nextSize.width) < 0.5 &&
          Math.abs(previousSize.height - nextSize.height) < 0.5
        ) {
          return previousSize;
        }

        return nextSize;
      });

      return true;
    };

    const connect = () => {
      const container = canvasContainerRef.current;
      if (!updateGuideSize(container)) {
        frameId = window.requestAnimationFrame(connect);
        return;
      }

      if (container) {
        resizeObserver = new ResizeObserver(() => {
          updateGuideSize(container);
        });
        resizeObserver.observe(container);
      }
    };

    connect();

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
    };
  }, [open, signatureAspectRatio]);

  React.useEffect(() => {
    if (!open || !guideSize || guideSize.width <= 1 || guideSize.height <= 1) {
      signaturePadRef.current?.off();
      signaturePadRef.current = null;
      setIsReady(false);
      if (!open) {
        setHasSignature(false);
      }
      return;
    }

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    const syncCanvasSize = (canvas: HTMLCanvasElement) => {
      const width = Math.max(canvas.offsetWidth, 1);
      const height = Math.max(canvas.offsetHeight, 1);
      const ratio = Math.max(window.devicePixelRatio || 1, 1);

      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      const context = canvas.getContext('2d');
      context?.setTransform(1, 0, 0, 1, 0, 0);
      context?.scale(ratio, ratio);

      return { width, height, ratio };
    };

    const initialize = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const { default: SignaturePadConstructor } =
        await import('signature_pad');
      if (cancelled) return;

      const signaturePad = new SignaturePadConstructor(canvas, {
        minWidth: 1,
        maxWidth: 2,
        penColor: SIGNATURE_PAD_PEN_COLOR,
      });

      signaturePadRef.current = signaturePad;

      const loadSignature = async (dataUrl?: string) => {
        const size = syncCanvasSize(canvas);

        if (dataUrl) {
          await signaturePad.fromDataURL(dataUrl, size);
          setHasSignature(true);
          return;
        }

        signaturePad.clear();
        setHasSignature(false);
      };

      await loadSignature(initialValue);
      if (cancelled) return;

      signaturePad.addEventListener('endStroke', () => {
        setHasSignature(true);
      });

      resizeObserver = new ResizeObserver(() => {
        const currentCanvas = canvasRef.current;
        const currentSignaturePad = signaturePadRef.current;
        if (!currentCanvas || !currentSignaturePad) return;

        const previousSignature = currentSignaturePad.isEmpty()
          ? undefined
          : currentSignaturePad.toDataURL('image/png');
        void loadSignature(previousSignature);
      });
      resizeObserver.observe(canvas);
      setIsReady(true);
    };

    const animationFrame = window.requestAnimationFrame(() => {
      void initialize();
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      signaturePadRef.current?.off();
      signaturePadRef.current = null;
      setIsReady(false);
    };
  }, [open, guideSize, initialValue]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add signature</DialogTitle>
          <DialogDescription>
            Draw a signature to place it into the selected PDF field.
          </DialogDescription>
        </DialogHeader>
        <div>
          <div className="rounded-xl border bg-white p-3 text-slate-950 shadow-xs dark:bg-white dark:text-slate-950">
            <div
              ref={canvasContainerRef}
              className="flex h-56 w-full items-center justify-center overflow-hidden rounded-lg bg-white p-2 dark:bg-white"
            >
              <div
                className={cn(
                  'relative overflow-hidden rounded-[3px] border border-dashed border-blue-500/70 bg-white',
                  isReady ? 'cursor-crosshair' : 'cursor-wait',
                )}
                style={{
                  width: guideSize ? `${guideSize.width}px` : undefined,
                  height: guideSize ? `${guideSize.height}px` : undefined,
                  opacity: guideSize ? 1 : 0,
                  backgroundColor: SIGNATURE_PAD_BACKGROUND_COLOR,
                }}
              >
                <canvas
                  ref={canvasRef}
                  className={cn(
                    'absolute inset-0 size-full touch-none',
                    !isReady && 'pointer-events-none',
                  )}
                  style={{
                    backgroundColor: SIGNATURE_PAD_BACKGROUND_COLOR,
                    touchAction: 'none',
                  }}
                />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={!isReady}
            onClick={() => {
              signaturePadRef.current?.clear();
              setHasSignature(false);
            }}
          >
            Clear
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!isReady || !hasSignature}
              onClick={() => {
                const canvas = canvasRef.current;
                if (!canvas) return;

                onConfirm(getSignatureDataUrl(canvas));
                onOpenChange(false);
              }}
            >
              Confirm
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Field overlay (on the PDF page) + side panel
// ---------------------------------------------------------------------------

function SignatureFieldOverlay({
  field,
  canSign,
  onOpen,
}: {
  field: SignatureFieldState;
  canSign: boolean;
  onOpen: () => void;
}) {
  if (!canSign) {
    return (
      <div
        className={cn(
          'absolute z-20 overflow-hidden rounded-[3px] border',
          field.imageDataUrl
            ? 'border-transparent'
            : 'border-dashed border-muted-foreground/50 bg-muted/30',
        )}
        style={bboxToStyle(field.bbox)}
      >
        {field.imageDataUrl ? (
          <img
            src={field.imageDataUrl}
            alt=""
            className="size-full object-fill"
            draggable={false}
          />
        ) : (
          <span className="flex size-full items-center justify-center px-2 text-center text-[11px] font-medium text-muted-foreground">
            {field.label}
          </span>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label={`${field.imageDataUrl ? 'Edit' : 'Sign'} ${field.label}`}
      className={cn(
        'absolute z-20 overflow-hidden rounded-[3px] border border-blue-500/70 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        field.imageDataUrl
          ? 'bg-transparent shadow-none hover:bg-blue-500/5'
          : 'bg-blue-500/10 hover:bg-blue-500/15',
      )}
      style={bboxToStyle(field.bbox)}
      onClick={onOpen}
    >
      {field.imageDataUrl ? (
        <img
          src={field.imageDataUrl}
          alt=""
          className="size-full object-fill"
          draggable={false}
        />
      ) : (
        <span className="flex size-full items-center justify-center gap-1.5 px-2 text-[11px] font-medium text-blue-700 dark:text-blue-300">
          <HugeiconsIcon icon={Pen01Icon} className="size-3.5" />
          {field.label}
        </span>
      )}
    </button>
  );
}

function SignatureFieldsPanel({
  fields,
  canSign,
  canSave,
  isSaving,
  saveError,
  onSignField,
  onClearField,
  onSave,
}: {
  fields: SignatureFieldState[];
  canSign: boolean;
  canSave: boolean;
  isSaving: boolean;
  saveError: string | null;
  onSignField: (fieldId: string) => void;
  onClearField: (fieldId: string) => void;
  onSave: () => void;
}) {
  return (
    <aside
      data-testid="signature-fields-panel"
      className="flex min-h-0 flex-col bg-background"
    >
      <ScrollArea className="min-h-0 flex-1" scrollFade>
        <div className="space-y-4 p-4">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Signature fields</h3>
            <p className="text-xs text-muted-foreground">
              {canSign
                ? 'Review fields, collect signatures, and save the signed document.'
                : 'Read-only — signing is restricted to admin and editor roles.'}
            </p>
          </div>

          {fields.length === 0 ? (
            <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              No signature fields are configured for this document.
            </p>
          ) : (
            fields.map((field) => (
              <div
                key={field.id}
                className="rounded-lg border bg-background p-3"
              >
                <div className="flex items-start gap-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-300">
                    <HugeiconsIcon icon={FilePenIcon} className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">{field.label}</div>
                      <div
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs',
                          field.imageDataUrl
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {field.imageDataUrl ? 'Signed' : 'Unsigned'}
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      page {field.page}
                    </div>
                    {canSign ? (
                      <div className="mt-3 flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={field.imageDataUrl ? 'outline' : 'default'}
                          className="flex-1"
                          onClick={() => onSignField(field.id)}
                        >
                          <HugeiconsIcon icon={Pen01Icon} className="size-4" />
                          {field.imageDataUrl ? 'Edit' : 'Sign'}
                        </Button>
                        {field.imageDataUrl ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => onClearField(field.id)}
                          >
                            Clear
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}

          {canSign ? (
            <>
              {saveError ? (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  {saveError}
                </div>
              ) : null}
              <Button
                type="button"
                className="w-full"
                disabled={!canSave || isSaving}
                onClick={onSave}
              >
                {isSaving ? 'Saving...' : 'Save signed document'}
              </Button>
            </>
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Interactive fork body
// ---------------------------------------------------------------------------

export interface ESignatureForkProps {
  /**
   * `form_instances.id` — the persistence target for a signed PDF
   * (form-scoped, `role='form_source'`).
   */
  formId: string;
  /** Source PDF to render + sign. */
  file?: string;
  /** Signature-field placement, driven from OUR data (§F3(a)). */
  fields: SignatureFieldPlacement[];
  /** admin/editor === true (§F4 place/complete gate); reviewer/viewer === false. */
  canSign: boolean;
  /** Fired after a signed PDF is successfully persisted as a `form_attachments` row. */
  onSigned?: (result: PersistSignedDocumentResult) => void;
  /** Fired if persistence fails; the component also surfaces its own inline error. */
  onPersistError?: (error: Error) => void;
}

function ESignatureForkInner({
  formId,
  file,
  fields,
  canSign,
  onSigned,
  onPersistError,
}: ESignatureForkProps) {
  // Throws synchronously on malformed placement data -- caught by
  // ESignatureForkBoundary (§F5).
  fields.forEach(assertValidField);

  const [signatures, setSignatures] = React.useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        fields
          .filter((field) => field.imageDataUrl)
          .map((field) => [field.id, field.imageDataUrl as string]),
      ),
  );
  const [openFieldId, setOpenFieldId] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const { mutateAsync: persist, isPending: isSaving } =
    usePersistSignedDocument();

  const fieldStates: SignatureFieldState[] = React.useMemo(
    () =>
      fields.map((field) => ({
        ...field,
        imageDataUrl: signatures[field.id],
      })),
    [fields, signatures],
  );

  const openField = fieldStates.find((f) => f.id === openFieldId) ?? null;
  const canSave =
    canSign && Boolean(file) && fieldStates.some((f) => f.imageDataUrl);

  const handleSave = React.useCallback(async () => {
    if (!file) return;

    setSaveError(null);
    const signedFields = fieldStates
      .filter((f) => f.imageDataUrl)
      .map((f) => ({
        page: f.page,
        bbox: f.bbox,
        imageDataUrl: f.imageDataUrl as string,
      }));

    try {
      const pdfBytes = await buildSignedPdfBytes({
        file,
        fields: signedFields,
      });
      const result = await persist({
        formId,
        pdfBytes,
        filename: DEFAULT_SIGNED_PDF_FILENAME,
      });
      onSigned?.(result);
    } catch (err) {
      const error =
        err instanceof Error
          ? err
          : new Error('Failed to save the signed document.');
      setSaveError(error.message);
      onPersistError?.(error);
    }
  }, [file, fieldStates, persist, formId, onSigned, onPersistError]);

  return (
    <>
      <PdfBlockResizableShell
        autoSaveId="pdf-block-e-signature-fork"
        left={
          <PDFViewer
            src={file}
            defaultZoom={DEFAULT_ZOOM}
            renderPageOverlay={({ pageNumber }) => (
              <>
                {fieldStates
                  .filter((f) => f.page === pageNumber)
                  .map((f) => (
                    <SignatureFieldOverlay
                      key={f.id}
                      field={f}
                      canSign={canSign}
                      onOpen={() => setOpenFieldId(f.id)}
                    />
                  ))}
              </>
            )}
          />
        }
        right={
          <SignatureFieldsPanel
            fields={fieldStates}
            canSign={canSign}
            canSave={canSave}
            isSaving={isSaving}
            saveError={saveError}
            onSignField={(fieldId) => setOpenFieldId(fieldId)}
            onClearField={(fieldId) =>
              setSignatures((previous) => {
                const next = { ...previous };
                delete next[fieldId];
                return next;
              })
            }
            onSave={() => void handleSave()}
          />
        }
      />
      {openField ? (
        <SignatureDialog
          open
          fieldBbox={openField.bbox}
          initialValue={openField.imageDataUrl}
          onOpenChange={(open) => {
            if (!open) setOpenFieldId(null);
          }}
          onConfirm={(value) => {
            setSignatures((previous) => ({
              ...previous,
              [openField.id]: value,
            }));
          }}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// §F5 soft-error boundary — falls back to the read-only viewer, never blank
// ---------------------------------------------------------------------------

interface ESignatureForkBoundaryState {
  hasError: boolean;
}

class ESignatureForkBoundary extends React.Component<
  { file?: string; children: React.ReactNode },
  ESignatureForkBoundaryState
> {
  constructor(props: { file?: string; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ESignatureForkBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      'E-Signature fork failed to initialise -- falling back to the read-only viewer:',
      error,
      info.componentStack,
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-0 flex-col gap-2">
          <div
            role="alert"
            className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            <span>
              The signature editor could not load. Showing the document
              read-only.
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <PDFViewer src={this.props.file} defaultZoom={DEFAULT_ZOOM} />
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Forked E-Signature block — see the module-level doc comment for the
 * full §F3/§F4/§F5 rationale. Renders `ESignatureForkInner` inside a
 * soft-error boundary that falls back to the read-only `PDFViewer` (never
 * blank) if initialisation fails.
 */
export function ESignatureFork(props: ESignatureForkProps) {
  return (
    <ESignatureForkBoundary file={props.file}>
      <ESignatureForkInner {...props} />
    </ESignatureForkBoundary>
  );
}

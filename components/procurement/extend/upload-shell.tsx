'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatFileSize } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { FileUpload } from '@/components/procurement/extend/file-upload';

/**
 * Upload shell state contract (ID-147.18, PRODUCT.md §E1/§E3/§E4).
 *
 * The STATE layer over the ID-147.6 vendored `FileUpload` affordance:
 * client-side type/size/count/duplicate validation inline before
 * submission (§E1), progress + success states, and an honest rejection
 * message sourced verbatim from the backend's actual response (§E4).
 *
 * `onFilesAccepted` binds, unchanged, to the existing hardened BI-9
 * `POST /api/procurement/upload` item-creation path (ID-145 BI-9, DR-014) —
 * uploading a form document still creates the form-first item (§E3); the
 * backend itself (magic-byte sniff, 50 MB cap, rate-limit) is untouched
 * (§E2, owned elsewhere). No new upload backend is introduced here.
 */

const PDF_MIME = 'application/pdf';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const LEGACY_DOC_MIME = 'application/msword';
const LEGACY_XLS_MIME = 'application/vnd.ms-excel';

/**
 * Mirrors `ALLOWED_MIME_TYPES` in `app/api/procurement/upload/route.ts` (the
 * hardened BI-9 backend this shell binds to) — client-side rejection here
 * pre-empts a round trip the server would reject anyway. The server stays
 * the source of truth for anything this list can't pre-detect (encrypted
 * documents, magic-byte mismatches, rate limiting) — §E4 surfaces those via
 * the backend's own response.
 */
const DEFAULT_ACCEPTED_MIME_TYPES = [
  PDF_MIME,
  DOCX_MIME,
  XLSX_MIME,
  LEGACY_DOC_MIME,
  LEGACY_XLS_MIME,
];
const DEFAULT_ACCEPTED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx'];
const DEFAULT_ACCEPT = [
  ...DEFAULT_ACCEPTED_MIME_TYPES,
  ...DEFAULT_ACCEPTED_EXTENSIONS,
].join(',');
/** 50 MB — matches `MAX_FILE_SIZE` in `app/api/procurement/upload/route.ts`. */
const DEFAULT_MAX_SIZE_BYTES = 52_428_800;
const DEFAULT_UPLOAD_ENDPOINT = '/api/procurement/upload';
const GENERIC_NETWORK_ERROR_MESSAGE =
  "Couldn't upload the file. Check your connection and try again.";

type UploadPhase = 'idle' | 'uploading' | 'success' | 'error';

/** Shape returned by `POST /api/procurement/upload` on success (loosely typed —
 * this shell only reads display fields, the backend owns the real contract). */
export interface UploadedForm {
  id?: string;
  name?: string;
  filename?: string;
  [key: string]: unknown;
}

export interface UploadShellProps {
  /** Maximum files accepted in a single selection/drop. Defaults to 1 — one upload creates one form-first item (§E3). */
  maxFiles?: number;
  /** Maximum size per file, in bytes. Defaults to 50 MB (matches the backend cap). */
  maxSizeBytes?: number;
  acceptedMimeTypes?: string[];
  acceptedExtensions?: string[];
  /** The hardened BI-9 endpoint `onFilesAccepted` binds to. */
  uploadEndpoint?: string;
  /** Called with the created form-first item on a successful upload (§E3). */
  onUploaded?: (form: UploadedForm) => void;
  className?: string;
}

function hasAcceptedType(
  file: File,
  mimeTypes: readonly string[],
  extensions: readonly string[],
): boolean {
  if (mimeTypes.includes(file.type)) return true;
  const lower = file.name.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

interface BatchValidation {
  ok: boolean;
  message?: string;
}

/** §E1 — type / size / count / duplicate, in that order, one message at a time. */
function validateBatch(
  files: File[],
  options: {
    maxFiles: number;
    maxSizeBytes: number;
    acceptedMimeTypes: readonly string[];
    acceptedExtensions: readonly string[];
  },
): BatchValidation {
  const { maxFiles, maxSizeBytes, acceptedMimeTypes, acceptedExtensions } =
    options;

  const badType = files.find(
    (file) => !hasAcceptedType(file, acceptedMimeTypes, acceptedExtensions),
  );
  if (badType) {
    return {
      ok: false,
      message: `"${badType.name}" isn't a supported file type. Accepted: PDF, Word (.doc/.docx), Excel (.xls/.xlsx).`,
    };
  }

  const tooLarge = files.find((file) => file.size > maxSizeBytes);
  if (tooLarge) {
    return {
      ok: false,
      message: `"${tooLarge.name}" is too large (${formatFileSize(tooLarge.size)}). Maximum is ${formatFileSize(maxSizeBytes)}.`,
    };
  }

  if (files.length > maxFiles) {
    return {
      ok: false,
      message: `You can upload up to ${maxFiles} file${maxFiles === 1 ? '' : 's'} at a time.`,
    };
  }

  const seen = new Set<string>();
  for (const file of files) {
    const key = `${file.name}-${file.size}`;
    if (seen.has(key)) {
      return { ok: false, message: `"${file.name}" was already selected.` };
    }
    seen.add(key);
  }

  return { ok: true };
}

function InlineRejection({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

export function UploadShell({
  maxFiles = 1,
  maxSizeBytes = DEFAULT_MAX_SIZE_BYTES,
  acceptedMimeTypes = DEFAULT_ACCEPTED_MIME_TYPES,
  acceptedExtensions = DEFAULT_ACCEPTED_EXTENSIONS,
  uploadEndpoint = DEFAULT_UPLOAD_ENDPOINT,
  onUploaded,
  className,
}: UploadShellProps) {
  const [phase, setPhase] = React.useState<UploadPhase>('idle');
  const [validationMessage, setValidationMessage] = React.useState<
    string | null
  >(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [activeFileName, setActiveFileName] = React.useState<string | null>(
    null,
  );
  const [uploadedForm, setUploadedForm] = React.useState<UploadedForm | null>(
    null,
  );

  const uploadFile = React.useCallback(
    async (file: File) => {
      setPhase('uploading');
      setActiveFileName(file.name);
      setErrorMessage(null);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(uploadEndpoint, {
          method: 'POST',
          body: formData,
        });
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          setErrorMessage(
            (data as { error?: string } | null)?.error ??
              GENERIC_NETWORK_ERROR_MESSAGE,
          );
          setPhase('error');
          return;
        }

        const form = data as UploadedForm;
        setUploadedForm(form);
        setPhase('success');
        onUploaded?.(form);
      } catch {
        setErrorMessage(GENERIC_NETWORK_ERROR_MESSAGE);
        setPhase('error');
      }
    },
    [uploadEndpoint, onUploaded],
  );

  const handleFilesAccepted = React.useCallback(
    (files: File[]) => {
      const validation = validateBatch(files, {
        maxFiles,
        maxSizeBytes,
        acceptedMimeTypes,
        acceptedExtensions,
      });

      if (!validation.ok) {
        setValidationMessage(validation.message ?? null);
        return;
      }

      setValidationMessage(null);
      const [file] = files;
      if (file) void uploadFile(file);
    },
    [maxFiles, maxSizeBytes, acceptedMimeTypes, acceptedExtensions, uploadFile],
  );

  const reset = React.useCallback(() => {
    setPhase('idle');
    setValidationMessage(null);
    setErrorMessage(null);
    setActiveFileName(null);
    setUploadedForm(null);
  }, []);

  if (phase === 'uploading') {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-lg border bg-background px-6 py-10 text-center',
          className,
        )}
      >
        <Loader2
          className="size-6 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-sm font-medium">
          Uploading{activeFileName ? `: ${activeFileName}` : ''}…
        </p>
        <Progress
          className="w-48"
          value={undefined}
          aria-label="Upload in progress"
        />
      </div>
    );
  }

  if (phase === 'success' && uploadedForm) {
    return (
      <div
        role="status"
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-lg border bg-background px-6 py-10 text-center',
          className,
        )}
      >
        <CheckCircle2 className="size-8 text-success" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">Upload complete</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {uploadedForm.name ?? uploadedForm.filename ?? 'Document'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={reset}>
          Upload another
        </Button>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <FileUpload
        accept={DEFAULT_ACCEPT}
        multiple
        showFileList={false}
        onFilesAccepted={handleFilesAccepted}
      />
      {phase === 'error' && errorMessage ? (
        <InlineRejection message={errorMessage} />
      ) : null}
      {validationMessage ? (
        <InlineRejection message={validationMessage} />
      ) : null}
    </div>
  );
}

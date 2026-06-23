'use client';

import { useCallback, useRef, useState } from 'react';
import { formatFileSize } from '@/lib/format';

/** State exposed to the `className` and `children` render props. */
export interface FileDropzoneState {
  dragging: boolean;
}

interface FileDropzoneProps {
  /** Accepted MIME types — matched against `File.type` (extension fallback below). */
  acceptedMimeTypes: readonly string[];
  /** Accepted extensions (lowercase, leading dot) — fallback when `File.type` is absent or wrong. */
  acceptedExtensions: readonly string[];
  /** Maximum file size in bytes. */
  maxSizeBytes: number;
  /** When true, a zero-byte file is rejected with an "empty" message. */
  rejectEmpty?: boolean;
  /** `accept` attribute for the hidden file input (e.g. ".docx,.pdf"). */
  inputAccept: string;
  /** Accessible label for the dropzone (`role="button"`). */
  ariaLabel: string;
  /** When false, click/keyboard activation and focusability are disabled (e.g. mid-upload). */
  interactive: boolean;
  /** Called with the chosen file once it passes validation. */
  onFile: (file: File) => void;
  /** Called with a human-readable message when validation fails. */
  onValidationError: (message: string) => void;
  /** Resolves the dropzone className from the current drag state. */
  className: (state: FileDropzoneState) => string;
  /** Renders the dropzone contents from the current drag state. */
  children: (state: FileDropzoneState) => React.ReactNode;
}

function hasValidExtension(
  filename: string,
  acceptedExtensions: readonly string[],
): boolean {
  const lower = filename.toLowerCase();
  return acceptedExtensions.some((ext) => lower.endsWith(ext));
}

/**
 * Hand-rolled file dropzone primitive — drag-and-drop, click-to-browse, and
 * keyboard activation over a hidden file input, with MIME + extension + size
 * validation. Renders a `role="button"` element; markup and per-state styling
 * are supplied by the consumer via the `children` / `className` render props.
 *
 * Built on native drag events (not react-dropzone) so the DOM contract stays
 * testable under jsdom `fireEvent.drop`.
 */
export function FileDropzone({
  acceptedMimeTypes,
  acceptedExtensions,
  maxSizeBytes,
  rejectEmpty = false,
  inputAccept,
  ariaLabel,
  interactive,
  onFile,
  onValidationError,
  className,
  children,
}: FileDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const validateFile = useCallback(
    (file: File): string | null => {
      if (
        !acceptedMimeTypes.includes(file.type) &&
        !hasValidExtension(file.name, acceptedExtensions)
      ) {
        return `Invalid file type. Please upload a ${acceptedExtensions.join(' or ')} file. Received: ${file.name}`;
      }
      if (file.size > maxSizeBytes) {
        return `File is too large (${formatFileSize(file.size)}). Maximum size is ${formatFileSize(maxSizeBytes)}.`;
      }
      if (rejectEmpty && file.size === 0) {
        return 'File is empty.';
      }
      return null;
    },
    [acceptedMimeTypes, acceptedExtensions, maxSizeBytes, rejectEmpty],
  );

  const processFile = useCallback(
    (file: File) => {
      const validationError = validateFile(file);
      if (validationError) {
        onValidationError(validationError);
        return;
      }
      onFile(file);
    },
    [validateFile, onFile, onValidationError],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      dragCounterRef.current = 0;

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        processFile(files[0]);
      }
    },
    [processFile],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        processFile(files[0]);
      }
      // Clear so re-selecting the same file fires `change` again.
      e.target.value = '';
    },
    [processFile],
  );

  const handleClick = useCallback(() => {
    if (interactive) {
      fileInputRef.current?.click();
    }
  }, [interactive]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  const state: FileDropzoneState = { dragging };

  return (
    <div
      role="button"
      tabIndex={interactive ? 0 : -1}
      aria-label={ariaLabel}
      data-dragging={dragging}
      className={className(state)}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={inputAccept}
        className="sr-only"
        onChange={handleFileInputChange}
        aria-hidden="true"
        tabIndex={-1}
      />
      {children(state)}
    </div>
  );
}

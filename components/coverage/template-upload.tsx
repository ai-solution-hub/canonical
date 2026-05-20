'use client';

import { useCallback, useRef, useState } from 'react';
import { FileUp, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/lib/format';
import type { Template } from '@/types/template';

interface TemplateUploadProps {
  procurementId: string;
  onUploadComplete: (template: Template) => void;
}

const ALLOWED_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_SIZE_BYTES = 50 * 1024 * 1024;

type UploadPhase = 'idle' | 'uploading' | 'complete' | 'error';

export function TemplateUpload({ procurementId, onUploadComplete }: TemplateUploadProps) {
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedTemplate, setUploadedTemplate] = useState<Template | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const resetState = useCallback(() => {
    setPhase('idle');
    setError(null);
    setTemplateName('');
    setDescription('');
    setSelectedFile(null);
    setUploadedTemplate(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const validateFile = useCallback((file: File): string | null => {
    if (file.type !== ALLOWED_MIME_TYPE && !file.name.toLowerCase().endsWith('.docx')) {
      return 'Invalid file type. Only .docx files are supported for template completion.';
    }
    if (file.size > MAX_SIZE_BYTES) {
      return `File is too large (${formatFileSize(file.size)}). Maximum size is 50 MB.`;
    }
    if (file.size === 0) {
      return 'File is empty.';
    }
    return null;
  }, []);

  const handleFileSelected = useCallback(
    (file: File) => {
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        setPhase('error');
        toast.error(validationError);
        return;
      }
      setSelectedFile(file);
      if (!templateName) {
        setTemplateName(file.name.replace(/\.docx$/i, ''));
      }
      setError(null);
    },
    [validateFile, templateName],
  );

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;

    setPhase('uploading');
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('name', templateName || selectedFile.name.replace(/\.docx$/i, ''));
      if (description.trim()) {
        formData.append('description', description.trim());
      }

      const res = await fetch(`/api/procurement/${procurementId}/templates`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Upload failed (${res.status})`);
      }

      const template: Template = await res.json();
      setUploadedTemplate(template);
      setPhase('complete');
      toast.success(`Template "${template.name}" uploaded successfully`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      setPhase('error');
      toast.error(message);
    }
  }, [procurementId, selectedFile, templateName, description]);

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
    if (dragCounterRef.current === 0) setDragging(false);
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
      if (files.length > 0) handleFileSelected(files[0]);
    },
    [handleFileSelected],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) handleFileSelected(files[0]);
    },
    [handleFileSelected],
  );

  const handleClick = useCallback(() => {
    if (phase === 'idle' || phase === 'error') fileInputRef.current?.click();
  }, [phase]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={phase === 'idle' || phase === 'error' ? 0 : -1}
        aria-label="Upload template document. Drag and drop or click to browse."
        className={cn(
          'relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors',
          phase === 'idle' && !dragging && !selectedFile && 'border-muted-foreground/25 hover:border-muted-foreground/50 cursor-pointer',
          phase === 'error' && 'border-destructive/50 hover:border-destructive cursor-pointer',
          dragging && 'border-primary bg-primary/5',
          phase === 'uploading' && 'border-primary/50 cursor-default',
          phase === 'complete' && 'border-template-confirmed/50 cursor-default',
          selectedFile && phase === 'idle' && 'border-primary/30',
        )}
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
          accept=".docx"
          className="sr-only"
          onChange={handleFileInputChange}
          aria-hidden="true"
          tabIndex={-1}
        />

        {/* Idle state — no file selected */}
        {phase === 'idle' && !selectedFile && (
          <>
            <FileUp className="size-10 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">Upload Template Document</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Drag and drop your template here, or click to browse.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Accepts: .docx only (max 50 MB)
              </p>
            </div>
          </>
        )}

        {/* Idle state — file selected, awaiting name + upload */}
        {phase === 'idle' && selectedFile && (
          <>
            <FileUp className="size-8 text-primary" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">{selectedFile.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatFileSize(selectedFile.size)}
              </p>
            </div>
          </>
        )}

        {/* Uploading state */}
        {phase === 'uploading' && (
          <>
            <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
            <p className="text-sm font-medium">Uploading template...</p>
          </>
        )}

        {/* Complete state */}
        {phase === 'complete' && uploadedTemplate && (
          <>
            <CheckCircle className="size-8 text-template-confirmed" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">Template uploaded</p>
              <p className="mt-1 text-xs text-muted-foreground">{uploadedTemplate.name}</p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onUploadComplete(uploadedTemplate);
                }}
              >
                Analyse Template
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  resetState();
                }}
              >
                Upload Another
              </Button>
            </div>
          </>
        )}

        {/* Error state */}
        {phase === 'error' && (
          <>
            <AlertTriangle className="size-8 text-muted-foreground/50" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground">Upload didn&apos;t complete</p>
              {error && <p className="mt-1 text-xs text-muted-foreground">{error}</p>}
              <p className="mt-2 text-xs text-muted-foreground">
                Click to try again, or drag and drop a new file.
              </p>
            </div>
          </>
        )}
      </div>

      {/* Name input — shown when file is selected but not yet uploaded */}
      {selectedFile && phase === 'idle' && (
        <div className="space-y-2">
          <Label htmlFor="template-name">Template Name</Label>
          <Input
            id="template-name"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="Enter template name"
            maxLength={200}
          />
          <Label htmlFor="template-description">Description (optional)</Label>
          <Textarea
            id="template-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of this template"
            maxLength={1000}
            rows={2}
          />
          <div className="flex gap-2">
            <Button onClick={handleUpload} disabled={!templateName.trim()}>
              Upload Template
            </Button>
            <Button variant="outline" onClick={resetState}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

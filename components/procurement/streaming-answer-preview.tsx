'use client';

import { Streamdown } from 'streamdown';
import { sharedStreamdownComponents } from '@/components/shared/streamdown-components';
import { cn } from '@/lib/utils';

export interface StreamingAnswerPreviewProps {
  /** The in-flight streamed answer text — raw markdown, possibly unterminated. */
  text: string;
  /** Whether a draft is actively streaming in. Gates Streamdown's caret (it
   * only shows while both `caret` is set and `isAnimating` is true) and the
   * `aria-busy` state — NOT a colour signal, so no WCAG non-colour concern. */
  isStreaming: boolean;
  className?: string;
}

/**
 * ID-145 {145.19} §I4 — the streamed-answer surface for the SSE draft-stream
 * (`useDraftStream`/`responses/draft-stream`). DR-040 "new surface" case: no
 * migration is implied here — this preview never existed before. The raw
 * streaming text used to be piped straight into the Tiptap response editor
 * mid-token (a throttled `editor.commands.setContent` on every ~60ms tick),
 * which risks a broken partial parse of in-flight markdown (an open
 * `**bold`, an unclosed link, a half-typed heading) — Streamdown is BUILT
 * for exactly this: `parseIncompleteMarkdown` (on by default) heals
 * unterminated constructs at the tail of the string, and `caret`+
 * `isAnimating` renders a trailing streaming cursor while text is still
 * arriving. The response editor now receives only the FINAL, complete text
 * once the stream ends (unchanged flush in `useStreamCoordination`), so the
 * two surfaces never show the same content at the same time.
 *
 * The shared `code`/`strong` a11y/test-hostile-default overrides (ID-161)
 * apply here too — same fix as the other two Streamdown render sites
 * (`content-renderer.tsx`, `file-render-pane.tsx`). No `a` override is
 * needed: a streaming draft-in-progress has no internal-link resolution
 * concern of its own.
 */
export function StreamingAnswerPreview({
  text,
  isStreaming,
  className,
}: StreamingAnswerPreviewProps) {
  return (
    <div
      data-testid="streaming-answer-preview"
      aria-label="Response being drafted"
      aria-busy={isStreaming}
      className={cn(
        'prose prose-sm max-w-none rounded-md border bg-card px-4 py-3',
        className,
      )}
    >
      <Streamdown
        caret="block"
        isAnimating={isStreaming}
        components={sharedStreamdownComponents}
      >
        {text}
      </Streamdown>
    </div>
  );
}

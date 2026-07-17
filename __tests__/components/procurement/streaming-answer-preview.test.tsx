/**
 * StreamingAnswerPreview — ID-145 {145.19} §I4 (BI-41-adjacent): the
 * streamed-answer surface for the SSE draft-stream renders natively through
 * Streamdown, the DR-040 "new surface" case (no migration — this surface
 * never existed before; the raw stream text used to be piped straight into
 * the Tiptap response editor mid-token instead).
 *
 * Behaviour under test:
 *  - the live text renders through Streamdown (not raw/escaped text);
 *  - a streaming caret shows while a draft is actively streaming in, and
 *    disappears once streaming stops (Streamdown's own `caret`/`isAnimating`
 *    contract — verified via the CSS custom property it emits);
 *  - unterminated/partial markdown (an unclosed `**bold`) renders cleanly,
 *    not as literal asterisks;
 *  - the shared ID-161 a11y overrides apply here too (semantic `<strong>`,
 *    no Shiki-lazy-load act() leak on a fenced code block).
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

import { StreamingAnswerPreview } from '@/components/procurement/streaming-answer-preview';

describe('StreamingAnswerPreview', () => {
  it('renders the live streamed text', () => {
    render(
      <StreamingAnswerPreview
        text="Our approach to this contract"
        isStreaming
      />,
    );
    expect(
      screen.getByText('Our approach to this contract'),
    ).toBeInTheDocument();
  });

  it('renders unterminated bold markdown cleanly, not as literal asterisks', () => {
    render(<StreamingAnswerPreview text="Our **key strength" isStreaming />);
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
    const strong = screen.getByText('key strength');
    // ID-161 shared override — semantic <strong>, not a data-streamdown span.
    expect(strong.tagName).toBe('STRONG');
  });

  it('shows a streaming caret while actively streaming', () => {
    const { container } = render(
      <StreamingAnswerPreview text="Drafting" isStreaming />,
    );
    const caretHost = container.querySelector('[style*="--streamdown-caret"]');
    expect(caretHost).not.toBeNull();
  });

  it('shows no streaming caret once streaming has stopped', () => {
    const { container } = render(
      <StreamingAnswerPreview text="Final answer" isStreaming={false} />,
    );
    expect(container.querySelector('[style*="--streamdown-caret"]')).toBeNull();
  });

  it('never renders a Shiki-lazy-load code block, matching the shared ID-161 override', () => {
    render(
      <StreamingAnswerPreview text={'```ts\nconst x = 1;\n```'} isStreaming />,
    );
    expect(document.querySelector('[data-streamdown="strong"]')).toBeNull();
  });
});

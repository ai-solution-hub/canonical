/**
 * `sharedStreamdownComponents` (ID-161) — direct behavioural tests for the
 * `code`/`strong` override pair extracted from
 * `components/item-detail/content-renderer.tsx` (commit aad8cc65) into
 * `components/shared/streamdown-components.tsx`. Renders markdown straight
 * through Streamdown with ONLY the shared pair applied (no site-specific `a`
 * or heading overrides) to prove the shared module alone fixes both
 * Streamdown-default defects, independent of either consuming render site:
 *
 *  - default `code` lazy-loads a Shiki highlighter chunk whose resolution
 *    lands outside React's `act()` — a leaked-act warning this repo's
 *    strict `__tests__/setup.ts` turns into a hard failure.
 *  - default `strong` renders `**bold**` as
 *    `<span data-streamdown="strong">`, not a semantic `<strong>` — a WCAG
 *    2.1 AA gap (screen-reader emphasis lost).
 */
import { describe, it, expect } from 'vitest';
import { act } from 'react';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { Streamdown } from 'streamdown';
import { sharedStreamdownComponents } from '@/components/shared/streamdown-components';

/** Streamdown lazy-loads its Shiki code-block highlighter; a pending resolve
 * that lands after a synchronous test body returns leaks a React "not
 * wrapped in act" warning into a LATER test (`setup.ts` throws on it). Flush
 * one tick inside `act()` before extracting/asserting whenever a rendered
 * corpus contains a fenced code block — mirrors
 * `__tests__/components/content-renderer.test.tsx`. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('sharedStreamdownComponents', () => {
  it('renders bold text as a semantic <strong>, not a data-streamdown span', () => {
    render(
      <Streamdown components={sharedStreamdownComponents}>
        {'Some **bold** text.'}
      </Streamdown>,
    );
    const bold = screen.getByText('bold');
    expect(bold.tagName).toBe('STRONG');
    expect(
      document.querySelector('[data-streamdown="strong"]'),
    ).not.toBeInTheDocument();
  });

  it('renders fenced code as plain <pre><code> markup with no Shiki highlight leak', async () => {
    const { container } = render(
      <Streamdown components={sharedStreamdownComponents}>
        {'```ts\nconst x = 1;\n```'}
      </Streamdown>,
    );
    await settle();
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.querySelector('[data-streamdown]')).toBeNull();
    expect(pre?.querySelector('span')).toBeNull();
    expect(pre?.textContent).toContain('const x = 1;');
  });

  it('renders inline code as a plain <code> element, not wrapped in <pre>', () => {
    render(
      <Streamdown components={sharedStreamdownComponents}>
        {'Some `inline code` here.'}
      </Streamdown>,
    );
    const code = screen.getByText('inline code');
    expect(code.tagName).toBe('CODE');
    expect(code.closest('pre')).toBeNull();
  });
});

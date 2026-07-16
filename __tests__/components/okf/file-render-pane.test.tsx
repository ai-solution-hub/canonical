/**
 * {132.32} G-LANDING-IMPL — `<FileRenderPane>` (LI-5 Streamdown render,
 * LI-6 index.md progressive-disclosure preserved, LI-16 ontology.json
 * render-exclusion, LI-18 graph-viewer link). Pure presenter — receives
 * fetched content via props (mirrors the `ConceptDetail`/`RelatedRecordsRail`
 * pattern: the connected container owns the TanStack Query call).
 */
import { describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import { render, screen } from '@testing-library/react';
import { FileRenderPane } from '@/components/okf/file-render-pane';

/** Streamdown lazy-loads its Shiki code-block highlighter; a pending resolve
 * that lands after a synchronous test body returns leaks a React "not
 * wrapped in act" warning into a LATER test (`__tests__/setup.ts` throws on
 * it). Flush one tick inside `act()` before asserting whenever a rendered
 * corpus contains a fenced code block — mirrors
 * `__tests__/components/content-renderer.test.tsx`. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('FileRenderPane', () => {
  it('shows a friendly empty state when no file is selected (LI-4(c))', () => {
    render(
      <FileRenderPane
        bundleId="first-client"
        path={null}
        content={null}
        isLoading={false}
        isError={false}
        knownMdPaths={new Set()}
        onNavigate={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/select a file from the tree/i),
    ).toBeInTheDocument();
  });

  it('shows a loading state while the file is being fetched', () => {
    render(
      <FileRenderPane
        bundleId="first-client"
        path="index.md"
        content={null}
        isLoading={true}
        isError={false}
        knownMdPaths={new Set()}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByTestId('file-render-pane-loading')).toBeInTheDocument();
  });

  it('shows an error state when the file fails to load', () => {
    render(
      <FileRenderPane
        bundleId="first-client"
        path="index.md"
        content={null}
        isLoading={false}
        isError={true}
        knownMdPaths={new Set()}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
  });

  it('renders the markdown content preserving themes → concepts structure (LI-5/LI-6)', () => {
    render(
      <FileRenderPane
        bundleId="first-client"
        path="index.md"
        content={[
          '## Sales',
          '',
          '* [Orders](tables/orders.md) — One row per order.',
        ].join('\n')}
        isLoading={false}
        isError={false}
        knownMdPaths={new Set(['tables/orders.md'])}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Sales' })).toBeInTheDocument();
    expect(screen.getByText('Orders')).toBeInTheDocument();
  });

  it('resolves an internal .md link to a known tree file as an in-app navigation (LI-5)', () => {
    const onNavigate = vi.fn();
    render(
      <FileRenderPane
        bundleId="first-client"
        path="index.md"
        content="See [Orders](tables/orders.md) for detail."
        isLoading={false}
        isError={false}
        knownMdPaths={new Set(['tables/orders.md'])}
        onNavigate={onNavigate}
      />,
    );
    screen.getByRole('button', { name: 'Orders' }).click();
    expect(onNavigate).toHaveBeenCalledWith('tables/orders.md');
  });

  it('renders an internal link to an unknown concept as a plain external anchor', () => {
    render(
      <FileRenderPane
        bundleId="first-client"
        path="index.md"
        content="See [Missing](tables/missing.md) for detail."
        isLoading={false}
        isError={false}
        knownMdPaths={new Set(['tables/orders.md'])}
        onNavigate={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'Missing' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Missing' })).toBeInTheDocument();
  });

  it('links through to the /okf/[bundleId] graph viewer (LI-18, complement not replace)', () => {
    render(
      <FileRenderPane
        bundleId="first-client"
        path="index.md"
        content="Body."
        isLoading={false}
        isError={false}
        knownMdPaths={new Set()}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByRole('link', { name: /graph view/i })).toHaveAttribute(
      'href',
      '/okf/first-client',
    );
  });

  // ---------------------------------------------------------------------
  // Streamdown a11y/test-hostile-default overrides (ID-161)
  // ---------------------------------------------------------------------
  // `<FileRenderPane>` was the unfixed Streamdown render site — it only
  // ever overrode `a` (for in-app tree navigation). It now also consumes
  // `sharedStreamdownComponents` (merged with its own `a` override, not
  // clobbered by it) for the same `code`/`strong` fix
  // `<ContentRenderer>` already had. See
  // `components/shared/streamdown-components.tsx` for the defects.
  describe('Streamdown a11y/test-hostile-default overrides (ID-161)', () => {
    it('renders bold text as a semantic <strong>, not a data-streamdown span', () => {
      render(
        <FileRenderPane
          bundleId="first-client"
          path="index.md"
          content="Some **bold** text in the file body."
          isLoading={false}
          isError={false}
          knownMdPaths={new Set()}
          onNavigate={vi.fn()}
        />,
      );
      const bold = screen.getByText('bold');
      expect(bold.tagName).toBe('STRONG');
      expect(
        screen.queryByText('bold', { selector: '[data-streamdown="strong"]' }),
      ).not.toBeInTheDocument();
    });

    it('renders fenced code as plain markup with no Shiki highlight leak', async () => {
      const { container } = render(
        <FileRenderPane
          bundleId="first-client"
          path="index.md"
          content={['```ts', 'const x = 1;', '```'].join('\n')}
          isLoading={false}
          isError={false}
          knownMdPaths={new Set()}
          onNavigate={vi.fn()}
        />,
      );
      await settle(); // fenced code block — Shiki lazy-loads if un-overridden
      const pre = container.querySelector('pre');
      expect(pre).not.toBeNull();
      expect(pre?.querySelector('[data-streamdown]')).toBeNull();
      expect(pre?.querySelector('span')).toBeNull();
      expect(pre?.textContent).toContain('const x = 1;');
    });

    it('preserves link role for a genuine external link (not the linkSafety button default)', () => {
      render(
        <FileRenderPane
          bundleId="first-client"
          path="index.md"
          content="See the [official register](https://example.com/register) for the source record."
          isLoading={false}
          isError={false}
          knownMdPaths={new Set()}
          onNavigate={vi.fn()}
        />,
      );
      const link = screen.getByRole('link', { name: 'official register' });
      expect(link.tagName).toBe('A');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });
});

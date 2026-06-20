/**
 * IngestionSuccessCard Component Tests
 *
 * Covers the reference variant (kind: 'reference') added under ID-110 {110.7}:
 * it renders the title, summary, domain/subtopic badges, warnings and a
 * copyable referenceId. Under ID-111.8 the reference-detail page (/reference/
 * <id>) now exists (ID-111.7), discharging OQ-N: the variant renders an
 * additive "View reference" link when referenceId is a non-empty string, while
 * still NOT rendering any content-variant affordances (suggestedLayer Select,
 * contentType badge, /item/<id> link). The link is guarded — an empty
 * referenceId keeps the copyable-id-only behaviour and never links to a bare
 * /reference/ (which would 404).
 *
 * The default content variant is asserted unchanged to protect the second
 * consumer (upload-tab-content.tsx) found via gitnexus_impact.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IngestionSuccessCard } from '@/components/create-content/ingestion-success-card';
import { LayerVocabularyProvider } from '@/contexts/layer-vocabulary-context';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('IngestionSuccessCard — reference variant (ID-110 {110.7})', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderReference(
    overrides: Partial<{
      referenceId: string;
      title: string;
      summary: string;
      domain: string;
      subtopic: string;
      warnings: string[];
    }> = {},
  ) {
    return render(
      <IngestionSuccessCard
        kind="reference"
        referenceId={overrides.referenceId ?? 'ri-1234-abcd'}
        title={overrides.title ?? 'Procurement Reform Act 2023 — Guidance'}
        summary={overrides.summary ?? 'A government guidance note on the Act.'}
        domain={overrides.domain ?? 'Procurement'}
        subtopic={overrides.subtopic ?? 'Legislation'}
        warnings={overrides.warnings}
      />,
    );
  }

  it('renders the title and summary', () => {
    renderReference();
    expect(
      screen.getByText('Procurement Reform Act 2023 — Guidance'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('A government guidance note on the Act.'),
    ).toBeInTheDocument();
  });

  it('renders the domain and subtopic badges', () => {
    renderReference();
    expect(screen.getByText('Procurement')).toBeInTheDocument();
    expect(screen.getByText('Legislation')).toBeInTheDocument();
  });

  it('renders warnings when present', () => {
    renderReference({ warnings: ['Embedding generation failed'] });
    expect(screen.getByText('Embedding generation failed')).toBeInTheDocument();
  });

  it('renders the copyable referenceId and copies it to the clipboard via toast', async () => {
    // Set up userEvent first (it may attach its own clipboard), then override
    // navigator.clipboard with our spy so the component's writeText is observed.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderReference({ referenceId: 'ri-9999-zzzz' });

    // The referenceId value is surfaced to the user.
    expect(screen.getByText('ri-9999-zzzz')).toBeInTheDocument();

    const copyButton = screen.getByRole('button', {
      name: /copy reference id/i,
    });
    await user.click(copyButton);

    expect(writeText).toHaveBeenCalledWith('ri-9999-zzzz');
    expect(toast.success).toHaveBeenCalled();
  });

  it('does NOT render a layer-suggest Select control (OQ-N)', () => {
    renderReference();
    expect(
      screen.queryByRole('combobox', { name: /select a layer/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/suggested layer/i)).not.toBeInTheDocument();
  });

  it('does NOT render a contentType classification badge (OQ-N)', () => {
    // contentType is not a prop of the reference variant; assert no "other"
    // / classification badge leaks through.
    renderReference();
    expect(screen.queryByText('other')).not.toBeInTheDocument();
  });

  it('does NOT render any /item/<id> "view item" link (OQ-N — no reference-detail page)', () => {
    renderReference({ referenceId: 'ri-1234-abcd' });
    const links = screen.queryAllByRole('link');
    for (const link of links) {
      // The only permitted /item link is the "Create another" nav (/item/new);
      // there must be no /item/<detail-id> link (it would 404).
      const href = link.getAttribute('href') ?? '';
      expect(href).not.toMatch(/^\/item\/(?!new$)/);
    }
    expect(
      screen.queryByRole('link', { name: /view item/i }),
    ).not.toBeInTheDocument();
  });

  it('does not require LayerVocabularyProvider to render', () => {
    // Reference variant rendered WITHOUT a provider wrapper above; reaching
    // this assertion proves useLayerVocabulary was not invoked.
    expect(() => renderReference()).not.toThrow();
  });
});

describe('IngestionSuccessCard — reference "View reference" link (ID-111.8 — discharges OQ-N)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderReference(
    overrides: Partial<{
      referenceId: string;
      title: string;
      summary: string;
      domain: string;
      subtopic: string;
      warnings: string[];
    }> = {},
  ) {
    return render(
      <IngestionSuccessCard
        kind="reference"
        referenceId={overrides.referenceId ?? 'ri-1234-abcd'}
        title={overrides.title ?? 'Procurement Reform Act 2023 — Guidance'}
        summary={overrides.summary ?? 'A government guidance note on the Act.'}
        domain={overrides.domain ?? 'Procurement'}
        subtopic={overrides.subtopic ?? 'Legislation'}
        warnings={overrides.warnings}
      />,
    );
  }

  it('renders a "View reference" link to /reference/<id> for a non-empty referenceId', () => {
    renderReference({ referenceId: 'ri-9999-zzzz' });
    const viewLink = screen.getByRole('link', { name: /view reference/i });
    expect(viewLink).toHaveAttribute('href', '/reference/ri-9999-zzzz');
  });

  it('retains the copyable referenceId alongside the View reference link (additive, not a replacement)', () => {
    renderReference({ referenceId: 'ri-9999-zzzz' });
    // Both affordances co-exist: the View reference link AND the copyable id.
    expect(
      screen.getByRole('link', { name: /view reference/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('ri-9999-zzzz')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /copy reference id/i }),
    ).toBeInTheDocument();
  });

  it('renders NO link and never links to a bare /reference/ when referenceId is empty (B-10 guard)', () => {
    // Empty referenceId is the IngestionSuccessCard fallback (referenceId ?? '');
    // the guard must keep copyable-id-only behaviour and emit no link that would
    // 404 against a bare /reference/.
    render(
      <IngestionSuccessCard
        kind="reference"
        referenceId=""
        title="A reference with no id"
        summary="Saved, but the id was not returned."
      />,
    );
    expect(
      screen.queryByRole('link', { name: /view reference/i }),
    ).not.toBeInTheDocument();
    const links = screen.queryAllByRole('link');
    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      // No link may point at /reference/ (bare or with an empty segment).
      expect(href).not.toMatch(/^\/reference(\/|$)/);
    }
  });
});

describe('IngestionSuccessCard — content variant unchanged (protects upload-tab-content)', () => {
  it('still renders the contentType badge and a /item/<id> view link', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <LayerVocabularyProvider>
          <IngestionSuccessCard
            itemId="item-42"
            title="An uploaded document"
            contentType="case_study"
          />
        </LayerVocabularyProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('case study')).toBeInTheDocument();
    const viewLink = screen.getByRole('link', { name: /view item/i });
    expect(viewLink).toHaveAttribute('href', '/item/item-42');
  });
});

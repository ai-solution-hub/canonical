/**
 * TemplateCoverageContent Component Tests
 *
 * Tests the template coverage tab — loading, empty, error states,
 * template selection, and coverage score display.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// vi.hoisted() — mock values referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/coverage',
  useSearchParams: () => new URLSearchParams(),
}));

// Stub TemplateCoverageSection to isolate this component
vi.mock('@/components/coverage/template-coverage-section', () => ({
  TemplateCoverageSection: ({ sectionRef, sectionName }: { sectionRef: string; sectionName: string }) => (
    <div data-testid={`template-section-${sectionRef}`}>{sectionName}</div>
  ),
}));

import { TemplateCoverageContent } from '@/components/coverage/template-coverage-content';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function createTemplateList(count = 2) {
  return {
    templates: Array.from({ length: count }, (_, i) => ({
      template_name: `template-${i + 1}`,
      template_type: i === 0 ? 'sq' : 'rfp',
      requirement_count: 10 + i * 5,
    })),
  };
}

function createCoverageResult(overrides: Record<string, unknown> = {}) {
  return {
    template_name: 'template-1',
    template_type: 'sq',
    template_version: 'v1.0',
    total_requirements: 15,
    score: 0.73,
    strong_count: 8,
    partial_count: 3,
    gap_count: 2,
    na_count: 2,
    sections: [
      {
        section_ref: 'S1',
        section_name: 'Organisation Info',
        requirements: [],
      },
      {
        section_ref: 'S2',
        section_name: 'Technical Capability',
        requirements: [],
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TemplateCoverageContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows loading skeleton while fetching templates', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(<TemplateCoverageContent />);

    expect(screen.getByRole('status', { name: /loading templates/i })).toBeInTheDocument();
  });

  it('shows empty state when no templates exist', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ templates: [] }),
    });

    render(<TemplateCoverageContent />);

    await waitFor(() => {
      expect(screen.getByText('No templates catalogued')).toBeInTheDocument();
    });
  });

  it('shows error message with retry button on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Template load failed' }),
    });

    render(<TemplateCoverageContent />);

    await waitFor(() => {
      expect(screen.getByText('Template load failed')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('renders template selector and auto-selects first template', async () => {
    const templateData = createTemplateList();
    const coverageData = createCoverageResult();

    // First call: template list; second call: coverage for selected template
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(templateData),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(coverageData),
      });

    render(<TemplateCoverageContent />);

    // Wait for coverage to load (means template was auto-selected)
    await waitFor(() => {
      expect(screen.getByText('template-1')).toBeInTheDocument();
    });

    // The second fetch should have been called with the first template name
    const coverageCall = mockFetch.mock.calls.find(
      (call: string[]) => typeof call[0] === 'string' && call[0].includes('/api/coverage/templates?'),
    );
    expect(coverageCall).toBeDefined();
    expect(coverageCall![0]).toContain('template_name=template-1');
  });

  it('displays score percentage, progress bar, and section breakdown', async () => {
    const templateData = createTemplateList();
    const coverageData = createCoverageResult({ score: 0.73 });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(templateData),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(coverageData),
      });

    render(<TemplateCoverageContent />);

    await waitFor(() => {
      expect(screen.getByText('73%')).toBeInTheDocument();
    });

    // Summary stat cards
    expect(screen.getByText('Strong')).toBeInTheDocument();
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.getByText('Gaps')).toBeInTheDocument();

    // Section breakdown
    expect(screen.getByTestId('template-section-S1')).toBeInTheDocument();
    expect(screen.getByTestId('template-section-S2')).toBeInTheDocument();
  });
});

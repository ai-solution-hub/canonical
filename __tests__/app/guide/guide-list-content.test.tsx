/**
 * /guide listing (S531 rebuild — DR-126 first-class guides surface).
 * Behaviour: renders guide cards linking to detail pages, an empty state
 * when no guides exist, and an error state on fetch failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GuideListContent } from '@/app/guide/guide-list-content';

const { mockFetchJson } = vi.hoisted(() => ({ mockFetchJson: vi.fn() }));
vi.mock('@/lib/query/fetchers', () => ({ fetchJson: mockFetchJson }));

function renderWithClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GuideListContent />
    </QueryClientProvider>,
  );
}

describe('GuideListContent', () => {
  beforeEach(() => {
    mockFetchJson.mockReset();
  });

  it('renders a card per guide linking to its detail page', async () => {
    mockFetchJson.mockResolvedValue([
      {
        id: 'g1',
        slug: 'security-basics',
        name: 'Security Basics',
        guide_type: 'sector',
        description: 'Start here for security.',
      },
      {
        id: 'g2',
        slug: 'onboarding',
        name: 'Onboarding',
        guide_type: 'company',
        description: null,
      },
    ]);

    renderWithClient();

    const first = await screen.findByRole('link', {
      name: /Security Basics/,
    });
    expect(first).toHaveAttribute('href', '/guide/security-basics');
    expect(screen.getByRole('link', { name: /Onboarding/ })).toHaveAttribute(
      'href',
      '/guide/onboarding',
    );
    expect(screen.getByText('Start here for security.')).toBeInTheDocument();
  });

  it('shows the empty state when no guides exist', async () => {
    mockFetchJson.mockResolvedValue([]);

    renderWithClient();

    expect(await screen.findByText('No guides yet')).toBeInTheDocument();
  });

  it('shows an error state when the fetch fails', async () => {
    mockFetchJson.mockRejectedValue(new Error('boom'));

    renderWithClient();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /Failed to load guides/,
      );
    });
  });
});

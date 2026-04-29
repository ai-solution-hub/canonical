/**
 * ContentDedupFilterBar Component Tests
 *
 * Verifies Radix Select interactions for domain + sort, and the refresh
 * button callback. Per CLAUDE.md gotcha
 * (`feedback_radix_select_jsdom_shims`), `installRadixPointerShims()` is
 * called in `beforeEach` to make Radix Select usable inside jsdom.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';
import { ContentDedupFilterBar } from '@/components/admin/content-dedup/content-dedup-filter-bar';

describe('ContentDedupFilterBar', () => {
  beforeEach(() => {
    installRadixPointerShims();
  });

  it('renders domain + sort selects and refresh button', () => {
    render(
      <ContentDedupFilterBar
        filters={{ sort: 'created_at_desc' }}
        onFiltersChange={() => {}}
        onRefresh={() => {}}
        availableDomains={['tech-it', 'compliance']}
      />,
    );

    expect(
      screen.getByRole('combobox', { name: /filter by domain/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: /sort order/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /refresh queue/i }),
    ).toBeInTheDocument();
  });

  it('emits onFiltersChange when domain is selected', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    render(
      <ContentDedupFilterBar
        filters={{ sort: 'created_at_desc' }}
        onFiltersChange={onFiltersChange}
        onRefresh={() => {}}
        availableDomains={['tech-it']}
      />,
    );

    await user.click(
      screen.getByRole('combobox', { name: /filter by domain/i }),
    );
    await user.click(await screen.findByRole('option', { name: 'tech-it' }));

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'tech-it' }),
    );
  });

  it('clears domain filter when "All domains" is selected', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    render(
      <ContentDedupFilterBar
        filters={{ sort: 'created_at_desc', domain: 'tech-it' }}
        onFiltersChange={onFiltersChange}
        onRefresh={() => {}}
        availableDomains={['tech-it']}
      />,
    );

    await user.click(
      screen.getByRole('combobox', { name: /filter by domain/i }),
    );
    await user.click(
      await screen.findByRole('option', { name: /all domains/i }),
    );

    expect(onFiltersChange).toHaveBeenCalled();
    const nextFilters = onFiltersChange.mock.calls[0][0];
    expect(nextFilters).not.toHaveProperty('domain');
  });

  it('emits onFiltersChange when sort is changed to similarity', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    render(
      <ContentDedupFilterBar
        filters={{ sort: 'created_at_desc' }}
        onFiltersChange={onFiltersChange}
        onRefresh={() => {}}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: /sort order/i }));
    await user.click(
      await screen.findByRole('option', { name: /similarity/i }),
    );

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'similarity_desc' }),
    );
  });

  it('calls onRefresh when refresh button is clicked', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();

    render(
      <ContentDedupFilterBar
        filters={{ sort: 'created_at_desc' }}
        onFiltersChange={() => {}}
        onRefresh={onRefresh}
      />,
    );

    await user.click(screen.getByRole('button', { name: /refresh queue/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('disables refresh button while isRefreshing', () => {
    render(
      <ContentDedupFilterBar
        filters={{ sort: 'created_at_desc' }}
        onFiltersChange={() => {}}
        onRefresh={() => {}}
        isRefreshing
      />,
    );

    expect(
      screen.getByRole('button', { name: /refresh queue/i }),
    ).toBeDisabled();
  });
});

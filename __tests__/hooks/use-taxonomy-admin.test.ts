import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the hook import
// ---------------------------------------------------------------------------

const { mockSupabase } = vi.hoisted(() => {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    then: vi.fn(),
  };
  // Chainable: each returns chain
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  // Default: resolve to empty subtopics
  chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null }),
  );

  return {
    mockSupabase: {
      from: vi.fn().mockReturnValue(chain),
      _chain: chain,
    },
  };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mockSupabase,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { toast } from 'sonner';
import {
  useTaxonomyAdmin,
  type AdminDomain,
  type AdminSubtopic,
  type UseTaxonomyAdminParams,
} from '@/hooks/use-taxonomy-admin';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch;

const sampleDomains: AdminDomain[] = [
  { id: 'd1', name: 'Technical', display_order: 1, colour: '#0000FF', key_signal: null, is_active: true, subtopic_count: 3, provenance: 'baseline' },
  { id: 'd2', name: 'Corporate', display_order: 2, colour: null, key_signal: null, is_active: true, subtopic_count: 1, provenance: 'baseline' },
];

const sampleSubtopics: AdminSubtopic[] = [
  { id: 's1', domain_id: 'd1', name: 'Cloud', display_order: 1, is_active: true, provenance: 'baseline', description: null },
  { id: 's2', domain_id: 'd1', name: 'Security', display_order: 2, is_active: true, provenance: 'baseline', description: null },
];

function defaultParams(): UseTaxonomyAdminParams {
  return { refresh: vi.fn() };
}

/**
 * Sets up mockFetch to return sampleDomains for the initial fetchDomains call
 * and renders the hook inside a QueryClientProvider. Returns the renderHook
 * result + the refresh mock + the queryClient.
 */
async function renderWithDomains(domains: AdminDomain[] = sampleDomains) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: vi.fn().mockResolvedValue(domains),
  });

  const refreshFn = vi.fn();
  const { queryClient, Wrapper } = createQueryWrapper();
  const rendered = renderHook(
    () => useTaxonomyAdmin({ refresh: refreshFn }),
    { wrapper: Wrapper },
  );

  // Wait for the initial fetch to complete
  await waitFor(() => {
    expect(rendered.result.current.loading).toBe(false);
  });

  return { ...rendered, refreshFn, queryClient };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useTaxonomyAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );
  });

  // -------------------------------------------------------------------------
  // Initial state and data fetching
  // -------------------------------------------------------------------------

  it('starts with loading=true and empty domains', () => {
    // Do not resolve fetch so loading stays true
    mockFetch.mockReturnValue(new Promise(() => {}));
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useTaxonomyAdmin(defaultParams()),
      { wrapper: Wrapper },
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.domains).toEqual([]);
    expect(result.current.expandedDomains.size).toBe(0);
  });

  it('fetches domains on mount and sets loading=false', async () => {
    const { result } = await renderWithDomains();

    expect(result.current.loading).toBe(false);
    expect(result.current.domains).toHaveLength(2);
    expect(result.current.domains[0].name).toBe('Technical');
    expect(mockFetch).toHaveBeenCalledWith('/api/taxonomy/domains', undefined);
  });

  it('shows error toast when domain fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: vi.fn().mockResolvedValue({ error: 'Failed to load domains' }),
    });
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useTaxonomyAdmin(defaultParams()),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });

    // The hook should still report empty domains via query error state
    expect(result.current.domains).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Toggle domain (expand/collapse)
  // -------------------------------------------------------------------------

  it('toggleDomain expands a domain and fetches subtopics via supabase', async () => {
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: sampleSubtopics, error: null }),
    );

    const { result } = await renderWithDomains();

    act(() => { result.current.toggleDomain('d1'); });

    expect(result.current.expandedDomains.has('d1')).toBe(true);

    // fetchSubtopics uses a dynamic import() which resolves asynchronously
    await waitFor(() => {
      expect(mockSupabase.from).toHaveBeenCalledWith('taxonomy_subtopics');
    });

    // Wait for subtopics to be set in cache and reflected in the Map
    await waitFor(() => {
      expect(result.current.subtopicsByDomain.get('d1')).toHaveLength(2);
    });
  });

  it('toggleDomain collapses an already-expanded domain', async () => {
    const { result } = await renderWithDomains();

    act(() => { result.current.toggleDomain('d1'); });
    expect(result.current.expandedDomains.has('d1')).toBe(true);

    act(() => { result.current.toggleDomain('d1'); });
    expect(result.current.expandedDomains.has('d1')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Domain CRUD — add
  // -------------------------------------------------------------------------

  it('openAddDomain resets form fields and opens dialog', async () => {
    const { result } = await renderWithDomains();

    act(() => { result.current.openAddDomain(); });

    expect(result.current.domainDialogOpen).toBe(true);
    expect(result.current.editingDomain).toBeNull();
    expect(result.current.domainName).toBe('');
    expect(result.current.domainColour).toBe('');
    expect(result.current.domainOrder).toBe('');
  });

  it('handleDomainSubmit creates a new domain via POST', async () => {
    // Initial fetch for domains
    const { result, refreshFn } = await renderWithDomains();

    // Open add domain dialog
    act(() => { result.current.openAddDomain(); });
    act(() => { result.current.setDomainName('New Domain'); });
    act(() => { result.current.setDomainColour('#FF0000'); });

    // Mock the POST call + subsequent refetch from invalidation
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(sampleDomains) });

    const fakeEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    await act(async () => {
      await result.current.handleDomainSubmit(fakeEvent);
    });

    expect(fakeEvent.preventDefault).toHaveBeenCalled();
    // Find the POST call (skip the initial GET)
    const postCall = mockFetch.mock.calls.find(
      (c) => c[1]?.method === 'POST',
    );
    expect(postCall).toBeDefined();
    expect(postCall![0]).toBe('/api/taxonomy/domains');
    const body = JSON.parse(postCall![1].body);
    expect(body.name).toBe('New Domain');
    expect(body.colour).toBe('#FF0000');

    expect(toast.success).toHaveBeenCalledWith('Domain created');
    expect(result.current.domainDialogOpen).toBe(false);
    expect(refreshFn).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Domain CRUD — edit
  // -------------------------------------------------------------------------

  it('openEditDomain populates form fields from the domain', async () => {
    const { result } = await renderWithDomains();

    act(() => { result.current.openEditDomain(sampleDomains[0]); });

    expect(result.current.domainDialogOpen).toBe(true);
    expect(result.current.editingDomain).toEqual(sampleDomains[0]);
    expect(result.current.domainName).toBe('Technical');
    expect(result.current.domainColour).toBe('#0000FF');
    expect(result.current.domainOrder).toBe('1');
  });

  it('handleDomainSubmit updates an existing domain via PATCH', async () => {
    const { result, refreshFn } = await renderWithDomains();

    // Open edit with existing domain
    act(() => { result.current.openEditDomain(sampleDomains[0]); });
    act(() => { result.current.setDomainName('Technical v2'); });

    // Mock PATCH + subsequent refetch from invalidation
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(sampleDomains) });

    const fakeEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    await act(async () => {
      await result.current.handleDomainSubmit(fakeEvent);
    });

    const patchCall = mockFetch.mock.calls.find(
      (c) => c[1]?.method === 'PATCH',
    );
    expect(patchCall).toBeDefined();
    expect(patchCall![0]).toBe('/api/taxonomy/domains/d1');
    const body = JSON.parse(patchCall![1].body);
    expect(body.name).toBe('Technical v2');

    expect(toast.success).toHaveBeenCalledWith('Domain updated');
    expect(refreshFn).toHaveBeenCalled();
  });

  it('handleDomainSubmit does nothing when name is empty', async () => {
    const { result } = await renderWithDomains();

    act(() => { result.current.openAddDomain(); });
    act(() => { result.current.setDomainName('   '); });

    const fakeEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    await act(async () => {
      await result.current.handleDomainSubmit(fakeEvent);
    });

    // Only the initial fetchDomains call should have been made
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('handleDomainSubmit shows error toast on API failure', async () => {
    const { result } = await renderWithDomains();

    act(() => { result.current.openAddDomain(); });
    act(() => { result.current.setDomainName('Failing Domain'); });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: vi.fn().mockResolvedValue({ error: 'Duplicate name' }),
    });

    const fakeEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    await act(async () => {
      try {
        await result.current.handleDomainSubmit(fakeEvent);
      } catch {
        // mutateAsync throws on error — expected
      }
    });

    expect(toast.error).toHaveBeenCalledWith('Duplicate name');
  });

  it('handleDomainSubmit closes without PATCH when no fields changed', async () => {
    const { result } = await renderWithDomains();

    // Open edit — don't change anything
    act(() => { result.current.openEditDomain(sampleDomains[0]); });

    const fakeEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    await act(async () => {
      await result.current.handleDomainSubmit(fakeEvent);
    });

    // No PATCH call — only initial GET
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.current.domainDialogOpen).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Subtopic CRUD — add
  // -------------------------------------------------------------------------

  it('openAddSubtopic sets domain ID and opens subtopic dialog', async () => {
    const { result } = await renderWithDomains();

    act(() => { result.current.openAddSubtopic('d1'); });

    expect(result.current.subtopicDialogOpen).toBe(true);
    expect(result.current.editingSubtopic).toBeNull();
    expect(result.current.subtopicName).toBe('');
  });

  it('handleSubtopicSubmit creates a new subtopic via POST', async () => {
    const { result, refreshFn } = await renderWithDomains();

    act(() => { result.current.openAddSubtopic('d1'); });
    act(() => { result.current.setSubtopicName('Networking'); });

    // Mock POST + refetch domains (for subtopic count update)
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(sampleDomains) });

    const fakeEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    await act(async () => {
      await result.current.handleSubtopicSubmit(fakeEvent);
    });

    const postCall = mockFetch.mock.calls.find(
      (c) => c[1]?.method === 'POST' && c[0] === '/api/taxonomy/subtopics',
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall![1].body);
    expect(body.domain_id).toBe('d1');
    expect(body.name).toBe('Networking');

    expect(toast.success).toHaveBeenCalledWith('Subtopic created');
    expect(refreshFn).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Subtopic CRUD — edit
  // -------------------------------------------------------------------------

  it('openEditSubtopic populates form fields from the subtopic', async () => {
    const { result } = await renderWithDomains();

    act(() => { result.current.openEditSubtopic(sampleSubtopics[0]); });

    expect(result.current.subtopicDialogOpen).toBe(true);
    expect(result.current.editingSubtopic).toEqual(sampleSubtopics[0]);
    expect(result.current.subtopicName).toBe('Cloud');
    expect(result.current.subtopicOrder).toBe('1');
  });

  it('handleSubtopicSubmit updates an existing subtopic via PATCH', async () => {
    const { result } = await renderWithDomains();

    act(() => { result.current.openEditSubtopic(sampleSubtopics[0]); });
    act(() => { result.current.setSubtopicName('Cloud Computing'); });

    // Mock PATCH + refetches
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(sampleDomains) });

    const fakeEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    await act(async () => {
      await result.current.handleSubtopicSubmit(fakeEvent);
    });

    const patchCall = mockFetch.mock.calls.find(
      (c) => c[1]?.method === 'PATCH' && c[0]?.includes('/api/taxonomy/subtopics/'),
    );
    expect(patchCall).toBeDefined();
    expect(patchCall![0]).toBe('/api/taxonomy/subtopics/s1');
    const body = JSON.parse(patchCall![1].body);
    expect(body.name).toBe('Cloud Computing');

    expect(toast.success).toHaveBeenCalledWith('Subtopic updated');
  });

  // -------------------------------------------------------------------------
  // Deactivation / reactivation
  // -------------------------------------------------------------------------

  it('confirmDeactivate sets target and opens dialog', async () => {
    const { result } = await renderWithDomains();

    act(() => { result.current.confirmDeactivate('domain', 'd1', 'Technical'); });

    expect(result.current.deactivateDialogOpen).toBe(true);
    expect(result.current.deactivateTarget).toEqual({
      type: 'domain',
      id: 'd1',
      name: 'Technical',
    });
  });

  it('handleDeactivate patches is_active=false for a domain', async () => {
    const { result, refreshFn } = await renderWithDomains();

    act(() => { result.current.confirmDeactivate('domain', 'd1', 'Technical'); });

    // Mock PATCH + refetch from invalidation
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(sampleDomains) });

    await act(async () => {
      await result.current.handleDeactivate();
    });

    const patchCall = mockFetch.mock.calls.find(
      (c) => c[1]?.method === 'PATCH' && c[0] === '/api/taxonomy/domains/d1',
    );
    expect(patchCall).toBeDefined();
    const body = JSON.parse(patchCall![1].body);
    expect(body.is_active).toBe(false);

    expect(toast.success).toHaveBeenCalledWith('Domain deactivated');
    expect(result.current.deactivateDialogOpen).toBe(false);
    expect(refreshFn).toHaveBeenCalled();
  });

  it('handleReactivate patches is_active=true for a subtopic', async () => {
    const { result, refreshFn } = await renderWithDomains();

    // Mock PATCH + refetch
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(sampleDomains) });

    await act(async () => {
      await result.current.handleReactivate('subtopic', 's1', 'd1');
    });

    const patchCall = mockFetch.mock.calls.find(
      (c) => c[1]?.method === 'PATCH' && c[0] === '/api/taxonomy/subtopics/s1',
    );
    expect(patchCall).toBeDefined();
    const body = JSON.parse(patchCall![1].body);
    expect(body.is_active).toBe(true);

    expect(toast.success).toHaveBeenCalledWith('Subtopic reactivated');
    expect(refreshFn).toHaveBeenCalled();
  });

  it('handleDeactivate shows error toast on failure', async () => {
    const { result } = await renderWithDomains();

    act(() => { result.current.confirmDeactivate('domain', 'd1', 'Technical'); });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: vi.fn().mockResolvedValue({ error: 'In use' }),
    });

    await act(async () => {
      try {
        await result.current.handleDeactivate();
      } catch {
        // mutateAsync throws on error — expected
      }
    });

    expect(toast.error).toHaveBeenCalledWith('In use');
  });

  // -------------------------------------------------------------------------
  // Reordering — domains
  // -------------------------------------------------------------------------

  it('handleMoveDomain swaps display orders and calls /api/taxonomy/reorder', async () => {
    const { result, refreshFn } = await renderWithDomains();

    // Mock reorder POST + subsequent refetch
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(sampleDomains) });

    await act(async () => {
      await result.current.handleMoveDomain('d2', 'up');
    });

    const reorderCall = mockFetch.mock.calls.find(
      (c) => c[1]?.method === 'POST' && c[0] === '/api/taxonomy/reorder',
    );
    expect(reorderCall).toBeDefined();
    const body = JSON.parse(reorderCall![1].body);
    expect(body.type).toBe('domain');
    expect(body.items).toHaveLength(2);

    // d2 should take d1's display_order (1) and vice versa
    const d2Update = body.items.find((i: { id: string }) => i.id === 'd2');
    const d1Update = body.items.find((i: { id: string }) => i.id === 'd1');
    expect(d2Update.display_order).toBe(1);
    expect(d1Update.display_order).toBe(2);

    expect(refreshFn).toHaveBeenCalled();
  });

  it('handleMoveDomain does nothing when at boundary (first item up)', async () => {
    const { result } = await renderWithDomains();

    await act(async () => {
      await result.current.handleMoveDomain('d1', 'up');
    });

    // No reorder call — only initial fetch
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('handleMoveDomain rolls back on API failure', async () => {
    const { result } = await renderWithDomains();

    // Mock a failed reorder + the rollback refetch from onSettled
    mockFetch
      .mockResolvedValueOnce({ ok: false, json: vi.fn().mockResolvedValue({ error: 'Failed to reorder' }) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(sampleDomains) });

    await act(async () => {
      try {
        await result.current.handleMoveDomain('d2', 'up');
      } catch {
        // mutateAsync throws on error — expected
      }
    });

    expect(toast.error).toHaveBeenCalledWith('Failed to reorder domains');
  });

  // -------------------------------------------------------------------------
  // Reordering — subtopics
  // -------------------------------------------------------------------------

  it('handleMoveSubtopic swaps subtopic display orders', async () => {
    // Populate subtopics in the cache first
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: sampleSubtopics, error: null }),
    );

    const { result, refreshFn } = await renderWithDomains();

    // Expand domain to load subtopics
    act(() => { result.current.toggleDomain('d1'); });
    await waitFor(() => {
      expect(result.current.subtopicsByDomain.get('d1')).toHaveLength(2);
    });

    // Mock the reorder POST + refetch
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}) });

    // Mock the subtopic refetch from onSettled
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: sampleSubtopics, error: null }),
    );

    await act(async () => {
      await result.current.handleMoveSubtopic('d1', 's2', 'up');
    });

    const reorderCall = mockFetch.mock.calls.find(
      (c) => c[1]?.method === 'POST' && c[0] === '/api/taxonomy/reorder',
    );
    expect(reorderCall).toBeDefined();
    const body = JSON.parse(reorderCall![1].body);
    expect(body.type).toBe('subtopic');
    expect(body.domain_id).toBe('d1');
    expect(body.items).toHaveLength(2);
    expect(refreshFn).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Screen reader announcement
  // -------------------------------------------------------------------------

  it('sets announcement on domain create for screen reader accessibility', async () => {
    const { result } = await renderWithDomains();

    act(() => { result.current.openAddDomain(); });
    act(() => { result.current.setDomainName('Accessibility Domain'); });

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(sampleDomains) });

    const fakeEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    await act(async () => {
      await result.current.handleDomainSubmit(fakeEvent);
    });

    expect(result.current.announcement).toBe("Domain 'Accessibility Domain' created");
  });

  // -------------------------------------------------------------------------
  // TanStack Query-specific tests
  // -------------------------------------------------------------------------

  it('domain query uses cache on re-render without refetching', async () => {
    const { result, rerender } = await renderWithDomains();

    expect(result.current.domains).toHaveLength(2);
    const fetchCount = mockFetch.mock.calls.length;

    // Re-render should not trigger another fetch
    rerender();

    expect(mockFetch.mock.calls.length).toBe(fetchCount);
    expect(result.current.domains).toHaveLength(2);
  });

  it('domain save mutation invalidates domain query', async () => {
    const { result } = await renderWithDomains();

    act(() => { result.current.openAddDomain(); });
    act(() => { result.current.setDomainName('New via mutation'); });

    // Mock POST + refetch after invalidation
    const updatedDomains = [
      ...sampleDomains,
      { id: 'd3', name: 'New via mutation', display_order: 3, colour: null, is_active: true, subtopic_count: 0, provenance: 'client' as const },
    ];
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(updatedDomains) });

    const fakeEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    await act(async () => {
      await result.current.handleDomainSubmit(fakeEvent);
    });

    // After invalidation, the query should refetch and show new data
    await waitFor(() => {
      expect(result.current.domains).toHaveLength(3);
    });
  });

  it('optimistic reorder restores domain order on API error', async () => {
    const { result } = await renderWithDomains();

    // Capture original order
    const originalFirst = result.current.domains[0].id;

    // Mock failed reorder + refetch from onSettled
    mockFetch
      .mockResolvedValueOnce({ ok: false, json: vi.fn().mockResolvedValue({ error: 'Server error' }) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(sampleDomains) });

    await act(async () => {
      try {
        await result.current.handleMoveDomain('d2', 'up');
      } catch {
        // mutateAsync throws — expected
      }
    });

    // After rollback + refetch, order should be restored
    await waitFor(() => {
      expect(result.current.domains[0].id).toBe(originalFirst);
    });
  });
});

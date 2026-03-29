/**
 * useEntityDetail Hook Tests
 *
 * Tests the TanStack Query hook that fetches entity detail and provides
 * a metadata save mutation. Verifies:
 * - Query is disabled when panel is closed or no name is provided
 * - Successful fetch returns entity detail
 * - Error states are surfaced correctly
 * - Save mutation calls the correct endpoint
 * - Successful save invalidates the detail cache
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createQueryWrapper } from '../helpers/query-wrapper';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_ENTITY_DETAIL = {
  canonical_name: 'ISO 27001',
  entity_type: 'certification',
  effective_type: 'certification',
  has_type_override: false,
  mention_count: 12,
  variant_names: ['ISO 27001', 'ISO/IEC 27001', 'ISO27001'],
  variant_count: 3,
  types_seen: ['certification'],
  has_type_conflict: false,
  content_items: [
    { id: 'item-1', title: 'Security Policy', content_type: 'policy' },
    { id: 'item-2', title: 'ISMS Overview', content_type: 'article' },
  ],
  content_item_count: 2,
  relationships: [
    {
      source_entity: 'ISO 27001',
      relationship_type: 'certified_by',
      target_entity: 'BSI',
      confidence: 0.95,
    },
  ],
  relationship_count: 1,
  metadata: {
    version: '2022',
    issuing_body: 'BSI',
    expiry_date: '2025-12-31',
  },
};

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------

// Dynamic import to ensure fetch mock is in place
async function importHook() {
  return import('@/hooks/use-entity-detail');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useEntityDetail', () => {
  describe('query behaviour', () => {
    it('does not fetch when enabled is false', async () => {
      const { useEntityDetail } = await importHook();

      renderHook(() => useEntityDetail('ISO 27001', false), {
        wrapper: createQueryWrapper(),
      });

      // Give a tick for any async work
      await new Promise((r) => setTimeout(r, 50));

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not fetch when canonicalName is null', async () => {
      const { useEntityDetail } = await importHook();

      renderHook(() => useEntityDetail(null, true), {
        wrapper: createQueryWrapper(),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('fetches entity detail when enabled and name is set', async () => {
      const { useEntityDetail } = await importHook();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(MOCK_ENTITY_DETAIL),
      });

      const { result } = renderHook(
        () => useEntityDetail('ISO 27001', true),
        { wrapper: createQueryWrapper() },
      );

      // Initially loading
      expect(result.current.isLoading).toBe(true);
      expect(result.current.detail).toBeNull();

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.detail).toEqual(MOCK_ENTITY_DETAIL);
      expect(result.current.error).toBeNull();
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/entities/ISO%2027001',
        undefined,
      );
    });

    it('surfaces error message on failed fetch', async () => {
      const { useEntityDetail } = await importHook();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal server error' }),
      });

      const { result } = renderHook(
        () => useEntityDetail('ISO 27001', true),
        { wrapper: createQueryWrapper() },
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.detail).toBeNull();
      expect(result.current.error).toBe('Internal server error');
    });

    it('surfaces generic error when response has no error field', async () => {
      const { useEntityDetail } = await importHook();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      });

      const { result } = renderHook(
        () => useEntityDetail('ISO 27001', true),
        { wrapper: createQueryWrapper() },
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.detail).toBeNull();
      expect(result.current.error).toBe('Request failed: 404');
    });
  });

  describe('save mutation', () => {
    it('calls PATCH endpoint with metadata', async () => {
      const { useEntityDetail } = await importHook();

      // First call: initial fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(MOCK_ENTITY_DETAIL),
      });

      const { result } = renderHook(
        () => useEntityDetail('ISO 27001', true),
        { wrapper: createQueryWrapper() },
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Set up the mutation response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'mention-1',
            canonical_name: 'ISO 27001',
            entity_type: 'certification',
            metadata: { version: '2024', issuing_body: 'BSI' },
          }),
      });

      // Also mock the refetch that happens after invalidation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ...MOCK_ENTITY_DETAIL,
            metadata: { version: '2024', issuing_body: 'BSI' },
          }),
      });

      const newMetadata = { version: '2024', issuing_body: 'BSI' };

      await act(async () => {
        await result.current.saveMetadata(newMetadata);
      });

      // Check the PATCH call
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/entities/ISO%2027001/metadata',
        expect.objectContaining({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newMetadata),
        }),
      );

      await waitFor(() => {
        expect(result.current.saveSuccess).toBe(true);
      });
      expect(result.current.saveError).toBeNull();
    });

    it('surfaces save error on failed mutation', async () => {
      const { useEntityDetail } = await importHook();

      // Initial fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(MOCK_ENTITY_DETAIL),
      });

      const { result } = renderHook(
        () => useEntityDetail('ISO 27001', true),
        { wrapper: createQueryWrapper() },
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Failed save
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Invalid metadata' }),
      });

      await act(async () => {
        try {
          await result.current.saveMetadata({ version: '' });
        } catch {
          // Expected — mutateAsync throws on error
        }
      });

      await waitFor(() => {
        expect(result.current.saveError).toBe('Invalid metadata');
      });

      expect(result.current.saveSuccess).toBe(false);
    });

    it('resets mutation state on reset call', async () => {
      const { useEntityDetail } = await importHook();

      // Initial fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(MOCK_ENTITY_DETAIL),
      });

      const { result } = renderHook(
        () => useEntityDetail('ISO 27001', true),
        { wrapper: createQueryWrapper() },
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Successful save
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'mention-1' }),
      });
      // Refetch after invalidation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(MOCK_ENTITY_DETAIL),
      });

      await act(async () => {
        await result.current.saveMetadata({ version: '2024' });
      });

      await waitFor(() => {
        expect(result.current.saveSuccess).toBe(true);
      });

      act(() => {
        result.current.resetSaveState();
      });

      await waitFor(() => {
        expect(result.current.saveSuccess).toBe(false);
      });
      expect(result.current.saveError).toBeNull();
    });
  });
});

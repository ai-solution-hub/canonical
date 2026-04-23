'use client';

import { useState, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { FilterPreset } from '@/types/filter-preset';

// ---------------------------------------------------------------------------
// System presets — always present, not stored in localStorage
// ---------------------------------------------------------------------------

const SYSTEM_PRESETS: FilterPreset[] = [
  {
    id: 'system-stale',
    name: 'Stale content',
    params: 'freshness=stale%2Cexpired',
    isSystem: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'system-unreviewed',
    name: 'Unreviewed items',
    params: 'review_status=unverified',
    isSystem: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'system-flagged',
    name: 'Flagged items',
    params: 'quality_issues=true',
    isSystem: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'system-my-content',
    name: 'My content',
    params: 'owner=me',
    isSystem: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'system-si',
    name: 'Sector intelligence',
    params: 'source=intelligence_pipeline',
    isSystem: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'kb-filter-presets';

function loadUserPresets(): FilterPreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p: unknown): p is FilterPreset =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as FilterPreset).id === 'string' &&
        typeof (p as FilterPreset).name === 'string' &&
        typeof (p as FilterPreset).params === 'string',
    );
  } catch {
    return [];
  }
}

function saveUserPresets(presets: FilterPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // localStorage unavailable or full — silently fail
  }
}

// ---------------------------------------------------------------------------
// Normalisation — strips non-filter params and sorts keys for comparison
// ---------------------------------------------------------------------------

export function normaliseParams(paramsString: string): string {
  const params = new URLSearchParams(paramsString);
  params.delete('sort');
  params.delete('order');
  params.delete('cursor');
  params.delete('q');
  params.sort();
  return params.toString();
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseFilterPresetsReturn {
  /** All presets: system presets first, then user presets sorted by createdAt. */
  presets: FilterPreset[];
  /** The preset whose params match the current URL, or null if none match. */
  activePreset: FilterPreset | null;
  /** Navigate to /browse with the preset's params, clearing any existing filters. */
  applyPreset: (presetId: string) => void;
  /** Save the current URL search params as a new user preset. Returns the new preset. */
  savePreset: (name: string) => FilterPreset;
  /** Rename an existing user preset. No-op for system presets. */
  renamePreset: (presetId: string, newName: string) => void;
  /** Delete a user preset. No-op for system presets. */
  deletePreset: (presetId: string) => void;
  /** Restore a previously deleted preset (for undo). */
  restorePreset: (preset: FilterPreset) => void;
  /** True when current URL has filters that could be saved (activeFilterCount > 0). */
  canSave: boolean;
}

export function useFilterPresets(): UseFilterPresetsReturn {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [userPresets, setUserPresets] =
    useState<FilterPreset[]>(loadUserPresets);

  // Merge system + user presets (system first, user sorted by createdAt asc)
  const presets = useMemo(() => {
    const sorted = [...userPresets].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    return [...SYSTEM_PRESETS, ...sorted];
  }, [userPresets]);

  // Normalised current URL params (filter params only)
  const currentNormalised = useMemo(
    () => normaliseParams(searchParams.toString()),
    [searchParams],
  );

  // Detect active preset by comparing normalised params
  const activePreset = useMemo(() => {
    if (!currentNormalised) return null;
    return (
      presets.find((p) => normaliseParams(p.params) === currentNormalised) ??
      null
    );
  }, [presets, currentNormalised]);

  // canSave: true when we have active filters
  const canSave = currentNormalised.length > 0;

  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = presets.find((p) => p.id === presetId);
      if (!preset) return;
      // Preserve from_bid sticky URL param (SD-5 / risk R-4): presets
      // are normalised on save so from_bid is stripped; re-append from
      // the current URL when applying so bid-context survives preset
      // switches in the same session.
      const fromBid = searchParams.get('from_bid');
      const params = new URLSearchParams(preset.params);
      if (fromBid) {
        params.set('from_bid', fromBid);
      }
      router.push(`/browse?${params.toString()}`);
    },
    [presets, router, searchParams],
  );

  const savePreset = useCallback(
    (name: string): FilterPreset => {
      const preset: FilterPreset = {
        id: `u_${crypto.randomUUID().slice(0, 8)}`,
        name: name.trim(),
        params: currentNormalised,
        isSystem: false,
        createdAt: new Date().toISOString(),
      };
      const updated = [...userPresets, preset];
      setUserPresets(updated);
      saveUserPresets(updated);
      return preset;
    },
    [currentNormalised, userPresets],
  );

  const renamePreset = useCallback(
    (presetId: string, newName: string) => {
      if (presetId.startsWith('system-')) return;
      const updated = userPresets.map((p) =>
        p.id === presetId ? { ...p, name: newName.trim() } : p,
      );
      setUserPresets(updated);
      saveUserPresets(updated);
    },
    [userPresets],
  );

  const deletePreset = useCallback(
    (presetId: string) => {
      if (presetId.startsWith('system-')) return;
      const updated = userPresets.filter((p) => p.id !== presetId);
      setUserPresets(updated);
      saveUserPresets(updated);
    },
    [userPresets],
  );

  const restorePreset = useCallback((preset: FilterPreset) => {
    setUserPresets((prev) => {
      const updated = [...prev, preset];
      saveUserPresets(updated);
      return updated;
    });
  }, []);

  return {
    presets,
    activePreset,
    applyPreset,
    savePreset,
    renamePreset,
    deletePreset,
    restorePreset,
    canSave,
  };
}

import { describe, it, expect, beforeEach, vi } from 'vitest';

// WP2 (S19): lib/entities/entity-aliases.ts now routes DB-fallback warnings
// through @/lib/logger (logger.warn) instead of console.warn.
const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: loggerMocks,
  getRequestContext: () => undefined,
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T) => fn(),
  updateRequestContext: vi.fn(),
  withRequestContext: <T>(handler: T) => handler,
  withRequestContextBare: <T>(handler: T) => handler,
  applyRequestContextToSentry: vi.fn(),
}));

import {
  resolveAlias,
  BASELINE_ALIASES,
  loadAliases,
  clearAliasCache,
  setAliasCache,
} from '@/lib/entities/entity-aliases';
import { canonicalise } from '@/lib/entities/entity-dedup';

beforeEach(() => {
  clearAliasCache();
  loggerMocks.warn.mockClear();
  loggerMocks.error.mockClear();
  loggerMocks.info.mockClear();
});

// ═══════════════════════════════════════════════════════════════════════════
// BASELINE_ALIASES
// ═══════════════════════════════════════════════════════════════════════════

describe('BASELINE_ALIASES', () => {
  it('contains generic aliases (ISO, technology names)', () => {
    expect(BASELINE_ALIASES['ISO Certification']).toBe('ISO 27001');
    expect(BASELINE_ALIASES['wordpress']).toBe('WordPress');
    expect(BASELINE_ALIASES['Csharp']).toBe('C#');
    expect(BASELINE_ALIASES['Wcag 2 1 Aa']).toBe('WCAG 2.1 AA');
  });

  it('does NOT contain client-specific aliases (example-client)', () => {
    expect(BASELINE_ALIASES['example-client']).toBeUndefined();
    expect(BASELINE_ALIASES['example-client Design Ltd']).toBeUndefined();
    expect(BASELINE_ALIASES['example-client Audit']).toBeUndefined();
    expect(BASELINE_ALIASES['example-client Lms']).toBeUndefined();
  });

  it('exports a non-empty alias map', () => {
    expect(Object.keys(BASELINE_ALIASES).length).toBeGreaterThan(0);
  });

  it('all alias values are non-empty strings', () => {
    for (const [key, value] of Object.entries(BASELINE_ALIASES)) {
      expect(
        value,
        `alias for "${key}" should be a non-empty string`,
      ).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// resolveAlias (no cache — baseline only)
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveAlias (baseline fallback)', () => {
  it('resolves generic ISO alias', () => {
    expect(resolveAlias('ISO 27001 2013')).toBe('ISO 27001');
  });

  it('resolves technology alias', () => {
    expect(resolveAlias('wordpress')).toBe('WordPress');
  });

  it('passes through unknown names unchanged', () => {
    expect(resolveAlias('Unknown Corp')).toBe('Unknown Corp');
  });

  it('does NOT resolve client-specific aliases without cache', () => {
    // example-client aliases are not in the baseline
    expect(resolveAlias('example-client')).toBe('example-client');
    expect(resolveAlias('example-client Design Ltd')).toBe('example-client Design Ltd');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// setAliasCache / clearAliasCache
// ═══════════════════════════════════════════════════════════════════════════

describe('setAliasCache', () => {
  it('injects client aliases and resolveAlias uses them', () => {
    setAliasCache({
      example-client: 'Example Client Ltd',
      'example-client Design Ltd': 'Example Client Ltd',
    });

    expect(resolveAlias('example-client')).toBe('Example Client Ltd');
    expect(resolveAlias('example-client Design Ltd')).toBe('Example Client Ltd');
    // Baseline aliases still available
    expect(resolveAlias('wordpress')).toBe('WordPress');
  });
});

describe('clearAliasCache', () => {
  it('resets to baseline behaviour', () => {
    setAliasCache({ example-client: 'Example Client Ltd' });
    expect(resolveAlias('example-client')).toBe('Example Client Ltd');

    clearAliasCache();
    // Now client alias no longer works
    expect(resolveAlias('example-client')).toBe('example-client');
    // But baseline still does
    expect(resolveAlias('wordpress')).toBe('WordPress');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// loadAliases
// ═══════════════════════════════════════════════════════════════════════════

describe('loadAliases', () => {
  function createMockSupabase(
    data: Array<{ alias: string; canonical: string }> | null,
    error: unknown = null,
  ) {
    return {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data, error }),
        }),
      }),
    };
  }

  it('merges DB data with baseline', async () => {
    const mockSb = createMockSupabase([
      { alias: 'example-client', canonical: 'Example Client Ltd' },
      { alias: 'example-client Audit', canonical: 'example-client Audit System' },
    ]);

    const result = await loadAliases(mockSb);

    // Client alias from DB
    expect(result['example-client']).toBe('Example Client Ltd');
    expect(result['example-client Audit']).toBe('example-client Audit System');
    // Baseline alias still present
    expect(result['wordpress']).toBe('WordPress');
    expect(result['ISO Certification']).toBe('ISO 27001');
  });

  it('DB values take precedence over baseline', async () => {
    const mockSb = createMockSupabase([
      { alias: 'wordpress', canonical: 'WP Override' },
    ]);

    const result = await loadAliases(mockSb);
    expect(result['wordpress']).toBe('WP Override');
  });

  it('falls back to baseline on DB error', async () => {
    const mockSb = createMockSupabase(null, { message: 'table not found' });

    const result = await loadAliases(mockSb);

    expect(result).toEqual(BASELINE_ALIASES);
    // logger.warn invoked with structured shape including err.
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: { message: 'table not found' } }),
      'Failed to load entity aliases from DB, using baseline',
    );
  });

  it('falls back to baseline when DB fetch throws', async () => {
    const mockSb = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockRejectedValue(new Error('network error')),
        }),
      }),
    };

    const result = await loadAliases(mockSb);

    expect(result).toEqual(BASELINE_ALIASES);
    // logger.warn invoked with single-arg message form (no context).
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'Entity alias DB fetch threw, using baseline',
    );
  });

  it('returns cached result on subsequent calls within TTL', async () => {
    const mockSb = createMockSupabase([
      { alias: 'example-client', canonical: 'Example Client Ltd' },
    ]);

    await loadAliases(mockSb);
    // Reset call count
    mockSb.from.mockClear();

    await loadAliases(mockSb);
    // Should NOT have queried DB again
    expect(mockSb.from).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// canonicalise -> resolveAlias (chained) with injected client aliases
// ═══════════════════════════════════════════════════════════════════════════

describe('canonicalise -> resolveAlias (chained with client aliases)', () => {
  beforeEach(() => {
    // Simulate DB-loaded client aliases
    setAliasCache({
      example-client: 'Example Client Ltd',
      'example-client Design Ltd': 'Example Client Ltd',
      'example-client Audit': 'example-client Audit System',
      'example-client Audit Platform': 'example-client Audit System',
      'example-client Lms': 'example-client LMS',
      'Learning Management System': 'example-client LMS',
      'example-client Pdms': 'example-client PDMS',
    });
  });

  const normalise = (name: string) => resolveAlias(canonicalise(name));

  it('example-client -> Example Client Ltd (canonicalise + alias)', () => {
    expect(normalise('example-client')).toBe('Example Client Ltd');
  });

  it('example-client design ltd -> Example Client Ltd', () => {
    expect(normalise('example-client design ltd')).toBe('Example Client Ltd');
  });

  it('example-client Audit Platform -> example-client Audit System', () => {
    expect(normalise('example-client Audit Platform')).toBe('example-client Audit System');
  });

  it('example-client audit -> example-client Audit System', () => {
    expect(normalise('example-client audit')).toBe('example-client Audit System');
  });

  it('ISO/IEC 27001 -> ISO 27001 (canonicalise handles it)', () => {
    expect(normalise('ISO/IEC 27001')).toBe('ISO 27001');
  });

  it('ISO Certification -> ISO 27001 (baseline alias)', () => {
    expect(normalise('ISO Certification')).toBe('ISO 27001');
  });

  it('unknown entity passes through both stages', () => {
    expect(normalise('Acme Corporation')).toBe('Acme Corporation');
  });
});

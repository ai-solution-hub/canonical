import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseCliArgs,
  assertNotRetiredProject,
  assertEnvComplete,
  assertEnvFlag,
  isTestArtefactTitle,
  buildHistoryRow,
  BACKFILL_CHANGE_REASON,
  BACKFILL_METADATA,
  PIPELINE_SERVICE_ACCOUNT_USER_ID,
  type ContentItem,
} from '../../scripts/backfill-content-history-v1';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('PIPELINE_SERVICE_ACCOUNT_USER_ID is a v4 UUID matching the canonical service account', () => {
    expect(PIPELINE_SERVICE_ACCOUNT_USER_ID).toBe(
      'a0000000-0000-4000-8000-000000000001',
    );
    expect(PIPELINE_SERVICE_ACCOUNT_USER_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('BACKFILL_CHANGE_REASON matches locked OQ-1', () => {
    expect(BACKFILL_CHANGE_REASON).toBe('backfill_v1_s186');
  });

  it('BACKFILL_METADATA matches locked OQ-2 shape', () => {
    expect(BACKFILL_METADATA).toEqual({
      backfill: true,
      reason: 'v1-history-missing-pre-s153',
      source_session: 'S186',
    });
  });
});

// ---------------------------------------------------------------------------
// parseCliArgs
// ---------------------------------------------------------------------------

describe('parseCliArgs', () => {
  it('returns defaults for empty argv', () => {
    const args = parseCliArgs([]);
    expect(args).toEqual({
      limit: 0,
      dryRun: false,
      batchSize: 50,
      help: false,
      env: '',
    });
  });

  it('parses --dry-run', () => {
    expect(parseCliArgs(['--dry-run']).dryRun).toBe(true);
  });

  it('parses --limit', () => {
    expect(parseCliArgs(['--limit', '10']).limit).toBe(10);
  });

  it('parses --batch-size', () => {
    expect(parseCliArgs(['--batch-size', '25']).batchSize).toBe(25);
  });

  it('parses --help', () => {
    expect(parseCliArgs(['--help']).help).toBe(true);
  });

  it('parses --env=prod (D-19 + D-23 fix)', () => {
    expect(parseCliArgs(['--env=prod']).env).toBe('prod');
  });

  it('parses --env prod (space form, L-3 fix)', () => {
    expect(parseCliArgs(['--env', 'prod']).env).toBe('prod');
  });

  it('rejects negative --limit (via --limit= syntax that bypasses util parseArgs ambiguity)', () => {
    expect(() => parseCliArgs(['--limit=-1'])).toThrow(/non-negative/);
  });

  it('rejects non-numeric --limit', () => {
    expect(() => parseCliArgs(['--limit', 'abc'])).toThrow(/non-negative/);
  });

  it('rejects --batch-size below 1', () => {
    expect(() => parseCliArgs(['--batch-size', '0'])).toThrow(
      /between 1 and 100/,
    );
  });

  it('rejects --batch-size above 100', () => {
    expect(() => parseCliArgs(['--batch-size', '101'])).toThrow(
      /between 1 and 100/,
    );
  });

  it('combines multiple flags', () => {
    const args = parseCliArgs([
      '--dry-run',
      '--limit',
      '10',
      '--batch-size',
      '25',
    ]);
    expect(args).toEqual({
      limit: 10,
      dryRun: true,
      batchSize: 25,
      help: false,
      env: '',
    });
  });
});

// ---------------------------------------------------------------------------
// assertNotRetiredProject
// ---------------------------------------------------------------------------

describe('assertNotRetiredProject (D-19 fix: retired ref is now mgrmucazfiibsomdmndh)', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('exits with code 1 when URL contains the legacy retired project ref (mgrmucazfiibsomdmndh)', () => {
    assertNotRetiredProject('https://mgrmucazfiibsomdmndh.supabase.co');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('does not exit for current production URL (rovrymhhffssilaftdwd)', () => {
    assertNotRetiredProject('https://rovrymhhffssilaftdwd.supabase.co');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not exit when URL is undefined (caller handles missing env separately)', () => {
    assertNotRetiredProject(undefined);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// assertEnvFlag (D-19 + D-23: --env=prod opt-in assertion)
// ---------------------------------------------------------------------------

describe('assertEnvFlag (D-19 + D-23 --env=prod opt-in)', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('does nothing when env flag is empty (default — no assertion)', () => {
    assertEnvFlag('', 'https://anything.supabase.co');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does nothing when env=prod AND url contains prod ref', () => {
    assertEnvFlag('prod', 'https://rovrymhhffssilaftdwd.supabase.co');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits with code 1 when env=prod but url does NOT contain prod ref', () => {
    assertEnvFlag('prod', 'https://turayklvaunphgbgscat.supabase.co');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('exits with code 1 when env=prod and url is undefined', () => {
    assertEnvFlag('prod', undefined);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// assertEnvComplete
// ---------------------------------------------------------------------------

describe('assertEnvComplete', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('exits when URL is missing', () => {
    assertEnvComplete(undefined, 'secret');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when secret key is missing', () => {
    assertEnvComplete('https://example.supabase.co', undefined);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not exit when both are present', () => {
    assertEnvComplete('https://example.supabase.co', 'secret');
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// isTestArtefactTitle
// ---------------------------------------------------------------------------

describe('isTestArtefactTitle', () => {
  it('returns true for [E2E prefix', () => {
    expect(isTestArtefactTitle('[E2E] Test item')).toBe(true);
    expect(isTestArtefactTitle('[E2E-123] worker')).toBe(true);
  });

  it('returns true for [SUPERSEDE prefix', () => {
    expect(isTestArtefactTitle('[SUPERSEDE] old record')).toBe(true);
    expect(isTestArtefactTitle('[SUPERSEDE-draft-v2]')).toBe(true);
  });

  it('returns false for real titles', () => {
    expect(isTestArtefactTitle('GDPR Compliance Policy')).toBe(false);
    expect(isTestArtefactTitle('What is ISO 27001?')).toBe(false);
  });

  it('returns false for null / empty titles', () => {
    expect(isTestArtefactTitle(null)).toBe(false);
    expect(isTestArtefactTitle(undefined)).toBe(false);
    expect(isTestArtefactTitle('')).toBe(false);
  });

  it('returns false for prefixes embedded mid-string', () => {
    // Prefix check is anchored at start — a title mentioning "E2E" later is real content.
    expect(isTestArtefactTitle('About E2E testing strategy')).toBe(false);
    expect(isTestArtefactTitle('Why we SUPERSEDE old docs')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildHistoryRow
// ---------------------------------------------------------------------------

describe('buildHistoryRow', () => {
  const baseItem: ContentItem = {
    id: '11111111-2222-4333-8444-555555555555',
    title: 'GDPR Compliance Policy',
    content: 'We comply with GDPR...',
    brief: 'A short brief',
    detail: 'A detail string',
    reference: 'REF-001',
    created_at: '2025-03-15T10:20:30.000Z',
  };

  it('maps every spec §10.3 column exactly', () => {
    const row = buildHistoryRow(baseItem);
    expect(row).toEqual({
      content_item_id: baseItem.id,
      version: 1,
      title: 'GDPR Compliance Policy',
      content: 'We comply with GDPR...',
      brief: 'A short brief',
      detail: 'A detail string',
      reference: 'REF-001',
      change_type: 'create',
      change_summary: 'Backfill v1 history for pre-S153 items',
      change_reason: 'backfill_v1_s186',
      metadata: BACKFILL_METADATA,
      created_by: PIPELINE_SERVICE_ACCOUNT_USER_ID,
      created_at: '2025-03-15T10:20:30.000Z',
    });
  });

  it('preserves created_at exactly from the item (AC12 — no offset)', () => {
    const row = buildHistoryRow(baseItem);
    expect(row.created_at).toBe(baseItem.created_at);
  });

  it('uses locked change_reason (AC8)', () => {
    const row = buildHistoryRow(baseItem);
    expect(row.change_reason).toBe('backfill_v1_s186');
  });

  it('uses change_type = create (AC9)', () => {
    const row = buildHistoryRow(baseItem);
    expect(row.change_type).toBe('create');
  });

  it('uses locked metadata shape (AC10)', () => {
    const row = buildHistoryRow(baseItem);
    expect(row.metadata).toEqual({
      backfill: true,
      reason: 'v1-history-missing-pre-s153',
      source_session: 'S186',
    });
  });

  it('uses pipeline service-account UUID (AC11)', () => {
    const row = buildHistoryRow(baseItem);
    expect(row.created_by).toBe(PIPELINE_SERVICE_ACCOUNT_USER_ID);
  });

  it('falls back to "(untitled)" when title is null', () => {
    const row = buildHistoryRow({ ...baseItem, title: null });
    expect(row.title).toBe('(untitled)');
  });

  it('coerces null content to empty string (content NOT NULL in DB)', () => {
    const row = buildHistoryRow({ ...baseItem, content: null });
    expect(row.content).toBe('');
  });

  it('passes through null brief / detail / reference', () => {
    const row = buildHistoryRow({
      ...baseItem,
      brief: null,
      detail: null,
      reference: null,
    });
    expect(row.brief).toBeNull();
    expect(row.detail).toBeNull();
    expect(row.reference).toBeNull();
  });
});

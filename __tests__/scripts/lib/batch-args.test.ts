import { describe, it, expect } from 'vitest';
import { parseBatchArgs } from '../../../scripts/lib/batch-args';

/**
 * Tests for the shared --apply / --limit / --env batch-arg parser.
 *
 * Driven entirely with explicit argv arrays — no dependency on the real
 * process.argv.
 */
describe('parseBatchArgs', () => {
  it('defaults to a dry run (apply=false) with no flags', () => {
    expect(parseBatchArgs([])).toEqual({ apply: false, limit: null, env: '' });
  });

  it('sets apply=true when --apply is passed', () => {
    expect(parseBatchArgs(['--apply']).apply).toBe(true);
  });

  it('parses --limit=N into a positive number', () => {
    expect(parseBatchArgs(['--limit=50']).limit).toBe(50);
  });

  it('parses --limit N (space form) into a positive number', () => {
    expect(parseBatchArgs(['--limit', '10']).limit).toBe(10);
  });

  it('resolves --limit=0 to null (process all rows)', () => {
    expect(parseBatchArgs(['--limit=0']).limit).toBeNull();
  });

  it('resolves a missing --limit to null', () => {
    expect(parseBatchArgs(['--apply']).limit).toBeNull();
  });

  it('resolves a negative --limit to null', () => {
    expect(parseBatchArgs(['--limit=-5']).limit).toBeNull();
  });

  it('captures --env=prod', () => {
    expect(parseBatchArgs(['--env=prod']).env).toBe('prod');
  });

  it('parses the full trio together', () => {
    expect(parseBatchArgs(['--apply', '--limit=25', '--env=prod'])).toEqual({
      apply: true,
      limit: 25,
      env: 'prod',
    });
  });

  it('throws on an unknown flag (strict parsing)', () => {
    expect(() => parseBatchArgs(['--bogus'])).toThrow();
  });
});

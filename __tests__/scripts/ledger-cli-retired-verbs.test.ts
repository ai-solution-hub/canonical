/**
 * ledger-cli-retired-verbs.test.ts — ID-148.8 (TECH §3.4, INV-7): the
 * umbrella + roadmap-verb-names retirement under Option C.
 *
 * NARROWED scope reminder (Option C): the roadmap ledger's SERVER arm is
 * REPURPOSED upstream to `initiatives` ({148.10}), NOT deleted —
 * `lib/validation/roadmap-schema.ts` stays a shell for {148.12}. Only the
 * CANONICAL CLI VERB NAMES retire here:
 *   - `update-roadmap`, `create-theme`, `update-umbrella` (bare subcommands)
 *   - `show`/`list` with a `roadmap`/`umbrellas` <ledger> argument
 *   - `promote --capability-theme` (a retired FLAG, not a retired verb name)
 *
 * Every retired path MUST return a clean `{ok:false,error:'retired-verb'|
 * 'retired-flag'}` envelope — never ENOENT/parse/stack — and MUST do so
 * WITHOUT touching any ledger file. The tests below point `--ledger-dir` at
 * an EMPTY temp dir (no task-list.json/product-roadmap.json/umbrellas.json
 * present at all) specifically to prove the retirement check fires before
 * any file read is attempted — a stray file read would surface as
 * `ledger-read-failed` (ENOENT), not `retired-verb`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, type ParsedArgs } from '@/scripts/ledger-cli';

let dir: string;

beforeEach(() => {
  // Deliberately EMPTY — no ledger files at all.
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-retired-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function args(
  subcommand: string,
  positionals: string[],
  extra: Partial<ParsedArgs['flags']> = {},
): ParsedArgs {
  return {
    subcommand,
    positionals,
    flags: {
      dryRun: false,
      pretty: false,
      regenMirrors: false,
      scoped: false,
      noRegenMirrors: true,
      ledgerDir: dir,
      ...extra,
    },
  };
}

describe('ledger-cli — ID-148.8 retired verb NAMES (RETIRED_VERBS)', () => {
  it('update-roadmap returns retired-verb, no ledger touched', async () => {
    const r = await run(args('update-roadmap', ['1', 'notes', 'x']));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('retired-verb');
      expect(r.detail).toContain('ID-148');
      expect(r.detail).not.toMatch(/ENOENT/i);
    }
  });

  it('create-theme returns retired-verb, no ledger touched', async () => {
    const r = await run(
      args('create-theme', [JSON.stringify({ id: '1', title: 'x' })]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('retired-verb');
      expect(r.detail).toContain('ID-148');
    }
  });

  it('update-umbrella returns retired-verb, no ledger touched', async () => {
    // The retirement check fires purely on the subcommand NAME, before any
    // op-flag (--add-tasks etc., themselves removed from VALUE_FLAGS) is
    // ever consulted.
    const r = await run(args('update-umbrella', ['test-umbrella']));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('retired-verb');
      expect(r.detail).toContain('ID-148');
    }
  });
});

describe('ledger-cli — ID-148.8 retired <ledger> arguments (show/list)', () => {
  it('show roadmap returns retired-verb, no ENOENT/parse/stack', async () => {
    const r = await run(args('show', ['roadmap', '1']));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('retired-verb');
      expect(r.detail).not.toMatch(/ENOENT/i);
    }
  });

  it('list roadmap returns retired-verb, no ENOENT/parse/stack', async () => {
    const r = await run(args('list', ['roadmap']));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('retired-verb');
      expect(r.detail).not.toMatch(/ENOENT/i);
    }
  });

  it('show umbrellas returns retired-verb, no ENOENT/parse/stack', async () => {
    const r = await run(args('show', ['umbrellas']));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('retired-verb');
      expect(r.detail).not.toMatch(/ENOENT/i);
    }
  });

  it('show umbrellas <id> also returns retired-verb (id ignored, never reaches a lookup)', async () => {
    const r = await run(args('show', ['umbrellas', 'canonical-pipeline']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('retired-verb');
  });

  it('list umbrellas returns retired-verb, no ENOENT/parse/stack', async () => {
    const r = await run(args('list', ['umbrellas']));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('retired-verb');
      expect(r.detail).not.toMatch(/ENOENT/i);
    }
  });

  // Checker FAIL remediation: `get` was missing this guard — `get roadmap
  // <id>` fell through to `loadLedger` and surfaced a raw ENOENT (the
  // product-roadmap.json fixture is absent from this suite's empty temp
  // dir), because 'roadmap' is still a valid LedgerName (Option C's server
  // arm repurpose). `get` now carries the identical RETIRED_LEDGER_NAMES
  // guard `show`/`list` already had.
  it('get roadmap returns retired-verb, no ENOENT/parse/stack', async () => {
    const r = await run(args('get', ['roadmap', '1']));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('retired-verb');
      expect(r.detail).not.toMatch(/ENOENT/i);
    }
  });

  it('get umbrellas returns retired-verb, no ENOENT/parse/stack (symmetry)', async () => {
    const r = await run(args('get', ['umbrellas', 'canonical-pipeline']));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('retired-verb');
      expect(r.detail).not.toMatch(/ENOENT/i);
    }
  });

  it('a genuinely unknown ledger name still gets the normal bad-ledger error, not retired-verb', async () => {
    const r = await run(args('show', ['nonsense-ledger', '1']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('bad-ledger');
  });
});

describe('ledger-cli — ID-148.8 promote --capability-theme is a retired FLAG', () => {
  it('returns retired-flag before promote() ever loads a ledger', async () => {
    const r = await run(
      args('promote', ['1', JSON.stringify({ id: '9999', title: 'x' })], {
        capabilityTheme: 'any-theme-id',
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('retired-flag');
      expect(r.detail).toContain('ID-148');
      expect(r.detail).not.toMatch(/ENOENT/i);
    }
  });
});

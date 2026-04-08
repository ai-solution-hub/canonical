/**
 * S156 guard: prevent the "naked INSERT INTO auth.users" anti-pattern.
 *
 * Background:
 *   The S156 incident traced to a migration that inserted a row into
 *   `auth.users` directly via SQL, bypassing `supabase.auth.admin.createUser()`.
 *   The row was missing the field initialisation that GoTrue normally
 *   provides — the 8 token columns defaulted to NULL, and there was no
 *   corresponding row in `auth.identities`. GoTrue's admin API scans those
 *   token columns into Go strings and 500s on NULL, which broke
 *   `auth.admin.listUsers()` for EVERY caller (not just the broken row).
 *   See `docs/audits/s156-auth-admin-sweep.md` for the full write-up.
 *
 * What this test enforces:
 *   For every migration file under `supabase/migrations/` that contains
 *   `INSERT INTO auth.users`, the migration MUST also:
 *
 *   1. Initialise all 8 GoTrue-required token columns to '' (empty string,
 *      NOT NULL):
 *        - confirmation_token
 *        - recovery_token
 *        - email_change_token_new
 *        - email_change_token_current
 *        - email_change
 *        - phone_change
 *        - phone_change_token
 *        - reauthentication_token
 *   2. Insert a corresponding row into `auth.identities` (any insert form
 *      that mentions the table is accepted — the test does not parse the
 *      INSERT shape, only its presence).
 *
 *   The canonical "correct" shape lives in
 *   `supabase/migrations/20260406180000_create_pipeline_service_account.sql`
 *   (post-S156 amendment).
 *
 *   Migrations that DO NOT insert into `auth.users` are ignored.
 *
 * What this test does NOT enforce:
 *   - The presence of `auth.admin.createUser()` calls in scripts (those are
 *     not migrations and have their own validation path via `seed:e2e-users`).
 *   - The semantic correctness of the inserted user (e.g. role, password).
 *   - The exact shape of the `auth.identities` insert. The test asserts
 *     only that a corresponding INSERT exists in the same migration file.
 *
 * Escape hatch:
 *   If a migration legitimately needs to bypass this guard (it shouldn't,
 *   but emergencies happen), add the literal comment
 *   `-- S156-GUARD-EXEMPT: <reason>` somewhere in the file. The test
 *   surfaces these in its output so they can be reviewed during code review.
 *
 * Why a vitest test rather than ESLint:
 *   Migration files are SQL, not TypeScript. ESLint cannot reach them.
 *   Running this in the existing `bun run test` suite ensures it gates
 *   every commit and runs in CI alongside the rest of the test suite.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';

const MIGRATIONS_DIR = resolve(__dirname, '../../supabase/migrations');

const REQUIRED_TOKEN_COLUMNS = [
  'confirmation_token',
  'recovery_token',
  'email_change_token_new',
  'email_change_token_current',
  'email_change',
  'phone_change',
  'phone_change_token',
  'reauthentication_token',
] as const;

const EXEMPTION_MARKER = 'S156-GUARD-EXEMPT';

interface MigrationFile {
  name: string;
  path: string;
  content: string;
}

function loadMigrations(): MigrationFile[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  return files.map((name) => {
    const path = resolve(MIGRATIONS_DIR, name);
    return { name, path, content: readFileSync(path, 'utf-8') };
  });
}

/**
 * Detects whether a migration file inserts into auth.users.
 * Tolerates whitespace and case variations. Strips SQL comments first so
 * a commented-out reference doesn't trip the detector.
 */
function insertsIntoAuthUsers(content: string): boolean {
  const stripped = content
    .split('\n')
    .map((line) => {
      const commentIdx = line.indexOf('--');
      return commentIdx === -1 ? line : line.slice(0, commentIdx);
    })
    .join('\n');
  return /INSERT\s+INTO\s+auth\.users\b/i.test(stripped);
}

/**
 * Detects whether a migration file also inserts into auth.identities.
 * Same comment-stripping logic as above.
 */
function insertsIntoAuthIdentities(content: string): boolean {
  const stripped = content
    .split('\n')
    .map((line) => {
      const commentIdx = line.indexOf('--');
      return commentIdx === -1 ? line : line.slice(0, commentIdx);
    })
    .join('\n');
  return /INSERT\s+INTO\s+auth\.identities\b/i.test(stripped);
}

/**
 * Detects whether a migration column-list (the parenthesised list after
 * `INSERT INTO auth.users`) mentions a token column. We look for the
 * column NAME anywhere in the file, since the column list and the VALUES
 * clause are separated by a newline-rich block. False positives are
 * acceptable here — a migration that mentions `confirmation_token` in a
 * comment would still need to actually insert it for the file to make
 * sense; the guard remains useful as a defence-in-depth check.
 */
function mentionsTokenColumn(content: string, column: string): boolean {
  const pattern = new RegExp(`\\b${column}\\b`);
  return pattern.test(content);
}

describe('S156 guard — INSERT INTO auth.users requires token initialisation + identities row', () => {
  const migrations = loadMigrations();

  it('migration directory is non-empty (sanity check)', () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it('every auth.users insert sets all 8 token columns', () => {
    const violations: string[] = [];

    for (const m of migrations) {
      if (!insertsIntoAuthUsers(m.content)) continue;
      if (m.content.includes(EXEMPTION_MARKER)) continue;

      const missing = REQUIRED_TOKEN_COLUMNS.filter(
        (col) => !mentionsTokenColumn(m.content, col),
      );
      if (missing.length > 0) {
        violations.push(
          `  - ${m.name}: missing token columns [${missing.join(', ')}]`,
        );
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `S156 guard failure — migrations with INSERT INTO auth.users must ` +
          `set all 8 GoTrue token columns to '' (NOT NULL), or GoTrue's admin ` +
          `API will 500 on listUsers/getUserById. ` +
          `See docs/audits/s156-auth-admin-sweep.md for context.\n\n` +
          `Violations:\n${violations.join('\n')}\n\n` +
          `Reference shape: supabase/migrations/20260406180000_create_pipeline_service_account.sql`,
      );
    }
  });

  it('every auth.users insert is paired with an auth.identities insert', () => {
    const violations: string[] = [];

    for (const m of migrations) {
      if (!insertsIntoAuthUsers(m.content)) continue;
      if (m.content.includes(EXEMPTION_MARKER)) continue;
      if (insertsIntoAuthIdentities(m.content)) continue;

      // Allow UPDATE-only "fix" migrations (e.g. the S156 corrective migration
      // updates the existing row's tokens and inserts the missing identities row).
      // These do not insert a NEW user, so the rule is satisfied as long as
      // they touch BOTH tables. The check above already requires the
      // identities insert; this branch is just documentation.
      violations.push(
        `  - ${m.name}: inserts into auth.users but not auth.identities`,
      );
    }

    if (violations.length > 0) {
      throw new Error(
        `S156 guard failure — migrations with INSERT INTO auth.users must ` +
          `also INSERT INTO auth.identities. Without the identities row, ` +
          `GoTrue's getUserById and password-reset flows degrade silently.\n\n` +
          `Violations:\n${violations.join('\n')}\n\n` +
          `Reference shape: supabase/migrations/20260406180000_create_pipeline_service_account.sql`,
      );
    }
  });

  it('exemptions are surfaced for code review (informational)', () => {
    const exemptions = migrations.filter((m) =>
      m.content.includes(EXEMPTION_MARKER),
    );
    if (exemptions.length > 0) {
      // Not a failure — just print so reviewers see them.
      // eslint-disable-next-line no-console
      console.log(
        `\nS156 guard: ${exemptions.length} migration(s) marked S156-GUARD-EXEMPT:\n` +
          exemptions.map((e) => `  - ${e.name}`).join('\n'),
      );
    }
    expect(exemptions.length).toBeLessThanOrEqual(5); // Hard ceiling — if we ever
    // accumulate >5 exemptions, the rule has become useless and we should
    // reconsider the design.
  });

  it('the canonical reference migration passes its own guard', () => {
    // Sanity check: 20260406180000_create_pipeline_service_account.sql is the
    // canonical "correct" shape. If it ever fails this guard, the test itself
    // is broken (or the migration was reverted).
    const canonical = migrations.find(
      (m) => m.name === '20260406180000_create_pipeline_service_account.sql',
    );
    expect(canonical, 'canonical reference migration must exist').toBeDefined();
    if (!canonical) return;

    expect(insertsIntoAuthUsers(canonical.content)).toBe(true);
    expect(insertsIntoAuthIdentities(canonical.content)).toBe(true);
    for (const col of REQUIRED_TOKEN_COLUMNS) {
      expect(
        mentionsTokenColumn(canonical.content, col),
        `canonical migration must mention ${col}`,
      ).toBe(true);
    }
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import { ESLint } from 'eslint';

/**
 * Scope guard for `local/no-unchecked-supabase-error`.
 *
 * The rule's LOGIC is covered by `no-unchecked-supabase-error.test.ts`
 * (RuleTester). What that file cannot see is which files the rule is actually
 * pointed at — that lives in `eslint.config.mjs`, and a scope regression is
 * silent: the rule keeps passing its own tests while the surface it guards
 * quietly shrinks.
 *
 * id-369 {369.4} (RC-3) extended the surface to `hooks/**` and
 * `components/**`, which is where 2 of the sweep's 10 findings lived
 * (F2 `use-user-role`, F9 `content-owner-management`). `scripts/**` is
 * deliberately OUT per id-369's own rationale.
 */

const RULE = 'local/no-unchecked-supabase-error';

/** `calculateConfigForFile` normalises severity to ESLint's numeric form. */
const ERROR = 2;

/**
 * Resolving the flat config is expensive (it imports every plugin), so the
 * instance is built once and shared — a per-case instance times out under
 * full-suite parallel load.
 */
let eslint: ESLint;

async function severityFor(filePath: string): Promise<unknown> {
  const config = (await eslint.calculateConfigForFile(filePath)) as {
    rules?: Record<string, unknown[]>;
  };
  const entry = config.rules?.[RULE];
  return entry ? entry[0] : undefined;
}

beforeAll(async () => {
  eslint = new ESLint({ cwd: process.cwd() });
  // Warm the config cache so the first assertion is not the one paying for it.
  await eslint.calculateConfigForFile('lib/notifications.ts');
}, 60_000);

describe('no-unchecked-supabase-error — configured scope', () => {
  it.each([
    'hooks/use-user-role.ts',
    'hooks/use-batch-create.ts',
    'components/settings/content-owner-management.tsx',
    'components/settings/governance-section.tsx',
    'app/api/review/action/route.ts',
    'lib/notifications.ts',
  ])('guards %s at error severity', async (file) => {
    expect(await severityFor(file)).toBe(ERROR);
  });

  it.each(['scripts/mcp-eval/functional-correctness.ts', 'lib/supabase/safe.ts'])(
    'leaves %s unguarded (deliberate carve-out)',
    async (file) => {
      expect(await severityFor(file)).toBeUndefined();
    },
  );
});

import { describe, it, expect } from 'vitest';
import {
  stripCommentsAndDollarStrings,
  extractCreateFunctions,
  extractRevokes,
  matchRevokeForCreate,
  normaliseSignature,
  extractTypesOnly,
  isAllowListed,
  validateAllowList,
  formatCreateSignature,
  INTENTIONAL_ANON_ALLOW_LIST,
  type CreateFunctionRecord,
  type RevokeRecord,
} from '@/scripts/check-revoke-guard';

// ── stripCommentsAndDollarStrings — pre-regex sanitisation ────────────────

describe('stripCommentsAndDollarStrings', () => {
  it('removes single-line -- comments', () => {
    const input = `-- This is a comment
SELECT 1;`;
    const out = stripCommentsAndDollarStrings(input);
    expect(out).not.toContain('This is a comment');
    expect(out).toContain('SELECT 1;');
  });

  it('removes /* ... */ block comments (single line)', () => {
    const input = `/* block comment */
SELECT 1;`;
    const out = stripCommentsAndDollarStrings(input);
    expect(out).not.toContain('block comment');
    expect(out).toContain('SELECT 1;');
  });

  it('removes /* ... */ block comments spanning multiple lines', () => {
    const input = `/* multi-line
   block comment with CREATE FUNCTION public.foo
   inside */
SELECT 1;`;
    const out = stripCommentsAndDollarStrings(input);
    expect(out).not.toContain('multi-line');
    expect(out).not.toContain('CREATE FUNCTION');
    expect(out).toContain('SELECT 1;');
  });

  it('removes $$ ... $$ dollar-quoted strings (CREATE FUNCTION inside body)', () => {
    const input = `CREATE FUNCTION public.outer()
RETURNS void AS $$
BEGIN
  EXECUTE format('CREATE FUNCTION public.inner_fn(text) RETURNS text AS \\$body\\$ SELECT 1 \\$body\\$ LANGUAGE sql');
END;
$$ LANGUAGE plpgsql;`;
    const out = stripCommentsAndDollarStrings(input);
    // Only the outer prologue should remain visible to the regex
    expect(out).toContain('CREATE FUNCTION public.outer');
    expect(out).not.toContain('inner_fn');
  });

  it('removes $tag$ ... $tag$ tagged dollar-quoted strings', () => {
    const input = `CREATE FUNCTION public.outer()
RETURNS void AS $body$
BEGIN
  -- CREATE FUNCTION public.bogus() should be ignored
  RAISE NOTICE 'CREATE FUNCTION public.also_bogus()';
END;
$body$ LANGUAGE plpgsql;`;
    const out = stripCommentsAndDollarStrings(input);
    expect(out).toContain('CREATE FUNCTION public.outer');
    expect(out).not.toContain('bogus');
    expect(out).not.toContain('also_bogus');
  });

  it('preserves SQL outside comments and dollar-strings', () => {
    const input = `CREATE FUNCTION public.foo() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;
REVOKE EXECUTE ON FUNCTION public.foo() FROM PUBLIC, anon;`;
    const out = stripCommentsAndDollarStrings(input);
    expect(out).toContain('CREATE FUNCTION public.foo');
    expect(out).toContain('REVOKE EXECUTE ON FUNCTION public.foo()');
    expect(out).toContain('FROM PUBLIC, anon');
  });
});

// ── extractCreateFunctions — paren-balanced parser ────────────────────────

describe('extractCreateFunctions (parser, §2.3 + §2.4)', () => {
  it('extracts a simple CREATE FUNCTION with one arg', () => {
    const input = `CREATE FUNCTION public.foo(bar text) RETURNS text AS $$ SELECT $1 $$ LANGUAGE sql;`;
    const out = extractCreateFunctions(input);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      name: 'foo',
      isQuoted: false,
      args: 'bar text',
    });
  });

  it('extracts CREATE OR REPLACE FUNCTION (§2.4 row 2)', () => {
    const input = `CREATE OR REPLACE FUNCTION public.bar() RETURNS void AS $$ SELECT 1 $$ LANGUAGE sql;`;
    const out = extractCreateFunctions(input);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'bar', args: '' });
  });

  it('handles multi-line CREATE FUNCTION definitions (§2.4 row 1)', () => {
    const input = `CREATE FUNCTION public.multi(
  p_x integer,
  p_y text
) RETURNS void AS $$ SELECT 1 $$ LANGUAGE sql;`;
    const out = extractCreateFunctions(input);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('multi');
    // Whitespace-collapsed signature comparison (so trailing newline tolerated)
    expect(out[0].args.replace(/\s+/g, ' ').trim()).toBe(
      'p_x integer, p_y text',
    );
  });

  it('handles nested types like numeric(10, 2) — paren-balancer requirement (§2.3)', () => {
    const input = `CREATE FUNCTION public.calc(amount numeric(10, 2), rate numeric(5, 4)) RETURNS numeric AS $$ SELECT amount * rate $$ LANGUAGE sql;`;
    const out = extractCreateFunctions(input);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('calc');
    expect(out[0].args).toContain('numeric(10, 2)');
    expect(out[0].args).toContain('numeric(5, 4)');
  });

  it('handles default expressions with nested parens (§2.4 row 6)', () => {
    const input = `CREATE FUNCTION public.with_defaults(p_a integer DEFAULT coalesce(0, 1), p_b text DEFAULT 'x') RETURNS void AS $$ SELECT 1 $$ LANGUAGE sql;`;
    const out = extractCreateFunctions(input);
    expect(out).toHaveLength(1);
    expect(out[0].args).toContain('coalesce(0, 1)');
    expect(out[0].args).toContain('p_b text');
  });

  it('handles SECURITY DEFINER functions (§2.4 row 3)', () => {
    const input = `CREATE OR REPLACE FUNCTION public.secdef_fn(p text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$ BEGIN RETURN p; END; $$;`;
    const out = extractCreateFunctions(input);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('secdef_fn');
  });

  it('handles quoted identifiers like public."Foo" (§2.4 row 4)', () => {
    const input = `CREATE FUNCTION public."Foo"(p text) RETURNS text AS $$ SELECT $1 $$ LANGUAGE sql;`;
    const out = extractCreateFunctions(input);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Foo');
    expect(out[0].isQuoted).toBe(true);
  });

  it('handles zero-arg functions (§2.4 row 5)', () => {
    const input = `CREATE FUNCTION public.empty_args() RETURNS void AS $$ SELECT 1 $$ LANGUAGE sql;`;
    const out = extractCreateFunctions(input);
    expect(out).toHaveLength(1);
    expect(out[0].args).toBe('');
  });

  it('captures formal parameters only and ignores RETURNS TABLE body (§2.4 row 7)', () => {
    const input = `CREATE FUNCTION public.tbl_fn(p_in text)
RETURNS TABLE (id uuid, label text)
AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid, $1 $$ LANGUAGE sql;`;
    const out = extractCreateFunctions(input);
    expect(out).toHaveLength(1);
    expect(out[0].args.trim()).toBe('p_in text');
  });

  it('does NOT match DROP FUNCTION (§2.4 row 8)', () => {
    const input = `DROP FUNCTION public.foo(text) CASCADE;`;
    const out = extractCreateFunctions(input);
    expect(out).toHaveLength(0);
  });

  it('extracts multiple CREATE FUNCTION statements in one file', () => {
    const input = `CREATE FUNCTION public.fn_a() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION public.fn_b(x text) RETURNS text AS $$ SELECT $1 $$ LANGUAGE sql;
CREATE FUNCTION public.fn_c(p_a int, p_b int) RETURNS int AS $$ SELECT $1 + $2 $$ LANGUAGE sql;`;
    const out = extractCreateFunctions(input);
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.name)).toEqual(['fn_a', 'fn_b', 'fn_c']);
  });

  it('strips comments before extraction (§2.4 row 10)', () => {
    const input = `-- CREATE FUNCTION public.commented_out(text) RETURNS text — should NOT match
/* CREATE FUNCTION public.also_commented() */
CREATE FUNCTION public.real_fn() RETURNS void AS $$ SELECT 1 $$ LANGUAGE sql;`;
    const out = extractCreateFunctions(input);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('real_fn');
  });

  it('strips dollar-quoted strings before extraction (§2.4 row 11)', () => {
    const input = `CREATE FUNCTION public.outer_fn() RETURNS void AS $body$
BEGIN
  EXECUTE 'CREATE FUNCTION public.inner_string_fn() RETURNS void AS $$ SELECT 1 $$ LANGUAGE sql';
END;
$body$ LANGUAGE plpgsql;`;
    const out = extractCreateFunctions(input);
    // outer_fn matches; inner_string_fn ignored because dollar-string body stripped
    expect(out.map((r) => r.name)).toEqual(['outer_fn']);
  });

  it('does not match functions in non-public schemas (D-OPS-43.3-7)', () => {
    const input = `CREATE FUNCTION auth.foo() RETURNS void AS $$ SELECT 1 $$ LANGUAGE sql;
CREATE FUNCTION extensions.bar() RETURNS void AS $$ SELECT 1 $$ LANGUAGE sql;`;
    const out = extractCreateFunctions(input);
    expect(out).toHaveLength(0);
  });

  it('captures the line number of the CREATE statement', () => {
    const input = `-- Line 1 (comment, gets blanked but line number preserved)
-- Line 2
CREATE FUNCTION public.line_test() RETURNS void AS $$ SELECT 1 $$ LANGUAGE sql;`;
    const out = extractCreateFunctions(input);
    expect(out).toHaveLength(1);
    expect(out[0].line).toBe(3);
  });
});

// ── extractRevokes — REVOKE statement parser ──────────────────────────────

describe('extractRevokes (matcher input)', () => {
  it('extracts REVOKE EXECUTE FROM anon', () => {
    const input = `REVOKE EXECUTE ON FUNCTION public.foo(text) FROM anon;`;
    const out = extractRevokes(input);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'foo', grantees: ['anon'] });
  });

  it('extracts REVOKE EXECUTE FROM PUBLIC, anon', () => {
    const input = `REVOKE EXECUTE ON FUNCTION public.foo(text) FROM PUBLIC, anon;`;
    const out = extractRevokes(input);
    expect(out).toHaveLength(1);
    expect(out[0].grantees.sort()).toEqual(['PUBLIC', 'anon'].sort());
  });

  it('extracts REVOKE EXECUTE FROM PUBLIC, anon, authenticated', () => {
    const input = `REVOKE EXECUTE ON FUNCTION public.foo() FROM PUBLIC, anon, authenticated;`;
    const out = extractRevokes(input);
    expect(out).toHaveLength(1);
    expect(out[0].grantees).toContain('anon');
    expect(out[0].grantees).toContain('PUBLIC');
    expect(out[0].grantees).toContain('authenticated');
  });

  it('extracts REVOKE inside a DO $$ ... $$ block', () => {
    const input = `DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.foo(text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;`;
    // Note: dollar-string stripping removes the DO body, so we must extract
    // REVOKEs BEFORE stripping. The script does this by scanning the raw
    // text for REVOKE separately from the comment-stripped CREATE pass.
    const out = extractRevokes(input);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('foo');
  });

  it('handles nested-paren args in REVOKE', () => {
    const input = `REVOKE EXECUTE ON FUNCTION public.calc(amount numeric(10, 2), rate numeric(5, 4)) FROM PUBLIC, anon;`;
    const out = extractRevokes(input);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('calc');
    expect(out[0].args).toContain('numeric(10, 2)');
  });

  it('handles quoted identifiers in REVOKE', () => {
    const input = `REVOKE EXECUTE ON FUNCTION public."Foo"() FROM anon;`;
    const out = extractRevokes(input);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Foo');
    expect(out[0].isQuoted).toBe(true);
  });

  it('extracts multiple REVOKE statements', () => {
    const input = `REVOKE EXECUTE ON FUNCTION public.fn_a() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_b(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_c() FROM PUBLIC, anon, authenticated;`;
    const out = extractRevokes(input);
    expect(out).toHaveLength(3);
  });
});

// ── matchRevokeForCreate — pairing logic ─────────────────────────────────

describe('matchRevokeForCreate (matcher, §2.3)', () => {
  it('returns true when a matching REVOKE exists with anon grantee', () => {
    const create: CreateFunctionRecord = {
      name: 'foo',
      isQuoted: false,
      args: 'bar text',
      line: 1,
    };
    const revokes: RevokeRecord[] = [
      {
        name: 'foo',
        isQuoted: false,
        args: 'bar text',
        grantees: ['PUBLIC', 'anon'],
        line: 5,
      },
    ];
    expect(matchRevokeForCreate(create, revokes)).toBe(true);
  });

  it('returns true when REVOKE has only anon (FROM anon)', () => {
    const create: CreateFunctionRecord = {
      name: 'foo',
      isQuoted: false,
      args: '',
      line: 1,
    };
    const revokes: RevokeRecord[] = [
      { name: 'foo', isQuoted: false, args: '', grantees: ['anon'], line: 5 },
    ];
    expect(matchRevokeForCreate(create, revokes)).toBe(true);
  });

  it('returns false when no REVOKE exists', () => {
    const create: CreateFunctionRecord = {
      name: 'foo',
      isQuoted: false,
      args: 'bar text',
      line: 1,
    };
    expect(matchRevokeForCreate(create, [])).toBe(false);
  });

  it('returns false when REVOKE exists but anon is not in grantee list', () => {
    const create: CreateFunctionRecord = {
      name: 'foo',
      isQuoted: false,
      args: '',
      line: 1,
    };
    const revokes: RevokeRecord[] = [
      {
        name: 'foo',
        isQuoted: false,
        args: '',
        grantees: ['PUBLIC', 'authenticated'],
        line: 5,
      },
    ];
    expect(matchRevokeForCreate(create, revokes)).toBe(false);
  });

  it('matches by signature-normalised args (whitespace tolerant)', () => {
    const create: CreateFunctionRecord = {
      name: 'foo',
      isQuoted: false,
      args: 'p_x integer,\n  p_y text',
      line: 1,
    };
    const revokes: RevokeRecord[] = [
      {
        name: 'foo',
        isQuoted: false,
        args: 'p_x integer, p_y text',
        grantees: ['PUBLIC', 'anon'],
        line: 5,
      },
    ];
    expect(matchRevokeForCreate(create, revokes)).toBe(true);
  });

  it('matches case-insensitively on bare identifiers', () => {
    const create: CreateFunctionRecord = {
      name: 'My_Fn',
      isQuoted: false,
      args: '',
      line: 1,
    };
    const revokes: RevokeRecord[] = [
      {
        name: 'my_fn',
        isQuoted: false,
        args: '',
        grantees: ['anon'],
        line: 5,
      },
    ];
    expect(matchRevokeForCreate(create, revokes)).toBe(true);
  });

  it('matches case-sensitively on quoted identifiers', () => {
    const create: CreateFunctionRecord = {
      name: 'Foo',
      isQuoted: true,
      args: '',
      line: 1,
    };
    const revokesMatch: RevokeRecord[] = [
      { name: 'Foo', isQuoted: true, args: '', grantees: ['anon'], line: 5 },
    ];
    const revokesMismatch: RevokeRecord[] = [
      { name: 'foo', isQuoted: true, args: '', grantees: ['anon'], line: 5 },
    ];
    expect(matchRevokeForCreate(create, revokesMatch)).toBe(true);
    expect(matchRevokeForCreate(create, revokesMismatch)).toBe(false);
  });

  it('matches when nested-paren args are present in both CREATE and REVOKE', () => {
    const create: CreateFunctionRecord = {
      name: 'calc',
      isQuoted: false,
      args: 'amount numeric(10, 2)',
      line: 1,
    };
    const revokes: RevokeRecord[] = [
      {
        name: 'calc',
        isQuoted: false,
        args: 'amount numeric(10, 2)',
        grantees: ['PUBLIC', 'anon'],
        line: 5,
      },
    ];
    expect(matchRevokeForCreate(create, revokes)).toBe(true);
  });

  it('matches when REVOKE uses types-only signature (e.g. uuid, uuid)', () => {
    // Real-world OPS-43 pattern from migration
    // 20260429225246_extend_resolve_near_dup_confirm_unique_audit.sql:
    // CREATE has named args (`p_left_id uuid, ...`); REVOKE has
    // types-only (`uuid, uuid, ...`). PG considers these equivalent.
    const create: CreateFunctionRecord = {
      name: 'resolve_near_dup_confirm_unique',
      isQuoted: false,
      args: 'p_left_id uuid, p_right_id uuid, p_actor_user_id uuid, p_pair_id text, p_note text DEFAULT NULL, p_similarity_at_resolution numeric DEFAULT NULL, p_threshold_at_resolution numeric DEFAULT NULL',
      line: 1,
    };
    const revokes: RevokeRecord[] = [
      {
        name: 'resolve_near_dup_confirm_unique',
        isQuoted: false,
        args: 'uuid, uuid, uuid, text, text, numeric, numeric',
        grantees: ['anon'],
        line: 99,
      },
    ];
    expect(matchRevokeForCreate(create, revokes)).toBe(true);
  });

  it('matches types-only with multi-word PG types (double precision)', () => {
    const create: CreateFunctionRecord = {
      name: 'distance',
      isQuoted: false,
      args: 'p_x double precision, p_y double precision',
      line: 1,
    };
    const revokes: RevokeRecord[] = [
      {
        name: 'distance',
        isQuoted: false,
        args: 'double precision, double precision',
        grantees: ['anon'],
        line: 5,
      },
    ];
    expect(matchRevokeForCreate(create, revokes)).toBe(true);
  });
});

// ── extractTypesOnly ──────────────────────────────────────────────────────

describe('extractTypesOnly', () => {
  it('returns empty string for empty input', () => {
    expect(extractTypesOnly('')).toBe('');
    expect(extractTypesOnly('   ')).toBe('');
  });

  it('strips named parameters from each arg', () => {
    expect(extractTypesOnly('p_x integer, p_y text')).toBe('integer, text');
  });

  it('preserves nested-paren types (numeric(10, 2))', () => {
    expect(extractTypesOnly('amount numeric(10, 2), rate numeric(5, 4)')).toBe(
      'numeric(10, 2), numeric(5, 4)',
    );
  });

  it('strips DEFAULT clauses', () => {
    expect(
      extractTypesOnly('p_x integer DEFAULT 0, p_y text DEFAULT NULL'),
    ).toBe('integer, text');
  });

  it('strips IN/OUT/INOUT/VARIADIC mode keywords', () => {
    expect(extractTypesOnly('IN p_x integer, OUT p_y text')).toBe(
      'integer, text',
    );
    expect(extractTypesOnly('VARIADIC p_args text[]')).toBe('text[]');
  });

  it('handles multi-word types like double precision', () => {
    expect(extractTypesOnly('p_x double precision, p_y double precision')).toBe(
      'double precision, double precision',
    );
  });

  it('handles types-only input as a no-op', () => {
    expect(extractTypesOnly('integer, text, uuid')).toBe('integer, text, uuid');
  });

  it('handles single-arg types-only', () => {
    expect(extractTypesOnly('uuid')).toBe('uuid');
  });
});

// ── normaliseSignature ────────────────────────────────────────────────────

describe('normaliseSignature', () => {
  it('collapses internal whitespace', () => {
    expect(normaliseSignature('p_x   integer,\n   p_y   text')).toBe(
      'p_x integer, p_y text',
    );
  });

  it('trims leading/trailing whitespace', () => {
    expect(normaliseSignature('  bar text  ')).toBe('bar text');
  });

  it('returns empty string for empty input', () => {
    expect(normaliseSignature('')).toBe('');
    expect(normaliseSignature('   ')).toBe('');
  });

  it('case-folds keywords like IN/OUT/INOUT', () => {
    expect(normaliseSignature('IN p_x integer, OUT p_y text')).toBe(
      'in p_x integer, out p_y text',
    );
  });
});

// ── isAllowListed ─────────────────────────────────────────────────────────

describe('isAllowListed (AC-3)', () => {
  it('returns true for the canonical set_config signature', () => {
    const create: CreateFunctionRecord = {
      name: 'set_config',
      isQuoted: false,
      args: 'setting text, value text, is_local boolean',
      line: 1,
    };
    expect(isAllowListed(create)).toBe(true);
  });

  it('returns false for non-allow-listed functions', () => {
    const create: CreateFunctionRecord = {
      name: 'foo',
      isQuoted: false,
      args: '',
      line: 1,
    };
    expect(isAllowListed(create)).toBe(false);
  });

  it('returns true even when args have whitespace differences', () => {
    const create: CreateFunctionRecord = {
      name: 'set_config',
      isQuoted: false,
      args: 'setting text,   value text,\n  is_local boolean',
      line: 1,
    };
    expect(isAllowListed(create)).toBe(true);
  });
});

// ── validateAllowList — anti-pattern guard (AC-10) ────────────────────────

describe('validateAllowList (AC-10, §2.5 anti-pattern guard)', () => {
  it('passes for the canonical INTENTIONAL_ANON_ALLOW_LIST', () => {
    expect(() => validateAllowList(INTENTIONAL_ANON_ALLOW_LIST)).not.toThrow();
  });

  it('throws when an entry has rationale shorter than 40 chars (AC-10)', () => {
    const bogus = [
      {
        signature: 'public.foo()',
        rationale: 'TODO',
        added_session: 'kh-prod-readiness-S99',
      },
    ];
    expect(() => validateAllowList(bogus)).toThrow(/rationale/i);
    expect(() => validateAllowList(bogus)).toThrow(/foo/);
  });

  it('throws when rationale is exactly 39 chars (boundary)', () => {
    const justUnder = [
      {
        signature: 'public.bar()',
        // 39 chars exactly
        rationale: 'a'.repeat(39),
        added_session: 'kh-prod-readiness-S99',
      },
    ];
    expect(() => validateAllowList(justUnder)).toThrow(/rationale/i);
  });

  it('passes when rationale is 40 chars (boundary)', () => {
    const ok = [
      {
        signature: 'public.bar()',
        rationale: 'a'.repeat(40),
        added_session: 'kh-prod-readiness-S99',
      },
    ];
    expect(() => validateAllowList(ok)).not.toThrow();
  });

  it('throws when rationale contains the placeholder string TODO', () => {
    const bogus = [
      {
        signature: 'public.baz()',
        rationale:
          'TODO write a real rationale once the public-search RPC ships.',
        added_session: 'kh-prod-readiness-S99',
      },
    ];
    expect(() => validateAllowList(bogus)).toThrow(/TODO|placeholder/i);
  });

  it('throws when added_session is missing or empty', () => {
    const bogus = [
      {
        signature: 'public.qux()',
        rationale:
          'A perfectly valid rationale that is well over forty characters long.',
        added_session: '',
      },
    ];
    expect(() => validateAllowList(bogus)).toThrow(/added_session/i);
  });
});

// ── INTENTIONAL_ANON_ALLOW_LIST — canonical content check ────────────────

describe('INTENTIONAL_ANON_ALLOW_LIST', () => {
  it('contains exactly one entry today (set_config)', () => {
    expect(INTENTIONAL_ANON_ALLOW_LIST).toHaveLength(1);
    expect(INTENTIONAL_ANON_ALLOW_LIST[0].signature).toBe(
      'public.set_config(setting text, value text, is_local boolean)',
    );
  });

  it('rationale references PostgREST + RLS use-case', () => {
    const r = INTENTIONAL_ANON_ALLOW_LIST[0].rationale;
    expect(r.length).toBeGreaterThanOrEqual(40);
    expect(r).toMatch(/PostgREST|RLS|anon/i);
  });
});

// ── formatCreateSignature (formatter for ::error:: annotations) ──────────

describe('formatCreateSignature', () => {
  it('emits public.name(args) for bare identifiers', () => {
    expect(
      formatCreateSignature({
        name: 'foo',
        isQuoted: false,
        args: 'bar text',
        line: 1,
      }),
    ).toBe('public.foo(bar text)');
  });

  it('emits public."Name"(args) for quoted identifiers', () => {
    expect(
      formatCreateSignature({
        name: 'Foo',
        isQuoted: true,
        args: '',
        line: 1,
      }),
    ).toBe('public."Foo"()');
  });
});

// ── End-to-end synthetic-fixture flow (AC-1 + AC-3 + AC-5) ───────────────

describe('end-to-end fixture flow (AC-1, AC-3, AC-5)', () => {
  it('AC-1 — synthetic fixture missing REVOKE produces a missing-REVOKE finding', () => {
    const fixture = `CREATE FUNCTION public.foo(bar text) RETURNS text AS $$ SELECT $1 $$ LANGUAGE sql;`;
    const stripped = stripCommentsAndDollarStrings(fixture);
    const creates = extractCreateFunctions(stripped);
    const revokes = extractRevokes(fixture);
    expect(creates).toHaveLength(1);
    expect(matchRevokeForCreate(creates[0], revokes)).toBe(false);
    expect(isAllowListed(creates[0])).toBe(false);
  });

  it('AC-3 — set_config CREATE without REVOKE is allow-listed (notice, not error)', () => {
    const fixture = `CREATE FUNCTION public.set_config(setting text, value text, is_local boolean) RETURNS text AS $$ SELECT value $$ LANGUAGE sql;
GRANT EXECUTE ON FUNCTION public.set_config(setting text, value text, is_local boolean) TO anon;`;
    const stripped = stripCommentsAndDollarStrings(fixture);
    const creates = extractCreateFunctions(stripped);
    const revokes = extractRevokes(fixture);
    expect(creates).toHaveLength(1);
    expect(matchRevokeForCreate(creates[0], revokes)).toBe(false);
    // But allow-listed → emit notice not error
    expect(isAllowListed(creates[0])).toBe(true);
  });

  it('positive case — CREATE + matching REVOKE in same file passes', () => {
    const fixture = `CREATE FUNCTION public.foo(bar text) RETURNS text AS $$ SELECT $1 $$ LANGUAGE sql;
REVOKE EXECUTE ON FUNCTION public.foo(bar text) FROM PUBLIC, anon;`;
    const stripped = stripCommentsAndDollarStrings(fixture);
    const creates = extractCreateFunctions(stripped);
    const revokes = extractRevokes(fixture);
    expect(matchRevokeForCreate(creates[0], revokes)).toBe(true);
  });

  it('AC-5 — idempotent: parser + matcher yield identical output across two runs', () => {
    const fixture = `CREATE FUNCTION public.fn_a() RETURNS void AS $$ SELECT 1 $$ LANGUAGE sql;
CREATE FUNCTION public.fn_b(x text) RETURNS text AS $$ SELECT $1 $$ LANGUAGE sql;
REVOKE EXECUTE ON FUNCTION public.fn_b(x text) FROM PUBLIC, anon;`;
    const run1 = extractCreateFunctions(stripCommentsAndDollarStrings(fixture));
    const run2 = extractCreateFunctions(stripCommentsAndDollarStrings(fixture));
    expect(run1).toEqual(run2);
    const revokes1 = extractRevokes(fixture);
    const revokes2 = extractRevokes(fixture);
    expect(revokes1).toEqual(revokes2);
    // Findings ordering is deterministic (input order preserved)
    expect(run1.map((c) => c.name)).toEqual(['fn_a', 'fn_b']);
  });

  it('CREATE OR REPLACE of pre-existing function still requires REVOKE in the same file (§2.4 row 9)', () => {
    const fixture = `CREATE OR REPLACE FUNCTION public.foo() RETURNS void AS $$ SELECT 1 $$ LANGUAGE sql;`;
    const stripped = stripCommentsAndDollarStrings(fixture);
    const creates = extractCreateFunctions(stripped);
    const revokes = extractRevokes(fixture);
    expect(matchRevokeForCreate(creates[0], revokes)).toBe(false);
  });

  it('handles real-world OPS-43-style trigger-function migration (REVOKE in DO block)', () => {
    const fixture = `CREATE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;`;
    const stripped = stripCommentsAndDollarStrings(fixture);
    const creates = extractCreateFunctions(stripped);
    // REVOKE must be extracted from the RAW fixture (not the dollar-stripped
    // version), otherwise REVOKEs inside DO blocks are lost.
    const revokes = extractRevokes(fixture);
    expect(creates).toHaveLength(1);
    expect(matchRevokeForCreate(creates[0], revokes)).toBe(true);
  });
});

/**
 * Squash-seed-preservation guard (ID-130.19).
 *
 * The 20260617130000 squash folded several pre-squash seed migrations into
 * DDL-only CREATE TABLE statements, silently DROPPING their INSERT VALUES
 * (a fresh/reset DB gets the table shape but not its core rows). Four CV
 * tables have been re-homed into `supabase/seed.sql` to close that gap —
 * application_types and form_types (§2·0/§2·0b), then procurement_vehicles
 * and procurement_vehicle_instances (§2·0c/§2·0d, ID-130.19).
 *
 * There is no local Docker/Supabase stack available to run `supabase db
 * reset` and assert the live tables directly in this environment, so this
 * guard is a static-parse proxy: it reads the committed `seed.sql` text and
 * asserts each known squash-victim table's INSERT VALUES clause still
 * contains its full expected core-row key set. This fails loudly if a
 * future edit to seed.sql (accidental trim, merge conflict, refactor)
 * silently drops rows again — the same failure mode the squash produced,
 * just re-triggered in a file no squash can touch.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SEED_PATH = join(__dirname, '../../supabase/seed.sql');
const seedSql = readFileSync(SEED_PATH, 'utf8');

/**
 * Splits SQL text into the top-level parenthesised groups it contains,
 * treating characters inside single-quoted string literals as opaque (so a
 * label like `'DOS (Digital Outcomes and Specialists)'` doesn't confuse
 * paren-depth tracking). Returns each group's inner text, in order — for an
 * INSERT statement that's [columnList, tuple1, tuple2, ...].
 */
function extractTopLevelGroups(text: string): string[] {
  const groups: string[] = [];
  let depth = 0;
  let inQuote = false;
  let current = '';
  for (const ch of text) {
    if (inQuote) {
      if (depth > 0) current += ch;
      if (ch === "'") inQuote = false;
      continue;
    }
    if (ch === "'") {
      inQuote = true;
      if (depth > 0) current += ch;
      continue;
    }
    if (ch === '(') {
      depth++;
      if (depth > 1) current += ch;
      continue;
    }
    if (ch === ')') {
      depth--;
      if (depth === 0) {
        groups.push(current);
        current = '';
      } else {
        current += ch;
      }
      continue;
    }
    if (depth > 0) current += ch;
  }
  return groups;
}

/**
 * Splits one VALUES tuple's inner text into its comma-separated fields,
 * treating quoted strings as opaque and `[...]` (ARRAY[...] literals) as a
 * single field even when it contains commas.
 */
function splitTopLevelFields(text: string): string[] {
  const fields: string[] = [];
  let current = '';
  let depth = 0;
  let inQuote = false;
  for (const ch of text) {
    if (inQuote) {
      current += ch;
      if (ch === "'") inQuote = false;
      continue;
    }
    if (ch === "'") {
      inQuote = true;
      current += ch;
      continue;
    }
    if (ch === '[' || ch === '(') {
      depth++;
      current += ch;
      continue;
    }
    if (ch === ']' || ch === ')') {
      depth--;
      current += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      fields.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  fields.push(current.trim());
  return fields;
}

function unquote(value: string): string {
  const match = value.match(/^'([\s\S]*)'$/);
  return match ? match[1] : value;
}

/** Returns the ordered list of values for `keyColumn` across every VALUES
 * tuple of `INSERT INTO public.<tableName>` in seed.sql. */
function extractColumnValues(tableName: string, keyColumn: string): string[] {
  const marker = `INSERT INTO public.${tableName}`;
  const start = seedSql.indexOf(marker);
  expect(start, `${marker} not found in supabase/seed.sql`).toBeGreaterThan(-1);
  const semiIdx = seedSql.indexOf(';', start);
  expect(
    semiIdx,
    `no terminating ';' found for the ${tableName} INSERT`,
  ).toBeGreaterThan(-1);
  const stmt = seedSql.slice(start, semiIdx);

  const valuesIdx = stmt.search(/\bVALUES\b/i);
  expect(valuesIdx, `no VALUES keyword found for ${tableName}`).toBeGreaterThan(
    -1,
  );

  const columnGroups = extractTopLevelGroups(stmt.slice(0, valuesIdx));
  expect(
    columnGroups.length,
    `could not parse the column list for ${tableName}`,
  ).toBe(1);
  const columns = columnGroups[0].split(',').map((c) => c.trim());
  const columnIdx = columns.indexOf(keyColumn);
  expect(
    columnIdx,
    `${tableName} INSERT has no '${keyColumn}' column`,
  ).toBeGreaterThanOrEqual(0);

  const onConflictIdx = stmt.search(/\bON CONFLICT\b/i);
  const tuplesSection = stmt.slice(
    valuesIdx,
    onConflictIdx === -1 ? stmt.length : onConflictIdx,
  );
  const tuples = extractTopLevelGroups(tuplesSection).map((g) =>
    splitTopLevelFields(g),
  );
  expect(
    tuples.length,
    `no VALUES tuples parsed for ${tableName}`,
  ).toBeGreaterThan(0);

  return tuples.map((fields) => unquote(fields[columnIdx]));
}

describe('squash-seed-preservation guard (ID-130.19)', () => {
  const knownSquashVictims: Array<{ table: string; expectedKeys: string[] }> = [
    {
      table: 'application_types',
      expectedKeys: [
        'procurement',
        'intelligence',
        'sales_proposal',
        'product_guide',
        'competitor_research',
        'training_onboarding',
      ],
    },
    {
      table: 'form_types',
      expectedKeys: [
        'bid',
        'rfp',
        'psq',
        'itt',
        'tender',
        'checklist',
        'questionnaire',
        'sales_proposal_template',
      ],
    },
    {
      table: 'procurement_vehicles',
      expectedKeys: ['framework', 'dps', 'dynamic_procurement'],
    },
    {
      table: 'procurement_vehicle_instances',
      expectedKeys: ['g_cloud', 'dos'],
    },
  ];

  it.each(knownSquashVictims)(
    'seed.sql re-homes the full $table core seed (squash-fidelity gap)',
    ({ table, expectedKeys }) => {
      const keys = extractColumnValues(table, 'key');
      const missing = expectedKeys.filter((k) => !keys.includes(k));

      expect(
        missing,
        `${table} is missing seed rows for: ${missing.join(', ')} — ` +
          `a squash or a seed.sql edit dropped INSERTs. See seed.sql's ` +
          `squash-fidelity-gap comments for the recovery source.`,
      ).toEqual([]);
    },
  );

  it('procurement_vehicle_instances.vehicle_key FKs resolve within seed.sql', () => {
    const vehicleKeys = extractColumnValues('procurement_vehicles', 'key');
    const instanceVehicleKeys = extractColumnValues(
      'procurement_vehicle_instances',
      'vehicle_key',
    );

    const unresolved = instanceVehicleKeys.filter(
      (vk) => !vehicleKeys.includes(vk),
    );
    expect(
      unresolved,
      `procurement_vehicle_instances references vehicle_key(s) not seeded ` +
        `in procurement_vehicles: ${unresolved.join(', ')}`,
    ).toEqual([]);
  });
});

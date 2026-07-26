/**
 * Behaviour tests for scripts/ci/prepare-supabase-ci-config.ts ({365.5} /
 * DR-096): the CI-runner-only transform that flips `enabled = true` to
 * `enabled = false` for the heavyweight local-stack services E2E never needs.
 *
 * The load-bearing behaviours: only the named TOP-LEVEL sections are touched
 * (services E2E depends on — api, db, auth, storage — must survive), nested
 * sections end a target section's scope, and a missing target section is
 * reported rather than silently skipped (that is the exclude-still-pulls
 * regression guard — supabase/cli#4088).
 */

import { describe, expect, it } from 'vitest';
import {
  CI_DISABLED_SERVICES,
  disableServicesInConfig,
} from '@/scripts/ci/prepare-supabase-ci-config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SAMPLE = `
project_id = "canonical"

[api]
enabled = true
port = 54321

[studio]
enabled = true
port = 54323

[storage]
enabled = true
file_size_limit = "50MiB"

[storage.buckets.corpus]
public = false

[realtime]
enabled = true

[edge_runtime]
enabled = true
policy = "per_worker"

[analytics]
enabled = true
port = 54327
`;

describe('disableServicesInConfig', () => {
  it('flips enabled=true to false in every target section and nowhere else', () => {
    const { output, flipped, missing } = disableServicesInConfig(SAMPLE);

    expect(missing).toEqual([]);
    expect(flipped.sort()).toEqual(
      ['analytics', 'edge_runtime', 'realtime', 'studio'].sort(),
    );

    const section = (name: string) =>
      output.split(`[${name}]`)[1]?.split('\n[')[0] ?? '';
    for (const svc of CI_DISABLED_SERVICES) {
      expect(section(svc)).toContain('enabled = false');
    }
    // Services E2E depends on stay enabled.
    expect(section('api')).toContain('enabled = true');
    expect(section('storage')).toContain('enabled = true');
  });

  it('leaves non-enabled keys and section structure untouched', () => {
    const { output } = disableServicesInConfig(SAMPLE);
    expect(output).toContain('port = 54323');
    expect(output).toContain('policy = "per_worker"');
    expect(output).toContain('[storage.buckets.corpus]');
    expect(output).toContain('public = false');
  });

  it('is idempotent — a second pass reports already-disabled, flips nothing', () => {
    const first = disableServicesInConfig(SAMPLE);
    const second = disableServicesInConfig(first.output);
    expect(second.flipped).toEqual([]);
    expect(second.alreadyDisabled.sort()).toEqual(
      ['analytics', 'edge_runtime', 'realtime', 'studio'].sort(),
    );
    expect(second.output).toEqual(first.output);
  });

  it('reports a missing target section instead of silently skipping it', () => {
    const withoutRealtime = SAMPLE.replace('[realtime]\nenabled = true\n', '');
    const { missing } = disableServicesInConfig(withoutRealtime);
    expect(missing).toEqual(['realtime']);
  });

  it('does not treat a nested [x.sub] header as still inside a target section', () => {
    const nested = `
[studio]
enabled = true

[studio.extra]
enabled = true
`;
    const { output } = disableServicesInConfig(nested, ['studio']);
    // Top-level [studio] flips; the nested table's key is out of scope.
    const [, studioBody] = output.split('[studio]');
    expect(studioBody.split('[studio.extra]')[0]).toContain('enabled = false');
    expect(output.split('[studio.extra]')[1]).toContain('enabled = true');
  });

  it('covers every section the REAL supabase/config.toml must keep declaring', () => {
    const real = readFileSync(
      resolve(import.meta.dirname, '../../supabase/config.toml'),
      'utf8',
    );
    const { flipped, alreadyDisabled, missing } = disableServicesInConfig(real);
    // The real file must always carry all four sections — a rename upstream
    // must surface here (and in CI as a loud failure), never as a silent
    // re-enable ({365.5} exclude-still-pulls trap).
    expect(missing).toEqual([]);
    expect([...flipped, ...alreadyDisabled].sort()).toEqual(
      [...CI_DISABLED_SERVICES].sort(),
    );
  });
});

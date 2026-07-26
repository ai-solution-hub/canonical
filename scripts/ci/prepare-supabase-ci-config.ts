#!/usr/bin/env bun
/**
 * scripts/ci/prepare-supabase-ci-config.ts — disable the heavyweight local
 * Supabase services CI E2E lanes never need, by flipping `enabled = true` to
 * `enabled = false` in supabase/config.toml ({365.5} / DR-096 cutover).
 *
 * WHY A CONFIG REWRITE AND NOT `supabase start -x <svc>`: `-x/--exclude` does
 * NOT prevent image pulls — the CLI's one-shot setup jobs gate on config.toml
 * `enabled`, not on the exclude list (supabase/cli#4088) — and an invalid
 * exclude name (e.g. the renamed `inbucket`) warns-and-continues, so a typo
 * silently costs the exclusion. `enabled = false` in config is the only
 * mechanism that both skips the container AND skips the pull.
 *
 * The base file keeps these services ENABLED for local development (studio,
 * analytics, edge_runtime, realtime — realtime has zero app consumers, the
 * others are dev conveniences). This script runs ON THE CI RUNNER ONLY,
 * rewriting the checked-out config in place before `supabase start`. Never
 * commit its output.
 *
 * Exits non-zero if any target section is missing — a rename or restructure
 * of config.toml must fail the lane loudly, not silently re-enable a 500 MB
 * service pull on a 2 vCPU runner.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Top-level config.toml sections whose service CI E2E lanes never use. */
export const CI_DISABLED_SERVICES = [
  'studio',
  'analytics',
  'edge_runtime',
  'realtime',
] as const;

export interface DisableResult {
  output: string;
  flipped: string[];
  alreadyDisabled: string[];
  missing: string[];
}

/**
 * Section-aware, line-based transform: within each named TOP-LEVEL section
 * (exact `[name]` header match — nested `[name.sub]` headers end the scope),
 * rewrite the first `enabled = true` to `enabled = false`. Pure function so
 * the behaviour is testable without touching the real config.
 */
export function disableServicesInConfig(
  toml: string,
  sections: readonly string[] = CI_DISABLED_SERVICES,
): DisableResult {
  const flipped: string[] = [];
  const alreadyDisabled: string[] = [];
  const seen = new Set<string>();
  let current: string | null = null;

  const out = toml.split('\n').map((line) => {
    const header = line.match(/^\[([^\]]+)\]\s*$/);
    if (header) {
      current = header[1];
      if (sections.includes(current)) seen.add(current);
      return line;
    }
    if (current !== null && sections.includes(current)) {
      const m = line.match(/^enabled\s*=\s*(true|false)\s*$/);
      if (m) {
        if (m[1] === 'true') {
          flipped.push(current);
          return 'enabled = false';
        }
        alreadyDisabled.push(current);
      }
    }
    return line;
  });

  const missing = sections.filter((s) => !seen.has(s));
  return { output: out.join('\n'), flipped, alreadyDisabled, missing };
}

async function main(): Promise<void> {
  // import.meta.dirname, not Bun's import.meta.dir — this file sits in the
  // Next.js build-typecheck graph, whose types don't know Bun's ImportMeta.
  const configPath = resolve(import.meta.dirname, '../../supabase/config.toml');
  const before = readFileSync(configPath, 'utf8');
  const { output, flipped, alreadyDisabled, missing } =
    disableServicesInConfig(before);

  if (missing.length > 0) {
    console.error(
      `[prepare-supabase-ci-config] FAILED: section(s) not found in ` +
        `supabase/config.toml: ${missing.map((s) => `[${s}]`).join(', ')}. ` +
        `If a section was renamed upstream, update CI_DISABLED_SERVICES — ` +
        `do not let the service silently re-enable in CI.`,
    );
    process.exit(1);
  }

  writeFileSync(configPath, output);
  console.log(
    `[prepare-supabase-ci-config] disabled: ${flipped.join(', ') || '(none)'}` +
      (alreadyDisabled.length > 0
        ? `; already disabled: ${alreadyDisabled.join(', ')}`
        : ''),
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('[prepare-supabase-ci-config] FAILED:', err);
    process.exit(1);
  });
}

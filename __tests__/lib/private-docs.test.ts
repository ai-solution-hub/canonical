/**
 * ID-68.16 — KH_PRIVATE_DOCS_DIR bridge helper contract.
 *
 * Covers TECH PC-25 (the one knob, name-at-birth), PC-29 (fail loudly,
 * no fallback to in-repo docs/), and the AC-D3 smoke for the documented
 * shell one-liner consumed by skill/sh bridge lanes.
 */
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolvePrivateDocsDir } from '@/lib/private-docs';

const KNOB = 'KH_PRIVATE_DOCS_DIR';

describe('resolvePrivateDocsDir (PC-25 / PC-29)', () => {
  let savedValue: string | undefined;

  beforeEach(() => {
    savedValue = process.env[KNOB];
    delete process.env[KNOB];
  });

  afterEach(() => {
    if (savedValue === undefined) {
      delete process.env[KNOB];
    } else {
      process.env[KNOB] = savedValue;
    }
  });

  it('returns the env path when the knob is set', () => {
    process.env[KNOB] = '/checkouts/knowledge-hub-docs-site';
    expect(resolvePrivateDocsDir()).toBe('/checkouts/knowledge-hub-docs-site');
  });

  it('throws when the knob is unset, naming the knob in the message (AC-D3 contract)', () => {
    expect(() => resolvePrivateDocsDir()).toThrowError(/KH_PRIVATE_DOCS_DIR/);
  });

  it('throws when the knob is set but empty/whitespace (unresolvable per Inv 29)', () => {
    process.env[KNOB] = '   ';
    expect(() => resolvePrivateDocsDir()).toThrowError(/KH_PRIVATE_DOCS_DIR/);
  });

  it('names both resolution routes in the error (sibling checkout + GitHub-App token)', () => {
    let message = '';
    try {
      resolvePrivateDocsDir();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    // Local/dev route: explicit sibling checkout, never auto-discovered.
    expect(message).toContain('knowledge-hub-docs-site');
    expect(message).toContain('../knowledge-hub-docs-site');
    expect(message).toMatch(/\.env\.local|shell/);
    // CI route: GitHub-App installation-token checkout.
    expect(message).toMatch(/GitHub-App/i);
    expect(message).toMatch(/CI/);
  });

  it('never falls back to the in-repo docs/ duplicate (Inv 29 — no partial output)', () => {
    // Knob unset: the helper must throw rather than resolve any path —
    // in particular it must not return the stale in-repo docs/ directory.
    expect(() => resolvePrivateDocsDir()).toThrowError();
  });
});

describe('shell one-liner contract (AC-D3 smoke for skill/sh consumers)', () => {
  const oneLiner =
    'echo "${KH_PRIVATE_DOCS_DIR:?KH_PRIVATE_DOCS_DIR not set — point it at the' +
    ' knowledge-hub-docs-site checkout (sibling clone locally; GitHub-App token' +
    ' checkout in CI)}"';

  const envWithoutKnob = (): NodeJS.ProcessEnv => {
    const env = { ...process.env };
    delete env[KNOB];
    return env;
  };

  it('exits non-zero and names the knob when unset', () => {
    const result = spawnSync('bash', ['-c', oneLiner], {
      env: envWithoutKnob(),
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('KH_PRIVATE_DOCS_DIR');
    expect(result.stderr).toContain('knowledge-hub-docs-site');
  });

  it('exits zero and echoes the path when set', () => {
    const result = spawnSync('bash', ['-c', oneLiner], {
      env: {
        ...envWithoutKnob(),
        [KNOB]: '/checkouts/knowledge-hub-docs-site',
      },
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('/checkouts/knowledge-hub-docs-site');
  });
});

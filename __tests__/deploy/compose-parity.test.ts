/**
 * Tests for the compose structural-parity guard (ID-127.8 / BI-15 Change B,
 * `scripts/ci/check-compose-parity.ts`).
 *
 * The guard asserts the Platform PRODUCTION ingestion compose
 * (deploy/coolify/docker-compose.platform.yaml) still conforms to the shared
 * cocoindex service structural template. These tests assert REAL behaviour:
 *
 *   1. The CURRENT shipped compose passes the guard with ZERO drift — proving
 *      the template matches reality and the guard does not false-positive.
 *   2. Each structural check FLAGS an injected divergence — proving the guard
 *      actually catches drift (the warn-only signal has teeth).
 *
 * No filesystem mocking: test (1) reads the actual compose so the guard and the
 * shipped file are verified together (the testStrategy contract). The injection
 * tests mutate the parsed object in-memory so each divergence is isolated.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  diffComposeTemplate,
  checkComposeText,
  findCocoindexService,
  REQUIRED_ENV_KEYS,
} from '../../scripts/ci/check-compose-parity';

const COMPOSE_PATH = resolve(
  __dirname,
  '../../deploy/coolify/docker-compose.platform.yaml',
);

function loadComposeText(): string {
  return readFileSync(COMPOSE_PATH, 'utf8');
}

/** Parse the real compose, mutate it, and re-run the guard over the mutation. */
function withMutatedCompose(
  mutate: (compose: Record<string, unknown>) => void,
): ReturnType<typeof diffComposeTemplate> {
  const compose = parseYaml(loadComposeText()) as Record<string, unknown>;
  mutate(compose);
  // Round-trip through the text path so we also exercise the YAML re-parse.
  return checkComposeText(stringifyYaml(compose));
}

describe('check-compose-parity — current compose conforms', () => {
  it('flags ZERO drift on the current platform-production compose', () => {
    const drifts = checkComposeText(loadComposeText());
    expect(drifts).toEqual([]);
  });

  it('locates the cocoindex service block by prefix', () => {
    const compose = parseYaml(loadComposeText());
    expect(findCocoindexService(compose)).toBeDefined();
  });
});

describe('check-compose-parity — flags injected divergence', () => {
  it('flags a regression to :latest (image hard-fail dropped)', () => {
    const drifts = withMutatedCompose((compose) => {
      const services = compose.services as Record<string, { image: string }>;
      const key = Object.keys(services).find((k) => k.startsWith('cocoindex'))!;
      services[key].image =
        'ghcr.io/ai-solution-hub/kh-cocoindex-pipeline:latest';
    });
    expect(drifts.some((d) => d.check === 'image-tag-hardfail')).toBe(true);
  });

  it('flags the soft ${VAR:-} default form (not the :? hard-fail)', () => {
    const drifts = withMutatedCompose((compose) => {
      const services = compose.services as Record<string, { image: string }>;
      const key = Object.keys(services).find((k) => k.startsWith('cocoindex'))!;
      services[key].image =
        'ghcr.io/ai-solution-hub/kh-cocoindex-pipeline:${COCOINDEX_IMAGE_TAG:-latest}';
    });
    expect(drifts.some((d) => d.check === 'image-tag-hardfail')).toBe(true);
  });

  it('flags a broken COCOINDEX_DB LMDB wiring', () => {
    const drifts = withMutatedCompose((compose) => {
      const services = compose.services as Record<
        string,
        { environment: Record<string, string> }
      >;
      const key = Object.keys(services).find((k) => k.startsWith('cocoindex'))!;
      services[key].environment.COCOINDEX_DB = '/wrong/path';
    });
    expect(drifts.some((d) => d.check === 'cocoindex-db')).toBe(true);
  });

  it('flags a narrowed Traefik scope (/extract dropped)', () => {
    const drifts = withMutatedCompose((compose) => {
      const services = compose.services as Record<
        string,
        { labels: string[] }
      >;
      const key = Object.keys(services).find((k) => k.startsWith('cocoindex'))!;
      services[key].labels = services[key].labels.map((l) =>
        l.includes('.rule=')
          ? l.replace(' || PathPrefix(`/extract`)', '')
          : l,
      );
    });
    expect(drifts.some((d) => d.check === 'traefik-scope')).toBe(true);
  });

  it('flags a widened Traefik scope that routes /stage', () => {
    const drifts = withMutatedCompose((compose) => {
      const services = compose.services as Record<
        string,
        { labels: string[] }
      >;
      const key = Object.keys(services).find((k) => k.startsWith('cocoindex'))!;
      services[key].labels = services[key].labels.map((l) =>
        l.includes('.rule=')
          ? l.replace('(PathPrefix(`/walk`)', '(PathPrefix(`/stage`) || PathPrefix(`/walk`)')
          : l,
      );
    });
    expect(drifts.some((d) => d.check === 'traefik-scope')).toBe(true);
  });

  it('flags a removed healthcheck probe', () => {
    const drifts = withMutatedCompose((compose) => {
      const services = compose.services as Record<
        string,
        { healthcheck?: unknown }
      >;
      const key = Object.keys(services).find((k) => k.startsWith('cocoindex'))!;
      delete services[key].healthcheck;
    });
    expect(drifts.some((d) => d.check === 'healthcheck')).toBe(true);
  });

  it('flags a healthcheck missing the start_period field', () => {
    const drifts = withMutatedCompose((compose) => {
      const services = compose.services as Record<
        string,
        { healthcheck: Record<string, unknown> }
      >;
      const key = Object.keys(services).find((k) => k.startsWith('cocoindex'))!;
      delete services[key].healthcheck.start_period;
    });
    expect(drifts.some((d) => d.check === 'healthcheck')).toBe(true);
  });

  it('flags a dropped required env key', () => {
    const drifts = withMutatedCompose((compose) => {
      const services = compose.services as Record<
        string,
        { environment: Record<string, string> }
      >;
      const key = Object.keys(services).find((k) => k.startsWith('cocoindex'))!;
      delete services[key].environment.EXTRACT_API_TOKEN;
    });
    expect(
      drifts.some(
        (d) =>
          d.check === 'env-keyset' && d.message.includes('EXTRACT_API_TOKEN'),
      ),
    ).toBe(true);
  });

  it('flags a missing cocoindex service block entirely', () => {
    const drifts = withMutatedCompose((compose) => {
      compose.services = {};
    });
    expect(drifts.some((d) => d.check === 'service-block')).toBe(true);
  });
});

describe('check-compose-parity — required env keyset is the shared set', () => {
  it('asserts every required key is present in the real compose', () => {
    const compose = parseYaml(loadComposeText());
    const service = findCocoindexService(compose)!;
    const presentKeys = Object.keys(
      service.environment as Record<string, unknown>,
    );
    for (const key of REQUIRED_ENV_KEYS) {
      expect(presentKeys).toContain(key);
    }
  });
});

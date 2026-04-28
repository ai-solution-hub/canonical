/**
 * Tests for lib/logger/index.ts (root logger configuration).
 *
 * Spec: docs/specs/structured-logging-spec.md §4.1 + §6 (AC 1, 5, 6) + §7.
 *
 * Covers:
 * - root logger emits JSON with the configured fields
 * - mixin injects requestId/userId/route/method from AsyncLocalStorage
 * - PII redaction paths replace sensitive caller-supplied fields
 * - error-level calls invoke Sentry forwarding (delegating to bridge)
 * - warn-level calls invoke Sentry forwarding (spec §10 decision 1)
 * - info-level does NOT invoke Sentry forwarding
 * - child loggers preserve the Sentry-forwarding wrap
 * - cold-start overhead under 5ms (AC 7) — best-effort smoke test
 *
 * Tests construct their own logger via `createLogger(destination)` rather
 * than asserting on the singleton, so we can capture the JSON output.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sentryMocks = vi.hoisted(() => {
  const setTag = vi.fn();
  const setUser = vi.fn();
  const setLevel = vi.fn();
  const setContext = vi.fn();
  const scope = { setTag, setUser, setLevel, setContext };
  return {
    setTag,
    setUser,
    setLevel,
    setContext,
    scope,
    getCurrentScope: vi.fn(() => scope),
    captureException: vi.fn(),
  };
});

vi.mock('@sentry/nextjs', () => ({
  getCurrentScope: sentryMocks.getCurrentScope,
  captureException: sentryMocks.captureException,
}));

import { createLogger, runWithRequestContext } from '@/lib/logger';
import type { RequestContext } from '@/lib/logger';

interface CapturedLine {
  level: string;
  msg?: string;
  requestId?: string;
  userId?: string;
  userRole?: string;
  route?: string;
  method?: string;
  service?: string;
  time?: string;
  err?: { type: string; message: string; stack?: string };
  [key: string]: unknown;
}

function capturingDestination() {
  const lines: CapturedLine[] = [];
  return {
    lines,
    write(chunk: string) {
      // Pino emits one JSON object per call; chunks may include a trailing newline.
      const trimmed = chunk.trim();
      if (!trimmed) return;
      lines.push(JSON.parse(trimmed) as CapturedLine);
    },
  };
}

function fixtureCtx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: '7d3f2a1e-4b6c-4f8a-9c1d-2e3f4a5b6c7d',
    route: '/api/items',
    method: 'POST',
    startedAt: 1700000000000,
    ...overrides,
  };
}

describe('lib/logger root logger', () => {
  beforeEach(() => {
    sentryMocks.captureException.mockReset();
    sentryMocks.setTag.mockReset();
    sentryMocks.setUser.mockReset();
    sentryMocks.setLevel.mockReset();
    sentryMocks.setContext.mockReset();
  });

  describe('JSON output shape', () => {
    it('emits level + msg + service + time on a basic info call', () => {
      const dest = capturingDestination();
      const logger = createLogger(dest);
      // Override level so test can capture (test default is "silent").
      logger.level = 'info';
      logger.info({ op: 'test' }, 'hello world');
      expect(dest.lines).toHaveLength(1);
      const line = dest.lines[0];
      expect(line.level).toBe('info');
      expect(line.msg).toBe('hello world');
      expect(line.service).toBe('knowledge-hub');
      expect(typeof line.time).toBe('string');
      expect(line.op).toBe('test');
    });

    it('emits the level as a string ("error") not the integer (50)', () => {
      const dest = capturingDestination();
      const logger = createLogger(dest);
      logger.level = 'error';
      logger.error({ err: new Error('x') }, 'boom');
      expect(dest.lines[0].level).toBe('error');
    });
  });

  describe('mixin / AsyncLocalStorage integration', () => {
    it('injects requestId/route/method when a request context is in scope', () => {
      const dest = capturingDestination();
      const logger = createLogger(dest);
      logger.level = 'info';
      runWithRequestContext(
        fixtureCtx({
          userId: 'aaaaaaaa-1111-4111-a111-111111111111',
          userRole: 'editor',
        }),
        () => {
          logger.info('inside scope');
        },
      );
      expect(dest.lines).toHaveLength(1);
      const line = dest.lines[0];
      expect(line.requestId).toBe('7d3f2a1e-4b6c-4f8a-9c1d-2e3f4a5b6c7d');
      expect(line.route).toBe('/api/items');
      expect(line.method).toBe('POST');
      expect(line.userId).toBe('aaaaaaaa-1111-4111-a111-111111111111');
      expect(line.userRole).toBe('editor');
    });

    it('omits requestId when called outside a scope', () => {
      const dest = capturingDestination();
      const logger = createLogger(dest);
      logger.level = 'info';
      logger.info('no scope');
      const line = dest.lines[0];
      expect(line.requestId).toBeUndefined();
      expect(line.route).toBeUndefined();
    });

    it('omits userId/userRole when not yet attached', () => {
      const dest = capturingDestination();
      const logger = createLogger(dest);
      logger.level = 'info';
      runWithRequestContext(fixtureCtx(), () => {
        logger.info('anonymous traffic');
      });
      const line = dest.lines[0];
      expect(line.requestId).toBeDefined();
      expect(line.userId).toBeUndefined();
      expect(line.userRole).toBeUndefined();
    });
  });

  describe('PII redaction', () => {
    it('redacts password / token / apiKey from caller-supplied fields', () => {
      const dest = capturingDestination();
      const logger = createLogger(dest);
      logger.level = 'info';
      logger.info(
        {
          password: 'super-secret',
          token: 'jwt-very-secret',
          apiKey: 'sk-test-keep-me-out',
          op: 'auth.login',
        },
        'sensitive ctx',
      );
      const line = dest.lines[0];
      expect(line.password).toBe('[redacted]');
      expect(line.token).toBe('[redacted]');
      expect(line.apiKey).toBe('[redacted]');
      expect(line.op).toBe('auth.login');
    });

    it('redacts email and organisation_name (D-12 superset)', () => {
      const dest = capturingDestination();
      const logger = createLogger(dest);
      logger.level = 'info';
      logger.info(
        {
          email: 'liam@example.test',
          organisation_name: 'TW Group Ltd',
          op: 'classifier.run',
        },
        'pii guard',
      );
      const line = dest.lines[0];
      expect(line.email).toBe('[redacted]');
      expect(line.organisation_name).toBe('[redacted]');
    });

    it('redacts authorization in nested req.headers', () => {
      const dest = capturingDestination();
      const logger = createLogger(dest);
      logger.level = 'info';
      logger.info(
        {
          req: {
            method: 'POST',
            url: '/api/items',
            headers: {
              authorization: 'Bearer sneaky',
              cookie: 'session=sneaky',
              'content-type': 'application/json',
            },
          },
        },
        'inbound',
      );
      const line = dest.lines[0];
      const reqLine = line.req as {
        headers: Record<string, string>;
        method: string;
      };
      // Serialiser already drops authorization/cookie via allowlist; the
      // redact paths still apply for safety.
      expect(reqLine.headers.authorization).toBeUndefined();
      expect(reqLine.headers.cookie).toBeUndefined();
      expect(reqLine.headers['content-type']).toBe('application/json');
      expect(reqLine.method).toBe('POST');
    });
  });

  describe('Sentry forwarding by level', () => {
    it('forwards error level to Sentry.captureException', () => {
      const dest = capturingDestination();
      const logger = createLogger(dest);
      logger.level = 'error';
      const err = new Error('oh no');
      logger.error({ err }, 'something bad');
      expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
      const [payload] = sentryMocks.captureException.mock.calls[0];
      expect(payload).toBe(err);
    });

    it('forwards warn level to Sentry (spec §10 decision 1)', () => {
      const dest = capturingDestination();
      const logger = createLogger(dest);
      logger.level = 'warn';
      logger.warn({ op: 'retry' }, 'retrying after backoff');
      expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
    });

    it('forwards fatal level to Sentry', () => {
      const dest = capturingDestination();
      const logger = createLogger(dest);
      logger.level = 'fatal';
      logger.fatal(
        { err: new Error('process unrecoverable') },
        'shutting down',
      );
      expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
    });

    it('does NOT forward info level', () => {
      const dest = capturingDestination();
      const logger = createLogger(dest);
      logger.level = 'info';
      logger.info({ op: 'noop' }, 'fyi');
      expect(sentryMocks.captureException).not.toHaveBeenCalled();
    });

    it('does NOT forward debug level', () => {
      const dest = capturingDestination();
      const logger = createLogger(dest);
      logger.level = 'debug';
      logger.debug({ op: 'noop' }, 'verbose');
      expect(sentryMocks.captureException).not.toHaveBeenCalled();
    });
  });

  describe('child loggers', () => {
    it('preserves Sentry forwarding on child loggers', () => {
      const dest = capturingDestination();
      const logger = createLogger(dest);
      logger.level = 'error';
      const child = logger.child({ component: 'embed' });
      const err = new Error('child error');
      child.error({ err }, 'child failed');
      expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
      // Bound context should appear on the JSON line.
      const line = dest.lines[0];
      expect(line.component).toBe('embed');
    });

    it('child output includes mixin context too', () => {
      const dest = capturingDestination();
      const logger = createLogger(dest);
      logger.level = 'info';
      const child = logger.child({ component: 'classify' });
      runWithRequestContext(fixtureCtx(), () => {
        child.info('child line');
      });
      const line = dest.lines[0];
      expect(line.component).toBe('classify');
      expect(line.requestId).toBe('7d3f2a1e-4b6c-4f8a-9c1d-2e3f4a5b6c7d');
    });
  });

  describe('cold-start overhead (AC 7)', () => {
    it('createLogger() returns in well under 5ms', () => {
      const dest = capturingDestination();
      const start = performance.now();
      const logger = createLogger(dest);
      const elapsed = performance.now() - start;
      // Spec AC 7 budgets 5ms; we test the construction step alone is well
      // under that. The full cold-start path includes the singleton init
      // and Sentry SDK import which is harder to isolate.
      expect(elapsed).toBeLessThan(5);
      expect(logger).toBeDefined();
    });
  });
});

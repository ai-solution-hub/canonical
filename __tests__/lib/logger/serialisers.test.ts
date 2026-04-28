/**
 * Tests for lib/logger/serialisers.ts.
 *
 * Spec: docs/specs/structured-logging-spec.md §4.1 + §4.7 (PII redaction
 * superset, D-12).
 *
 * Covers:
 * - serialiseError unwraps Error.cause chain
 * - serialiseError truncates very long stacks + messages
 * - serialiseError handles non-Error inputs (string, plain object, null)
 * - serialiseRequest filters headers to the allowlist
 * - serialiseRequest accepts both web Request and plain-object shape
 * - serialiseResponse extracts status + filtered headers
 * - REDACT_PATHS contains the credential, PII, and authorisation entries
 *   the spec mandates
 */

import { describe, it, expect } from 'vitest';

import {
  serialiseError,
  serialiseRequest,
  serialiseResponse,
  REDACT_PATHS,
  REDACT_CENSOR,
} from '@/lib/logger/serialisers';

describe('lib/logger/serialisers', () => {
  describe('serialiseError', () => {
    it('returns a stable shape for plain Errors', () => {
      const err = new Error('database timeout');
      const out = serialiseError(err);
      expect(out.type).toBe('Error');
      expect(out.message).toBe('database timeout');
      expect(out.stack).toContain('database timeout');
    });

    it('preserves the constructor name (e.g. TypeError)', () => {
      const out = serialiseError(new TypeError('bad type'));
      expect(out.type).toBe('TypeError');
    });

    it('walks the Error.cause chain', () => {
      const inner = new Error('inner cause');
      const outer = new Error('outer error', { cause: inner });
      const out = serialiseError(outer);
      expect(out.message).toBe('outer error');
      expect(out.cause?.message).toBe('inner cause');
    });

    it('caps stack frames to keep payload bounded', () => {
      const err = new Error('many frames');
      err.stack = [
        'Error: many frames',
        ...Array(60).fill('    at frame'),
      ].join('\n');
      const out = serialiseError(err);
      // 30-line cap + 1 truncation marker => 31 lines max
      expect(out.stack?.split('\n').length).toBeLessThanOrEqual(31);
      expect(out.stack).toContain('more frames]');
    });

    it('truncates very long messages', () => {
      const huge = 'x'.repeat(2000);
      const out = serialiseError(new Error(huge));
      expect(out.message.length).toBeLessThanOrEqual(
        1000 + '…[truncated]'.length,
      );
      expect(out.message).toContain('truncated');
    });

    it('handles plain-object errors (Anthropic-style throw shapes)', () => {
      const out = serialiseError({
        name: 'APIError',
        message: 'rate limited',
        status: 429,
      });
      expect(out.type).toBe('APIError');
      expect(out.message).toBe('rate limited');
    });

    it('handles strings', () => {
      const out = serialiseError('thrown a string');
      expect(out.type).toBe('NonError');
      expect(out.message).toBe('thrown a string');
    });

    it('handles null and undefined', () => {
      expect(serialiseError(null).type).toBe('NonError');
      expect(serialiseError(undefined).type).toBe('NonError');
    });

    it('preserves Node-style err.code', () => {
      const err = new Error('connection failed') as Error & { code: string };
      err.code = 'ECONNREFUSED';
      const out = serialiseError(err);
      expect(out.code).toBe('ECONNREFUSED');
    });
  });

  describe('serialiseRequest', () => {
    it('filters web Request headers to the allowlist', () => {
      const req = new Request('https://example.test/api/items', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer secret-should-not-leak',
          cookie: 'session=secret-should-not-leak',
          'x-request-id': 'req-123',
          'x-supabase-something': 'should-not-leak',
        },
      });
      const out = serialiseRequest(req);
      expect(out.method).toBe('POST');
      expect(out.url).toBe('https://example.test/api/items');
      expect(out.headers['content-type']).toBe('application/json');
      expect(out.headers['x-request-id']).toBe('req-123');
      expect(out.headers.authorization).toBeUndefined();
      expect(out.headers.cookie).toBeUndefined();
      expect(out.headers['x-supabase-something']).toBeUndefined();
    });

    it('accepts plain-object shapes (test fixtures)', () => {
      const out = serialiseRequest({
        method: 'GET',
        url: '/api/foo',
        headers: { 'user-agent': 'vitest', authorization: 'Bearer x' },
      });
      expect(out.method).toBe('GET');
      expect(out.headers['user-agent']).toBe('vitest');
      expect(out.headers.authorization).toBeUndefined();
    });

    it('returns empty headers for null/undefined inputs', () => {
      expect(serialiseRequest(null).headers).toEqual({});
      expect(serialiseRequest(undefined).headers).toEqual({});
    });
  });

  describe('serialiseResponse', () => {
    it('extracts status and filtered headers from a web Response', () => {
      const res = new Response('ok', {
        status: 201,
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'session=should-not-leak',
          'x-request-id': 'res-123',
        },
      });
      const out = serialiseResponse(res);
      expect(out.status).toBe(201);
      expect(out.headers['content-type']).toBe('application/json');
      expect(out.headers['x-request-id']).toBe('res-123');
      expect(out.headers['set-cookie']).toBeUndefined();
    });

    it('handles plain-object shapes with statusCode (Node-style)', () => {
      const out = serialiseResponse({
        statusCode: 500,
        headers: { 'content-type': 'text/plain', 'x-request-id': 'r1' },
      });
      expect(out.status).toBe(500);
      expect(out.headers['x-request-id']).toBe('r1');
    });
  });

  describe('REDACT_PATHS', () => {
    it('covers credential and authorisation fields per spec §4.7', () => {
      // Each must be present somewhere in the list (depth-prefixed allowed).
      const required = [
        '*.password',
        '*.token',
        '*.apiKey',
        '*.authorization',
        '*.cookie',
        'req.headers.authorization',
        'req.headers.cookie',
      ];
      for (const path of required) {
        expect(REDACT_PATHS).toContain(path);
      }
    });

    it('covers the PII superset (D-12) — email, organisation, holder, author', () => {
      const required = [
        '*.email',
        '*.organisation_name',
        '*.client_name',
        '*.holder_name',
        '*.author',
        '*.created_by',
      ];
      for (const path of required) {
        expect(REDACT_PATHS).toContain(path);
      }
    });

    it('exposes the censor string', () => {
      expect(REDACT_CENSOR).toBe('[redacted]');
    });
  });
});

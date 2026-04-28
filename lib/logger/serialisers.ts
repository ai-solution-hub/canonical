/**
 * Pino serialisers for the structured logger.
 *
 * Spec: docs/specs/structured-logging-spec.md §4.1 + §4.7 (PII redaction
 * superset per D-12).
 *
 * The serialisers run BEFORE pino's `redact` paths apply, so anything
 * sensitive that lives on `err`/`req`/`res` objects is normalised here
 * to a known shape — the wildcard redact paths (`*.password`, etc.) then
 * mop up any caller-supplied bag-of-fields that includes the same keys.
 *
 * Why redo `req`/`res` instead of leaning on `pino.stdSerializers.req` /
 * `.res`?
 *
 * 1. Vercel's Edge/Node runtimes pass a `Request` (web standard) to route
 *    handlers, not a Node `IncomingMessage`. The standard pino serializers
 *    expect Node-shape objects with `.headers`, `.method`, `.url`, plus
 *    Node-specific fields like `.connection.remoteAddress`. Web `Request`
 *    has `headers` as a `Headers` instance, not a plain object — direct
 *    feed into the standard serializer mishandles header iteration.
 *
 * 2. We want to **allowlist** headers (not log everything), and we want to
 *    redact body fields by name. A custom serializer keeps the allow/deny
 *    policy in one place where the spec-defined PII list lives.
 *
 * Serialisers must never throw — pino swallows errors but loses the line.
 */

const REDACTED = '[redacted]';

/**
 * Header allowlist — only these headers are emitted on serialised
 * requests/responses. Authentication and cookie headers never leak even
 * by accident, regardless of pino redact paths.
 */
const SAFE_REQUEST_HEADERS = new Set([
  'accept',
  'accept-language',
  'content-type',
  'content-length',
  'host',
  'origin',
  'referer',
  'user-agent',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-pathname',
  'x-request-id',
  'x-vercel-id',
  'x-vercel-ip-country',
  'x-real-ip',
]);

const SAFE_RESPONSE_HEADERS = new Set([
  'content-type',
  'content-length',
  'cache-control',
  'etag',
  'location',
  'x-request-id',
  'x-vercel-id',
]);

/**
 * Limits to keep log lines under Vercel's ~4KB truncation threshold.
 */
const MAX_STACK_LINES = 30;
const MAX_MESSAGE_CHARS = 1000;

interface SerialisedError {
  type: string;
  message: string;
  stack?: string;
  code?: string | number;
  cause?: SerialisedError;
}

function safeString(value: unknown, max = MAX_MESSAGE_CHARS): string {
  if (value === undefined || value === null) return '';
  const str = typeof value === 'string' ? value : String(value);
  return str.length > max ? `${str.slice(0, max)}…[truncated]` : str;
}

function trimStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const lines = stack.split('\n');
  if (lines.length <= MAX_STACK_LINES) return stack;
  return [
    ...lines.slice(0, MAX_STACK_LINES),
    `…[+${lines.length - MAX_STACK_LINES} more frames]`,
  ].join('\n');
}

/**
 * Serialise an Error (or anything thrown) into a stable JSON shape.
 *
 * Walks the `cause` chain so `new Error('outer', { cause: inner })` shows
 * both messages in the log line. Caps stack frames per error to keep the
 * total payload bounded.
 */
export function serialiseError(value: unknown): SerialisedError {
  if (value instanceof Error) {
    const out: SerialisedError = {
      type: value.name || 'Error',
      message: safeString(value.message),
    };
    const stack = trimStack(value.stack);
    if (stack) out.stack = stack;
    const code = (value as Error & { code?: string | number }).code;
    if (code !== undefined) out.code = code;
    if (value.cause !== undefined && value.cause !== value) {
      out.cause = serialiseError(value.cause);
    }
    return out;
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    return {
      type: typeof obj.name === 'string' ? obj.name : 'NonError',
      message: safeString(obj.message ?? JSON.stringify(obj)),
    };
  }
  return {
    type: 'NonError',
    message: safeString(value),
  };
}

interface SerialisedRequest {
  method?: string;
  url?: string;
  route?: string;
  headers: Record<string, string>;
}

/**
 * Serialise an inbound request. Accepts either a `Request` (web standard,
 * what Next.js route handlers receive) or a plain object with similar
 * shape (used by tests).
 *
 * Headers are filtered to the allowlist — `authorization` / `cookie` /
 * Supabase auth headers never reach the log line.
 */
export function serialiseRequest(value: unknown): SerialisedRequest {
  if (value === null || value === undefined) {
    return { headers: {} };
  }

  if (value instanceof Request) {
    const headers: Record<string, string> = {};
    value.headers.forEach((headerValue, headerName) => {
      const lower = headerName.toLowerCase();
      if (SAFE_REQUEST_HEADERS.has(lower)) {
        headers[lower] = headerValue;
      }
    });
    return {
      method: value.method,
      url: value.url,
      headers,
    };
  }

  const obj = value as {
    method?: string;
    url?: string;
    route?: string;
    headers?: Record<string, unknown> | Headers;
  };
  const headers: Record<string, string> = {};
  const rawHeaders = obj.headers;
  if (rawHeaders instanceof Headers) {
    rawHeaders.forEach((headerValue, headerName) => {
      const lower = headerName.toLowerCase();
      if (SAFE_REQUEST_HEADERS.has(lower)) {
        headers[lower] = headerValue;
      }
    });
  } else if (rawHeaders && typeof rawHeaders === 'object') {
    for (const [k, v] of Object.entries(rawHeaders)) {
      const lower = k.toLowerCase();
      if (SAFE_REQUEST_HEADERS.has(lower) && v !== undefined) {
        headers[lower] = String(v);
      }
    }
  }
  return {
    method: obj.method,
    url: obj.url,
    route: obj.route,
    headers,
  };
}

interface SerialisedResponse {
  status?: number;
  headers: Record<string, string>;
}

/**
 * Serialise an outbound response. Accepts a web standard `Response` or
 * `NextResponse` (which extends it), plus a plain-object fallback for
 * tests.
 */
export function serialiseResponse(value: unknown): SerialisedResponse {
  if (value === null || value === undefined) {
    return { headers: {} };
  }

  if (value instanceof Response) {
    const headers: Record<string, string> = {};
    value.headers.forEach((headerValue, headerName) => {
      const lower = headerName.toLowerCase();
      if (SAFE_RESPONSE_HEADERS.has(lower)) {
        headers[lower] = headerValue;
      }
    });
    return { status: value.status, headers };
  }

  const obj = value as {
    status?: number;
    statusCode?: number;
    headers?: Record<string, unknown> | Headers;
  };
  const headers: Record<string, string> = {};
  const rawHeaders = obj.headers;
  if (rawHeaders instanceof Headers) {
    rawHeaders.forEach((headerValue, headerName) => {
      const lower = headerName.toLowerCase();
      if (SAFE_RESPONSE_HEADERS.has(lower)) {
        headers[lower] = headerValue;
      }
    });
  } else if (rawHeaders && typeof rawHeaders === 'object') {
    for (const [k, v] of Object.entries(rawHeaders)) {
      const lower = k.toLowerCase();
      if (SAFE_RESPONSE_HEADERS.has(lower) && v !== undefined) {
        headers[lower] = String(v);
      }
    }
  }
  return {
    status: obj.status ?? obj.statusCode,
    headers,
  };
}

/**
 * Pino `redact.paths` — sensitive fields anywhere in a log line are
 * replaced with `[redacted]` at serialisation time.
 *
 * Per spec §4.7 (D-12 superset): credentials, organisation strings,
 * content excerpts, classifier inputs, author names. Some are full
 * redactions, some are truncated to a length that's still useful for
 * debugging without exposing full content — pino's `redact` only
 * supports censor strings, so the truncation cases are handled by
 * `serialiseError` / caller discipline rather than by this list.
 */
export const REDACT_PATHS: string[] = [
  // Credentials at any depth
  '*.password',
  '*.token',
  '*.apiKey',
  '*.api_key',
  '*.secret',
  '*.authorization',
  '*.cookie',
  // Headers (belt-and-braces — serialiser already drops these)
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
  // PII (D-12 superset)
  '*.email',
  '*.organisation_name',
  '*.client_name',
  '*.holder_name',
  '*.author',
  '*.created_by',
];

export const REDACT_CENSOR = REDACTED;

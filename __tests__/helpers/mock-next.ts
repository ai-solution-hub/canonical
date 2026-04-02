/**
 * Mock factories for Next.js modules used in tests.
 */
import { vi } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Router mock (for component tests using next/navigation)
// ---------------------------------------------------------------------------

export function mockRouter() {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn().mockResolvedValue(undefined),
  };
}

export function mockSearchParams(params: Record<string, string> = {}) {
  return new URLSearchParams(params);
}

export function mockPathname(pathname = '/') {
  return pathname;
}

// ---------------------------------------------------------------------------
// NextRequest factory (for API route tests)
// ---------------------------------------------------------------------------

interface MockRequestOptions {
  method?: string;
  body?: unknown;
  searchParams?: Record<string, string>;
  headers?: Record<string, string>;
}

/**
 * Create a NextRequest for testing API route handlers.
 *
 * @param path - URL path (e.g. '/api/items')
 * @param options - method, body, searchParams, headers
 */
export function createTestRequest(
  path: string,
  options: MockRequestOptions = {},
): NextRequest {
  const { method = 'GET', body, searchParams, headers = {} } = options;

  const url = new URL(path, 'http://localhost:3000');
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }

  const init: RequestInit = { method, headers };

  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    init.body = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }

  return new NextRequest(url, init);
}

/**
 * Create a mock params Promise for Next.js 16 dynamic route params.
 * Next.js 16 passes params as a Promise that must be awaited.
 */
export function createTestParams<T extends Record<string, string>>(
  params: T,
): Promise<T> {
  return Promise.resolve(params);
}

// ---------------------------------------------------------------------------
// Cookies mock (required by createClient in @/lib/supabase/server)
// ---------------------------------------------------------------------------

export function mockCookies() {
  return {
    getAll: vi.fn().mockReturnValue([]),
    set: vi.fn(),
    delete: vi.fn(),
    get: vi.fn().mockReturnValue(undefined),
    has: vi.fn().mockReturnValue(false),
  };
}

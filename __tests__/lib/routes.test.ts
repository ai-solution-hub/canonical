import { describe, it, expect } from 'vitest';
import { PUBLIC_ROUTES, isPublicRoute } from '@/lib/routes';

describe('PUBLIC_ROUTES', () => {
  it('matches the canonical list (inline snapshot regression guard)', () => {
    expect([...PUBLIC_ROUTES]).toMatchInlineSnapshot(`
      [
        "/login",
        "/auth/callback",
        "/oauth/consent",
      ]
    `);
  });

  it('includes key public routes', () => {
    const routes = [...PUBLIC_ROUTES];
    expect(routes).toContain('/login');
    expect(routes).toContain('/auth/callback');
    expect(routes).toContain('/oauth/consent');
  });

  it('does NOT include sensitive paths', () => {
    const routes = [...PUBLIC_ROUTES];
    expect(routes).not.toContain('/admin');
    expect(routes).not.toContain('/settings');
    expect(routes).not.toContain('/dashboard');
    expect(routes).not.toContain('/api/admin');
  });

  it('has no wildcard or catch-all patterns', () => {
    for (const route of PUBLIC_ROUTES) {
      expect(route).not.toContain('*');
      expect(route).not.toMatch(/\[\.{3}/); // no [...param] catch-alls
      expect(route).not.toContain('**');
    }
  });

  it('every entry is an absolute path starting with /', () => {
    for (const route of PUBLIC_ROUTES) {
      expect(route).toMatch(/^\//);
    }
  });

  // /.well-known is handled by proxy.ts directly and is intentionally absent
  // from the canonical PUBLIC_ROUTES list. It is an API-like route that does
  // not need UI-level auth guards.
  it('does NOT include /.well-known (handled by proxy.ts separately)', () => {
    const routes = [...PUBLIC_ROUTES];
    expect(routes).not.toContain('/.well-known');
  });
});

describe('isPublicRoute', () => {
  it('returns true for exact public routes', () => {
    expect(isPublicRoute('/login')).toBe(true);
    expect(isPublicRoute('/auth/callback')).toBe(true);
    expect(isPublicRoute('/oauth/consent')).toBe(true);
  });

  it('returns true for sub-paths of public routes (startsWith)', () => {
    expect(isPublicRoute('/auth/callback?code=abc')).toBe(true);
    expect(isPublicRoute('/login?redirect=/dashboard')).toBe(true);
    expect(isPublicRoute('/oauth/consent/confirm')).toBe(true);
  });

  it('returns false for non-public routes', () => {
    expect(isPublicRoute('/dashboard')).toBe(false);
    expect(isPublicRoute('/admin')).toBe(false);
    expect(isPublicRoute('/settings')).toBe(false);
    expect(isPublicRoute('/browse')).toBe(false);
    expect(isPublicRoute('/')).toBe(false);
  });

  it('returns false for routes that merely contain a public route name', () => {
    // Ensures startsWith semantics, not includes
    expect(isPublicRoute('/not-login')).toBe(false);
    expect(isPublicRoute('/api/login-check')).toBe(false);
  });
});

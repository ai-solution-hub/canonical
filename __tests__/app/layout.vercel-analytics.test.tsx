import { describe, it, expect, vi, afterEach } from 'vitest';
import { Analytics } from '@vercel/analytics/next';

/**
 * Regression guard for the /login prod-build pageerror (ID-128.13).
 *
 * Root cause: `<Analytics />` (@vercel/analytics/next) unconditionally
 * injects a `<script src="/_vercel/insights/script.js">` tag whenever
 * `NODE_ENV === 'production'` — which `next start` always sets, regardless
 * of whether the app is actually served by Vercel's edge network. On real
 * Vercel deploys, Vercel's platform intercepts `/_vercel/*` before it
 * reaches the app. Under a LOCAL or CI `next start` (no Vercel edge), the
 * request falls through to our own app; proxy.ts redirects the
 * unauthenticated, non-public request to /login (200 text/html); the
 * browser then tries to execute that HTML as JS, throwing the uncaught
 * `Unexpected token '<'` pageerror seen on every /login load in
 * e2e-nightly (>=6 consecutive red runs before this fix).
 *
 * Fix: RootLayout only renders `<Analytics />` when `process.env.VERCEL
 * === '1'` (the platform's own runtime/build-time signal, set on Vercel
 * and never set locally or in GitHub Actions).
 */

vi.mock('next/font/google', () => ({
  Instrument_Sans: () => ({ variable: '--font-sans' }),
}));

const { default: RootLayout } = await import('@/app/layout');

/** Walk a React element tree looking for a node whose `type` is `target`. */
function containsComponentType(node: unknown, target: unknown): boolean {
  if (node == null || typeof node !== 'object') return false;
  if ((node as { type?: unknown }).type === target) return true;
  const children = (node as { props?: { children?: unknown } }).props?.children;
  if (Array.isArray(children)) {
    return children.some((child) => containsComponentType(child, target));
  }
  return containsComponentType(children, target);
}

describe('RootLayout — Vercel Analytics gating', () => {
  const ORIGINAL_VERCEL = process.env.VERCEL;

  afterEach(() => {
    if (ORIGINAL_VERCEL === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = ORIGINAL_VERCEL;
    }
  });

  it('omits the Analytics beacon outside Vercel (local dev, CI next start)', async () => {
    delete process.env.VERCEL;

    const element = await RootLayout({ children: <div /> });

    expect(containsComponentType(element, Analytics)).toBe(false);
  });

  it('renders the Analytics beacon when actually deployed on Vercel', async () => {
    process.env.VERCEL = '1';

    const element = await RootLayout({ children: <div /> });

    expect(containsComponentType(element, Analytics)).toBe(true);
  });
});

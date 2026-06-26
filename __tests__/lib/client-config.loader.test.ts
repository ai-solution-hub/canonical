import { describe, it, expect, vi } from 'vitest';
import {
  loadBranding,
  BRANDING,
  BRANDING_PRIMARY_FOREGROUND,
  BRANDING_PRIMARY_DARK,
  BRANDING_PRIMARY_FOREGROUND_DARK,
} from '@/lib/client-config';

describe('loadBranding', () => {
  it('resolves default branding with no argument', () => {
    // __tests__/setup.ts sets NEXT_PUBLIC_CLIENT_ID='default' as a
    // deterministic test default; the silent ?? 'default' fallback was
    // removed in WP6 (lib/env.ts) because it caused the S196 incident.
    const branding = loadBranding();
    expect(branding.clientId).toBe('default');
    expect(branding.productName).toBe('Canonical');
  });

  it('falls back to default for nonexistent client id', () => {
    const branding = loadBranding('nonexistent');
    expect(branding.clientId).toBe('default');
  });

  it('resolves default branding when called with "default"', () => {
    const branding = loadBranding('default');
    expect(branding.clientId).toBe('default');
    expect(branding.productName).toBe('Canonical');
  });

  it('emits the [branding] contrast advisory server-side (build/SSR log)', () => {
    // Branding contrast advisories are deployment-config diagnostics: emitted
    // once server-side (visible in the build/SSR + CI log), never in the
    // browser where a full page load would repeat them and drown the E2E
    // console gate. Stub `window` away to exercise the server path under jsdom.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('window', undefined);
    try {
      loadBranding('default');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[branding]'),
      );
    } finally {
      vi.unstubAllGlobals();
      warnSpy.mockRestore();
    }
  });

  it('does NOT emit the [branding] advisory in the browser (window defined)', () => {
    // jsdom provides `window`; the advisory must stay out of the browser
    // console so the E2E gate's signal-to-noise stays high.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      loadBranding('default');
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[branding]'),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('resolves to default for an overlay id absent from the public tree', () => {
    // Post-untrack (ID-68.22): client branding JSON + assets are no longer
    // committed to the public tree — they are fetched into
    // lib/branding/clients/ at build time (ID-95). The committed
    // client-branding map therefore contains ONLY default, so any overlay
    // client id resolves to default in the public build, exactly like any
    // other unknown id. A deploy that overlays a client JSON expands the
    // generated map without a source edit (see client-branding-map.codegen
    // test for the overlay-present path).
    const branding = loadBranding('overlay-client');
    expect(branding.clientId).toBe('default');
    expect(branding.productName).toBe('Canonical');
  });
});

describe('module-level BRANDING constants', () => {
  it('BRANDING is non-null after module init', () => {
    expect(BRANDING).toBeDefined();
    expect(BRANDING.clientId).toBe('default');
  });

  it('BRANDING_PRIMARY_FOREGROUND is a valid OKLCH string', () => {
    expect(BRANDING_PRIMARY_FOREGROUND).toMatch(/^oklch\(/);
  });

  it('BRANDING_PRIMARY_DARK is a valid OKLCH string', () => {
    expect(BRANDING_PRIMARY_DARK).toMatch(/^oklch\(/);
  });

  it('BRANDING_PRIMARY_FOREGROUND_DARK is a valid OKLCH string', () => {
    expect(BRANDING_PRIMARY_FOREGROUND_DARK).toMatch(/^oklch\(/);
  });
});

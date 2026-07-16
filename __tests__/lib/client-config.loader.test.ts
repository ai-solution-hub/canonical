import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
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

  // ID-156.4: the WCAG-contrast advisory was leaking into every scripts/*.ts
  // CLI invocation (e.g. ledger-cli.ts, which transitively imports BRANDING
  // via lib/validation/schemas.ts), breaking naive stdout+stderr-merged jq
  // piping. Gate to the app/dev surface: suppress ONLY when the process
  // entry point is a scripts/ CLI — never for the app/build/SSR/test surface
  // this advisory is intended for. Anchored to process.cwd() (tightened
  // post-Checker-review — see isScriptEntryPoint's doc comment), so the fake
  // entry here is built from the REAL cwd, matching this repo's actual
  // `bun scripts/<name>.ts`-from-repo-root invocation convention.
  it('does NOT emit the [branding] advisory when the process entry point is a scripts/ CLI', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('window', undefined);
    const originalArgv1 = process.argv[1];
    process.argv[1] = join(process.cwd(), 'scripts', 'ledger-cli.ts');
    try {
      loadBranding('default');
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[branding]'),
      );
    } finally {
      process.argv[1] = originalArgv1;
      vi.unstubAllGlobals();
      warnSpy.mockRestore();
    }
  });

  it('still emits the [branding] advisory server-side for a non-scripts/ entry point', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('window', undefined);
    const originalArgv1 = process.argv[1];
    process.argv[1] = join(process.cwd(), 'node_modules', '.bin', 'next');
    try {
      loadBranding('default');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[branding]'),
      );
    } finally {
      process.argv[1] = originalArgv1;
      vi.unstubAllGlobals();
      warnSpy.mockRestore();
    }
  });

  // ID-156.4 checker finding: the original `/(^|[/\\])scripts[/\\]/` match
  // tested the ABSOLUTE entry path for a `scripts` segment ANYWHERE in it,
  // so a repo checked out under an ancestor directory literally named
  // `scripts` (e.g. `~/scripts/canonical`) would false-positive-suppress the
  // advisory for every entry point — next dev/build, vitest included — not
  // just this repo's own top-level scripts/ CLIs. Prove the tightened,
  // cwd-relative anchor does NOT reproduce that false positive: an entry
  // point that lives under an ancestor `scripts/` directory OUTSIDE the
  // current working directory must still emit the advisory.
  it('still emits the [branding] advisory for an entry point under an ancestor scripts/ dir outside cwd (ID-156.4 false-positive regression)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('window', undefined);
    const originalArgv1 = process.argv[1];
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/home/dev/repo');
    process.argv[1] = '/home/dev/scripts/unrelated-project/app.ts';
    try {
      loadBranding('default');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[branding]'),
      );
    } finally {
      process.argv[1] = originalArgv1;
      cwdSpy.mockRestore();
      vi.unstubAllGlobals();
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

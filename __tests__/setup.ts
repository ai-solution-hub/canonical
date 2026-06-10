/**
 * Vitest global setup file.
 *
 * Sets deterministic defaults for required env vars so `lib/env.ts`
 * boot-time validation passes in any test environment (CI, local, sandbox)
 * without depending on `.env.local`. Tests that need to override these
 * (e.g. __tests__/lib/env.test.ts itself) use `vi.stubEnv` per-test.
 *
 * `process.env.X = ...` does NOT replace existing values — preserves any
 * value already set by the shell (CI secrets, integration runs, etc.).
 *
 * NEXT_PUBLIC_CLIENT_ID defaults to 'default' here so unit tests get the
 * fallback "Knowledge Hub" branding rather than a per-developer value
 * from `.env.local` (which would make assertions on alt text / product
 * name flaky across machines).
 *
 * Class C tests (integration / e2e tests that read env values directly to
 * construct fixtures) intentionally stay on `process.env.X` rather than
 * routing through `clientEnv` / `serverEnv` — see WP-S5.1 spec §13.9 for
 * the reasoning (Zod parses at module load; `vi.stubEnv` after import has
 * no retroactive effect; integration tests reading values for fixtures
 * gain nothing from the boundary). Production runtime uses
 * `clientEnv` / `serverEnv` to enforce the type-system boundary; test
 * setup uses `process.env` for flexibility.
 *
 * Registers jest-dom matchers and provides polyfills for jsdom.
 * Skips browser polyfills when running in node environment (e.g. real DB
 * integration tests).
 */
const TEST_ENV_DEFAULTS: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_anon_key',
  NEXT_PUBLIC_APP_URL: 'https://test.vercel.app',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_service_key',
  POSTGRES_PASSWORD: 'test-db-password',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  OPENAI_API_KEY: 'sk-test',
  CRON_SECRET: 'test-cron-secret',
};
for (const [k, v] of Object.entries(TEST_ENV_DEFAULTS)) {
  if (!process.env[k]) {
    process.env[k] = v;
  }
}

// NEXT_PUBLIC_CLIENT_ID is FORCE-SET (not guarded by `if (!process.env[k])`)
// because CI's Production GH environment injects the live client ID, which
// would make branding-dependent unit tests non-deterministic.
// Unit tests must always resolve to the 'default' branding config so
// assertions on product name, alt text, and ARIA labels are stable.
// Integration / E2E tests that need the real client ID use their own env
// scope (Staging) and do not share this setup file.
process.env.NEXT_PUBLIC_CLIENT_ID = 'default';

// ID-90.22 R1a: the global KH_LEDGER_SERVER='0' force-pin (added by the
// {90.21} flip) is REMOVED. serverEnabled() in scripts/ledger-cli.ts defaults
// ON (KH_LEDGER_SERVER !== '0'), so the ledger-cli-*.test.ts WRITE suites now
// exercise the SERVER TRANSPORT path via run() against a per-suite ephemeral
// task-view server (one server per suite scratch --ledger-dir, reused across
// run() calls; see __tests__/helpers/ledger-test-server.ts). Suites that must
// pin a specific arm (the differential-parity harness, ledger-server-client's
// serverOn/serverOff subprocess arms) continue to set KH_LEDGER_SERVER
// explicitly in their OWN subprocess env, which is unaffected by the absence of
// a process-wide pin here. The direct write path is now DEAD CODE for tests
// (no suite exercises it) — its removal lands in R1b.

// ID-90.22 / AC-I: in CI the ephemeral ledger server is spawned with
// --require-denylist (ledger-server-lifecycle.ts), and the ledger-cli-*.test.ts
// WRITE suites spawn it via run()/ensureServer (which inherits process.env), so
// without a denylist present every gated write returns ok:false. Provide a
// SYNTHETIC denylist (AC-I: synthetic only, never real client names — mirrors
// SYNTHETIC_DENYLIST in scripts/ledger-differential-parity.ts; the real
// KH_CLIENT_NAME_DENYLIST is for production enforcement + the identity-guard
// job, not unit-test envs). Guarded by CI + unset so a real secret or a
// suite-specific denylist still wins, and local (non-CI) runs are unaffected.
if (process.env.CI && !process.env.KH_CLIENT_NAME_DENYLIST) {
  process.env.KH_CLIENT_NAME_DENYLIST = JSON.stringify({
    tokens: [{ value: 'SYNTH_SETUP_TOKEN_DO_NOT_USE', case_insensitive: true }],
    exclusion_patterns: [],
  });
}

// React act() regression guard (S32 audit close-out, S37 W4 IMPL).
// Any console.error matching the act() warning patterns throws, surfacing
// the offending test via Vitest's stack trace. Per-test
// `vi.spyOn(console, 'error').mockImplementation(...)` patterns overlay this
// wrapper and restore cleanly. See feedback_react_act_warning_classes for the
// 3-class taxonomy this guard protects against (A: bare dispatchEvent,
// B: child useEffect fetch, C: waitFor drain).
const ACT_WARNING_RE =
  /wrapped into act|not wrapped in act|inside a test was not wrapped in act/;
const realConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === 'string' && ACT_WARNING_RE.test(first)) {
    throw new Error(`React act() warning leaked: ${first}`);
  }
  realConsoleError(...args);
};

import '@testing-library/jest-dom/vitest';

// Skip browser polyfills in node environment (real DB integration tests use @vitest-environment node)
if (typeof window === 'undefined') {
  // Nothing to polyfill in node
} else {
  // Polyfill matchMedia (not provided by jsdom)
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });

  // Stub IntersectionObserver (not provided by jsdom)
  class MockIntersectionObserver {
    readonly root = null;
    readonly rootMargin = '0px';
    readonly thresholds: ReadonlyArray<number> = [0];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    value: MockIntersectionObserver,
  });

  // Stub ResizeObserver (not provided by jsdom)
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: MockResizeObserver,
  });

  // In-memory Storage polyfill. Node >= 24 ships a native localStorage getter
  // that is `in globalThis` but returns undefined without --localstorage-file;
  // that makes Vitest's jsdom env skip copying jsdom's Storage onto the global,
  // so a bare `localStorage.clear()` throws. CI pins Node 22 (no native shim) so
  // this only bites local full-suite runs — but the polyfill makes the suite
  // Node-version-agnostic. Methods live on Storage.prototype (each instance
  // backed by its own Map via a WeakMap) so existing
  // `vi.spyOn(Storage.prototype, 'getItem')` interceptors still fire.
  const StorageCtor: typeof Storage | undefined =
    (globalThis as { Storage?: typeof Storage }).Storage ??
    (window as { Storage?: typeof Storage }).Storage;
  const StoragePrototype: object = StorageCtor?.prototype ?? Object.prototype;
  const storageBacking = new WeakMap<object, Map<string, string>>();
  const mapFor = (self: object): Map<string, string> => {
    let m = storageBacking.get(self);
    if (!m) {
      m = new Map<string, string>();
      storageBacking.set(self, m);
    }
    return m;
  };
  Object.defineProperties(StoragePrototype, {
    length: {
      configurable: true,
      get(this: object): number {
        return mapFor(this).size;
      },
    },
    clear: {
      configurable: true,
      writable: true,
      value(this: object): void {
        mapFor(this).clear();
      },
    },
    getItem: {
      configurable: true,
      writable: true,
      value(this: object, key: string): string | null {
        const m = mapFor(this);
        return m.has(key) ? (m.get(key) as string) : null;
      },
    },
    key: {
      configurable: true,
      writable: true,
      value(this: object, index: number): string | null {
        return Array.from(mapFor(this).keys())[index] ?? null;
      },
    },
    removeItem: {
      configurable: true,
      writable: true,
      value(this: object, key: string): void {
        mapFor(this).delete(key);
      },
    },
    setItem: {
      configurable: true,
      writable: true,
      value(this: object, key: string, value: string): void {
        mapFor(this).set(key, String(value));
      },
    },
  });
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    const instance = Object.create(StoragePrototype) as Storage;
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: instance,
    });
    Object.defineProperty(window, name, {
      configurable: true,
      writable: true,
      value: instance,
    });
  }
} // end if (typeof window !== 'undefined')

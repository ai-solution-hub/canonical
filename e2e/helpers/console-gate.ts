import { expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * Opt-in browser-error gate for the E2E smoke suite (bl-336).
 *
 * Playwright does not fail a test when the page throws an uncaught exception or
 * logs `console.error` / `console.warning` — browser errors pass silently. This
 * helper subscribes to `page.on('pageerror')` (uncaught exceptions) and
 * `page.on('console')` (error/warning levels) and accumulates any message that
 * is NOT on the allowlist. Call `assertNoConsoleViolations()` at the end of a
 * test to fail it if anything leaked.
 *
 * Opt-in by design: attach it only to the specs you want gated (the `@smoke`
 * subset). It is NOT wired into the shared `fixtures` so existing specs keep
 * their current behaviour.
 *
 * Allowlisting is BY MESSAGE PREFIX, not blanket suppression. Each allowed
 * prefix must be a known-benign, justified case — adding a prefix here is an
 * explicit decision to tolerate that specific message, not to mute the gate.
 */

/**
 * Known-benign console messages, matched by `startsWith` against the rendered
 * console text. Keep this list minimal and justified.
 *
 * - `[branding] ` — `validateBrandingContrast` (lib/client-config.ts) emits
 *   build/runtime WCAG contrast warnings via `logger.warn('[branding] …')`,
 *   which routes to `console.warn`. The active client's primary colour trips
 *   the 3:1 non-text threshold (~94 warns per run). This is a design-token
 *   decision tracked separately, not a regression the smoke suite should fail
 *   on. Allowlisted by the `[branding] ` prefix only — real errors elsewhere
 *   still fail the gate.
 */
const ALLOWED_CONSOLE_PREFIXES: readonly string[] = [
  '[branding] ',
  // Browser-emitted subresource load failures (e.g. "Failed to load resource:
  // the server responded with a status of 404 (Not Found)"). These are
  // network-level noise from the browser, NOT the app-thrown-error class this
  // gate targets — and error-path smoke tests deliberately produce them (e.g.
  // guide-pages "nonexistent guide shows error state", which navigates to a 404
  // by design). Genuine uncaught exceptions still fail the gate via
  // page.on('pageerror'); app-logged console.error/warning still fails it too.
  'Failed to load resource:',
];

/** Console levels the gate treats as violations. */
const GATED_CONSOLE_TYPES: ReadonlySet<string> = new Set(['error', 'warning']);

function isAllowed(text: string): boolean {
  return ALLOWED_CONSOLE_PREFIXES.some((prefix) => text.startsWith(prefix));
}

/** A captured browser-side violation, retained for the failure message. */
export interface ConsoleViolation {
  kind: 'pageerror' | 'console';
  /** Console level for `kind: 'console'`; undefined for page errors. */
  level?: string;
  text: string;
}

/** Handle returned by {@link attachConsoleGate}. */
export interface ConsoleGate {
  /** Violations captured so far (allowlisted messages excluded). */
  readonly violations: readonly ConsoleViolation[];
  /**
   * Assert no violations were captured. Fails the test with the full list of
   * offending messages if any were seen.
   */
  assertNoConsoleViolations(): void;
}

/**
 * Attach the gate to a page. Call BEFORE the navigation you want to cover so
 * the listeners catch errors fired during the initial load, then call
 * `assertNoConsoleViolations()` once the page has settled.
 */
export function attachConsoleGate(page: Page): ConsoleGate {
  const violations: ConsoleViolation[] = [];

  page.on('pageerror', (error: Error) => {
    const text = error.message;
    if (isAllowed(text)) return;
    violations.push({ kind: 'pageerror', text });
  });

  page.on('console', (message: ConsoleMessage) => {
    if (!GATED_CONSOLE_TYPES.has(message.type())) return;
    const text = message.text();
    if (isAllowed(text)) return;
    violations.push({ kind: 'console', level: message.type(), text });
  });

  return {
    get violations() {
      return violations;
    },
    assertNoConsoleViolations() {
      const detail = violations
        .map((v) =>
          v.kind === 'pageerror'
            ? `  [pageerror] ${v.text}`
            : `  [console.${v.level}] ${v.text}`,
        )
        .join('\n');
      expect(
        violations,
        violations.length > 0
          ? `Unexpected browser errors (not on the allowlist):\n${detail}`
          : undefined,
      ).toHaveLength(0);
    },
  };
}

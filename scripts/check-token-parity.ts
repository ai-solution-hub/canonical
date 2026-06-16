#!/usr/bin/env bun
/**
 * Token-drift guard — asserts the Warm Meridian token mirror in
 * docs-site/src/styles/warm-meridian.css matches the canonical block in
 * app/globals.css (PRODUCT Inv-10, TECH.md §2.7).
 *
 * Mirror contract:
 *   - The Knowledge Hub app declares semantic tokens in app/globals.css
 *     under :root (light) and .dark (dark mode). The Warm Meridian design
 *     system specifies a fixed subset of six tokens that Starlight's surface
 *     vocabulary (--sl-color-*) consumes via var() indirection.
 *   - This guard checks ONLY that subset (MIRROR_TOKENS), not every token in
 *     the app. Other tokens (primitive --stone-*, status tokens, domain
 *     surface tokens) are free to differ — they're not part of the docs-site
 *     surface contract.
 *   - The dark-mode selector differs by host: globals.css uses class-based
 *     `.dark` (Tailwind v4 + KH ThemeContext); Starlight uses attribute-based
 *     `[data-theme='dark']`. PRODUCT Inv-10 makes parity in toggle mechanism
 *     explicitly NOT required — independent toggle, identical palette values.
 *
 * Re-homed to MAIN (ID-114 {114.10}):
 *   - app/globals.css is resolved repo-root-relative — no parent-dir escape.
 *   - warm-meridian.css is resolved via KH_PRIVATE_DOCS_DIR (sibling checkout
 *     locally; GitHub-App-token checkout in CI via resolve-private-docs action).
 *
 * Exit codes (CLI mode):
 *   0 — all six mirror tokens match (light + dark)
 *   1 — drift detected; per-token report on stderr
 *
 * Wiring:
 *   - CI: invoked from `.github/workflows/token-parity.yml` after the
 *     resolve-private-docs action makes KH_PRIVATE_DOCS_DIR available.
 *   - Local: run with KH_PRIVATE_DOCS_DIR set in your environment.
 *
 * Spec source: docs/specs/id-9-astro-starlight-docs-foundation/TECH.md §2.7;
 *              docs/design/warm-meridian-implementation-spec.md (token
 *              vocabulary).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * The six canonical mirror tokens declared by TECH.md §2.7. Any drift in
 * these values between app/globals.css and warm-meridian.css trips the
 * guard. Order matters for stable test assertions.
 */
export const MIRROR_TOKENS = [
  '--background',
  '--foreground',
  '--primary',
  '--border',
  '--muted',
  '--muted-foreground',
] as const;

export type MirrorToken = (typeof MIRROR_TOKENS)[number];

export interface TokenDrift {
  token: string;
  reason: 'missing-in-mirror' | 'missing-in-source' | 'value-mismatch';
  source?: string;
  mirror?: string;
  message: string;
}

/**
 * Extract CSS custom-property declarations from the block bounded by the
 * given selector, e.g. `:root` or `.dark` or `[data-theme='dark']`. Returns
 * a map of `--token` to its raw declaration value (everything between `:`
 * and the closing `;`, with leading/trailing whitespace trimmed).
 *
 * The matcher escapes regex-significant characters in the selector so callers
 * can pass `[data-theme='dark']` literally. We anchor on the first `{` after
 * the selector and the FIRST matching `}` at top level — nested blocks
 * inside the same scope are not supported, but neither file uses them.
 */
export function extractTokens(
  css: string,
  selector: string,
): Map<string, string> {
  const tokens = new Map<string, string>();

  // Find the selector + opening brace, then capture until the matching
  // top-level closing brace by counting depth.
  const selectorEscaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Anchor the selector to (a) a line start, OR (b) a closing brace from a
  // prior block. This prevents `[data-theme='dark']` matching when nested
  // inside another rule (e.g. a media query that the codebase doesn't use,
  // but we defend against anyway).
  const selectorPattern = new RegExp(
    `(?:^|\\})\\s*${selectorEscaped}\\s*\\{`,
    'm',
  );
  const match = css.match(selectorPattern);
  if (!match || match.index === undefined) {
    return tokens;
  }

  const start = match.index + match[0].length;
  let depth = 1;
  let i = start;
  while (i < css.length && depth > 0) {
    const ch = css[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (depth === 0) break;
    i += 1;
  }
  const block = css.slice(start, i);

  // Match each `--token: value;` declaration. Whitespace tolerant.
  const declRegex = /(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+);/g;
  let decl: RegExpExecArray | null;
  while ((decl = declRegex.exec(block)) !== null) {
    tokens.set(decl[1], decl[2].trim());
  }
  return tokens;
}

/**
 * Compare extracted source and mirror token maps over the MIRROR_TOKENS set.
 * Returns one TokenDrift entry per discrepancy. Empty array means no drift.
 */
export function diffTokens(
  source: Map<string, string>,
  mirror: Map<string, string>,
  expectedTokens: readonly string[] = MIRROR_TOKENS,
): TokenDrift[] {
  const drifts: TokenDrift[] = [];
  for (const token of expectedTokens) {
    const srcValue = source.get(token);
    const mirValue = mirror.get(token);

    if (srcValue === undefined) {
      drifts.push({
        token,
        reason: 'missing-in-source',
        message: `${token} not found in app/globals.css source block`,
      });
      continue;
    }
    if (mirValue === undefined) {
      drifts.push({
        token,
        reason: 'missing-in-mirror',
        source: srcValue,
        message: `${token} declared in source (${srcValue}) but missing from docs-site mirror`,
      });
      continue;
    }
    if (srcValue !== mirValue) {
      drifts.push({
        token,
        reason: 'value-mismatch',
        source: srcValue,
        mirror: mirValue,
        message: `${token} drift: source="${srcValue}" mirror="${mirValue}"`,
      });
    }
  }
  return drifts;
}

/**
 * CLI entry point.
 *
 * Resolves paths:
 *   - app/globals.css: repo-root-relative (scripts/ -> parent = repo root).
 *     No parent-dir escape — this script lives IN the main repo.
 *   - warm-meridian.css: resolved under KH_PRIVATE_DOCS_DIR (the private
 *     docs-site bridge knob, PC-28). Locally: sibling checkout at
 *     ../knowledge-hub-docs-site. In CI: GitHub-App-token checkout made
 *     available by the resolve-private-docs action.
 *
 * Fails fast with an actionable message when KH_PRIVATE_DOCS_DIR is unset
 * (no silent fallback — AC-D3 contract).
 */
async function main(): Promise<number> {
  const here = dirname(fileURLToPath(import.meta.url));
  // scripts/ lives one level below the repo root — go up one to reach it.
  const repoRoot = resolve(here, '..');
  const globalsPath = resolve(repoRoot, 'app/globals.css');

  const privateDocsDir = process.env.KH_PRIVATE_DOCS_DIR;
  if (!privateDocsDir) {
    console.error(
      'check-token-parity: ERROR — KH_PRIVATE_DOCS_DIR is not set.\n' +
        '  Locally: set it to the sibling knowledge-hub-docs-site checkout.\n' +
        '  CI: add the resolve-private-docs action step before this script.\n' +
        '  See .github/actions/resolve-private-docs/README.md (Inv 28).',
    );
    return 1;
  }
  const mirrorPath = resolve(privateDocsDir, 'src/styles/warm-meridian.css');

  const [globals, mirror] = await Promise.all([
    readFile(globalsPath, 'utf8'),
    readFile(mirrorPath, 'utf8'),
  ]);

  const lightSource = extractTokens(globals, ':root');
  const lightMirror = extractTokens(mirror, ':root');
  const lightDrift = diffTokens(lightSource, lightMirror, MIRROR_TOKENS);

  const darkSource = extractTokens(globals, '.dark');
  const darkMirror = extractTokens(mirror, "[data-theme='dark']");
  const darkDrift = diffTokens(darkSource, darkMirror, MIRROR_TOKENS);

  const total = lightDrift.length + darkDrift.length;
  if (total === 0) {
    console.log(
      `check-token-parity: PASS — ${MIRROR_TOKENS.length} tokens mirrored in both light + dark modes.`,
    );
    return 0;
  }

  console.error(`check-token-parity: FAIL — ${total} drift(s) detected.`);
  if (lightDrift.length > 0) {
    console.error('\nLight mode (:root vs :root):');
    for (const d of lightDrift) console.error(`  - ${d.message}`);
  }
  if (darkDrift.length > 0) {
    console.error("\nDark mode (.dark vs [data-theme='dark']):");
    for (const d of darkDrift) console.error(`  - ${d.message}`);
  }
  console.error(
    '\nResolve by editing docs-site/src/styles/warm-meridian.css so the mirrored',
  );
  console.error(
    'token values match app/globals.css. Do NOT edit app/globals.css to align',
  );
  console.error(
    'with docs-site — the Next.js app is the canonical source per TECH.md §2.7.',
  );
  return 1;
}

// `import.meta.main` is Bun-specific. Falls back gracefully if run elsewhere
// (the script is invoked via `bun` only, per package.json scripts).
if (import.meta.main) {
  const code = await main();
  process.exit(code);
}

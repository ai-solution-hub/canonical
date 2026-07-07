/**
 * OKF concept-document frontmatter/body split — TS port of the reference
 * `OKFDocument.parse` (`okf/src/reference_agent/bundle/document.py:22-47`,
 * ID-132 {132.14} G-VIEWER lift-and-shift).
 *
 * The reference delimits a leading `---`-fenced YAML block from the markdown
 * body. This port preserves its exact edge-case behaviour (no leading `---`
 * → the whole text is body with empty frontmatter; unterminated block → an
 * error; a non-mapping YAML payload → an error) so `lib/okf/bundle-graph.ts`
 * (the concept walker) parses concept `.md` files identically to the
 * producer/reference toolchain that writes them.
 *
 * Spec: TECH-ADDENDUM-reference-agents.md Part 2 (§Source inventory).
 */
import { parse as parseYaml } from 'yaml';

const FRONTMATTER_DELIM = '---';

/** Thrown when a `.md` file's frontmatter block is malformed or unterminated. */
export class OkfDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OkfDocumentError';
  }
}

/** The frontmatter + body split of one OKF concept document. */
export interface OkfDocument {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Parse an OKF document's leading `---` YAML frontmatter block and body.
 *
 * Mirrors `OKFDocument.parse` line-for-line:
 * - No `---` on the first line → `{ frontmatter: {}, body: text }` (the
 *   whole text passes through unchanged).
 * - No closing `---` found → `OkfDocumentError` ("Unterminated...").
 * - The YAML between the fences must parse to a mapping (object), not a
 *   scalar or a list → `OkfDocumentError` otherwise.
 * - Malformed YAML → `OkfDocumentError` wrapping the parser's message.
 * - Exactly one leading blank line after the closing fence is trimmed from
 *   the body (matches the reference's `body.startswith("\n")` single-strip).
 */
export function parseOkfDocument(text: string): OkfDocument {
  const lines = text.split(/\r\n|\r|\n/);

  if (lines.length === 0 || lines[0].trim() !== FRONTMATTER_DELIM) {
    return { frontmatter: {}, body: text };
  }

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === FRONTMATTER_DELIM) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    throw new OkfDocumentError('Unterminated YAML frontmatter block');
  }

  const frontmatterText = lines.slice(1, endIdx).join('\n');
  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatterText);
  } catch (err) {
    throw new OkfDocumentError(
      `Invalid YAML in frontmatter: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  parsed = parsed ?? {};
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new OkfDocumentError('Frontmatter must be a YAML mapping');
  }

  let body = lines.slice(endIdx + 1).join('\n');
  if (body.startsWith('\n')) {
    body = body.slice(1);
  }

  return { frontmatter: parsed as Record<string, unknown>, body };
}

/**
 * {59.28} — shared sidecar-path helpers for the Q&A corpus sidecar (the
 * `__qa__/` reserved-prefix `.md` files cocoindex re-walks into
 * `q_a_extractions`).
 *
 * This module is the SINGLE serialisation contract shared by every Q&A leg:
 * the corpus-promotion emit ({59.29}), the user-direct write-back emit
 * ({59.30}), and the golden-fixture round-trip proof ({59.32}). Direct imports
 * only — no barrel re-exports (CLAUDE.md).
 *
 * Three concerns:
 *   1. `sdUuid5(relPath)`        — the TS mirror of the Python `sd:`-seeded
 *                                  uuid5 PK, the linkage anchor for
 *                                  `q_a_pairs.source_document_id` (INV-8).
 *   2. `qaSidecarRelPath(seed)`  — the `__qa__/`-prefixed, UUID-keyed rel_path
 *                                  for a pair/extraction (INV-20 path stability).
 *   3. `serialiseCarriedSet` /   — the markdown round-trip for the INV-2 CARRIED
 *      `parseCarriedSet`           set ONLY (no lifecycle state ever touches the
 *                                  file).
 */
import { createHash } from 'node:crypto';

// SOURCE OF TRUTH: scripts/cocoindex_pipeline/flow.py:1612 (_KH_PIPELINE_DOC_NS).
// Must stay bit-for-bit identical (INV-8/INV-20). Derived once as
// uuid5(NAMESPACE_DNS, "kh-pipeline.cocoindex.document-identity.v1") and pinned
// on BOTH sides. A cross-language parity test
// (__tests__/lib/q-a-pairs/sidecar-path.test.ts) shells out to python3 and
// asserts `sdUuid5(relPath)` equals `uuid.uuid5(_KH_PIPELINE_DOC_NS,
// "sd:"+relPath)` so any drift fails CI rather than silently orphaning the
// linkage anchor.
const KH_PIPELINE_DOC_NS = 'fbfaf1ff-1ee4-583c-9757-1674465b2ec1';

/**
 * RFC 4122 §4.3 name-based (SHA-1) UUID — the bit-for-bit TS mirror of Python
 * `uuid.uuid5(namespace, name)` (`scripts/cocoindex_pipeline/flow.py:1612`).
 *
 * Zero-dependency ON PURPOSE: the `uuid` npm package is NOT a declared
 * dependency (only a transitive one) and the shared `node_modules` is read-only,
 * so we own this tiny primitive on Node's stdlib `crypto` and pin its
 * correctness with the cross-language parity test rather than risk a transitive
 * drift silently breaking the forever-stable INV-8/INV-20 linkage anchor.
 *
 * Algorithm: SHA-1 over (namespace 16 bytes ++ name UTF-8 bytes), take the
 * first 16 bytes, set the version (5) and RFC 4122 variant bits, hex-format.
 */
function uuid5(name: string, namespaceUuid: string): string {
  const ns = Buffer.from(namespaceUuid.replace(/-/g, ''), 'hex');
  const bytes = createHash('sha1')
    .update(ns)
    .update(Buffer.from(name, 'utf8'))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The reserved sidecar prefix. Files under this prefix are recognised by the
 * frozen walk gate ({59.26}, `flow.py` resolve_route) and routed to the
 * Q&A-only branch — they mint `source_documents` + `q_a_extractions` ONLY, never
 * `content_items`. Keep in sync with the Python freeze gate.
 */
export const QA_SIDECAR_PREFIX = '__qa__';

/**
 * The TS mirror of the Python `sd:`-seeded document-identity uuid5.
 *
 * Python (the source of truth, `flow.py`):
 *   `uuid.uuid5(_KH_PIPELINE_DOC_NS, f"sd:{rel_path}")`
 * TS (this function, MUST produce the identical uuid):
 *   `uuid5("sd:" + relPath, KH_PIPELINE_DOC_NS)` (local crypto helper above).
 *
 * `relPath` is the source-relative POSIX path consumed VERBATIM — it is the
 * uuid5 seed, so any normalisation here would mint a different identity and
 * orphan the linkage (INV-1/INV-20). Callers pass the same rel_path the Python
 * walk would compute (e.g. the output of `qaSidecarRelPath`).
 */
export function sdUuid5(relPath: string): string {
  return uuid5(`sd:${relPath}`, KH_PIPELINE_DOC_NS);
}

/**
 * The `__qa__/`-prefixed rel_path for a pair/extraction sidecar.
 *
 * Format: `__qa__/<seed>.md` — a UUID-keyed filename so a reorg WITHIN the
 * reserved prefix never changes the path the linkage derives from (INV-20 path
 * stability). The `seed` is the stable pair/extraction key (a UUID); it is the
 * filename stem so the on-disk file is trivially traceable back to its row.
 *
 * The golden fixture ({59.32}) PINS this exact shape — keep it simple and
 * deterministic. `seed` is consumed verbatim; callers pass a stable id.
 */
export function qaSidecarRelPath(seed: string): string {
  return `${QA_SIDECAR_PREFIX}/${seed}.md`;
}

/**
 * The INV-2 CARRIED set — the ONLY fields that round-trip through the sidecar
 * file. Lifecycle state (edit_intent / valid_from / valid_to / created_at /
 * updated_at / source_document_id / publication_status / ids / embeddings) is
 * STRUCTURALLY excluded: it is never serialised and never parsed, so a re-walk
 * cannot resurrect stale lifecycle from the file (INV-9 not-round-tripped).
 *
 * Defined explicitly (rather than `Pick<Tables<'q_a_pairs'>, …>`) so the carried
 * boundary is self-documenting and lifecycle keys cannot leak in via a widened
 * Row type. Field semantics mirror the `q_a_pairs` columns:
 *   - question_text:                 NOT NULL text
 *   - answer_standard:               NOT NULL text
 *   - answer_advanced:               nullable text (omitted from the file when
 *                                    null/absent — INV "when present")
 *   - alternate_question_phrasings:  text[] NOT NULL DEFAULT '{}'
 *   - scope_tag / anti_scope_tag:    nullable text
 */
export interface CarriedSet {
  question_text: string;
  answer_standard: string;
  answer_advanced?: string | null;
  alternate_question_phrasings: string[];
  scope_tag?: string | null;
  anti_scope_tag?: string | null;
}

// ── Frontmatter encoding ──────────────────────────────────────────────────────
// The structured fields (scope_tag / anti_scope_tag / alternate_question_
// phrasings) live in a minimal YAML frontmatter block; the free-text fields
// (question + answers, which are themselves markdown and may span many lines)
// live in `##`-delimited body sections. We hand-roll a TINY YAML subset rather
// than depend on a YAML library: the schema is fixed and closed, the values are
// scalars/string-arrays, and a JSON-encoded scalar form keeps every value
// LOSSLESS (newlines, quotes, leading/trailing whitespace, `: ` sequences) so
// `parseCarriedSet(serialiseCarriedSet(x))` is an exact inverse. JSON is a
// strict subset of YAML flow syntax, so the frontmatter stays valid YAML and
// remains human-readable for simple values.

const FRONTMATTER_FENCE = '---';
const Q_HEADING = '## Question';
const A_STANDARD_HEADING = '## Answer (standard)';
const A_ADVANCED_HEADING = '## Answer (advanced)';

const KNOWN_HEADINGS = [
  Q_HEADING,
  A_STANDARD_HEADING,
  A_ADVANCED_HEADING,
] as const;

// ── Reversible heading-escaping ({59.34}, bl-350) ─────────────────────────────
// splitBodySections detects a section boundary by STRICT whole-line equality
// (`isKnownHeading`), so a CARRIED field value whose body contains a BARE line
// exactly equal to a known heading would mis-split on parse — truncating the
// field and spilling a spurious section ({59.32} could only BOUND this). We make
// the round-trip lossless with a minimal, reversible backslash-prefix escape:
//
//   serialise: a body line that — IGNORING any leading backslashes — is exactly
//              a known heading gets ONE more leading backslash:
//                `## Question`    -> `\## Question`
//                `\## Question`   -> `\\## Question`   (escape-the-escape)
//   parse:     such an escaped line (one-or-more backslashes + a known heading)
//              has exactly ONE leading backslash stripped on read.
//
// A line is treated as a section boundary ONLY when it is a bare (zero-backslash)
// known heading (`isKnownHeading`), so escaping triggers EXCLUSIVELY on a
// colliding line and the output for every NON-colliding pair stays byte-identical
// (the {59.32} golden byte-pin is unaffected). Human-readable + LLM-benign.
//
// The pattern anchors the WHOLE line: `^(\\*)(<heading>)$`. The heading alts are
// fixed literals (no regex metacharacters beyond the parens in
// "## Answer (standard)", which are escaped below), so the match is exact.
const HEADING_ALTERNATION = KNOWN_HEADINGS.map((h) =>
  h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
).join('|');
const ESCAPABLE_HEADING_LINE = new RegExp(`^(\\\\*)(${HEADING_ALTERNATION})$`);

/**
 * Escape every body line that — ignoring leading backslashes — is exactly a
 * known heading, by prepending one backslash. Non-colliding lines are returned
 * verbatim, so a body with no colliding line is byte-identical to its input.
 */
function escapeHeadingCollisions(body: string): string {
  return body
    .split('\n')
    .map((line) => (ESCAPABLE_HEADING_LINE.test(line) ? `\\${line}` : line))
    .join('\n');
}

/**
 * Inverse of `escapeHeadingCollisions`: strip exactly one leading backslash from
 * any line that is one-or-more backslashes followed by a known heading. A bare
 * (zero-backslash) known heading is never reached here — it was consumed as a
 * section boundary by `splitBodySections` — so this only un-escapes the escaped
 * forms, fully reversing the serialise-side escape at every backslash depth.
 */
function unescapeHeadingCollisions(body: string): string {
  return body
    .split('\n')
    .map((line) =>
      ESCAPABLE_HEADING_LINE.test(line) && line.startsWith('\\')
        ? line.slice(1)
        : line,
    )
    .join('\n');
}

/**
 * Serialise the CARRIED set to the canonical sidecar markdown.
 *
 * Shape (pinned for NEW-OQ-26-2; {59.32} golden fixture locks it):
 *
 *   ---
 *   scope_tag: <json-scalar | null>
 *   anti_scope_tag: <json-scalar | null>
 *   alternate_question_phrasings: <json-array>
 *   ---
 *
 *   ## Question
 *
 *   <question_text>
 *
 *   ## Answer (standard)
 *
 *   <answer_standard>
 *
 *   ## Answer (advanced)      ← ONLY when answer_advanced is present (non-null)
 *
 *   <answer_advanced>
 *
 * NO lifecycle keys appear anywhere in the output (INV-9 / INV-11 — assert the
 * string contains none of edit_intent / valid_from / source_document_id /
 * created_at / …).
 */
export function serialiseCarriedSet(pair: CarriedSet): string {
  const frontmatter = [
    FRONTMATTER_FENCE,
    `scope_tag: ${encodeScalar(pair.scope_tag ?? null)}`,
    `anti_scope_tag: ${encodeScalar(pair.anti_scope_tag ?? null)}`,
    `alternate_question_phrasings: ${encodeArray(
      pair.alternate_question_phrasings,
    )}`,
    FRONTMATTER_FENCE,
  ].join('\n');

  // Escape any bare-heading collision in each field body so a value that
  // contains a line exactly equal to a section heading does not mis-split on
  // parse ({59.34}). Non-colliding bodies pass through unchanged (byte-identical
  // output for normal pairs — the {59.32} golden byte-pin is preserved).
  const sections = [
    `${Q_HEADING}\n\n${escapeHeadingCollisions(pair.question_text)}`,
    `${A_STANDARD_HEADING}\n\n${escapeHeadingCollisions(pair.answer_standard)}`,
  ];
  // INV "when present": the advanced answer section is emitted only when the
  // pair carries a non-null answer_advanced — round-trips back to `undefined`.
  if (pair.answer_advanced != null) {
    sections.push(
      `${A_ADVANCED_HEADING}\n\n${escapeHeadingCollisions(pair.answer_advanced)}`,
    );
  }

  return `${frontmatter}\n\n${sections.join('\n\n')}\n`;
}

/**
 * Parse the canonical sidecar markdown back into the CARRIED set — the exact
 * inverse of `serialiseCarriedSet`. `parseCarriedSet(serialiseCarriedSet(x))`
 * deep-equals the carried subset of `x` (the absent advanced section parses
 * back to an absent key, not `null`).
 *
 * Throws on a structurally invalid sidecar (missing frontmatter fence or a
 * required body section) rather than returning a partial set — a malformed
 * sidecar is a corpus integrity fault the caller must surface, never silently
 * coerce to defaults.
 */
export function parseCarriedSet(md: string): CarriedSet {
  const { frontmatter, body } = splitFrontmatter(md);

  const scope_tag = decodeScalar(
    readFrontmatterValue(frontmatter, 'scope_tag'),
  );
  const anti_scope_tag = decodeScalar(
    readFrontmatterValue(frontmatter, 'anti_scope_tag'),
  );
  const alternate_question_phrasings = decodeArray(
    readFrontmatterValue(frontmatter, 'alternate_question_phrasings'),
  );

  const sections = splitBodySections(body);
  const question_text = requireSection(sections, Q_HEADING);
  const answer_standard = requireSection(sections, A_STANDARD_HEADING);
  const advanced = sections.get(A_ADVANCED_HEADING);

  const carried: CarriedSet = {
    question_text,
    answer_standard,
    alternate_question_phrasings,
  };
  // Inverse of the "when present" emit: an absent advanced section parses back
  // to an absent key (not null), so the round-trip deep-equals a pair authored
  // without answer_advanced.
  if (advanced !== undefined) carried.answer_advanced = advanced;
  if (scope_tag !== null) carried.scope_tag = scope_tag;
  if (anti_scope_tag !== null) carried.anti_scope_tag = anti_scope_tag;

  return carried;
}

// ── Internal: lossless scalar/array codec (JSON-as-YAML-subset) ───────────────

/** A nullable string scalar → `null` literal or a JSON-quoted string. */
function encodeScalar(value: string | null): string {
  return value === null ? 'null' : JSON.stringify(value);
}

function decodeScalar(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === 'null' || trimmed === '') return null;
  return JSON.parse(trimmed) as string;
}

/** A string[] → a JSON array literal (valid YAML flow sequence). */
function encodeArray(values: string[]): string {
  return JSON.stringify(values);
}

function decodeArray(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'null') return [];
  return JSON.parse(trimmed) as string[];
}

// ── Internal: structural split helpers ────────────────────────────────────────

/**
 * Split the leading `---`-fenced frontmatter from the body. The first line MUST
 * be the opening fence; the next `---` on its own line closes it.
 */
function splitFrontmatter(md: string): { frontmatter: string; body: string } {
  const lines = md.split('\n');
  if (lines[0]?.trim() !== FRONTMATTER_FENCE) {
    throw new Error(
      'parseCarriedSet: sidecar is missing the opening frontmatter fence (---)',
    );
  }
  const closeIdx = lines.indexOf(FRONTMATTER_FENCE, 1);
  if (closeIdx === -1) {
    throw new Error(
      'parseCarriedSet: sidecar frontmatter is not terminated by a closing fence (---)',
    );
  }
  return {
    frontmatter: lines.slice(1, closeIdx).join('\n'),
    body: lines.slice(closeIdx + 1).join('\n'),
  };
}

/** Read a single `key: value` line out of the frontmatter block. */
function readFrontmatterValue(frontmatter: string, key: string): string {
  const prefix = `${key}:`;
  const line = frontmatter.split('\n').find((l) => l.startsWith(prefix));
  if (line === undefined) {
    throw new Error(
      `parseCarriedSet: sidecar frontmatter is missing required key '${key}'`,
    );
  }
  return line.slice(prefix.length);
}

/**
 * Split the body into a heading → content map keyed by the `## ` headings. The
 * content is everything between a heading and the next heading (or EOF), with
 * the single leading and single trailing blank-line separators stripped so the
 * value is the original field text.
 */
function splitBodySections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = body.split('\n');
  let currentHeading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentHeading !== null) {
      // Strip the serialiser's separators, then reverse the heading-escaping so
      // a bare-heading body line is restored to its original text ({59.34}). A
      // bare (zero-backslash) heading was already consumed as a boundary below,
      // so only the escaped forms are un-escaped here.
      sections.set(
        currentHeading,
        unescapeHeadingCollisions(trimSectionBody(buffer.join('\n'))),
      );
    }
  };

  for (const line of lines) {
    // A line is a section boundary ONLY when it is a bare (un-escaped) known
    // heading — an escaped collision (`\## Question`) is body content and is
    // un-escaped by `flush`, never treated as a boundary.
    if (isKnownHeading(line)) {
      flush();
      currentHeading = line;
      buffer = [];
    } else if (currentHeading !== null) {
      buffer.push(line);
    }
  }
  flush();

  return sections;
}

function isKnownHeading(line: string): boolean {
  return (
    line === Q_HEADING ||
    line === A_STANDARD_HEADING ||
    line === A_ADVANCED_HEADING
  );
}

/**
 * Strip exactly the serialiser's separators: the single blank line after the
 * heading and the single trailing blank line before the next heading / the
 * file's terminal newline. The field's own internal blank lines are preserved.
 */
function trimSectionBody(content: string): string {
  let out = content;
  if (out.startsWith('\n')) out = out.slice(1);
  if (out.endsWith('\n')) out = out.slice(0, -1);
  return out;
}

function requireSection(
  sections: Map<string, string>,
  heading: string,
): string {
  const value = sections.get(heading);
  if (value === undefined) {
    throw new Error(
      `parseCarriedSet: sidecar body is missing the required '${heading}' section`,
    );
  }
  return value;
}

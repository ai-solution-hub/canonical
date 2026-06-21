/**
 * ID-59 {59.32} — Q&A sidecar round-trip + N-time idempotency GOLDEN FIXTURE
 * (serialisation leg). Folds bl-324 (the idempotency assertion).
 *
 * Spec: specs/id-59-concurrent-edit-intent-arbitration/TECH-qa-sidecar-canonical.md
 *       T1 (round-trip + N-time fixpoint) + the NEW-OQ-26-2 frontmatter shape.
 * Product invariants: INV-16 (carried byte-for-byte + not-carried preserved),
 *                     INV-17 (N>=3 stable fixpoint, no churn/drift).
 *
 * This is the TypeScript half of the {59.32} golden fixture. The Python half
 * (`scripts/tests/test_qa_sidecar_roundtrip.py`) proves the WALK leg (re-walk
 * mints identical deterministic PKs + INV-20 path stability); THIS file proves
 * the SERIALISATION leg that the round-trip rides on:
 *
 *   edit (carried set) -> serialiseCarriedSet -> bytes ON DISK -> read back ->
 *   parseCarriedSet -> the carried set is BYTE-FOR-FOR identical (INV-16), and
 *   the NOT-CARRIED lifecycle set is preserved because it NEVER enters the file
 *   (INV-9 — the file cannot carry, hence cannot mangle, lifecycle state).
 *
 * It uses a REAL temp directory (a stand-in for the `__qa__/` sidecar on the
 * COCOINDEX_SOURCE_PATH-bound folder) so the round-trip is proven against actual
 * bytes on disk, not an in-memory string — mirroring the {59.9}/{59.29}
 * file-backed proofs. Behaviour-first per test-philosophy.md: the test asserts
 * the round-trip BEHAVIOUR (carried equality, fixpoint stability, the documented
 * edge-case limitation), never the serialisation internals.
 *
 * NEW-OQ-26-2: the golden fixture PINS the concrete frontmatter shape here — any
 * future drift in serialiseCarriedSet's output breaks the byte-pin below.
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  serialiseCarriedSet,
  parseCarriedSet,
  qaSidecarRelPath,
  type CarriedSet,
} from '@/lib/q-a-pairs/sidecar-path';

// ---------------------------------------------------------------------------
// The GOLDEN carried-set fixture — the canonical edited pair the round-trip
// proves. Exercises every carried field: a multi-line answer, an advanced
// answer with markdown, phrasings, scope tags, and a £ (multi-byte) glyph.
// ---------------------------------------------------------------------------
const GOLDEN_PAIR: CarriedSet = {
  question_text: 'What is the maximum contract value under the framework?',
  answer_standard:
    'The maximum contract value is £5m over the framework term.\n\n' +
    'Call-off contracts may set a lower ceiling.',
  answer_advanced:
    'Per clause 4.2 the aggregate ceiling is £5m;\n\n' +
    '- frameworks MAY set a lower call-off cap\n' +
    '- the cap is inclusive of optional extensions',
  alternate_question_phrasings: [
    'How much can the contract be worth?',
    "What's the contract ceiling?",
  ],
  scope_tag: 'procurement',
  anti_scope_tag: 'sales',
};

/** The not-carried (lifecycle) set that must NEVER appear in the sidecar bytes
 *  (INV-9). Their absence FROM THE FILE is what preserves them on a re-walk —
 *  a re-extract cannot resurrect lifecycle it never read. This is the INV-16
 *  "all not-carried preserved" guarantee at the serialisation boundary. */
const NOT_CARRIED_KEYS = [
  'edit_intent',
  'valid_from',
  'valid_to',
  'created_at',
  'updated_at',
  'source_document_id',
  'publication_status',
  'question_embedding',
  'superseded_by',
  'source_workspace_id',
  'origin_kind',
];

describe('{59.32} golden fixture — sidecar round-trip (edit -> disk -> read -> parse)', () => {
  let sourceRoot: string;
  let absPath: string;

  beforeEach(async () => {
    sourceRoot = await mkdtemp(join(tmpdir(), 'kh-qa-golden-'));
    // The canonical __qa__/<seed>.md path the emit legs write to.
    const relPath = qaSidecarRelPath('11111111-1111-4111-8111-111111111111');
    absPath = join(sourceRoot, relPath);
  });

  afterEach(async () => {
    await rm(sourceRoot, { recursive: true, force: true });
  });

  /** Write the carried set to the real sidecar file via the production
   *  serialiser; mkdir the __qa__/ dir first (the emit legs do this too). */
  async function writeSidecar(pair: CarriedSet): Promise<void> {
    const { mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, serialiseCarriedSet(pair), 'utf8');
  }

  /** Read the sidecar file back and parse it — the re-extract analogue. */
  async function readSidecar(): Promise<CarriedSet> {
    return parseCarriedSet(await readFile(absPath, 'utf8'));
  }

  // -------------------------------------------------------------------------
  // INV-16: the carried set survives edit -> disk -> read -> parse byte-for-byte.
  // -------------------------------------------------------------------------
  it('INV-16: the carried set round-trips through a real file byte-for-byte', async () => {
    await writeSidecar(GOLDEN_PAIR);
    const parsed = await readSidecar();
    expect(parsed).toEqual(GOLDEN_PAIR);
  });

  // -------------------------------------------------------------------------
  // INV-16 (not-carried preserved): the bytes on disk carry NONE of the
  // lifecycle keys — so a re-walk's re-extract cannot resurrect stale lifecycle
  // from the file. The not-carried set is preserved on the pair precisely
  // because the canonical file is carried-only.
  // -------------------------------------------------------------------------
  it('INV-16: the sidecar bytes carry NO lifecycle keys (not-carried preserved by absence)', async () => {
    await writeSidecar(GOLDEN_PAIR);
    const onDisk = await readFile(absPath, 'utf8');
    for (const key of NOT_CARRIED_KEYS) {
      expect(onDisk).not.toContain(key);
    }
  });

  // -------------------------------------------------------------------------
  // INV-17 / bl-324: N>=3 write->read->write fixpoint. The bytes on disk are
  // byte-identical every iteration AND the parsed carried set is stable — no
  // oscillation, no drift. This is the metadata-only-edit COCO.10 contract made
  // testable at the serialisation boundary: re-serialising a parsed pair yields
  // the SAME bytes, so a re-walk over an unchanged sidecar is a true no-op.
  // -------------------------------------------------------------------------
  it('INV-17: N>=3 round-trip is a stable fixpoint (identical bytes + parse every iteration, bl-324)', async () => {
    // Iteration 0: the original edit.
    await writeSidecar(GOLDEN_PAIR);
    const bytes0 = await readFile(absPath, 'utf8');
    let current = await readSidecar();

    const N = 4; // >= 3
    for (let i = 1; i <= N; i++) {
      // Re-serialise the parsed pair (the re-promote write-back analogue) and
      // re-read it — the COCO.10 fixpoint: parse∘serialise is the identity.
      await writeSidecar(current);
      const bytesI = await readFile(absPath, 'utf8');
      expect(bytesI).toBe(bytes0); // byte-identical to the original — no drift
      const parsedI = await readSidecar();
      expect(parsedI).toEqual(GOLDEN_PAIR); // carried set unchanged — no churn
      current = parsedI;
    }
  });

  // -------------------------------------------------------------------------
  // A carried set WITHOUT answer_advanced round-trips with the absent key
  // staying absent (the "when present" emit) across the same N-time fixpoint —
  // the absent advanced section never spontaneously appears.
  // -------------------------------------------------------------------------
  it('INV-17: a pair without answer_advanced stays advanced-less across N round-trips', async () => {
    const noAdvanced: CarriedSet = {
      question_text: 'Which regions are in scope?',
      answer_standard: 'England, Scotland, Wales and Northern Ireland.',
      alternate_question_phrasings: [],
    };
    await writeSidecar(noAdvanced);
    let current = await readSidecar();
    for (let i = 0; i < 3; i++) {
      await writeSidecar(current);
      current = await readSidecar();
      expect(current).toEqual(noAdvanced);
      expect('answer_advanced' in current).toBe(false);
      expect(await readFile(absPath, 'utf8')).not.toContain(
        '## Answer (advanced)',
      );
    }
  });

  // -------------------------------------------------------------------------
  // NEW-OQ-26-2: the golden fixture PINS the exact frontmatter + body byte
  // shape. Any drift in serialiseCarriedSet's output breaks this pin (the shape
  // is a cross-tool contract — the Python walk re-extracts from this exact form
  // and both emit legs write it).
  // -------------------------------------------------------------------------
  it('NEW-OQ-26-2: the on-disk shape is the pinned frontmatter + ## section body', async () => {
    await writeSidecar(GOLDEN_PAIR);
    const onDisk = await readFile(absPath, 'utf8');

    const expected = [
      '---',
      'scope_tag: "procurement"',
      'anti_scope_tag: "sales"',
      'alternate_question_phrasings: ["How much can the contract be worth?","What\'s the contract ceiling?"]',
      '---',
      '',
      '## Question',
      '',
      'What is the maximum contract value under the framework?',
      '',
      '## Answer (standard)',
      '',
      'The maximum contract value is £5m over the framework term.',
      '',
      'Call-off contracts may set a lower ceiling.',
      '',
      '## Answer (advanced)',
      '',
      'Per clause 4.2 the aggregate ceiling is £5m;',
      '',
      '- frameworks MAY set a lower call-off cap',
      '- the cap is inclusive of optional extensions',
      '',
    ].join('\n');

    expect(onDisk).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// {59.28}-CARRIED heading-in-content edge case ({59.32} brief: "prove
// splitBodySections handles it OR explicitly document the limitation").
//
// FINDING (documented, not silently worked around): parseCarriedSet's
// splitBodySections uses STRICT WHOLE-LINE equality in isKnownHeading. A CARRIED
// field VALUE that contains a BARE `## Question` / `## Answer (standard)` /
// `## Answer (advanced)` line — one that, after serialisation, sits on its own
// line and exactly equals a section heading — is mis-parsed as a NEW section
// boundary. The round-trip is therefore LOSSY for that pathological value.
//
// This is an ACCEPTED v1 LIMITATION, not a regression — the carried fields are
// Q&A question/answer prose where a line that is EXACTLY `## Answer (standard)`
// and nothing else is rare/pathological. A robust fix (escaping bare headings,
// or a length-prefixed/fenced body encoding) is tracked as a follow-up
// (OQ-32-1, surfaced to the Curator for a backlog item). These tests
// CHARACTERISE the current behaviour so the limitation is visible and any future
// fix flips them deliberately.
// ---------------------------------------------------------------------------
describe('{59.32} edge case — heading-in-content (documented limitation, strict-equality isKnownHeading)', () => {
  it('LIMITATION: answer_standard containing a BARE "## Question" line does NOT round-trip', () => {
    const pathological: CarriedSet = {
      question_text: 'Outer question?',
      answer_standard:
        'Intro line.\n\n## Question\n\nThis line LOOKS like a heading but is answer content.',
      alternate_question_phrasings: [],
    };
    const round = parseCarriedSet(serialiseCarriedSet(pathological));
    // The bare `## Question` inside the answer is mis-read as a section
    // boundary: the content after it is mis-assigned to question_text and the
    // answer is truncated. The round-trip is LOSSY (the documented limitation).
    expect(round).not.toEqual(pathological);
    expect(round.answer_standard).toBe('Intro line.');
    expect(round.question_text).toBe(
      'This line LOOKS like a heading but is answer content.',
    );
  });

  it('LIMITATION: answer_advanced containing a BARE "## Answer (standard)" line does NOT round-trip', () => {
    const pathological: CarriedSet = {
      question_text: 'Outer question?',
      answer_standard: 'The standard answer.',
      answer_advanced:
        'Advanced intro.\n\n## Answer (standard)\n\nNested-looking heading inside the advanced body.',
      alternate_question_phrasings: [],
    };
    const round = parseCarriedSet(serialiseCarriedSet(pathological));
    expect(round).not.toEqual(pathological);
    // The bare heading inside answer_advanced clobbers answer_standard.
    expect(round.answer_standard).toBe(
      'Nested-looking heading inside the advanced body.',
    );
  });

  it('BOUNDED: the limitation is NARROW — a non-bare inline heading round-trips fine', () => {
    // The limitation is ONLY the bare, whole-line, exact-match case. A heading
    // that is NOT exactly a known section heading — a deeper level (`### …`),
    // indented, or with trailing text — is NOT a false boundary and round-trips
    // losslessly. This bounds the blast radius of the documented limitation.
    // NB: null scope tags round-trip to ABSENT keys (the same "when present"
    // semantics as answer_advanced), so the fixture omits them — the BOUNDED
    // proof is about the heading-detection blast radius, not the tag codec.
    const safe: CarriedSet = {
      question_text:
        'A question mentioning ### Question (deeper level) inline.',
      answer_standard:
        'An answer with `## Answer (standard)` in a code span and a ' +
        '## Answer (standard) heading that has trailing text so it is not bare.',
      answer_advanced:
        'Advanced body referencing #### Answer (advanced) at a deeper level.',
      alternate_question_phrasings: ['phrase about ## Question wording'],
    };
    // None of these lines is EXACTLY a known heading (deeper level / trailing
    // text / inside a phrasing array which never goes through the body split),
    // so the round-trip is lossless.
    expect(parseCarriedSet(serialiseCarriedSet(safe))).toEqual(safe);
  });
});

/**
 * {59.28} — shared sidecar-path helpers.
 *
 * Spec: specs/id-59-concurrent-edit-intent-arbitration/TECH-qa-sidecar-canonical.md
 *       "Shared helpers introduced" + the Risks "Cross-language uuid5 drift
 *       (HIGH)" mitigation + NEW-OQ-26-2 (markdown shape).
 * Product invariants tested: INV-2 (carried set only), INV-8 (linkage anchor /
 *                            uuid5 parity), INV-20 (path stability).
 *
 * The load-bearing proof is the cross-language uuid5 PARITY: `sdUuid5(relPath)`
 * (TS) MUST equal `uuid.uuid5(_KH_PIPELINE_DOC_NS, "sd:"+rel_path)` (Python,
 * `scripts/cocoindex_pipeline/flow.py`). It is proven LIVE by shelling out to
 * python3 in-test — a true cross-language proof, not a hard-coded expectation —
 * so any future drift on either side fails CI rather than silently orphaning
 * `q_a_pairs.source_document_id`.
 *
 * Tests verify OBSERVABLE BEHAVIOUR (the round-trip equality, the cross-language
 * value equality, the absence of lifecycle keys in the file) — not the
 * serialisation internals.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

import {
  sdUuid5,
  qaSidecarRelPath,
  serialiseCarriedSet,
  parseCarriedSet,
  QA_SIDECAR_PREFIX,
  type CarriedSet,
} from '@/lib/q-a-pairs/sidecar-path';

// The namespace pinned on BOTH sides (flow.py:1612 _KH_PIPELINE_DOC_NS). The
// parity test passes it to python3 so the Python reference is computed from the
// SAME constant the TS module embeds — drift on either constant fails the proof.
const KH_PIPELINE_DOC_NS = 'fbfaf1ff-1ee4-583c-9757-1674465b2ec1';

/**
 * The Python reference for `uuid.uuid5(_KH_PIPELINE_DOC_NS, "sd:"+relPath)`,
 * computed live. relPath is passed via argv (not interpolated into the program
 * string) so arbitrary path content — nested dirs, spaces, unicode — is shelled
 * safely.
 */
function pythonSdUuid5(relPath: string): string {
  return execFileSync(
    'python3',
    [
      '-c',
      'import sys, uuid; ' +
        "print(uuid.uuid5(uuid.UUID(sys.argv[1]), 'sd:' + sys.argv[2]))",
      KH_PIPELINE_DOC_NS,
      relPath,
    ],
    { encoding: 'utf8' },
  ).trim();
}

describe('sdUuid5 — cross-language uuid5 parity with the Python pipeline (INV-8, HIGH risk)', () => {
  // Representative relPaths: a plain file, nested dirs, the canonical __qa__/
  // sidecar shape, a path with a space, and a unicode path — each must mint the
  // IDENTICAL uuid both sides.
  const relPaths = [
    'foo.md',
    'corpus/test/answer.md',
    '__qa__/11111111-1111-4111-8111-111111111111.md',
    'corpus/with space/answer.md',
    'corpus/ünïcødé/answer.md',
  ];

  for (const relPath of relPaths) {
    it(`sdUuid5(${JSON.stringify(relPath)}) === python3 uuid5("sd:"+relPath)`, () => {
      const ts = sdUuid5(relPath);
      const py = pythonSdUuid5(relPath);
      expect(ts).toBe(py);
    });
  }

  it('mints a v5-shaped UUID (RFC 4122 version nibble = 5)', () => {
    const id = sdUuid5('corpus/test/answer.md');
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('is deterministic — the same relPath always mints the same id', () => {
    expect(sdUuid5('corpus/test/answer.md')).toBe(
      sdUuid5('corpus/test/answer.md'),
    );
  });
});

describe('qaSidecarRelPath — __qa__/-prefixed, UUID-keyed path (INV-20 path stability)', () => {
  it('returns __qa__/<seed>.md', () => {
    const seed = '11111111-1111-4111-8111-111111111111';
    expect(qaSidecarRelPath(seed)).toBe(`${QA_SIDECAR_PREFIX}/${seed}.md`);
  });

  it('is keyed solely on the seed — the path is invariant to anything else (INV-20)', () => {
    const seed = '22222222-2222-4222-8222-222222222222';
    expect(qaSidecarRelPath(seed)).toBe(qaSidecarRelPath(seed));
  });

  it("the derived path falls under the reserved prefix so the walk's Q&A branch claims it", () => {
    expect(
      qaSidecarRelPath('33333333-3333-4333-8333-333333333333').startsWith(
        `${QA_SIDECAR_PREFIX}/`,
      ),
    ).toBe(true);
  });
});

describe('serialiseCarriedSet / parseCarriedSet — INV-2 carried-set round-trip', () => {
  const withAdvanced: CarriedSet = {
    question_text: 'What is the maximum contract value?',
    answer_standard:
      'The maximum contract value is £5m over the framework term.',
    answer_advanced:
      'Per clause 4.2, the ceiling is £5m aggregate;\n\nframeworks may set a lower call-off cap.',
    alternate_question_phrasings: [
      'How much can the contract be worth?',
      "What's the contract ceiling?",
    ],
    scope_tag: 'procurement',
    anti_scope_tag: 'sales',
  };

  const withoutAdvanced: CarriedSet = {
    question_text: 'Which regions are in scope?',
    answer_standard: 'England, Scotland, Wales and Northern Ireland.',
    alternate_question_phrasings: [],
    scope_tag: null,
    anti_scope_tag: null,
  };

  it('round-trips the full carried set (with answer_advanced) byte-for-byte', () => {
    const parsed = parseCarriedSet(serialiseCarriedSet(withAdvanced));
    expect(parsed).toEqual(withAdvanced);
  });

  it('round-trips a carried set WITHOUT answer_advanced — the absent key stays absent', () => {
    const parsed = parseCarriedSet(serialiseCarriedSet(withoutAdvanced));
    expect(parsed).toEqual({
      question_text: withoutAdvanced.question_text,
      answer_standard: withoutAdvanced.answer_standard,
      alternate_question_phrasings: [],
    });
    // The "when present" emit means an absent advanced answer parses back to an
    // ABSENT key (not null) — assert it is not introduced.
    expect('answer_advanced' in parsed).toBe(false);
  });

  it('preserves multi-line answers and special characters in the body', () => {
    const tricky: CarriedSet = {
      question_text: 'Edge: a question with: a colon and a "quote"',
      answer_standard:
        'Line one.\n\nLine two with a trailing newline preserved.\n',
      answer_advanced: '- bullet\n- another: with colon\n\n> a blockquote',
      alternate_question_phrasings: ['phrase: with colon', 'phrase "quoted"'],
      scope_tag: 'tag-with-special: chars',
      anti_scope_tag: 'another "quoted" tag',
    };
    expect(parseCarriedSet(serialiseCarriedSet(tricky))).toEqual(tricky);
  });

  it('the serialised markdown contains NONE of the lifecycle keys (INV-9 / INV-11)', () => {
    const md = serialiseCarriedSet(withAdvanced);
    const forbidden = [
      'edit_intent',
      'valid_from',
      'valid_to',
      'created_at',
      'updated_at',
      'source_document_id',
      'publication_status',
      'question_embedding',
      'superseded_by',
      'origin_kind',
      'status',
    ];
    for (const key of forbidden) {
      expect(md).not.toContain(key);
    }
  });

  it('serialises the pinned shape: --- frontmatter + ## Question / ## Answer (standard) / ## Answer (advanced) body', () => {
    const md = serialiseCarriedSet(withAdvanced);
    // NEW-OQ-26-2 shape pin ({59.32} golden fixture locks this exact shape).
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('\nscope_tag: ');
    expect(md).toContain('\nanti_scope_tag: ');
    expect(md).toContain('\nalternate_question_phrasings: ');
    expect(md).toContain('## Question');
    expect(md).toContain('## Answer (standard)');
    expect(md).toContain('## Answer (advanced)');
  });

  it('omits the ## Answer (advanced) section entirely when answer_advanced is absent', () => {
    const md = serialiseCarriedSet(withoutAdvanced);
    expect(md).not.toContain('## Answer (advanced)');
  });

  it('treats answer_advanced: null the same as absent (no advanced section emitted)', () => {
    const md = serialiseCarriedSet({
      ...withoutAdvanced,
      answer_advanced: null,
    });
    expect(md).not.toContain('## Answer (advanced)');
    const parsed = parseCarriedSet(md);
    expect('answer_advanced' in parsed).toBe(false);
  });

  it('throws on a structurally invalid sidecar rather than coercing to defaults', () => {
    // Missing frontmatter fence entirely.
    expect(() => parseCarriedSet('no frontmatter here')).toThrow(/frontmatter/);
    // Complete frontmatter but a missing required body section (## Answer
    // (standard)) — surfaced as a fault, not coerced to a default.
    expect(() =>
      parseCarriedSet(
        '---\nscope_tag: null\nanti_scope_tag: null\nalternate_question_phrasings: []\n---\n\n## Question\n\nq only\n',
      ),
    ).toThrow(/Answer \(standard\)/);
  });
});

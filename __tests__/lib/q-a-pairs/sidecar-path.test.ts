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

// ---------------------------------------------------------------------------
// {59.34} (bl-350) — heading-in-content round-trip: reversible heading-escaping.
//
// Spec: specs/id-59-concurrent-edit-intent-arbitration/TECH-qa-sidecar-canonical.md
//       (NEW-OQ-26-2 body shape) + the {59.32} documented limitation this leg
//       resolves. Product invariant: INV-16 (carried byte-for-byte round-trip)
//       extended to cover the pathological bare-heading-in-content case that
//       {59.32} could only BOUND, not fix.
//
// ROOT CAUSE (now fixed): splitBodySections used STRICT whole-line equality, so
// a carried field value whose body contained a BARE line exactly equal to a
// known section heading mis-split as a section boundary. The fix escapes only a
// COLLIDING body line (a line that, ignoring leading backslashes, is exactly a
// known heading) with a single leading backslash on serialise, and strips
// exactly one leading backslash from such lines on parse — reversible, and
// "escape-the-escape" so a value that already looks like the escaped form round-
// trips too. Behaviour-first: these assert the round-trip BEHAVIOUR, not the
// concrete backslash byte form.
// ---------------------------------------------------------------------------
describe('serialiseCarriedSet / parseCarriedSet — {59.34} bare-heading-in-content round-trip', () => {
  // (a) Each carried free-text field, in turn, contains a BARE line that is
  // exactly a known section heading. Each must round-trip losslessly now.
  const bareHeadingCases: Array<{ name: string; pair: CarriedSet }> = [
    {
      name: 'question_text contains a bare "## Question" line',
      pair: {
        question_text:
          'Intro to the question.\n\n## Question\n\nThis line is bare-heading content, not a boundary.',
        answer_standard: 'The standard answer.',
        alternate_question_phrasings: [],
      },
    },
    {
      name: 'answer_standard contains a bare "## Question" line',
      pair: {
        question_text: 'Outer question?',
        answer_standard:
          'Intro line.\n\n## Question\n\nThis line LOOKS like a heading but is answer content.',
        alternate_question_phrasings: [],
      },
    },
    {
      name: 'answer_standard contains a bare "## Answer (standard)" line',
      pair: {
        question_text: 'Outer question?',
        answer_standard:
          'A standard answer that quotes its own\n\n## Answer (standard)\n\nheading on a bare line.',
        alternate_question_phrasings: [],
      },
    },
    {
      name: 'answer_advanced contains a bare "## Answer (standard)" line',
      pair: {
        question_text: 'Outer question?',
        answer_standard: 'The standard answer.',
        answer_advanced:
          'Advanced intro.\n\n## Answer (standard)\n\nNested-looking heading inside the advanced body.',
        alternate_question_phrasings: [],
      },
    },
    {
      name: 'answer_advanced contains a bare "## Answer (advanced)" line',
      pair: {
        question_text: 'Outer question?',
        answer_standard: 'The standard answer.',
        answer_advanced:
          'Advanced intro.\n\n## Answer (advanced)\n\nThe advanced body quoting its own heading.',
        alternate_question_phrasings: [],
      },
    },
    {
      name: 'every free-text field contains a different bare heading at once',
      pair: {
        question_text: 'Q intro.\n\n## Answer (advanced)\n\nQ outro.',
        answer_standard: 'A-std intro.\n\n## Question\n\nA-std outro.',
        answer_advanced: 'A-adv intro.\n\n## Answer (standard)\n\nA-adv outro.',
        alternate_question_phrasings: ['a phrasing', 'another'],
        scope_tag: 'procurement',
        anti_scope_tag: 'sales',
      },
    },
    {
      name: 'a body that is ONLY a bare heading line (no surrounding content)',
      pair: {
        question_text: '## Question',
        answer_standard: '## Answer (standard)',
        answer_advanced: '## Answer (advanced)',
        alternate_question_phrasings: [],
      },
    },
  ];

  for (const { name, pair } of bareHeadingCases) {
    it(`(a) round-trips losslessly when ${name}`, () => {
      const parsed = parseCarriedSet(serialiseCarriedSet(pair));
      expect(parsed).toEqual(pair);
    });
  }

  // (b) Escape-the-escape: a body line that is LITERALLY the escaped form of a
  // heading must round-trip exactly — escaping is fully reversible at every
  // backslash depth, so a value the user wrote that already looks like the
  // escape output is never silently un-escaped into a heading-collision.
  const escapeTheEscapeCases: string[] = [
    '\\## Question', // one backslash — looks like the escaped form
    '\\## Answer (standard)',
    '\\## Answer (advanced)',
    '\\\\## Question', // two backslashes — escaped escape
    '\\\\\\## Answer (advanced)', // three backslashes
  ];

  for (const escaped of escapeTheEscapeCases) {
    it(`(b) escape-the-escape: a bare ${JSON.stringify(escaped)} body line round-trips exactly`, () => {
      const pair: CarriedSet = {
        question_text: `Before.\n\n${escaped}\n\nAfter.`,
        answer_standard: `Std before.\n\n${escaped}\n\nStd after.`,
        answer_advanced: escaped,
        alternate_question_phrasings: [],
      };
      const parsed = parseCarriedSet(serialiseCarriedSet(pair));
      expect(parsed).toEqual(pair);
    });
  }

  // (c) N-time idempotency: serialise(parse(serialise(x))) === serialise(x) for
  // the COLLIDING inputs — the escaped form is a stable fixpoint with no churn
  // or oscillation across repeated round-trips (the re-promote write-back is a
  // true no-op for an unchanged colliding pair).
  it('(c) N-time idempotency: serialise(parse(serialise(x))) is a stable fixpoint for colliding inputs', () => {
    // NB: anti_scope_tag is OMITTED, not set to null — the existing "when
    // present" tag semantics parse an explicit null back to an ABSENT key, so a
    // `null` here would make the deep-equal below spuriously fail on the codec,
    // not the heading-escaping under test. (scope_tag is present to keep the
    // frontmatter exercised.)
    const colliding: CarriedSet = {
      question_text: 'Q intro.\n\n## Answer (advanced)\n\nQ outro.',
      answer_standard:
        'A-std intro.\n\n## Question\n\nA-std outro.\n\n\\## Answer (standard)\n\ndeeper.',
      answer_advanced: 'A-adv.\n\n## Answer (standard)\n\nbody.',
      alternate_question_phrasings: ['p1'],
      scope_tag: 'procurement',
    };

    const s0 = serialiseCarriedSet(colliding);
    let current = s0;
    for (let i = 0; i < 4; i++) {
      const reSerialised = serialiseCarriedSet(parseCarriedSet(current));
      expect(reSerialised).toBe(s0); // byte-identical fixpoint, no drift
      // …and the parsed carried set stays deep-equal to the original.
      expect(parseCarriedSet(reSerialised)).toEqual(colliding);
      current = reSerialised;
    }
  });

  // (d) Regression guard: NON-colliding pairs stay BYTE-IDENTICAL — escaping
  // triggers ONLY on a colliding line, so the existing serialiser output (and
  // the {59.32} golden byte-pin) is unchanged for every normal pair. A body
  // line that is NOT bare (deeper level, trailing text, inline) is NOT escaped.
  it('(d) regression guard: a NON-colliding pair serialises byte-identically (no spurious escaping)', () => {
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
    // The serialised output must contain NO backslash-escaped heading — nothing
    // here is a bare, whole-line, exact-match heading, so nothing is escaped.
    const md = serialiseCarriedSet(safe);
    expect(md).not.toContain('\\## Question');
    expect(md).not.toContain('\\## Answer (standard)');
    expect(md).not.toContain('\\## Answer (advanced)');
    // And it still round-trips losslessly.
    expect(parseCarriedSet(md)).toEqual(safe);
  });
});

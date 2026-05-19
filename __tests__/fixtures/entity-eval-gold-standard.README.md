# Entity Classification Gold Standard — Fixture Provenance

**Fixture file:** `entity-eval-gold-standard.json` **Item count:** 67 (as of S157 WP1,
09/04/2026) **Consumed by:** `scripts/eval-entity-classification.ts`,
`__tests__/eval/entity-classification-eval.test.ts` (EVAL_ENTITY=1 mode),
`__tests__/validation/eval-fixture-sync.test.ts`.

## History

| Commit       | Date       | Action                                                                             | Net items |
| ------------ | ---------- | ---------------------------------------------------------------------------------- | --------- |
| `0450a033`   | 01/04/2026 | Created — 67 hand-labelled items against real ingested `content_items`             | 67        |
| `a0bec425`   | 03/04/2026 | S151 — added 18 items to cover missing entity types                                | 85        |
| `92b0b959`   | 05/04/2026 | S155 — added 10 items for BERTScore integration                                    | 95        |
| `<S157 WP1>` | 09/04/2026 | **S157 WP1** — removed 28 phantoms (see below); restored to 67-item clean baseline | 67        |

## Why 28 items were removed in S157 WP1

The 28 items added across `a0bec425` and `92b0b959` were hand-authored fixture entries
whose `content_item_id` UUIDs **did not exist in `content_items`**. They scored as 100%
false-negative on every `--live` run (the classifier threw `Content item not found` and
they contributed 0 extractions), which dragged down aggregate recall and
exclusion_compliance without touching precision.

Full analysis is in `docs/audits/s154-entity-classification-diagnostic-report.md` §D-Q2.
Pre-cleanup:

- 95 items total, 201 expected entities, 210 excluded entities
- 28 phantoms contributed 74/201 expected (36.8%) and 66/210 excluded (31.4%) to
  denominators but 0 to numerators
- Real recall on the 67 real items measured ~96%; reported aggregate was 60.7%

Post-cleanup (67 items, this file): metrics are meaningful again and every iteration can
be measured against a clean baseline.

## Follow-up item (separate session)

Removing the 28 phantoms dropped the all-12-entity-type coverage that S151/S155 attempted.
A follow-up session will re-expand the fixture **from real ingested `content_items` rows**
(not hand-invented body text). Plan at
`docs/specs/entity-fixture-real-content-expansion-plan.md` (to be written), roadmap item
§1.6a.

## Invariants

- Every `content_item_id` in this file **must resolve** to an existing row in
  `content_items`. Verify via a Supabase audit query before committing any addition.
- The `eval-fixture-sync.test.ts` guard requires `length >= 60`.
- `expected_entities[].canonical_name` must be lowercased.
- `excluded_entities[].reason` must be a human-readable explanation of why the classifier
  should NOT extract the entity.

## Baseline file

Associated baseline at
`__tests__/fixtures/eval-baselines/entity-classification.baseline.json`. After any fixture
change, the baseline **must** be re-saved via:

```bash
bun run scripts/eval-entity-classification.ts --live --validate --confirm --save-baseline
```

Use `dangerouslyDisableSandbox: true` when running (Bun fetch 204 hangs through the
sandbox proxy — see `CLAUDE.md` § Gotchas § Supabase).

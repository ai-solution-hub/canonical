# Retrieval stays on the text spine; PixelRAG rejected on measured evidence

Crosswalk: DR-154

## Context

Page-as-image retrieval (PixelRAG) was evaluated as a general replacement for chunking and
text retrieval, judged on value alone with integration cost excluded. A spike ran three arms
over 82 ground-truth queries against real form fixtures, under decision rules committed before
the measurement — including a ≥10pp evidence-recall bar for adoption.

## Decision

Retrieval stays on the text spine: conversion → chunk → embed → retrieve. PixelRAG is rejected
as a replacement, having measured +1.5pp evidence recall@3 (0.667 vs 0.652) against the 10pp
bar, with accuracy indistinguishable and ~2.2× read cost. No vision index and no second
datastore.

## Alternatives considered

- **PixelRAG retrieval with a text reader** — the strongest published configuration; measured
  here and did not clear the bar on this corpus.
- **Full pixel pipeline** — 2.2× read cost for no accuracy gain.
- **Hybrid dual-index** — unjustified by the margins, and adds a second datastore to a
  two-person operational surface.

## Consequences

- Footnote-class evidence was PixelRAG's one decisive win (+57pp) and is recovered on the text
  side first, via footnote-aware conversion.
- If footnote-aware conversion does not close that class, a *targeted* deferred-visual
  fallback — fetching the page image at read time for footnote-class misses only — is the
  sanctioned pattern. A general vision index is not.
- The retrieval approach is unchanged, so no re-extraction burn is owed.
- The next retrieval lever is a text reranker: ecosystem evidence puts it at +13.2pp against
  +0.2pp for visual reranking.
- Measured baseline recall@3 = 0.65 is the reference point for match-rate targets.

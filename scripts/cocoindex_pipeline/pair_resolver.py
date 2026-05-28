"""KH-owned `PairResolver` implementation for cocoindex Stage-5 entity-resolution.

Hosts:
  - `KhPairResolver` — LLM-backed `PairResolver` Protocol implementation with
    persistent determinism cache backed by `public.entity_pair_resolutions`
    (§P-9 migration). Implements PRODUCT Inv-14 — re-running Stage-5 on the
    same input produces the same canonical mapping byte-for-byte (cache hits
    replay prior LLM decisions without re-invoking the model).

The resolver consumes the cocoindex 1.0.3 `PairResolver` Protocol shape
(empirically verified at TECH §7):

    async def __call__(self, entity: str, candidates: list[str]) -> PairDecision

One `KhPairResolver` instance is constructed per (run × entity_type) batch by
Stage-5 (§P-6, owned by Subtask {53.13}). The `entity_type` scopes the cache
key per P-OQ3 ratification — `'Cisco'` as `organisation` vs `technology`
resolve to independent cache rows.

Cache shape: `(name_a, name_b, entity_type, decision, op_id)` with a UNIQUE
constraint on `(name_a, name_b, entity_type)`. `name_a` is the lexicographically
smaller of the (entity, candidate) pair at insert time, so `(a, b)` and
`(b, a)` hit the same cache row. `op_id` records the run that originated the
decision for audit-forensics.

LLM invocation mirrors the existing `extract_*` patterns in `extraction.py`:
Anthropic SDK call wrapped by `_anthropic_retry` (tenacity, 4 attempts on
transient errors). Prompt + parser shape per T-OQ2 thin-string-parser
ratification (TECH §5): temperature=0, max_tokens=4, no Pydantic — strip +
lowercase the response, take the first whitespace-delimited token; fail-safe
defaults to `"different"` on parse failure or any unexpected response.

References:
- `docs/specs/stage-5-entity-resolution/PRODUCT.md` Inv-14 (cache persistence).
- `docs/specs/stage-5-entity-resolution/TECH.md` §P-8 (class body),
  §5 T-OQ2 (thin string-parser), §P-9 (cache table migration).
- `scripts/cocoindex_pipeline/extraction.py` — `_anthropic_retry`,
  `ANTHROPIC_MODEL` pattern this module mirrors.
- `supabase/migrations/20260528122543_id53_entity_mentions_op_id_and_pair_cache.sql`
  — `entity_pair_resolutions` cache table.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

import anthropic

from scripts.cocoindex_pipeline.extraction import (
    ANTHROPIC_MODEL,
    _anthropic_retry,
)

if TYPE_CHECKING:  # pragma: no cover
    import asyncpg

    from cocoindex.ops.entity_resolution import PairDecision


# Pair-resolution prompt — VERBATIM per TECH §P-8 / T-OQ2 ratification.
# UK English is NOT enforced inside the prompt (keep as TECH-spec'd); the
# rest of the module — comments, docstrings, commit message — uses UK
# English per CLAUDE.md.
_PAIR_RESOLUTION_PROMPT_TEMPLATE = (
    "Are these two entity names referring to the same real-world thing? "
    'Reply with exactly "same" or "different".\n'
    "Name A: {name_a}\n"
    "Name B: {name_b}"
)

# Token budget — the prompt instructs the LLM to reply with one of two
# short tokens (`same` / `different`), so 4 tokens is a generous ceiling
# that still keeps wall-clock latency low (no rationale text emitted).
_PAIR_RESOLUTION_MAX_TOKENS = 4

# Temperature=0 minimises stochasticity within a fixed model version
# (full determinism is impossible across model versions per TECH §P-8
# rationale — the cache layer guarantees re-run determinism).
_PAIR_RESOLUTION_TEMPERATURE = 0


class KhPairResolver:
    """LLM-backed `PairResolver` with persistent determinism cache.

    PRODUCT.md Inv-14: decisions persist across runs via the
    `entity_pair_resolutions` cache table (§P-9). Re-running Stage-5 on
    the same input produces the same canonical mapping byte-for-byte —
    cache hits replay prior LLM decisions without re-invoking the model.

    Construction is keyword-only (per TECH §P-8 signature contract). One
    instance per (run × entity_type) batch — Stage-5 ({53.13}) constructs
    a fresh resolver for each entity_type group it submits to
    `cocoindex.ops.entity_resolution.resolve_entities`.
    """

    def __init__(
        self,
        *,
        db_pool: "asyncpg.Pool",
        op_id: UUID,
        entity_type: str,
    ) -> None:
        # Per Inv-14 + P-OQ3 cache-keying rationale: one KhPairResolver
        # instance per (run × entity_type) batch. The entity_type passed
        # to the cache lookup / INSERT below scopes the cache key — same
        # (name_a, name_b) under different entity_type values resolve to
        # independent cache rows (e.g. 'Cisco' as organisation vs
        # technology).
        self._pool = db_pool
        self._op_id = op_id
        self._entity_type = entity_type

    async def __call__(
        self,
        entity: str,
        candidates: list[str],
    ) -> "PairDecision":
        """cocoindex `PairResolver` Protocol entry point.

        Iterates candidates; for each, calls `_resolve_one_pair`. On the
        first `"same"` decision, returns
        `PairDecision(matched=candidate, canonical=<longer name>)`. If no
        candidate matches, returns `PairDecision(matched=None, canonical=None)`.

        Canonical preference per TECH §P-8: the longer / more-disambiguating
        name wins (`max((entity, candidate), key=len)`).
        """
        # Lazy import — keeps cocoindex out of module-import-time so unit
        # tests can stub the dependency surface without resolving the real
        # cocoindex 1.0.3 Rust engine.
        from cocoindex.ops.entity_resolution import PairDecision

        for candidate in candidates:
            decision = await self._resolve_one_pair(entity, candidate)
            if decision == "same":
                # Canonical preference: the longer / more-disambiguating name wins.
                canonical = max((entity, candidate), key=len)
                return PairDecision(matched=candidate, canonical=canonical)
        return PairDecision(matched=None, canonical=None)

    async def _resolve_one_pair(self, name_a: str, name_b: str) -> str:
        """Resolve one (name_a, name_b) pair via cache-first lookup.

        Lexicographic ordering of the pair at lookup + insert time ensures
        `(a, b)` and `(b, a)` hit the same cache row. The cache row is
        scoped by `self._entity_type` per P-OQ3 ratification.

        Returns `"same"` or `"different"`.
        """
        # Lexicographic-order key so (a,b) and (b,a) hit the same row.
        key_a, key_b = sorted((name_a, name_b))

        # Cache lookup. Use the pool's acquire context — no transaction
        # needed for a single read (Postgres autocommit on a single SELECT
        # is sufficient).
        async with self._pool.acquire() as conn:
            cached = await conn.fetchval(
                "SELECT decision FROM public.entity_pair_resolutions "
                "WHERE name_a = $1 AND name_b = $2 AND entity_type = $3",
                key_a,
                key_b,
                self._entity_type,
            )
            if cached is not None:
                return cached

        # Cache miss: invoke the LLM.
        decision = await self._invoke_llm(key_a, key_b)

        # Write back to cache. `ON CONFLICT (name_a, name_b, entity_type)
        # DO NOTHING` is the race-safety mechanism per TECH §P-8 (P-OQ2
        # narrow race window documented + accepted): two concurrent
        # invocations on the same triple both INSERT, but the second is
        # swallowed by the conflict clause — exactly one row materialises
        # and no UNIQUE-violation exception surfaces to the caller.
        async with self._pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO public.entity_pair_resolutions "
                "(name_a, name_b, entity_type, decision, op_id) "
                "VALUES ($1, $2, $3, $4, $5) "
                "ON CONFLICT (name_a, name_b, entity_type) DO NOTHING",
                key_a,
                key_b,
                self._entity_type,
                decision,
                self._op_id,
            )
        return decision

    async def _invoke_llm(self, name_a: str, name_b: str) -> str:
        """Invoke the Anthropic SDK to classify whether two names refer
        to the same real-world entity.

        Returns `"same"` or `"different"`. T-OQ2 ratified parser per TECH
        §5: strip + lowercase the response, take the first whitespace-
        delimited token; if the token is exactly `"same"` return `"same"`,
        otherwise return `"different"` (fail-safe — parse failure or any
        unexpected response defaults to `"different"`, protecting the
        canonicalisation surface from LLM hallucination).

        Anthropic SDK invocation mirrors `extract_classification` in
        `extraction.py`: same client construction (`AsyncAnthropic()`),
        same `_anthropic_retry` tenacity wrapper, same `ANTHROPIC_MODEL`.
        """
        client = anthropic.AsyncAnthropic()  # picks up ANTHROPIC_API_KEY from env

        prompt = _PAIR_RESOLUTION_PROMPT_TEMPLATE.format(
            name_a=name_a,
            name_b=name_b,
        )

        response = await _anthropic_retry(
            lambda: client.messages.create(
                model=ANTHROPIC_MODEL,
                max_tokens=_PAIR_RESOLUTION_MAX_TOKENS,
                temperature=_PAIR_RESOLUTION_TEMPERATURE,
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
            )
        )

        response_text = response.content[0].text

        # Thin string-parser (T-OQ2 Option (b) ratified): strip + lowercase
        # + first-token; fail-safe → "different" on anything but exact "same".
        first_token = response_text.strip().lower().split()
        if first_token and first_token[0] == "same":
            return "same"
        return "different"

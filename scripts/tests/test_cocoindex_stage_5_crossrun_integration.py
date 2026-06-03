"""GATED cross-run integration shells for Stage-5 existing-canonical seeding.

WHY GATED (read before un-gating)
---------------------------------
These tests prove the END-TO-END cross-run consequence of ID-81 seeding that the
real-body unit tests (`test_cocoindex_stage_5_resolution.py`) cannot: TWO real
pipeline runs against a live Postgres (distinct op_ids) converging on ONE
canonical, a PINNED override of a longer name by run 2, NULL-op_id chaining, and
`full_reprocess` byte-for-byte idempotency (TECH §5 Inv-2/Inv-3/Inv-6-NULLop/
Inv-14).

They require TWO real pipeline runs against a DB and MUST NOT run against the
parent's shared staging branch (`turayklvaunphgbgscat`). Per TECH §5
"Integration-test guard", they are tagged for a CONTROLLED run (a local Supabase
stack or a dedicated ephemeral branch) the parent orchestrates — NEVER as part
of the default `python3 -m pytest scripts/tests/` sweep, and NEVER against
shared staging.

GATING MECHANISM
----------------
Every test is `@pytest.mark.skipif(not os.getenv("KH_RUN_STAGE5_INTEGRATION"))`,
so by default pytest COLLECTS them (they appear in the run as `s`/SKIPPED) but
NEVER executes them. The asyncpg connection is created INSIDE each test function
(never at import/collection time) so collection touches no DB and reads no
connection string. To run them in a controlled environment, set
`KH_RUN_STAGE5_INTEGRATION=1` AND point `KH_STAGE5_INTEGRATION_DSN` at a
DISPOSABLE database (local stack / ephemeral branch) — NOT shared staging.

These are authored shells: the structure, fixtures, and assertions encode the
acceptance criteria so the controlled-run operator can fill the run-harness
plumbing (two `app_main` invocations / two op_ids over the same corpus) without
re-deriving the proof obligations. Each body raises a clear NotImplementedError
guiding the operator, so an accidental un-gate fails loudly rather than silently
passing a hollow test.

References:
- `docs/specs/ID-81-canonical-stability/TECH.md` §5 (the per-invariant table;
  the integration rows are Inv-2/Inv-3/Inv-6-NULLop/Inv-14) + §5 guard note.
- `docs/specs/ID-81-canonical-stability/PRODUCT.md` Inv-2, Inv-3, Inv-6, Inv-14.
"""

from __future__ import annotations

import os

import pytest

# ── Gate (collected-but-skipped by default) ───────────────────────────────────
#
# CONTROLLED-RUN ONLY. The reason string names the shared-staging prohibition so
# a future reader cannot miss why the gate exists.
_INTEGRATION_ENABLED = bool(os.getenv("KH_RUN_STAGE5_INTEGRATION"))
_SKIP_REASON = (
    "cross-run integration — controlled DB run only, not shared staging "
    "(turayklvaunphgbgscat). Set KH_RUN_STAGE5_INTEGRATION=1 + "
    "KH_STAGE5_INTEGRATION_DSN=<disposable-db> to enable (ID-81 TECH §5)."
)

# Module-level guard: even when collected, the heavy run-harness import below is
# deferred into each test body so collection never touches a DB or asyncpg.
pytestmark = pytest.mark.skipif(not _INTEGRATION_ENABLED, reason=_SKIP_REASON)


def _require_disposable_dsn() -> str:
    """Return the disposable-DB DSN, refusing the shared staging branch.

    Called INSIDE a test body (never at import/collection). Fails loudly if the
    DSN is missing or points at shared staging — the safety interlock that makes
    an accidental un-gate against staging impossible.
    """
    dsn = os.getenv("KH_STAGE5_INTEGRATION_DSN")
    if not dsn:
        raise RuntimeError(
            "KH_STAGE5_INTEGRATION_DSN is unset — refusing to guess a DB. Point "
            "it at a DISPOSABLE local stack or ephemeral branch (NOT staging)."
        )
    if "turayklvaunphgbgscat" in dsn:
        raise RuntimeError(
            "KH_STAGE5_INTEGRATION_DSN points at the SHARED STAGING branch "
            "(turayklvaunphgbgscat) — these cross-run integration tests MUST NOT "
            "run against shared staging (ID-81 TECH §5). Use a disposable DB."
        )
    return dsn


# ── Inv-2: same entity across two runs → one canonical ────────────────────────


def test_crossrun_same_entity_converges_to_one_canonical() -> None:
    """Inv-2: the same entity + entity_type ingested in run 1 and run 2 (distinct
    op_ids) carries ONE canonical_name after both runs complete — the value run 1
    first materialised.

    Operator harness (controlled run): ingest a corpus producing a canonical of
    one entity_type in run 1 (op_id A); ingest a corpus whose per-doc canonical is
    a near-match of run 1's canonical in run 2 (op_id B); after both
    `pipeline_runs.status='completed'`, assert `SELECT DISTINCT canonical_name
    FROM entity_mentions WHERE entity_type = $1 AND canonical_name IN (run1, run2)`
    returns exactly ONE value (run 1's pinned canonical).
    """
    _require_disposable_dsn()
    raise NotImplementedError(
        "Inv-2 cross-run convergence: operator wires two app_main runs (distinct "
        "op_ids) over the seeding corpus, then asserts SELECT DISTINCT "
        "canonical_name returns ONE value (run 1's). See TECH §5 Inv-2."
    )


# ── Inv-3: PINNED override of a longer name (prior-run canonical never demoted) ─


def test_crossrun_pinned_override_of_longer_name() -> None:
    """Inv-3: run 1 pins the short canonical "eir 2004"; run 2's longer per-doc
    canonical "environmental information regulations 2004" chains UNDER it; the
    prior-run row is byte-for-byte unchanged (PINNED never demotes the existing).

    Operator harness: run 1 ingests a doc yielding canonical "eir 2004" (op_id A);
    snapshot that row's columns. Run 2 ingests a doc whose per-doc canonical is the
    longer form (op_id B). After run 2 completes, assert run 2's row carries
    "eir 2004" (chained under the shorter PINNED existing, NOT the reverse) and the
    run-1 row is unchanged (Inv-3 + Inv-7 write-scope).
    """
    _require_disposable_dsn()
    raise NotImplementedError(
        "Inv-3 PINNED override: operator pins a short canonical in run 1, ingests "
        "a longer near-match in run 2, asserts run 2 chains UNDER run 1's short "
        "canonical and the run-1 row is unchanged. See TECH §5 Inv-3."
    )


# ── Inv-6 (NULL-op_id case): app-side canonical is an eligible chaining target ──


def test_crossrun_null_op_id_canonical_chains() -> None:
    """Inv-6 (NULL-op_id arm): a canonical written app-side with NULL op_id
    (`classifyContent` / Admin curation) is an eligible chaining target — a
    later run's near-match chains under it (op-AGNOSTIC roster read).

    Operator harness: INSERT an entity_mentions row with NULL op_id and a known
    canonical (the app-side write shape). Then run a pipeline pass (op_id A) whose
    per-doc canonical near-matches the NULL-op row. After completion, assert the
    run's row carries the NULL-op canonical (chained under it) and the NULL-op row
    is byte-for-byte unchanged (READ op-agnostic, WRITE op_id-scoped — Inv-7/11).
    """
    _require_disposable_dsn()
    raise NotImplementedError(
        "Inv-6 NULL-op_id chaining: operator seeds a NULL-op_id app-side canonical, "
        "runs a pass with a near-match, asserts the run chains under it and the "
        "NULL-op row is unchanged. See TECH §5 Inv-6 (integration NULL-op case)."
    )


# ── Inv-14: full_reprocess byte-for-byte idempotency ──────────────────────────


def test_crossrun_full_reprocess_idempotent_mapping() -> None:
    """Inv-14: re-running Stage-5 over the same corpus via `full_reprocess`
    produces the SAME canonical mapping — the set of (per-document-name →
    resolved-canonical) pairs in run 2 matches run 1 byte-for-byte.

    Operator harness: run 1 ingests a corpus that triggers seeding-based chaining
    (op_id A); capture the (per-doc-name → resolved-canonical) pair set. Trigger a
    `full_reprocess` (op_id B) over the SAME corpus; capture its pair set. Assert
    the two pair sets are equal (no cross-run flip — PINNED + the KhPairResolver
    determinism cache + seed-set order normalisation via sorted(entities)).
    """
    _require_disposable_dsn()
    raise NotImplementedError(
        "Inv-14 full_reprocess idempotency: operator captures the (per-doc-name → "
        "resolved-canonical) pair set in run 1, full_reprocesses as run 2, asserts "
        "the pair sets match byte-for-byte. See TECH §5 Inv-14."
    )

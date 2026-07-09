"""ID-138 {138.15} R(a) — SEED-CONTRACT freeze: identity-neutral corpus lift.

Behaviour proof that lifting the admitted corpus into the durable corpus
bucket at `object_key = source_documents.storage_path` (the admission-time
`rel_path`, TECH.md §2.1 R(a)) is an IDENTITY-NEUTRAL migration: recomputing
every frozen uuid5 seed from the SAME (unchanged) keys the lift preserves
yields the SAME ids the pipeline already minted — zero identity churn
(s440 §5.1, DR-023).

The lift is, by ruling, the IDENTITY FUNCTION on the key: `object_key :=
storage_path` VERBATIM — no re-encode, no case-fold, no prefix. That is
precisely what makes it identity-neutral. `test_a_transformed_key_would_*`
below is the disproof-by-construction the Checker's testStrategy requires: it
shows a HYPOTHETICAL non-identity lift (one that transformed the key) WOULD
churn `source_documents.id` — i.e. this suite has teeth, it is not a vacuous
tautology that would pass no matter what the lift did.

SEED-CONTRACT formulas under test (byte-for-byte against
`scripts/cocoindex_pipeline/flow.py`, current as of this Subtask — mirrored in
`specs/id-138-corpus-durable-home/SEED-CONTRACT.md`):
  - `sd:{rel_path}`                          admission-time mint ONLY
    (flow.py:1994 provisional-log-id comment + the {138.6} SQL resolver's
    byte-identical formula, `20260703160100_id138_admission_identity_fn.sql:70-71`)
  - `ci:{source_document_id}`                registry-keyed since {138.10}
    (flow.py:2174)
  - `chunk:{source_document_id}:{position}`   registry-keyed (flow.py:2349, 3503)
  - `qa:{source_document_id}:{idx}`           registry-keyed (flow.py:2395, 3529)
  - `ri:{url}`                                URL-ingest identity (flow.py:3870)
    — never a bucket object, untouched by a corpus-bucket lift by definition

KNOWN EXCEPTION (documented, not remediated here): `em:`/`er:` seeds in the
engine-declared content branch (`_ingest_content_branch`, flow.py:2507/2581)
remain `rel_path`-keyed (F4 gap — tracked, rebuildable engine class,
accepted). A RENAME would re-mint those two rows; that is a rename-tolerance
concern (R(id), covered by `test_cocoindex_identity_core.py`), not a
bucket-lift concern — a lift never renames anything, so it does not
exercise this gap. Not asserted here.

Reference: TECH.md §2.1 R(a), §4 ("R(a) identity-neutral migration" test row).
"""

from __future__ import annotations

import uuid

import pytest

from conftest import fresh_flow_module


def _flow_module():
    return fresh_flow_module()


# Frozen literal (not imported from flow.py) so a namespace drift in the
# pipeline fails THIS suite loudly rather than silently comparing against
# itself — same discipline as test_cocoindex_identity_core.py:43-46.
_NS = uuid.UUID("fbfaf1ff-1ee4-583c-9757-1674465b2ec1")


def _lift_object_key(storage_path: str) -> str:
    """THE lift (TECH.md §2.1 R(a), T1): corpus-bucket `object_key :=
    storage_path`, VERBATIM. No transform of any kind — this identity
    function IS the ruling; the lift changes nothing about the key."""
    return storage_path


class _FixtureDoc:
    """A pre-existing (pre-lift) admitted `source_documents` row, minted
    BEFORE this test runs via the REAL SEED-CONTRACT formula — stands in for
    a row already sitting in the corpus prior to the bucket migration."""

    def __init__(self, rel_path: str) -> None:
        self.storage_path = rel_path  # frozen admission-time key (R(a))
        self.source_document_id = uuid.uuid5(_NS, f"sd:{rel_path}")
        self.content_item_id = uuid.uuid5(_NS, f"ci:{self.source_document_id}")
        self.chunk_id_0 = uuid.uuid5(_NS, f"chunk:{self.source_document_id}:0")
        self.qa_id_0 = uuid.uuid5(_NS, f"qa:{self.source_document_id}:0")


_FIXTURE_CORPUS = [
    _FixtureDoc("markdown/example-co-Bid-Library-2026-v4_4.md"),
    _FixtureDoc("procurement/tender-evaluation-guide.md"),
    _FixtureDoc("nested/dir/onboarding-transcript.md"),
]


class TestIdentityNeutralCorpusLift:
    """R(a): lifting to `object_key = storage_path` changes NOTHING."""

    def test_ns_matches_pipeline(self) -> None:
        flow = _flow_module()
        assert flow._KH_PIPELINE_DOC_NS == _NS, (
            "the frozen SEED-CONTRACT namespace must match flow.py's "
            "_KH_PIPELINE_DOC_NS byte-for-byte — every recomputation below "
            "checks against this namespace, so a silent drift here would "
            "invalidate the whole suite"
        )

    def test_concept_ns_matches_pipeline(self) -> None:
        """ID-132 {132.11} G-EMBED / BI-26: `_KH_CONCEPT_NS` (flow.py:1683) is
        a SECOND frozen SEED-CONTRACT namespace, added for the OKF concept
        producer's `record_embeddings(owner_kind='concept')` embedding key
        (`owner_id = uuid5(_KH_CONCEPT_NS, concept_rel_path)`). It MUST NOT
        change after the first OKF bundle publish (BI-20/BI-21) — a drift
        here silently orphans the bundle vector index, exactly the hazard
        `test_ns_matches_pipeline` above guards for `_KH_PIPELINE_DOC_NS`.
        Pinned two ways: against the frozen literal (independent of any
        recomputation) AND against its derivation formula
        `uuid5(_KH_PIPELINE_DOC_NS, "concept")` (flow.py:1681 comment)."""
        flow = _flow_module()
        _CONCEPT_NS = uuid.UUID("fd4ba596-2223-591b-b25c-1046022aced5")
        assert flow._KH_CONCEPT_NS == _CONCEPT_NS, (
            "_KH_CONCEPT_NS must match the frozen literal byte-for-byte — a "
            "silent drift here would orphan every concept's bundle vector "
            "index entry after first publish (BI-20/BI-21/BI-26)"
        )
        assert flow._KH_CONCEPT_NS == uuid.uuid5(flow._KH_PIPELINE_DOC_NS, "concept"), (
            "_KH_CONCEPT_NS must equal uuid5(_KH_PIPELINE_DOC_NS, 'concept') — "
            "its documented derivation formula (flow.py:1681)"
        )

    @pytest.mark.parametrize("doc", _FIXTURE_CORPUS, ids=lambda d: d.storage_path)
    def test_lift_preserves_object_key_verbatim(self, doc: _FixtureDoc) -> None:
        lifted_key = _lift_object_key(doc.storage_path)
        assert lifted_key == doc.storage_path, (
            "R(a): the corpus-bucket object key must equal storage_path VERBATIM"
        )

    @pytest.mark.parametrize("doc", _FIXTURE_CORPUS, ids=lambda d: d.storage_path)
    def test_sd_seed_unchanged_across_lift(self, doc: _FixtureDoc) -> None:
        """Recomputing `sd:{rel_path}` from the (unchanged) lifted key yields
        the SAME `source_document_id` the pipeline already minted — the lift
        introduces zero identity churn for the register row."""
        lifted_key = _lift_object_key(doc.storage_path)
        recomputed = uuid.uuid5(_NS, f"sd:{lifted_key}")
        assert recomputed == doc.source_document_id

    @pytest.mark.parametrize("doc", _FIXTURE_CORPUS, ids=lambda d: d.storage_path)
    def test_derived_seeds_unchanged_across_lift(self, doc: _FixtureDoc) -> None:
        """`ci:`/`chunk:`/`qa:` are registry-keyed on `source_document_id`
        ({138.10}), which the lift never touches — invariant BY CONSTRUCTION.
        Recompute + assert equality against the fixture for concreteness."""
        assert uuid.uuid5(_NS, f"ci:{doc.source_document_id}") == doc.content_item_id
        assert uuid.uuid5(_NS, f"chunk:{doc.source_document_id}:0") == doc.chunk_id_0
        assert uuid.uuid5(_NS, f"qa:{doc.source_document_id}:0") == doc.qa_id_0

    def test_ri_seed_untouched_by_bucket_lift(self) -> None:
        """`ri:{url}` (reference/URL ingest, flow.py:3870) never sits in the
        corpus bucket — a bucket lift has no operation over it. Zero churn,
        included here for SEED-CONTRACT completeness (TECH.md §2.1 R(a))."""
        url = "https://example.gov.uk/procurement-notice-2026-04"
        before = uuid.uuid5(_NS, f"ri:{url}")
        after = uuid.uuid5(_NS, f"ri:{url}")  # "the lift" — no-op for URL rows
        assert after == before

    # ── The negative assertion: proves the freeze is load-bearing ───────────

    @pytest.mark.parametrize("doc", _FIXTURE_CORPUS, ids=lambda d: d.storage_path)
    def test_a_transformed_key_would_mint_a_different_id(self, doc: _FixtureDoc) -> None:
        """Disproof-by-construction: this suite is not vacuously true. IF the
        lift were NOT identity-preserving on the key — e.g. a hypothetical
        migration that prefixed a folder segment onto every object key —
        the recomputed `sd:` seed WOULD differ from the already-minted
        `source_document_id`. That the REAL lift (§2.1 R(a): object_key =
        storage_path verbatim) does NOT do this is exactly what makes it
        identity-neutral; a transform WOULD churn identity."""
        transformed_key = f"migrated/{doc.storage_path}"
        assert transformed_key != doc.storage_path

        churned = uuid.uuid5(_NS, f"sd:{transformed_key}")
        assert churned != doc.source_document_id, (
            "a transformed object key must mint a DIFFERENT id — proving the "
            "verbatim-identity lift is what prevents churn, not incidental luck"
        )


# ── End-to-end proof against the REAL pipeline walk (not a hand
# reimplementation of the formula) ───────────────────────────────────────────
#
# The fixtures/fakes below are a deliberately minimal subset of the
# `test_cocoindex_identity_core.py` harness (same patterns: `_FakeFile`,
# `_ResolverPool`/`_ResolverConn` doubling for the {138.6} M2 resolver over
# `DB_CTX`) — kept local rather than imported cross-file so this suite stays
# self-contained. See that file for the full rename-tolerance proof (R(id));
# this suite's job is narrower: prove the LIFT specifically (walking the SAME
# rel_path/bytes again because the lift changed no key) is a clean re-walk.


class _FakeTarget:
    def __init__(self, table_name: str) -> None:
        self.table_name = table_name
        self.rows: list[dict] = []

    def declare_row(self, *, row: dict) -> None:
        self.rows.append(row)


class _FakeFile:
    class _FilePath:
        def __init__(self, rel_path) -> None:
            self.path = rel_path

    def __init__(self, rel_path: str, *, data: bytes) -> None:
        from pathlib import Path

        self.file_path = _FakeFile._FilePath(Path(rel_path))
        self._data = data

    async def size(self) -> int:
        return len(self._data)

    async def read(self) -> bytes:
        return self._data

    async def read_text(self) -> str:
        return self._data.decode("utf-8")

    async def content_fingerprint(self) -> bytes:
        import hashlib

        return hashlib.sha256(self._data).digest()


class _ResolverConn:
    def __init__(self, registry: dict) -> None:
        self._registry = registry
        self.executed: list[tuple[str, tuple]] = []
        self.resolved: list[dict] = []

    async def fetchrow(self, sql: str, *args: object):
        assert "resolve_or_mint_source_identity" in sql
        content_hash, rel_path = args[0], args[1]
        existing = self._registry.get(content_hash)
        if existing is not None:
            sd_id, was_minted = existing, False
        else:
            sd_id = uuid.uuid5(_NS, f"sd:{rel_path}")
            self._registry[content_hash] = sd_id
            was_minted = True
        self.resolved.append(
            {"content_hash": content_hash, "rel_path": rel_path, "was_minted": was_minted}
        )
        return {"source_document_id": sd_id, "was_minted": was_minted}

    async def execute(self, sql: str, *args: object) -> str:
        self.executed.append((sql, args))
        return "INSERT 0 1"


class _ResolverAcquire:
    def __init__(self, conn: _ResolverConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> _ResolverConn:
        return self._conn

    async def __aexit__(self, *exc: object) -> None:
        return None


class _ResolverPool:
    def __init__(self, registry: dict) -> None:
        self.conn = _ResolverConn(registry)

    def acquire(self) -> _ResolverAcquire:
        return _ResolverAcquire(self.conn)


def _sd_insert_args(conn: _ResolverConn) -> dict:
    for sql, args in conn.executed:
        if "INSERT INTO public.source_documents" not in sql:
            continue
        cols = sql.split("(", 1)[1].split(")", 1)[0]
        columns = [c.strip() for c in cols.split(",")]
        return dict(zip(columns, args))
    raise AssertionError("no source_documents INSERT captured")


def _stub_seams(flow, monkeypatch: pytest.MonkeyPatch, *, markdown: str) -> None:
    async def _fake_convert(file):
        return markdown

    async def _fake_classification(content_text: str):
        return {
            "content_type": "case_study",
            "primary_domain": "procurement",
            "primary_subtopic": "tender_evaluation",
            "suggested_title": "Doc Title",
        }

    async def _fake_qa(content_text: str):
        return {"qa_pairs": [{"question_text": "What is X?", "answer_text": "X is Y."}]}

    async def _fake_entities(content_text: str):
        return []

    async def _fake_relationships(content_text: str):
        return []

    async def _fake_embed(content_text: str) -> list[float]:
        return [0.0] * 1024

    monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
    monkeypatch.setattr(flow, "extract_classification", _fake_classification)
    monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
    monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
    monkeypatch.setattr(flow, "extract_relationships", _fake_relationships)
    monkeypatch.setattr(flow, "embed_content_text", _fake_embed)


def _walk(flow, registry: dict, rel_path: str, data: bytes, monkeypatch: pytest.MonkeyPatch) -> dict:
    """Drive one real `flow.ingest_file` content-branch walk against the
    {138.6} resolver double, exactly as the production walk calls it."""
    import asyncio

    from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

    _stub_seams(flow, monkeypatch, markdown="# H\n\n" + data.decode("utf-8", "ignore"))

    pool = _ResolverPool(registry)
    monkeypatch.setattr(flow.coco, "use_context", lambda key: pool)

    ci = _FakeTarget("content_items")
    qa = _FakeTarget("q_a_extractions")
    sd = _FakeTarget("source_documents")
    em = _FakeTarget("entity_mentions")

    async def _exercise() -> None:
        async with bind_flow_meta(op_id=uuid.uuid4()):
            await flow.ingest_file(_FakeFile(rel_path, data=data), ci, qa, sd, em, None, None)

    asyncio.run(_exercise())
    return {
        "ci": ci.rows,
        "qa": qa.rows,
        "sd_insert": _sd_insert_args(pool.conn),
        "resolved": pool.conn.resolved,
    }


class TestIdentityNeutralLiftAgainstRealWalk:
    """Proves the lift is identity-neutral end-to-end through the REAL
    pipeline code (not a hand reimplementation of the formula): a document
    admitted BEFORE the lift, then walked AGAIN at the SAME storage_path
    (because the lift is verbatim-identity on the key), resolves to the
    SAME `source_document_id` and does NOT re-mint the derived `ci:`/`qa:`
    rows — a clean re-walk, zero identity churn, matching what the manual
    staging dry-run gate (TECH.md §4) must observe on the synthetic Platform
    corpus."""

    def test_post_lift_rewalk_resolves_same_identity_and_reuses_derived_rows(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        registry: dict = {}
        corpus_bytes = b"synthetic Platform corpus fixture bytes for the lift proof"
        rel_path = "markdown/synthetic-platform-fixture.md"

        pre_lift = _walk(flow, registry, rel_path, corpus_bytes, monkeypatch)
        assert pre_lift["resolved"][0]["was_minted"] is True

        # ── THE LIFT (T1, R(a)): object_key := storage_path VERBATIM. The
        # walk's rel_path input is UNCHANGED by construction — that is the
        # freeze. Re-walking at the (identical) lifted key simulates the
        # post-lift world.
        object_key = _lift_object_key(pre_lift["sd_insert"]["storage_path"])
        assert object_key == rel_path

        post_lift = _walk(flow, registry, object_key, corpus_bytes, monkeypatch)

        assert post_lift["resolved"][0]["was_minted"] is False, (
            "a clean re-walk after the lift must RESOLVE, never re-mint"
        )
        assert post_lift["sd_insert"]["id"] == pre_lift["sd_insert"]["id"], (
            "the lift must not change source_document_id"
        )
        assert post_lift["ci"][0]["id"] == pre_lift["ci"][0]["id"], (
            "the lift must not re-mint the content_items row"
        )
        assert [r["id"] for r in post_lift["qa"]] == [r["id"] for r in pre_lift["qa"]], (
            "the lift must not re-mint the q_a_extractions rows"
        )

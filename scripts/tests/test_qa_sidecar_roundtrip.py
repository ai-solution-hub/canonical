"""ID-59 {59.32} — Q&A sidecar round-trip + N-time idempotency golden fixture
(walk leg) + INV-20 path-stability. Folds bl-324 (the idempotency assertion).

This is the PYTHON half of the {59.32} golden fixture. The TypeScript half
(``__tests__/lib/q-a-pairs/sidecar-roundtrip.golden.test.ts``) proves the
serialisation round-trip and the N-time fixpoint on the carried-set markdown;
THIS file proves the WALK leg that the round-trip depends on:

  - **N>=3 fixpoint (INV-17 / COCO.10 / bl-324):** re-walking the SAME `__qa__/`
    sidecar bytes N times mints IDENTICAL deterministic ``sd:`` / ``qa:`` uuid5
    PKs and identical row payloads every run, so ``declare_row`` UPSERTs the same
    rows rather than minting duplicates — no oscillation, no churn, no drift. The
    only per-run difference is the ``op_id`` ROW FIELD (it identifies the RUN, not
    the row — ratified OQ-A re-stamps the same row's op_id). This is the
    metadata-only-touch memo contract (05-qa-flow.md §5.2) made testable at the
    walk level: stable PKs == the UPSERT short-circuits to the same projection.

  - **INV-20 path stability (05-qa-flow.md §5.5):** the linkage anchor is derived
    from the rel_path (``uuid5("sd:"+rel_path)`` / ``uuid5("qa:"+rel_path+":"+idx)``)
    and the rel_path travels into ``source_documents.storage_path``. A rename
    WITHIN the reserved prefix (``__qa__/foo.md`` -> ``__qa__/sub/foo.md``) re-keys
    on the NEW uuid5 (the keying is genuinely path-derived, proven by inequality
    of the two paths' PKs), and the on-disk path stays traceable via storage_path.
    The pair-non-duplication on a rename is the PROMOTION layer's
    ``promoted_to_pair_id`` anchor (asserted in the promote-corpus suite, not the
    walk) — the walk's contribution is the deterministic re-key proven here.

REAL-BODY discipline (test-philosophy §5.3, mirrors the {59.26} fork-routing
suite): the real ``_ingest_qa_sidecar_branch`` fork body runs UNPATCHED. Only
the outside-world seams (Docling conversion + the Anthropic extraction passes)
are touched, as RECORDING observers — the inner ``extract_qa_form`` is faked to
a deterministic fixed payload so the walk's row-minting is exercised on stable
bytes without a live LLM call.

Async tests follow the repo convention (no pytest-asyncio plugin): drive
coroutines via ``asyncio.run`` inside sync test functions.

Reference:
  specs/id-59-concurrent-edit-intent-arbitration/TECH-qa-sidecar-canonical.md
  T1 (round-trip + N-time fixpoint, folds bl-324) + R3 (INV-20 path stability);
  PRODUCT-qa-sidecar-canonical.md INV-16/INV-17/INV-20.
"""

from __future__ import annotations

import asyncio
import hashlib
import uuid
from pathlib import Path

import pytest

from conftest import fresh_flow_module  # noqa: E402


def _flow_module():
    """Load a fresh stubbed ``cocoindex_pipeline.flow`` (ID-55.1 primitive)."""
    return fresh_flow_module()


class _FakeTarget:
    """Records ``declare_row`` calls without touching any DB (keyword-only
    ``declare_row(*, row)``), mirroring the {59.26} fork-routing double."""

    def __init__(self, table_name: str) -> None:
        self.table_name = table_name
        self.rows: list[dict] = []

    def declare_row(self, *, row: dict) -> None:
        self.rows.append(row)


class _FakeFile:
    """File stand-in with a RELATIVE ``file_path.path`` (production shape post
    ``_to_source_relative``) whose ``read()`` returns the given literal bytes."""

    class _FilePath:
        def __init__(self, rel_path: Path) -> None:
            self.path = rel_path

    def __init__(self, rel_path: str, *, data: bytes = b"") -> None:
        self.file_path = _FakeFile._FilePath(Path(rel_path))
        self._data = data

    async def size(self) -> int:
        return len(self._data)

    async def read(self) -> bytes:
        return self._data

    async def read_text(self) -> str:
        return self._data.decode("utf-8")

    async def content_fingerprint(self) -> bytes:
        return hashlib.sha256(self._data).digest()


def _make_qa_manifest(workspace_id: uuid.UUID, *, prefix: str = "__qa__/"):
    """A real WorkspaceManifest mapping ``prefix`` -> the qa_sidecar route."""
    from scripts.cocoindex_pipeline.workspace_resolver import (
        WorkspaceManifest,
        WorkspaceMapping,
    )

    return WorkspaceManifest(
        schema_version=1,
        mappings=[
            WorkspaceMapping(
                path_prefix=prefix, workspace_id=workspace_id, route="qa_sidecar"
            )
        ],
    )


async def _fake_relationships_empty(content_text: str) -> list:
    return []


def _observe_seams(flow: object, monkeypatch: pytest.MonkeyPatch) -> dict:
    """Replace the outside-world seams with recording observers. The inner
    ``extract_qa_form`` returns a FIXED deterministic payload so the walk mints
    stable rows on stable bytes (no live LLM). The content-only passes
    (classification / entities / embed) must stay at ZERO for a sidecar."""
    calls = {"convert": 0, "classification": 0, "qa": 0, "entities": 0, "embed": 0}

    async def _fake_convert(file: object) -> str:
        calls["convert"] += 1
        # The sidecar IS markdown; the conversion is the identity-ish text read.
        return await file.read_text()

    async def _fake_classification(content_text: str):
        calls["classification"] += 1
        return {"content_type": "case_study"}

    async def _fake_qa(content_text: str):
        calls["qa"] += 1
        # FIXED deterministic two-pair payload — the golden walk fixture's
        # carried set. Stable across every re-walk (no LLM nondeterminism).
        return {
            "extraction_kind": "q_a_form",
            "qa_pairs": [
                {
                    "question_text": "What is the maximum contract value?",
                    "answer_text": "The maximum contract value is £5m.",
                    "question_phrasings": ["How much can the contract be worth?"],
                },
                {
                    "question_text": "Which regions are in scope?",
                    "answer_text": "England, Scotland, Wales and Northern Ireland.",
                    "question_phrasings": [],
                },
            ],
        }

    async def _fake_entities(content_text: str):
        calls["entities"] += 1
        return []

    async def _fake_embed(content_text: str) -> list[float]:
        calls["embed"] += 1
        return [0.0] * 1024

    monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
    monkeypatch.setattr(flow, "extract_classification", _fake_classification)
    monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
    monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
    monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
    monkeypatch.setattr(flow, "embed_content_text", _fake_embed)
    return calls


def _drive_ingest(flow: object, fake_file: object, *, manifest: object) -> dict:
    """Drive one real ``ingest_file`` with all seven targets recording. The
    qa_sidecar branch only writes sd + qa; the other five targets are asserted
    empty (the INV-5 structural guarantee carries through the round-trip)."""
    from scripts.cocoindex_pipeline.flow_context import (
        bind_flow_meta,
        bind_workspace_manifest,
    )

    targets = {
        "ci": _FakeTarget("content_items"),
        "qa": _FakeTarget("q_a_extractions"),
        "sd": _FakeTarget("source_documents"),
        "em": _FakeTarget("entity_mentions"),
        "ft": _FakeTarget("form_templates"),
        "ftf": _FakeTarget("form_template_fields"),
        "cc": _FakeTarget("content_chunks"),
    }
    run_op_id = uuid.uuid4()

    async def _exercise() -> None:
        async with bind_flow_meta(op_id=run_op_id):
            async with bind_workspace_manifest(manifest):
                await flow.ingest_file(
                    fake_file,
                    targets["ci"],
                    targets["qa"],
                    targets["sd"],
                    targets["em"],
                    targets["ft"],
                    targets["ftf"],
                    targets["cc"],
                )

    asyncio.run(_exercise())
    targets["op_id"] = run_op_id  # type: ignore[assignment]
    return targets


def _strip_op_id(rows: list[dict]) -> list[dict]:
    """Drop the per-RUN op_id field so two runs' row payloads compare equal on
    everything that defines the ROW (op_id is re-stamped per run by design)."""
    return [{k: v for k, v in r.items() if k != "op_id"} for r in rows]


class TestQaSidecarNTimeFixpoint:
    """INV-17 / COCO.10 / bl-324: N>=3 re-walks of the SAME sidecar bytes mint
    IDENTICAL deterministic PKs + identical row payloads every run — a stable
    fixpoint with no oscillation, churn, or drift."""

    def test_three_rewalks_same_bytes_mint_identical_pks_and_payloads(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()

        ws = uuid.uuid4()
        manifest = _make_qa_manifest(ws)
        rel_path = "__qa__/11111111-1111-4111-8111-111111111111.md"
        same_bytes = (
            b"---\nscope_tag: null\nanti_scope_tag: null\n"
            b"alternate_question_phrasings: []\n---\n\n"
            b"## Question\n\nWhat is the maximum contract value?\n\n"
            b"## Answer (standard)\n\nThe maximum contract value is \xc2\xa35m.\n"
        )

        # Walk the SAME bytes N = 3 times. Re-seed the observer each run (the
        # fresh fork body resolves the same deterministic PKs every time).
        runs = []
        for _ in range(3):
            calls = _observe_seams(flow, monkeypatch)
            out = _drive_ingest(
                flow, _FakeFile(rel_path, data=same_bytes), manifest=manifest
            )
            runs.append((out, calls))

        # Hard-coded uuid5 oracles over _KH_PIPELINE_DOC_NS
        # ("fbfaf1ff-1ee4-583c-9757-1674465b2ec1") for the pinned rel_path
        # "__qa__/11111111-1111-4111-8111-111111111111.md" — frozen literals so a
        # namespace or seed-string drift fails loudly (not re-derived from flow).
        sd_pk = uuid.UUID("bcb1e7b4-38e9-5ff9-9a6b-f0b16b391105")  # sd:{rel}
        expected_qa_pks = [
            uuid.UUID("bcbf2fcf-8404-5f30-9c80-e562234ededb"),  # qa:{rel}:0
            uuid.UUID("c41065e6-379c-5e17-b2f0-3814d5b1de32"),  # qa:{rel}:1
        ]

        # ── source_documents: ONE row per run, the SAME sd: uuid5 PK. ──────────
        for out, _ in runs:
            assert len(out["sd"].rows) == 1, "one source_documents row per walk"
            assert out["sd"].rows[0]["id"] == sd_pk, (
                "source_documents PK is the stable sd:-seeded uuid5 — a re-walk "
                "UPSERTs the SAME row (INV-17 fixpoint, INV-20 path-derived)"
            )

        # ── q_a_extractions: N rows per run, identical ordered qa: uuid5 PKs. ──
        for out, _ in runs:
            assert len(out["qa"].rows) == 2, "one q_a_extractions row per Q&A pair"
        qa_pks_per_run = [[r["id"] for r in out["qa"].rows] for out, _ in runs]
        for qa_pks in qa_pks_per_run:
            assert qa_pks == expected_qa_pks, (
                "q_a_extractions PKs are the stable qa:-seeded uuid5 list — "
                "identical every re-walk (no duplicate rows)"
            )

        # ── FIXPOINT: the full row payloads (minus the per-run op_id) are
        # byte-identical run-for-run — no churn, no drift. ────────────────────
        sd_payloads = [_strip_op_id(out["sd"].rows) for out, _ in runs]
        qa_payloads = [_strip_op_id(out["qa"].rows) for out, _ in runs]
        assert sd_payloads[0] == sd_payloads[1] == sd_payloads[2], (
            "source_documents payload is a stable fixpoint across N re-walks"
        )
        assert qa_payloads[0] == qa_payloads[1] == qa_payloads[2], (
            "q_a_extractions payloads are a stable fixpoint across N re-walks "
            "(bl-324 idempotency assertion)"
        )

        # ── INV-5 carried through the fixpoint: ZERO content rows every run. ──
        for out, _ in runs:
            assert out["ci"].rows == [], "ZERO content_items every re-walk (INV-5)"
            assert out["cc"].rows == [], "ZERO content_chunks every re-walk (INV-5)"
            assert out["em"].rows == [], "ZERO entity_mentions every re-walk (INV-5)"
            for qa_row in out["qa"].rows:
                assert qa_row["source_content_item_id"] is None, (
                    "source_content_item_id stays NULL across re-walks (INV-5)"
                )

        # ── COCO.10: no content-only LLM pass ever runs for a sidecar, on ANY
        # of the N walks (the metadata-touch memo discipline at the call seam). ─
        for _, calls in runs:
            assert calls["classification"] == 0
            assert calls["entities"] == 0
            assert calls["embed"] == 0

    def test_op_id_is_the_only_per_run_difference(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Two walks of identical bytes differ ONLY in the op_id row field (the
        per-RUN stamp) — every other row field is byte-identical (the row is the
        same logical row, UPSERTed, not a fresh insert)."""
        flow = _flow_module()
        ws = uuid.uuid4()
        manifest = _make_qa_manifest(ws)
        rel_path = "__qa__/22222222-2222-4222-8222-222222222222.md"
        same_bytes = b"# QA\n\nidentical bytes both runs"

        _observe_seams(flow, monkeypatch)
        out_a = _drive_ingest(
            flow, _FakeFile(rel_path, data=same_bytes), manifest=manifest
        )
        _observe_seams(flow, monkeypatch)
        out_b = _drive_ingest(
            flow, _FakeFile(rel_path, data=same_bytes), manifest=manifest
        )

        # Genuinely distinct runs (distinct op_id).
        assert out_a["op_id"] != out_b["op_id"]
        # The sd row's op_id field tracks the run; everything else matches.
        assert out_a["sd"].rows[0]["op_id"] == out_a["op_id"]
        assert out_b["sd"].rows[0]["op_id"] == out_b["op_id"]
        assert _strip_op_id(out_a["sd"].rows) == _strip_op_id(out_b["sd"].rows)
        assert _strip_op_id(out_a["qa"].rows) == _strip_op_id(out_b["qa"].rows)


class TestQaSidecarPathStability:
    """INV-20 (05-qa-flow.md §5.5): the linkage anchor is path-derived, so a
    rename WITHIN the reserved prefix re-keys on the new uuid5 deterministically;
    the rel_path travels into source_documents.storage_path so the on-disk file
    stays traceable. The pair-non-duplication on a rename is the promotion
    layer's promoted_to_pair_id anchor (promote-corpus suite); here we prove the
    walk re-keys deterministically and the storage_path follows the rename."""

    def test_rename_within_prefix_rekeys_on_new_uuid5(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        ws = uuid.uuid4()
        manifest = _make_qa_manifest(ws)
        same_bytes = b"# QA\n\nsame content, renamed file"

        old_path = "__qa__/foo.md"
        new_path = "__qa__/sub/foo.md"

        _observe_seams(flow, monkeypatch)
        out_old = _drive_ingest(
            flow, _FakeFile(old_path, data=same_bytes), manifest=manifest
        )
        _observe_seams(flow, monkeypatch)
        out_new = _drive_ingest(
            flow, _FakeFile(new_path, data=same_bytes), manifest=manifest
        )

        # Hard-coded uuid5 oracles over _KH_PIPELINE_DOC_NS for the two pinned
        # paths ("__qa__/foo.md" / "__qa__/sub/foo.md") — frozen literals so a
        # namespace/seed drift fails loudly while the load-bearing INEQUALITY
        # (rename re-keys) is still proven below.

        # The two paths mint DIFFERENT deterministic sd: PKs — the keying is
        # genuinely path-derived (NOT content-derived), so a rename re-keys.
        sd_old = out_old["sd"].rows[0]["id"]
        sd_new = out_new["sd"].rows[0]["id"]
        assert sd_old == uuid.UUID("42c08615-f8d1-5acd-9da7-a046e414837e")  # sd:{old}
        assert sd_new == uuid.UUID("ff8ccb4f-3c96-5893-8bab-a40d2233b019")  # sd:{new}
        assert sd_old != sd_new, (
            "a rename within the reserved prefix re-keys the sd: uuid5 (INV-20: "
            "the path is the seed) — the old and new paths are distinct anchors"
        )

        # q_a_extractions PKs likewise re-key on the new path.
        qa_old = [r["id"] for r in out_old["qa"].rows]
        qa_new = [r["id"] for r in out_new["qa"].rows]
        assert qa_old == [
            uuid.UUID("33ed46da-cc47-54e7-858e-f75a72e90fbb"),  # qa:{old}:0
            uuid.UUID("01d73f65-2385-565f-a5b5-2f9b88cfa878"),  # qa:{old}:1
        ]
        assert qa_new == [
            uuid.UUID("1368e595-2ad8-5706-b71f-b0adb58211e2"),  # qa:{new}:0
            uuid.UUID("e9a04219-153e-5e98-8bf8-be394a79eff9"),  # qa:{new}:1
        ]
        assert qa_old != qa_new

        # storage_path follows the rename so the on-disk file is traceable from
        # the re-keyed anchor (the write-back path-resolution target, R2.1).
        assert out_old["sd"].rows[0]["storage_path"] == old_path
        assert out_new["sd"].rows[0]["storage_path"] == new_path

    def test_same_path_is_stable_across_rewalk(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The complement of the rename test: the SAME path re-keys to the SAME
        uuid5 across re-walks (path stability is what makes the linkage durable
        when nothing moves) — the INV-20 'stable when unchanged' half."""
        flow = _flow_module()
        ws = uuid.uuid4()
        manifest = _make_qa_manifest(ws)
        rel_path = "__qa__/sub/nested/stable.md"
        same_bytes = b"# QA\n\nunchanged"

        _observe_seams(flow, monkeypatch)
        out_a = _drive_ingest(
            flow, _FakeFile(rel_path, data=same_bytes), manifest=manifest
        )
        _observe_seams(flow, monkeypatch)
        out_b = _drive_ingest(
            flow, _FakeFile(rel_path, data=same_bytes), manifest=manifest
        )

        # Hard-coded sd: uuid5 oracle for the pinned rel_path
        # "__qa__/sub/nested/stable.md" — a frozen literal (not re-derived from
        # flow) so a namespace/seed drift fails this stability assertion loudly.
        assert (
            out_a["sd"].rows[0]["id"]
            == out_b["sd"].rows[0]["id"]
            == uuid.UUID("df714f7e-e608-524b-8b64-8b28369dc388")  # sd:{rel}
        )
        assert [r["id"] for r in out_a["qa"].rows] == [
            r["id"] for r in out_b["qa"].rows
        ]

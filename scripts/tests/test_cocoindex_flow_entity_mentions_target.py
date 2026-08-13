"""Tests for cocoindex_pipeline/flow.py — the entity_mentions TableTarget
mount and its id-434 ownership contract.

Pre-id-434 this file pinned `em_target` as ingest_file's third extra arg
(the ID-53.10 §P-4 mount-each threading). id-434 (DR-140 clause 1) inverted
the ownership: the per-file component no longer receives `em_target` at all —
it RETURNS `EntityMentionCandidate`s, and the ONE consumer of `em_target` is
the phase-2b `declare_entity_mentions` component mounted by `app_main`.

Verified here by:

  1. ``ENTITY_MENTIONS_SCHEMA`` is exported, declares exactly the 9
     walk-write columns, and primary_key=(``id``,) — the PG-defaulted
     columns must NOT be declared. (Unchanged by id-434 — only the
     *derivation* of id/canonical_name values changed, TECH §4.)

  2. ``ingest_file``'s positional signature is exactly
     (file, qa, sd, cc, er, re) — NO em_target, NO phantom rel_path
     (ID-28.21 regression guard, extended).

  3. ``app_main`` mounts ``em_target`` (managed_by=USER), does NOT thread it
     into the per-file fan-out, and passes it to the phase-2b
     ``declare_entity_mentions`` component. Source-inspection is the
     canonical pattern (mirrors the retry-counter / stage-counter wiring
     tests in sibling files) because the cocoindex Rust engine cannot be
     booted in unit tests.

Stub strategy follows the ID-44.5 ``stubbed_sys_modules`` discipline
(``conftest.py``): connector submodules + cocoindex are mocked ONLY for
the duration of the flow import, then sys.modules is restored.
"""

from __future__ import annotations

import inspect
from types import ModuleType

from conftest import fresh_flow_module


def _flow_module() -> ModuleType:
    """Load a fresh stubbed ``cocoindex_pipeline.flow`` (ID-55.1 primitive)."""
    return fresh_flow_module()


# ── ENTITY_MENTIONS_SCHEMA declared via the canonical TableSchema call ───────


class TestEntityMentionsSchemaDeclaration:
    """``ENTITY_MENTIONS_SCHEMA`` is declared via the canonical TableSchema /
    ColumnDef call sites and threads through to the ``em_target`` mount.

    Because ``TableSchema`` + ``ColumnDef`` are MagicMock stubs in this test
    environment, we cannot introspect a `.columns` dict on the assigned
    value (it is itself a MagicMock). Instead we verify the structural
    contract: the module exports ``ENTITY_MENTIONS_SCHEMA`` and the
    declaration site in source contains exactly the 9 walk-write column
    keys + primary_key=("id",).
    """

    def test_schema_is_exported(self) -> None:
        flow = _flow_module()
        assert hasattr(flow, "ENTITY_MENTIONS_SCHEMA"), (
            "flow.py must export ENTITY_MENTIONS_SCHEMA"
        )

    def test_schema_source_declares_exactly_the_walk_write_columns(self) -> None:
        """Pin the column set by source-inspection (TableSchema is a stubbed
        MagicMock in this environment, so introspecting the assigned value
        is not possible — the call site is the contract)."""
        flow = _flow_module()
        source = inspect.getsource(flow)
        marker = "ENTITY_MENTIONS_SCHEMA = TableSchema("
        start = source.find(marker)
        assert start != -1, (
            "flow.py must declare ENTITY_MENTIONS_SCHEMA via the canonical "
            "TableSchema(columns=..., primary_key=...) call."
        )
        block = source[start : start + 800]
        for col in (
            '"id"',
            '"source_document_id"',
            '"entity_type"',
            '"entity_name"',
            '"canonical_name"',
            '"confidence"',
            '"context_snippet"',
            '"metadata"',
            '"op_id"',
        ):
            assert col in block, (
                f"ENTITY_MENTIONS_SCHEMA must declare {col}"
            )
        assert 'primary_key=("id",)' in block, (
            "ENTITY_MENTIONS_SCHEMA must pin primary_key=('id',) — the "
            "deterministic uuid5 (id-434: keyed on the RESOLVED canonical) "
            "lands here"
        )

    def test_pg_defaulted_columns_are_omitted_from_declaration(self) -> None:
        """``created_at``, ``entity_type_override``, ``normalisation_version``
        have server-side defaults and must NOT appear in the declaration —
        explicit insert would either duplicate PG default behaviour or trip
        the GENERATED-ALWAYS rejection path (CLAUDE.md gotcha)."""
        flow = _flow_module()
        source = inspect.getsource(flow)
        start = source.find("ENTITY_MENTIONS_SCHEMA = TableSchema(")
        assert start != -1
        block = source[start : start + 800]
        for forbidden in (
            '"created_at"',
            '"entity_type_override"',
            '"normalisation_version"',
        ):
            assert forbidden not in block, (
                f"PG-defaulted column {forbidden} must NOT be declared in "
                "ENTITY_MENTIONS_SCHEMA (CLAUDE.md 'GENERATED ALWAYS' gotcha)"
            )

    def test_op_id_column_is_declared_nullable(self) -> None:
        """The ``op_id`` column is the Inv-6 substrate — nullable, populated
        from the candidate's memo-carried op_id at the phase-2b declare."""
        flow = _flow_module()
        source = inspect.getsource(flow)
        start = source.find("ENTITY_MENTIONS_SCHEMA = TableSchema(")
        block = source[start : start + 800]
        assert '"op_id": ColumnDef(type="uuid", nullable=True)' in block, (
            "op_id must be declared as ColumnDef(type='uuid', nullable=True)"
        )


# ── id-434: ingest_file no longer takes em_target; it returns candidates ─────


class TestIngestFileEmOwnershipInverted:
    """The per-file component's signature carries NO em_target (DR-140
    clause 1) and its return value is the phase-1 → phase-2 transfer."""

    def test_ingest_file_positional_signature_is_exactly_six_params(self) -> None:
        flow = _flow_module()
        sig = inspect.signature(flow.ingest_file)
        params = [
            name
            for name, p in sig.parameters.items()
            if p.kind
            in (
                inspect.Parameter.POSITIONAL_ONLY,
                inspect.Parameter.POSITIONAL_OR_KEYWORD,
            )
        ]
        assert params[0] != "rel_path", (
            "ingest_file must NOT lead with rel_path — the fan-out passes "
            "fn(File, *extra_args); the key is never forwarded to fn "
            "(ID-28.21 regression guard)"
        )
        assert params == [
            "file",
            "qa_target",
            "sd_target",
            "cc_target",
            "er_target",
            "re_target",
        ], (
            "id-434: ingest_file positional params must be exactly "
            "(file, qa_target, sd_target, cc_target, er_target, re_target) — "
            f"em_target left the signature (DR-140 clause 1); got {params}"
        )

    def test_ingest_file_returns_the_candidate_list(self) -> None:
        """The MEMOISED return value is the phase-2 transfer channel
        (TECH §2.1): a memo hit must replay the candidate list, so the
        annotation is the executable statement of that contract."""
        flow = _flow_module()
        sig = inspect.signature(flow.ingest_file)
        assert "EntityMentionCandidate" in str(sig.return_annotation), (
            "ingest_file must be annotated to return "
            f"list[EntityMentionCandidate]; got {sig.return_annotation!r}"
        )

    def test_transfer_type_is_frozen_with_the_ruled_floor(self) -> None:
        """The S554 transfer floor (PRODUCT §3) + the op_id memo-channel
        extension, frozen so the memoised value is stable."""
        flow = _flow_module()
        import dataclasses

        assert dataclasses.is_dataclass(flow.EntityMentionCandidate)
        assert flow.EntityMentionCandidate.__dataclass_params__.frozen, (
            "EntityMentionCandidate must be frozen — it is a memoised value"
        )
        fields = {f.name for f in dataclasses.fields(flow.EntityMentionCandidate)}
        assert fields == {
            "source_document_id",
            "entity_type",
            "entity_name",
            "per_doc_key",
            "context_snippet",
            "confidence",
            "source_span_start",
            "source_span_end",
            "op_id",
        }, f"the ruled transfer floor + op_id, exactly; got {sorted(fields)}"


# ── app_main: em_target flows to phase 2b ONLY ───────────────────────────────


class TestAppMainEmTargetWiring:
    """``app_main`` mounts ``em_target`` and hands it to exactly one
    consumer: the phase-2b declare component."""

    def test_app_main_mounts_entity_mentions_target(self) -> None:
        flow = _flow_module()
        source = inspect.getsource(flow.app_main)
        assert "em_target = await mount_table_target(" in source, (
            "app_main() must contain `em_target = await mount_table_target(...)`"
        )
        assert '"entity_mentions"' in source
        assert "ENTITY_MENTIONS_SCHEMA" in source

    def test_em_target_is_not_threaded_into_the_per_file_fan_out(self) -> None:
        """The per-file fan-out args must not include em_target — the
        per-file component neither declares nor sees mention rows."""
        flow = _flow_module()
        source = inspect.getsource(flow.app_main)
        start = source.find("bound_ingest_file,")
        assert start != -1, "app_main must fan out through bound_ingest_file"
        fan_out_block = source[start : start + 400]
        assert "em_target" not in fan_out_block, (
            "id-434: em_target must NOT be threaded into the per-file "
            f"fan-out; got: {fan_out_block!r}"
        )

    def test_em_target_flows_to_the_declare_component(self) -> None:
        flow = _flow_module()
        source = inspect.getsource(flow.app_main)
        start = source.find('component_subpath("declare_entity_mentions")')
        assert start != -1, (
            "app_main must mount the phase-2b declare_entity_mentions "
            "component"
        )
        declare_block = source[start : start + 400]
        assert "em_target" in declare_block, (
            "em_target's one consumer is the phase-2b declare component; "
            f"got: {declare_block!r}"
        )

    def test_app_main_uses_managed_by_user_for_em_target(self) -> None:
        """``managed_by=ManagedBy.USER`` ensures cocoindex writes rows only —
        never DDL — for ``entity_mentions``. KH migrations own the schema."""
        flow = _flow_module()
        source = inspect.getsource(flow.app_main)
        em_block_start = source.find("em_target = await mount_table_target(")
        assert em_block_start != -1
        em_block = source[em_block_start : em_block_start + 400]
        assert "managed_by=ManagedBy.USER" in em_block, (
            "em_target mount must declare managed_by=ManagedBy.USER — "
            "cocoindex writes rows only, KH migrations own DDL."
        )

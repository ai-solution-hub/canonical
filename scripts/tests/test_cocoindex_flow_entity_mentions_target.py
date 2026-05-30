"""Tests for cocoindex_pipeline/flow.py — ID-53.10 entity_mentions
TableTarget mount in app_main (Stage-5 entity-resolution write substrate).

Per PRODUCT.md Inv-6 and TECH.md §P-4: ``app_main`` must mount an
``em_target`` ``TableTarget`` adjacent to the existing three
(``ci_target``, ``qa_target``, ``sd_target``) and pass it positionally to
``coco.mount_each`` so the per-doc ``ingest_file`` component receives it.
``ENTITY_MENTIONS_SCHEMA`` declares the subset of ``entity_mentions``
columns the per-item phase writes; the PG-defaulted columns
(``created_at``, ``entity_type_override``, ``normalisation_version``) are
OMITTED per the existing ``content_text_hash GENERATED ALWAYS`` convention.

The Stage-5 ``declare_row`` body that consumes ``em_target`` ships at
{53.11}; this slice only locks the signature + mount so {53.11} can land
without touching ``app_main`` wiring. Verified here by:

  1. ``ENTITY_MENTIONS_SCHEMA`` is exported, declares exactly the 9
     per-item-write columns, and primary_key=(``id``,) — the PG-defaulted
     columns must NOT be declared.

  2. ``ingest_file`` signature accepts ``em_target`` as the fourth extra
     arg (5 total params: file, ci, qa, sd, em). The leading param is the
     File item VALUE — there is NO phantom ``rel_path`` (ID-28.21 blocker
     regression guard, extended).

  3. ``app_main`` source contains the ``em_target = await
     mount_table_target(..., 'entity_mentions', ENTITY_MENTIONS_SCHEMA,
     managed_by=ManagedBy.USER)`` mount and threads ``em_target`` into
     ``coco.mount_each(...)`` as the fourth target. Source-inspection
     is the canonical pattern (mirrors the retry-counter / stage-counter
     wiring tests in sibling files) because the cocoindex Rust engine
     cannot be booted in unit tests.

Stub strategy follows the ID-44.5 ``stubbed_sys_modules`` discipline
(``conftest.py``): connector submodules + cocoindex are mocked ONLY for
the duration of the flow import, then sys.modules is restored.

Reference: docs/reference/task-list.json → ID-53 → Subtask 10
"""

from __future__ import annotations

import inspect
from types import ModuleType

from conftest import fresh_flow_module


def _flow_module() -> ModuleType:
    """Load a fresh stubbed ``cocoindex_pipeline.flow`` (ID-55.1 primitive).

    Delegates to the centralised ``conftest.fresh_flow_module()`` — it pops both
    ``cocoindex_pipeline.flow`` / ``scripts.cocoindex_pipeline.flow`` keys,
    imports flow under the standard cocoindex stub set, and restores cooperative
    sibling pins — so this file no longer re-derives the stub/pop/import dance
    (previously a near-verbatim copy of the sibling flow tests).
    """
    return fresh_flow_module()


# ── §P-4: ENTITY_MENTIONS_SCHEMA declared via the canonical TableSchema call ──


class TestEntityMentionsSchemaDeclaration:
    """``ENTITY_MENTIONS_SCHEMA`` is declared via the canonical TableSchema /
    ColumnDef call sites and threads through to the ``em_target`` mount.

    Because ``TableSchema`` + ``ColumnDef`` are MagicMock stubs in this test
    environment, we cannot introspect a `.columns` dict on the assigned
    value (it is itself a MagicMock). Instead we verify the structural
    contract: the module exports ``ENTITY_MENTIONS_SCHEMA`` and the
    declaration site in source contains exactly the 9 per-item-write column
    keys + primary_key=("id",) — matching TECH §P-4 verbatim.
    """

    def test_schema_is_exported(self) -> None:
        flow = _flow_module()
        assert hasattr(flow, "ENTITY_MENTIONS_SCHEMA"), (
            "flow.py must export ENTITY_MENTIONS_SCHEMA per ID-53.10 §P-4"
        )

    def test_schema_source_declares_exactly_the_per_item_write_columns(self) -> None:
        """Pin the column set by source-inspection (TableSchema is a stubbed
        MagicMock in this environment, so introspecting the assigned value
        is not possible — the call site is the contract)."""
        flow = _flow_module()
        source = inspect.getsource(flow)
        # Locate the ENTITY_MENTIONS_SCHEMA assignment.
        marker = "ENTITY_MENTIONS_SCHEMA = TableSchema("
        start = source.find(marker)
        assert start != -1, (
            "flow.py must declare ENTITY_MENTIONS_SCHEMA via the canonical "
            "TableSchema(columns=..., primary_key=...) call (TECH §P-4)."
        )
        # The declaration is short — slice forward 800 chars to cover the
        # full multi-line literal.
        block = source[start : start + 800]
        for col in (
            '"id"',
            '"content_item_id"',
            '"entity_type"',
            '"entity_name"',
            '"canonical_name"',
            '"confidence"',
            '"context_snippet"',
            '"metadata"',
            '"op_id"',
        ):
            assert col in block, (
                f"ENTITY_MENTIONS_SCHEMA must declare {col} (TECH §P-4 verbatim)"
            )
        assert 'primary_key=("id",)' in block, (
            "ENTITY_MENTIONS_SCHEMA must pin primary_key=('id',) — the "
            "per-doc deterministic uuid5 lands here at {53.11}"
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
        """The ``op_id`` column is the Inv-6 substrate — nullable per the
        §P-9 migration, populated per-flow inside ingest_file at {53.11}."""
        flow = _flow_module()
        source = inspect.getsource(flow)
        start = source.find("ENTITY_MENTIONS_SCHEMA = TableSchema(")
        block = source[start : start + 800]
        assert '"op_id": ColumnDef(type="uuid", nullable=True)' in block, (
            "op_id must be declared as ColumnDef(type='uuid', nullable=True) "
            "— Inv-6 round-trip substrate, §P-9 migration shape"
        )


# ── §P-4: ingest_file accepts em_target as the fourth extra arg ───────────────


class TestIngestFileAcceptsEmTarget:
    """``ingest_file`` accepts ``em_target`` so ``mount_each`` arity matches."""

    def test_ingest_file_signature_has_7_params(self) -> None:
        flow = _flow_module()
        params = list(inspect.signature(flow.ingest_file).parameters)
        assert params[0] != "rel_path", (
            "ingest_file must NOT lead with rel_path — mount_each passes "
            "fn(File, *extra_args); the key is never forwarded to fn "
            "(ID-28.21 regression guard)"
        )
        # ID-52.12 extended the arity from five to seven: ft_target / ftf_target
        # (the form_templates / form_template_fields Path-B write targets) follow
        # em_target positionally. ID-56.8 extended it to eight: cc_target (the
        # content_chunks chunk-row UPSERT target) is appended as a DEFAULTED 8th
        # positional so the prior 7-arg callers stay valid.
        assert len(params) == 8, (
            "ingest_file must take exactly (file, ci, qa, sd, em, ft, ftf, cc); "
            f"got {params}"
        )

    def test_em_target_is_the_fourth_extra_arg(self) -> None:
        """``em_target`` is the FOURTH extra arg (index 4) — pinned by position so
        the {53.11} declare_row body can refer to it without ambiguity. The
        ID-52.12 form targets (ft_target / ftf_target) follow it as the fifth +
        sixth extra args, and the ID-56.8 ``cc_target`` follows as the seventh
        (defaulted None)."""
        flow = _flow_module()
        params = list(inspect.signature(flow.ingest_file).parameters)
        assert params[4] == "em_target", (
            f"the fourth extra arg of ingest_file must be named 'em_target'; "
            f"got params={params}"
        )
        assert params[5:] == ["ft_target", "ftf_target", "cc_target"], (
            f"the fifth..seventh extra args must be ft_target, ftf_target, "
            f"cc_target (positional order); got params={params}"
        )


# ── §P-4: app_main mounts em_target and threads it into mount_each ────────────


class TestAppMainMountsEntityMentionsTarget:
    """``app_main`` source contains the ``em_target`` mount + mount_each
    fold-in. Source-inspection is the canonical pattern (mirrors the
    retry-counter / stage-counter wiring tests in sibling files) because
    the cocoindex Rust engine cannot be booted in unit tests.
    """

    def test_app_main_mounts_entity_mentions_target(self) -> None:
        flow = _flow_module()
        source = inspect.getsource(flow.app_main)
        assert "em_target = await mount_table_target(" in source, (
            "app_main() must contain `em_target = await mount_table_target(...)` "
            "per ID-53.10 §P-4 — Stage-5 writes land via this handle."
        )
        assert '"entity_mentions"' in source, (
            "the mount_table_target call must name the target table "
            "'entity_mentions' (the PG table name)."
        )
        assert "ENTITY_MENTIONS_SCHEMA" in source, (
            "the mount_table_target call must pass ENTITY_MENTIONS_SCHEMA — "
            "the schema declaration is the structural contract."
        )

    def test_app_main_passes_em_target_to_mount_each(self) -> None:
        flow = _flow_module()
        source = inspect.getsource(flow.app_main)
        # Verify mount_each receives em_target as the fourth target (and
        # that the call literally names it — pins the threading contract).
        assert "em_target," in source or "em_target)" in source, (
            "app_main() must pass em_target into coco.mount_each(...) so the "
            "per-item ingest_file component receives it as the fourth extra arg."
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

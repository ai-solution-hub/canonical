r"""ID-138 {138.16} — R(d) promotion-boundary audit + regression test.

TECH.md (specs/id-138-corpus-durable-home) §2.4 R(d) / §2.5 R(e) / §1.2. R(d)
is explicitly **SUPERSEDED**: there is no record-override/RETAIN store to
build (DR-026 killed that design point). (d) resolves entirely to a stated
INVARIANT: pipeline walks never mutate promoted/curated records; engine
writes stop at the staging layer, and changes to a promoted record can only
ever arrive through the existing promotion machinery
(`lib/q-a-pairs/promote-corpus.ts`). This file (1) audits every
engine-declared target mounted at `flow.py:3700-3776` against that invariant,
and (2) proves it with a regression test.

── AUDIT (per-target table; this Subtask's deliverable #1) ──────────────────

{127.25} DR-034 update: `ci_target`/`content_items` is REMOVED entirely — the
table is dropped both envs. Seven ``mount_table_target(DB_CTX, "<table>", ...,
managed_by=ManagedBy.USER)`` calls now exist in `app_main`, fanned out across
TWO `mount_each` calls: the content/localfs walk (6 targets: qa/sd/em/cc/er/re)
and the URL-ledger walk (3 targets: ri/sd/re). `q_a_pairs` has **no**
`mount_table_target` call anywhere in `flow.py` — it is not an engine-managed
table at all. (The row below documenting the now-removed `ci_target` is kept
for audit provenance — it was NEVER a `q_a_pairs` toucher either.)

| target      | table                  | write site (flow.py)          | staging-only? | touches q_a_pairs? |
|-------------|------------------------|--------------------------------|---------------|---------------------|
| `ci_target` | `content_items`        | REMOVED {127.25} DR-034 — table dropped both envs; was `ci_target.declare_row` :2277 | n/a (historical) | no |
| `qa_target` | `q_a_extractions`      | `qa_target.declare_row` :2390 (content branch), :2711 (`__qa__/` sidecar branch) | yes (staging for the promotion path) | no — PK is `qa:{source_document_id}:{idx}` ({138.10} P3), independently re-keyed from any `q_a_pairs` id, which is minted at promotion time (`promote-corpus.ts:376-388`) |
| `sd_target` | `source_documents`     | mounted (:3605-3610) but **never declared** on the content/URL routes — the parent row is taken OFF-ENGINE via the raw-pool `_upsert_source_document` (:2922-3134) since S437/S438; `sd_target` survives on call signatures only for legacy-arity compatibility | yes (register, off-engine) | no — and the `ON CONFLICT (id) DO UPDATE` explicitly OMITS `admission_status`/`retention_class`/`origin_type`/`storage_path` from its SET list (:3074-3105) so a re-walk cannot resurrect a tombstoned or curated row (R(d)/DR-026, verbatim in the source comment at :2936-2938) |
| `em_target` | `entity_mentions`      | `em_target.declare_row` :2503   | yes           | no                  |
| `er_target` | `entity_relationships` | `er_target.declare_row` :2592   | yes           | no                  |
| `cc_target` | `content_chunks`       | `cc_target.declare_row` :2351   | yes           | no                  |
| `ri_target` | `reference_items`      | `ri_target.declare_row` :3386   | yes ("promoted evidence" per R(e) table, but its survival mechanism is the CASCADE pre-flight gate on `citations`, §2.6 — a *different* contract from the q_a_pairs non-mutation story) | no |
| `re_target` | `record_embeddings`    | `_declare_record_embedding` :1510 | yes         | no                  |

Grep sweep (ast-dataflow does not cover Python — `.ast-dataflow/CLAUDE.md`):
  - `grep -n 'ci_target\|qa_target\|sd_target\|em_target\|er_target\|cc_target\|ri_target\|re_target' scripts/cocoindex_pipeline/flow.py`
    confirms the 8 targets above and no 9th.
  - `grep -n 'q_a_pairs' scripts/cocoindex_pipeline/flow.py` returns exactly 5
    hits — all PROSE COMMENTS (:2415, :2633, :2665, :3900, :3904), zero
    executable writes. The :3900-3904 hit is the ID-120 §P-3 Q&A-dedup
    proposer: it READS the published `q_a_pairs` corpus for cosine candidates
    but writes ONLY to `q_a_pair_dedup_proposals` — "NEVER writes q_a_pairs
    publication_status/superseded_by (the merge fires only on curator
    approval, app-side {120.7})" (verbatim source comment).
  - `grep -n 'retention_class' scripts/cocoindex_pipeline/flow.py` — appears
    ONLY on `_upsert_source_document`'s payload (:2885, :2916, :2944, :3070,
    :3102, :3132); none of the 8 engine targets above carries it — retention
    lifecycle is a `source_documents`-only attribute (R(e), R(ops)), not a
    per-engine-target concept.
  - `grep -n '"sd:\|"ci:\|"chunk:\|"qa:' scripts/cocoindex_pipeline/flow.py`
    confirms the {138.10} re-key: `ci:`/`chunk:`/`qa:` seeds are
    `f"...:{source_document_id}:..."` (:2174, :2349, :2395, :2716) —
    registry-keyed, NOT `rel_path`-keyed. `sd:` (:1994, :3360) stays
    `rel_path`-derived (the M2 resolver's first-admission MINT formula only).
    `em:`/`er:` seeds (:2504, :2569) are STILL `f"em:{rel_path}:..."` /
    `f"er:{rel_path}:..."` — the known F4 gap (rebuildable derived rows;
    out of scope for this Subtask, noted per the dispatch brief).

The ONLY writer of `q_a_pairs` in the whole application is the TS promotion
path, audited for completeness (out of this Python suite's reach, cited for
the Checker):
  - `lib/q-a-pairs/promote-corpus.ts:229-509 promoteCorpusExtractions` — the
    sole INSERT/UPDATE surface for `q_a_pairs` sourced from the corpus lane.
    Reads eligible rows via the `q_a_extractions_promotion_candidates()` RPC
    (`supabase/migrations/20260617130000_squash_baseline.sql:4148-4161`).
  - `repromoteCarriedFields` (`promote-corpus.ts:643-712`) is the ONLY code
    path that re-syncs a re-walked extraction's text onto an ALREADY-linked
    pair, and it does so through a **compile-checked typed `Pick<...>`**
    (`CarriedRepromoteFields`, :629-632) limited to `question_text` /
    `answer_standard` / `alternate_question_phrasings` (+ a `question_embedding:
    null` mark-stale rider on a question-text change only). The NOT-CARRIED
    lifecycle set (`publication_status`, `superseded_by`, `source_workspace_id`,
    `source_form_template_id`, `edit_intent`, `valid_from`/`valid_to`,
    `source_document_id`) is structurally excluded from that payload's TYPE —
    adding one of those keys is a TypeScript compile error, not just a review
    nit.

DISCOVERED NUANCE (out-of-scope observation — NOT fixed by this Subtask;
flagged for the Checker/Curator per the dispatch brief's "in-flight
discoveries" instruction): `q_a_extractions_promotion_candidates()`'s WHERE
clause (`e.promoted_to_pair_id IS NULL OR (p.id IS NOT NULL AND
p.question_embedding IS NULL)`) means an ALREADY-PUBLISHED pair (embedding
NOT NULL) whose linked extraction is re-walked with DIFFERENT text is NOT
currently re-selected by the RPC, so `repromoteCarriedFields` never runs for
it today. The mutation-prevention half of R(d) holds regardless (proven
below — the promoted row is never reachable from the walk), but the
"surfaces as a proposal" half is only PARTIALLY live: the differing text
lands correctly in `q_a_extractions` (staging) and sits there, inert,
until either the pair's embedding is cleared or a future admission-review
surface diffs `q_a_extractions` against its linked `q_a_pairs` row directly.
This is consistent with DR-026's "auto-apply is earned per progressive
trust" framing (nothing here contradicts the ruling) but is a real gap for
a future Task, not this one — this Subtask does not build that surface (R(d)
"is NOT a store to build").

── REGRESSION TEST (deliverable #2) ─────────────────────────────────────────

`TestEngineTargetsStructurallyExcludeQaPairs` pins the audit above as CODE:
the closed 8-table mount set never includes `q_a_pairs`, and `ingest_file`'s
own signature has no q_a_pairs-shaped parameter — so there is no argument
position through which a `q_a_pairs` write could even be threaded.

`TestWalkNeverMutatesPromotedQaPair` drives the REAL `ingest_file` twice over
the SAME source identity with a DIFFERING extraction (mirroring "a walk over
a corpus whose extraction differs from a promoted q_a_pairs row" per
TECH.md §4). A plain `_SIMULATED_PROMOTED_PAIR` dict stands in for an
already-promoted `q_a_pairs` row; it is never passed to `ingest_file` at
all (there is no parameter for it) and is asserted byte-identical after
both walks — the walk structurally cannot reach it. The differing content
DOES land in the `q_a_extractions` staging row (proving the change
surfaces, is not silently dropped) at the SAME PK across both walks, and
the declared row's key set is asserted to be the closed, known set that
excludes every promotion-owned column (`promoted_to_pair_id`,
`publication_status`, `question_embedding`, `superseded_by`,
`invalidated_at`) — so even cocoindex's own `declare_row` UPSERT (which
generates `ON CONFLICT (id) DO UPDATE SET <only the declared columns>`)
cannot clobber the promotion linkage on `q_a_extractions` itself, let alone
the promoted `q_a_pairs` row in a different table entirely.
"""

from __future__ import annotations

import asyncio
import inspect
import re
import uuid
from pathlib import Path

import pytest

from conftest import fresh_flow_module  # noqa: E402

# ── flow.py source path (for the static/structural sweep) ───────────────────
_FLOW_SOURCE_PATH = (
    Path(__file__).resolve().parent.parent / "cocoindex_pipeline" / "flow.py"
)


def _flow_module():
    """Load a fresh stubbed ``cocoindex_pipeline.flow`` (ID-55.1 primitive)."""
    return fresh_flow_module()


# ── Fakes (mirrors test_cocoindex_flow_write_path.py — the repo convention
#    duplicates these small doubles per test file rather than sharing them) ──


class _FakeTarget:
    """Records ``declare_row`` calls without touching any DB."""

    def __init__(self, table_name: str) -> None:
        self.table_name = table_name
        self.rows: list[dict] = []

    def declare_row(self, *, row: dict) -> None:
        self.rows.append(row)


class _FakeFormFile:
    """Form-flow File stand-in with a RELATIVE ``file_path.path``."""

    class _FilePath:
        def __init__(self, rel_path: Path) -> None:
            self.path = rel_path

    def __init__(self, rel_path: str, disk_path: Path) -> None:
        self.file_path = _FakeFormFile._FilePath(Path(rel_path))
        self._disk = disk_path

    async def size(self) -> int:
        return self._disk.stat().st_size

    async def read(self) -> bytes:
        return self._disk.read_bytes()

    async def read_text(self) -> str:
        return self._disk.read_text()

    async def content_fingerprint(self) -> bytes:
        import hashlib

        return hashlib.sha256(self._disk.read_bytes()).digest()


async def _fake_relationships_empty(content_text: str) -> list:
    return []


class _FakePoolConn:
    """asyncpg connection double answering the M2 identity resolver.

    Mints ``source_document_id`` deterministically from ``rel_path`` alone
    (``uuid5(NS, "sd:"+rel_path)``) — mirroring the SEED-CONTRACT MINT formula
    on first admission. Two drives over the SAME rel_path therefore resolve
    to the SAME id regardless of content differences, exactly like the real
    content-hash-first resolver does across a re-walk of the same file.
    """

    def __init__(self) -> None:
        self.executed: list[tuple[str, tuple]] = []

    async def fetchrow(self, sql: str, *args: object) -> dict:
        rel_path = args[1]
        return {
            "source_document_id": uuid.uuid5(
                uuid.UUID("fbfaf1ff-1ee4-583c-9757-1674465b2ec1"), f"sd:{rel_path}"
            ),
            "was_minted": True,
        }

    async def execute(self, sql: str, *args: object) -> str:
        self.executed.append((sql, args))
        return "INSERT 0 1"


class _FakePoolAcquire:
    def __init__(self, conn: _FakePoolConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> _FakePoolConn:
        return self._conn

    async def __aexit__(self, *exc: object) -> None:
        return None


class _FakePool:
    def __init__(self) -> None:
        self.conn = _FakePoolConn()

    def acquire(self) -> _FakePoolAcquire:
        return _FakePoolAcquire(self.conn)


def _wire_pool(flow: object, monkeypatch: pytest.MonkeyPatch) -> "_FakePool":
    pool = _FakePool()
    monkeypatch.setattr(flow.coco, "use_context", lambda key: pool)
    return pool


# ── Deliverable #1 as code: the closed engine-target set ────────────────────

# The exact 8 tables mounted at flow.py:3593-3665 (transcribed from the audit
# above). Any addition/removal here is a deliberate, audited change — this is
# a "golden literal" pin in the same spirit as TestInv19QaDeclareSnapshot in
# test_cocoindex_flow_write_path.py.
_EXPECTED_ENGINE_TARGET_TABLES = {
    "q_a_extractions",
    "source_documents",
    "entity_mentions",
    "entity_relationships",
    "content_chunks",
    "reference_items",
    "record_embeddings",
}

# Promotion-owned columns that live on q_a_pairs / the extraction-to-pair
# link. A walk's qa_target.declare_row payload must NEVER contain any of
# these — if it ever does, the engine could clobber promotion state via
# cocoindex's declare_row UPSERT (ON CONFLICT DO UPDATE SET <declared cols>).
_FORBIDDEN_PROMOTION_OWNED_KEYS = {
    "promoted_to_pair_id",
    "publication_status",
    "question_embedding",
    "superseded_by",
    "invalidated_at",
}


class TestEngineTargetsStructurallyExcludeQaPairs:
    """Static/structural half of the audit, pinned as a regression gate."""

    def test_mounted_engine_target_tables_are_the_closed_audited_set(self) -> None:
        source = _FLOW_SOURCE_PATH.read_text()
        mounted_tables = set(
            re.findall(
                r'mount_table_target\(\s*DB_CTX,\s*"([a-z_]+)"',
                source,
            )
        )
        assert mounted_tables == _EXPECTED_ENGINE_TARGET_TABLES, (
            "the set of engine-managed mount_table_target tables changed — "
            "re-run the ID-138.16 R(d) audit: confirm the new/removed target "
            "still never mounts against q_a_pairs (or any other promoted/"
            "curated store) before updating this pinned set"
        )
        assert "q_a_pairs" not in mounted_tables, (
            "q_a_pairs must NEVER be an engine-declared mount_table_target — "
            "R(d)/DR-026: it is populated exclusively by the TS promotion "
            "path (lib/q-a-pairs/promote-corpus.ts), never by a pipeline walk"
        )

    def test_ingest_file_signature_has_no_q_a_pairs_shaped_parameter(self) -> None:
        flow = _flow_module()
        params = list(inspect.signature(flow.ingest_file).parameters)
        assert not any("pair" in name.lower() for name in params), (
            f"ingest_file gained a pair-shaped parameter ({params!r}) — this "
            "would open a path for the walk to write q_a_pairs directly, "
            "which R(d)/DR-026 forbids structurally"
        )

    def test_ingest_url_signature_has_no_q_a_pairs_shaped_parameter(self) -> None:
        flow = _flow_module()
        params = list(inspect.signature(flow.ingest_url).parameters)
        assert not any("pair" in name.lower() for name in params), (
            f"ingest_url gained a pair-shaped parameter ({params!r}) — same "
            "R(d)/DR-026 structural guarantee as ingest_file"
        )


# ── Deliverable #2: the behavioural non-mutation + proposal-surfacing proof ──


class TestWalkNeverMutatesPromotedQaPair:
    """R(d)/TECH §4: a walk whose extraction DIFFERS from a promoted
    ``q_a_pairs`` row does NOT mutate the promoted row; the differing
    content surfaces in the staging (``q_a_extractions``) layer instead."""

    _REL_PATH = "acme/promotion-boundary-doc.md"
    _OP_ID_WALK_1 = uuid.UUID("1a2b3c4d-0000-4000-8000-000000000001")
    _OP_ID_WALK_2 = uuid.UUID("1a2b3c4d-0000-4000-8000-000000000002")

    # A plain stand-in for an ALREADY-PROMOTED q_a_pairs row (published,
    # embedded). It is intentionally NEVER wired into ingest_file — there is
    # no parameter through which it could be (see TestEngineTargets... above)
    # — so its immutability across both walks is a structural fact, not an
    # incidental one. Captured here as a snapshot to assert byte-identity.
    _SIMULATED_PROMOTED_PAIR = {
        "id": str(uuid.uuid4()),
        "question_text": "What is the maximum contract value?",
        "answer_standard": "The maximum contract value is £5m.",
        "publication_status": "published",
        "question_embedding": [0.0] * 1024,
    }

    @classmethod
    def _drive(
        cls,
        flow: object,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        *,
        answer_text: str,
        op_id: uuid.UUID,
    ) -> dict:
        """Drive the REAL ``ingest_file`` with a Q&A-form extraction whose
        answer text is the caller-supplied value — a stand-in for "the walk's
        extraction differs from what was previously promoted"."""
        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

        markdown = "# Promotion boundary doc\n\nBody text."

        async def _fake_convert(file: object) -> str:
            return markdown

        async def _fake_classification(content_text: str):
            return {
                "content_type": "case_study",
                "primary_domain": "procurement",
                "primary_subtopic": "tender_evaluation",
                "suggested_title": "Promotion boundary doc",
            }

        async def _fake_qa(content_text: str):
            return {
                "qa_pairs": [
                    {
                        "question_text": "What is the maximum contract value?",
                        "answer_text": answer_text,
                    },
                ]
            }

        async def _fake_entities(content_text: str):
            return []

        async def _fake_embed(content_text: str) -> list[float]:
            return [0.0] * 1024

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
        monkeypatch.setattr(flow, "extract_classification", _fake_classification)
        monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
        monkeypatch.setattr(
            flow, "extract_relationships", _fake_relationships_empty
        )
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        src = tmp_path / "promotion-boundary-doc.md"
        src.write_text(markdown)
        fake_file = _FakeFormFile(cls._REL_PATH, src)

        targets = {
            "qa": _FakeTarget("q_a_extractions"),
            "sd": _FakeTarget("source_documents"),
            "em": _FakeTarget("entity_mentions"),
        }

        _wire_pool(flow, monkeypatch)

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=op_id):
                await flow.ingest_file(
                    fake_file,
                    targets["qa"],
                    targets["sd"],
                    targets["em"],
                    None,
                    None,
                )

        asyncio.run(_exercise())
        return targets

    def test_differing_rewalk_never_touches_the_promoted_pair(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()

        # Snapshot the "promoted pair" BEFORE either walk — it is never
        # passed into ingest_file, so any change to it would have to come
        # from some OTHER code path, which this test does not invoke.
        promoted_before = dict(self._SIMULATED_PROMOTED_PAIR)

        # ── Walk 1: extraction matches what was (hypothetically) promoted ──
        out_1 = self._drive(
            flow,
            tmp_path,
            monkeypatch,
            answer_text="The maximum contract value is £5m.",
            op_id=self._OP_ID_WALK_1,
        )

        # ── Walk 2 (re-walk, SAME identity): extraction DIFFERS ────────────
        out_2 = self._drive(
            flow,
            tmp_path,
            monkeypatch,
            answer_text="The maximum contract value is £7.5m (revised).",
            op_id=self._OP_ID_WALK_2,
        )

        assert len(out_1["qa"].rows) == 1
        assert len(out_2["qa"].rows) == 1
        row_1 = out_1["qa"].rows[0]
        row_2 = out_2["qa"].rows[0]

        # NON-MUTATION: the simulated promoted pair is untouched — trivially
        # true because it was never reachable, but asserted explicitly so a
        # future refactor that DID thread it through would have to change
        # this assertion (and would then be caught by the structural tests
        # above, since ingest_file's signature has no slot for it).
        assert self._SIMULATED_PROMOTED_PAIR == promoted_before, (
            "the promoted q_a_pairs row must never be touched by a walk"
        )

        # PROPOSAL SURFACING: the differing extraction DOES land in the
        # q_a_extractions staging row — the change is captured, not dropped.
        assert row_1["extracted_answer_text"] == "The maximum contract value is £5m."
        assert (
            row_2["extracted_answer_text"]
            == "The maximum contract value is £7.5m (revised)."
        )
        assert row_1["extracted_answer_text"] != row_2["extracted_answer_text"], (
            "the two walks must have genuinely differing extractions for "
            "this test to prove anything"
        )

        # SAME PK across both walks (registry-keyed on source_document_id,
        # {138.10} P3) — a re-walk UPSERTs the SAME staging row rather than
        # minting a duplicate; this is the row the promotion machinery
        # (q_a_extractions_promotion_candidates() + repromoteCarriedFields,
        # promote-corpus.ts) would read by id to reconcile against the
        # linked q_a_pairs row.
        assert row_1["id"] == row_2["id"], (
            "a re-walk of the same source must UPSERT the same q_a_extractions "
            "row, not mint a new one"
        )

        # CLOSED KEY SET: neither row may carry a promotion-owned column.
        # cocoindex's declare_row UPSERT only SETs the columns present in
        # this dict on conflict — so keeping these keys absent is what
        # makes the non-mutation guarantee hold at the SQL layer, not just
        # by convention.
        for row in (row_1, row_2):
            forbidden_present = _FORBIDDEN_PROMOTION_OWNED_KEYS & row.keys()
            assert not forbidden_present, (
                f"qa_target.declare_row payload must never include "
                f"promotion-owned keys, found: {forbidden_present}"
            )

        # sd/em stay unaffected by the differing qa content — the row keys
        # are governed by the same source_document_id identity. (content_items
        # is dropped entirely, {127.25} DR-034 — there is no `ci` to check.)
        assert out_1["sd"].rows == [] and out_2["sd"].rows == [], (
            "source_documents no longer flows through sd_target.declare_row "
            "on the content branch (S437/S438 raw-pool move) — both should "
            "stay empty here"
        )

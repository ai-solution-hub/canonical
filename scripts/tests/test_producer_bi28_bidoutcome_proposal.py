"""BI-28 acceptance — ID-132 {132.22} G-BIDOUTCOME-PROPOSAL.

Per PRODUCT §S443 BI-28 (and this Subtask's testStrategy): a bid-outcome-seeded
(won-bid `case_study`) concept draft appears in the producer's STAGED
proposed-change set stamped with `source_workspace_id` provenance — never
auto-published, and never a `content_items` write on any path.

This exercises the {132.24} substrate ({132.24} reserved the per-entry
`source_workspace_id` slot on `ProposedChange`, defaulting `None`); {132.22}
extends it BY VALUE — propagating the won-bid concept's `workspace_id`
(`sources/l_records.py`'s `ConceptKey.workspace_id`, {132.21}) into the
`ProposedChange.source_workspace_id` slot for those entries via a
`concept_path -> workspace_id` provenance map passed to `sync_bundle`. The
flow assembly that BUILDS that map from the run's `ConceptKey`s and wires the
`stage_only=True` staging call is {132.16}/{132.23}'s job, not this Subtask's;
here the map is supplied directly so the producer-side contract is proven
end-to-end.

Exercised against a REAL temporary git repo (`tmp_path` + `git init`) per the
{132.12}/{132.24} pattern — never a mocked git, never a remote. `git_sync.py`
has ZERO `cocoindex` import, so this file needs no `stubbed_sys_modules` stub;
`producer/trigger.py` (imported for the invariant-2 no-run assertion) is
likewise collection-safe (no module-scope cocoindex).

De-identified throughout: no client name appears anywhere below (the buyer is
a generic placeholder).
"""

from __future__ import annotations

import asyncio
import inspect
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

# ── Path setup — mirrors the sibling producer test files.

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from scripts.cocoindex_pipeline.producer import git_sync, trigger  # noqa: E402
from scripts.cocoindex_pipeline.producer.git_sync import (  # noqa: E402
    proposed_change_set,
    sync_bundle,
)

# A won-bid case_study is seeded by a procurement `workspaces.id` (the S443
# amendment / DR-029 grain) — a de-identified placeholder here.
_WORKSPACE_ID = "3f1a9c22-4d0b-4e77-8b21-0a5c9e6b1d84"
_WON_BID_CONCEPT = "case-studies/buyer-northgate.md"
_ORDINARY_CONCEPT = "topics/procurement-basics.md"


def _git(repo_path: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=repo_path, capture_output=True, text=True, check=True
    )
    return result.stdout


def _commit_count(repo_path: Path) -> int:
    # A repo with no commits yet makes `git log` exit non-zero — that is zero
    # commits, not an error (a STAGING run legitimately leaves HEAD unborn).
    result = subprocess.run(
        ["git", "log", "--oneline"], cwd=repo_path, capture_output=True, text=True
    )
    if result.returncode != 0:
        return 0
    return len(result.stdout.splitlines())


@pytest.fixture()
def repo(tmp_path: Path) -> Path:
    """A fresh, real git repo — no commits, no identity configured."""
    subprocess.run(["git", "init", "--quiet"], cwd=tmp_path, check=True)
    return tmp_path


def _case_study_doc(*, buyer: str) -> str:
    """A realistic won-bid `case_study` OKF concept doc (BI-12 frontmatter +
    synthesis body + `# Citations`). Note: the doc content carries NO workspace
    id — provenance is stamped from the `source_workspace_ids` MAP, never parsed
    from the body — so the stamping tests below genuinely prove the map is the
    driver."""
    return (
        "---\n"
        "type: case_study\n"
        f"title: {buyer}\n"
        f"description: Won-bid case study for {buyer}.\n"
        "timestamp: 2026-07-09T00:00:00Z\n"
        "---\n"
        f"A distilled synthesis of the won bid delivered for {buyer}.\n"
        "\n"
        "# Citations\n"
        "- canonical://form_templates/22222222-2222-4222-8222-222222222222\n"
    )


def _topic_doc() -> str:
    return (
        "---\n"
        "type: topic\n"
        "title: Procurement basics\n"
        "description: An ordinary topic concept.\n"
        "timestamp: 2026-07-09T00:00:00Z\n"
        "---\n"
        "A distilled synthesis of procurement basics.\n"
        "\n"
        "# Citations\n"
        "- canonical://source_documents/11111111-1111-4111-8111-111111111111\n"
    )


# ── BI-28 invariant 1: won-bid concept stamped with source_workspace_id,
#    landed in STAGING (never auto-published) until human review ───────────


class TestBidOutcomeProvenanceStamp:
    def test_a_won_bid_concept_draft_is_stamped_with_its_source_workspace_id(
        self, repo: Path
    ) -> None:
        result = sync_bundle(
            repo,
            {
                _WON_BID_CONCEPT: _case_study_doc(buyer="Northgate Council"),
                _ORDINARY_CONCEPT: _topic_doc(),
            },
            stage_only=True,
            source_workspace_ids={_WON_BID_CONCEPT: _WORKSPACE_ID},
        )

        won = next(
            c for c in result.proposed_changes if c.concept_path == _WON_BID_CONCEPT
        )
        assert won.source_workspace_id == _WORKSPACE_ID

    def test_a_concept_with_no_provenance_entry_is_left_unstamped(
        self, repo: Path
    ) -> None:
        """Control — provenance is stamped PER ENTRY from the map, never
        blanket across the run. An ordinary (non-won-bid) concept in the same
        run keeps the substrate's `None` default."""
        result = sync_bundle(
            repo,
            {
                _WON_BID_CONCEPT: _case_study_doc(buyer="Northgate Council"),
                _ORDINARY_CONCEPT: _topic_doc(),
            },
            stage_only=True,
            source_workspace_ids={_WON_BID_CONCEPT: _WORKSPACE_ID},
        )

        ordinary = next(
            c for c in result.proposed_changes if c.concept_path == _ORDINARY_CONCEPT
        )
        assert ordinary.source_workspace_id is None

    def test_the_provenance_survives_into_the_dr013_proposed_change_set_payload(
        self, repo: Path
    ) -> None:
        """The accept/edit/reject review UI (DR-013 shape) binds to the
        JSON-serialisable `proposed_change_set` payload — the provenance must
        be attributable there, not merely on the in-memory dataclass."""
        result = sync_bundle(
            repo,
            {_WON_BID_CONCEPT: _case_study_doc(buyer="Northgate Council")},
            stage_only=True,
            source_workspace_ids={_WON_BID_CONCEPT: _WORKSPACE_ID},
        )

        payload = proposed_change_set(result)
        json.dumps(payload)  # must stay JSON-serialisable for the review UI

        entry = next(
            c for c in payload["changes"] if c["concept_path"] == _WON_BID_CONCEPT
        )
        assert entry["source_workspace_id"] == _WORKSPACE_ID

    def test_a_won_bid_proposal_lands_in_staging_never_auto_published(
        self, repo: Path
    ) -> None:
        """The won-bid draft is STAGED — applied + `git add`ed, NO commit —
        awaiting human review at the publish gate. It is never auto-published:
        `staged is True` and the repo has zero commits."""
        result = sync_bundle(
            repo,
            {_WON_BID_CONCEPT: _case_study_doc(buyer="Northgate Council")},
            stage_only=True,
            source_workspace_ids={_WON_BID_CONCEPT: _WORKSPACE_ID},
        )

        assert result.staged is True
        assert _commit_count(repo) == 0  # STAGING — the gated commit is deferred
        won = next(
            c for c in result.proposed_changes if c.concept_path == _WON_BID_CONCEPT
        )
        assert won.change_kind == "add"  # a genuine new draft proposal
        # The draft is staged in the git index, ready for the later gated commit.
        staged_paths = _git(repo, "diff", "--cached", "--name-only").splitlines()
        assert _WON_BID_CONCEPT in staged_paths

    def test_an_absent_provenance_map_leaves_every_entry_unstamped(
        self, repo: Path
    ) -> None:
        """Additive-safety: omitting `source_workspace_ids` entirely (the
        ordinary Pass-1/Pass-2 producer flow, and every pre-{132.22} caller)
        leaves the substrate default — no entry is stamped."""
        result = sync_bundle(
            repo,
            {_ORDINARY_CONCEPT: _topic_doc()},
            stage_only=True,
        )

        assert all(c.source_workspace_id is None for c in result.proposed_changes)


# ── BI-28 invariant 2: recording a won outcome triggers NO producer run ───
#    (DR-018/{132.16} G-TRIGGER chains on source_documents deltas, NOT
#    q_a_pair drafts; won-bid q_a_pairs flow in on the NEXT run — DR-025.)


class TestWonOutcomeTriggersNoProducerRun:
    def test_recording_a_won_outcome_fires_no_producer_run(self) -> None:
        """A won-outcome recording mutates `q_a_pairs` / `form_templates`
        (the DR-025 promotion), touching ZERO `source_documents` rows — so the
        real post-walk hook (`trigger_producer_post_walk`), which gates on
        `source_documents` deltas, no-ops without ever calling the entry
        point."""
        fired: "list[Any]" = []

        async def spy_entry_point(deltas: Any, **_kwargs: Any) -> str:
            fired.append(deltas)
            return "ran"

        # A won-outcome recording yields NO source_documents delta.
        won_outcome_source_document_deltas: "tuple[Any, ...]" = ()

        result = asyncio.run(
            trigger.trigger_producer_post_walk(
                "op-won-outcome",
                won_outcome_source_document_deltas,
                entry_point=spy_entry_point,
                fired_op_ids=set(),
            )
        )

        assert result is False
        assert fired == []  # no producer run was triggered

    def test_a_later_walk_that_touches_source_documents_does_fire(self) -> None:
        """Control — proves the no-fire above is about the EMPTY
        source_documents delta, not a broken trigger. Once the promoted won-bid
        q_a_pairs are picked up by a subsequent ordinary walk that DOES touch
        `source_documents`, the producer run fires normally (DR-025)."""
        fired: "list[Any]" = []

        async def spy_entry_point(deltas: Any, **_kwargs: Any) -> str:
            fired.append(deltas)
            return "ran"

        source_document_deltas = [{"id": "sd-1", "logical_path": "named-clients.pdf"}]

        result = asyncio.run(
            trigger.trigger_producer_post_walk(
                "op-next-ordinary-walk",
                source_document_deltas,
                entry_point=spy_entry_point,
                fired_op_ids=set(),
            )
        )

        assert result is True
        assert fired == [source_document_deltas]


# ── BI-28 invariant 3: NO content_items write on ANY path ─────────────────


class TestNoContentItemsWrite:
    def test_the_staging_path_takes_no_database_handle(self) -> None:
        """The BI-28 staging path (`sync_bundle` + `proposed_change_set`)
        operates purely on a git bundle repo + in-memory maps — it accepts NO
        database pool / connection / client, so no DB row of ANY kind
        (`content_items` included) is reachable through it (DR-034 retired
        `content_items`; the OKF producer never writes it on any path)."""
        db_ish = {
            "pool",
            "conn",
            "connection",
            "db",
            "client",
            "supabase",
            "cursor",
            "session",
        }
        for fn in (sync_bundle, proposed_change_set):
            params = set(inspect.signature(fn).parameters)
            assert not (params & db_ish), (
                f"{fn.__name__} unexpectedly accepts a DB handle {params & db_ish}; "
                "the staging/proposal path must have no database coupling"
            )

    def test_the_git_sync_module_references_content_items_nowhere(self) -> None:
        """Structural guard (mirrors the suite's `inspect.getsource`
        source-inspection precedent): the producer's proposal/staging writer
        references `content_items` on no path — no read, no write."""
        assert "content_items" not in inspect.getsource(git_sync)

    def test_a_full_bi28_staging_run_mutates_only_the_bundle_repo(
        self, repo: Path
    ) -> None:
        """End-to-end: staging a won-bid proposal touches ONLY files under the
        git bundle repo (staged, not committed) — no other side effect, hence
        no `content_items` write is possible on this path."""
        result = sync_bundle(
            repo,
            {_WON_BID_CONCEPT: _case_study_doc(buyer="Northgate Council")},
            stage_only=True,
            source_workspace_ids={_WON_BID_CONCEPT: _WORKSPACE_ID},
        )

        assert result.staged is True
        # The ONLY staged path is the bundle concept file; nothing is committed.
        staged_paths = _git(repo, "diff", "--cached", "--name-only").splitlines()
        assert staged_paths == [_WON_BID_CONCEPT]
        assert _commit_count(repo) == 0

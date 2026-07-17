"""Tests for the repo/docs Source adapter (ID-163 {163.4} PC-1 — the KA3
two-extractor PROTOTYPE).

Verifies: `RepoConceptKey`'s frozen/deterministic memo-key shape (mirrors
`ConceptKey`, BI-18), its `__post_init__` gate against the `system_baseline`
bundle-class type set (PC-4, `EffectiveOntology.base_for_class`), the E1
(tool, code-symbol grain) + E2 (navigation, markdown-page grain) split
enumerating without a third `RepoConceptKey` shape or read grid (the KA3
judged gate), and the S4 `git_blob_sha` change signal (memo-HIT on an
unchanged backing artefact, memo-MISS on a touched one).

`FakeRepo` mirrors `LRecordsSource`'s `FakePool` fixture pattern
(`test_l_records_source.py`) in spirit — a small, test-file-scoped,
fluent-API double standing in for the real backing store. Unlike
`FakePool` (which stubs return values), `FakeRepo` wraps a REAL `git init`
`tmp_path` repo: `git_blob_sha` is computed via a real `git rev-parse
HEAD:<path>` subprocess call (`git_sync.py:264` `_run_git` posture), and
stubbing that return value would decouple the test from the actual
git-shelling contract PC-1 depends on. This mirrors
`test_producer_git_sync.py`'s own `repo` fixture (real `tmp_path` + `git
init`), the established precedent for testing this pipeline's git-backed
modules.
"""

import asyncio
import dataclasses
import subprocess
from pathlib import Path

import pytest

from scripts.cocoindex_pipeline.producer.resource_uri import build_git_blob_citation
from scripts.cocoindex_pipeline.producer.validator import EffectiveOntology
from scripts.cocoindex_pipeline.sources.repo_docs import (
    RepoConceptKey,
    RepoDocsSource,
    Source,
)


class FakeRepo:
    """A real `git init` tmp_path repo with a fluent write/commit API —
    the `RepoDocsSource` test double, mirroring `FakePool`'s fluent-builder
    shape (`test_l_records_source.py`)."""

    def __init__(self, root: Path) -> None:
        self.root = root
        subprocess.run(["git", "init", "--quiet"], cwd=root, check=True)
        subprocess.run(
            ["git", "config", "user.email", "test@example.invalid"],
            cwd=root,
            check=True,
        )
        subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)

    def write(self, rel_path: str, content: str) -> "FakeRepo":
        path = self.root / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return self

    def commit(self, message: str = "test commit") -> "FakeRepo":
        subprocess.run(["git", "add", "-A"], cwd=self.root, check=True)
        subprocess.run(
            ["git", "commit", "--quiet", "-m", message], cwd=self.root, check=True
        )
        return self


def _run(coro):
    return asyncio.run(coro)


_TOOL_FILE = "lib/mcp/tools/content.ts"
_NAV_FILE = "docs/navigation/getting-started.md"


def _seed_two_pillars(repo: FakeRepo) -> FakeRepo:
    """Seeds the tool pillar (E1, 2 concepts sharing one backing file) and
    the navigation pillar (E2, 1 concept), then commits — the KA3
    validation slice's minimal corpus."""
    repo.write(
        _TOOL_FILE,
        "import { defineTool } from './shared';\n"
        "export async function registerContentTools(server) {\n"
        "  defineTool(\n"
        "    server,\n"
        "    'get',\n"
        "    { title: 'Get Content', description: 'Retrieve (parens ok)' },\n"
        "    async () => ({}),\n"
        "  );\n"
        "  defineTool(\n"
        "    server,\n"
        "    'create_content_item',\n"
        "    { title: 'Create' },\n"
        "    async () => ({}),\n"
        "  );\n"
        "}\n",
    )
    repo.write(
        _NAV_FILE,
        "# Getting started\n\nHow to navigate the platform.\n",
    )
    repo.commit("seed tool + navigation pillars")
    return repo


# ── RepoConceptKey shape (mirrors ConceptKey — BI-2/BI-18 analogues) ────


class TestRepoConceptKeyShape:
    def test_is_frozen(self) -> None:
        key = RepoConceptKey(
            rel_path="tool/get.md",
            concept_type="tool",
            source_ref="lib/mcp/tools/content.ts#L1-L5",
            git_blob_sha="abc123",
        )
        with pytest.raises(dataclasses.FrozenInstanceError):
            key.rel_path = "tampered.md"  # type: ignore[misc]

    def test_equal_by_value(self) -> None:
        a = RepoConceptKey(
            rel_path="tool/get.md",
            concept_type="tool",
            source_ref="x#L1-L2",
            git_blob_sha="sha1",
        )
        b = RepoConceptKey(
            rel_path="tool/get.md",
            concept_type="tool",
            source_ref="x#L1-L2",
            git_blob_sha="sha1",
        )
        assert a == b
        assert hash(a) == hash(b)

    def test_rejects_empty_rel_path(self) -> None:
        with pytest.raises(ValueError, match="rel_path"):
            RepoConceptKey(
                rel_path="", concept_type="tool", source_ref="x", git_blob_sha="sha1"
            )

    def test_git_blob_sha_participates_in_equality_the_bi18_memo_lever(self) -> None:
        """A bumped `git_blob_sha` on an otherwise-identical key is a
        DIFFERENT frozen instance — cocoindex's `_canonicalize_dataclass`
        fingerprints every field, so this is what turns a backing-artefact
        edit into a memo-MISS (S4)."""
        a = RepoConceptKey(
            rel_path="tool/get.md",
            concept_type="tool",
            source_ref="x#L1-L2",
            git_blob_sha="sha1",
        )
        b = dataclasses.replace(a, git_blob_sha="sha2")
        assert a != b
        assert hash(a) != hash(b)


class TestRepoConceptKeyPC4TypeGate:
    """PC-4 (ID-163 TECH, DR-079): `RepoConceptKey.__post_init__` validates
    `concept_type` against `EffectiveOntology.base_for_class('system_baseline')`
    (163.3), NOT the business `client_business` set — the two classes are
    disjoint, and a `RepoConceptKey` never widens via the {132.36}
    overlay mechanism (PC-6 rejects overlays for `system_baseline`
    outright)."""

    def test_accepts_every_system_baseline_type(self) -> None:
        allowed = EffectiveOntology.base_for_class("system_baseline").concept_types
        assert allowed == {"schema", "tool", "api", "navigation", "playbook"}
        for concept_type in sorted(allowed):
            RepoConceptKey(
                rel_path=f"{concept_type}/x.md",
                concept_type=concept_type,
                source_ref="x",
                git_blob_sha="sha1",
            )

    def test_rejects_a_business_type_off_the_system_baseline_class(self) -> None:
        """`company` is a `client_business`-class type (BI-4) — never a
        valid `system_baseline` `RepoConceptKey.concept_type`, proving the
        per-class gate is class-CORRECT, not merely "some closed set"."""
        with pytest.raises(ValueError, match="system_baseline"):
            RepoConceptKey(
                rel_path="company/x.md",
                concept_type="company",
                source_ref="x",
                git_blob_sha="sha1",
            )

    def test_rejects_an_arbitrary_off_class_type(self) -> None:
        with pytest.raises(ValueError, match="system_baseline"):
            RepoConceptKey(
                rel_path="bogus/x.md",
                concept_type="bogus",
                source_ref="x",
                git_blob_sha="sha1",
            )


# ── Source protocol conformance ──────────────────────────────────────────


class TestSourceProtocolConformance:
    def test_repo_docs_source_conforms_to_the_local_source_protocol(
        self, tmp_path: Path
    ) -> None:
        source = RepoDocsSource(tmp_path)
        assert isinstance(source, Source)


# ── KA3 — the two-extractor PROTOTYPE judged gate ────────────────────────


class TestKA3TwoExtractorPrototype:
    """KA3 (doctrine key-assumption 3): the tool pillar (E1, code-symbol
    grain) + the navigation pillar (E2, markdown-page grain) together
    enumerate the S1 system-baseline concept set through ONE
    `RepoConceptKey` shape — no third concept model / bespoke read grid
    is needed to cover both identity models."""

    def test_list_concepts_enumerates_the_tool_pillar_grain(
        self, tmp_path: Path
    ) -> None:
        _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        keys = _run(source.list_concepts())
        tool_keys = [k for k in keys if k.concept_type == "tool"]
        assert {k.rel_path for k in tool_keys} == {
            "tool/get.md",
            "tool/create_content_item.md",
        }

    def test_list_concepts_enumerates_the_one_doc_pillar_grain(
        self, tmp_path: Path
    ) -> None:
        _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        keys = _run(source.list_concepts())
        nav_keys = [k for k in keys if k.concept_type == "navigation"]
        assert [k.rel_path for k in nav_keys] == ["navigation/getting-started.md"]
        assert nav_keys[0].source_ref == _NAV_FILE

    def test_e1_e2_split_covers_both_pillars_with_one_key_shape(
        self, tmp_path: Path
    ) -> None:
        """The KA3 verdict itself: every enumerated key, across BOTH
        pillars, is the SAME `RepoConceptKey` type -- no bespoke subclass,
        no alternate key shape, no third concept model."""
        _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        keys = _run(source.list_concepts())
        assert len(keys) == 3
        assert all(type(k) is RepoConceptKey for k in keys)
        assert {k.concept_type for k in keys} == {"tool", "navigation"}

    def test_tool_source_ref_is_a_file_line_range_locator(
        self, tmp_path: Path
    ) -> None:
        """E1 citation locator shape (PC-5 precursor): `file#Lstart-Lend`,
        Lstart strictly before Lend, pointing at the `defineTool(...)`
        call span (parens inside the description string do not perturb
        the span)."""
        _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        keys = _run(source.list_concepts())
        get_key = next(k for k in keys if k.rel_path == "tool/get.md")
        assert get_key.source_ref.startswith(f"{_TOOL_FILE}#L")
        _file_part, _, range_part = get_key.source_ref.partition("#L")
        lstart, lend = range_part.split("-L")
        assert int(lstart) < int(lend)

    def test_two_tools_in_the_same_file_are_distinct_concepts(
        self, tmp_path: Path
    ) -> None:
        _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        keys = _run(source.list_concepts())
        tool_keys = [k for k in keys if k.concept_type == "tool"]
        assert len({k.source_ref for k in tool_keys}) == 2  # distinct line ranges
        assert len({k.git_blob_sha for k in tool_keys}) == 1  # same backing file


# ── S4 — the git_blob_sha change signal (BI-18 delta lever analogue) ────


class TestS4GitBlobShaChangeSignal:
    def test_unchanged_backing_artefact_produces_an_identical_key_memo_hit(
        self, tmp_path: Path
    ) -> None:
        _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        first = {k.rel_path: k for k in _run(source.list_concepts())}
        second = {k.rel_path: k for k in _run(source.list_concepts())}
        assert first == second  # byte-identical keys -> cocoindex memo-HIT
        assert first["tool/get.md"].git_blob_sha
        assert first["tool/get.md"].git_blob_sha == second["tool/get.md"].git_blob_sha

    def test_a_touched_backing_artefact_changes_its_sha_and_key_memo_miss(
        self, tmp_path: Path
    ) -> None:
        repo = _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        before = {k.rel_path: k for k in _run(source.list_concepts())}

        repo.write(
            _TOOL_FILE,
            "import { defineTool } from './shared';\n"
            "export async function registerContentTools(server) {\n"
            "  defineTool(\n"
            "    server,\n"
            "    'get',\n"
            "    { title: 'Get Content (touched)' },\n"
            "    async () => ({}),\n"
            "  );\n"
            "  defineTool(\n"
            "    server,\n"
            "    'create_content_item',\n"
            "    { title: 'Create' },\n"
            "    async () => ({}),\n"
            "  );\n"
            "}\n",
        ).commit("touch the tool pillar's backing file")
        after = {k.rel_path: k for k in _run(source.list_concepts())}

        assert before["tool/get.md"].git_blob_sha != after["tool/get.md"].git_blob_sha
        assert before["tool/get.md"] != after["tool/get.md"]
        # The untouched navigation pillar's sha is unaffected (file-scoped
        # git blob identity, not a run-wide invalidation).
        assert (
            before["navigation/getting-started.md"].git_blob_sha
            == after["navigation/getting-started.md"].git_blob_sha
        )

    def test_a_path_absent_at_head_resolves_to_an_empty_sha_not_a_raise(
        self, tmp_path: Path
    ) -> None:
        """Mirrors `git_sync.py`'s `_read_head` posture: "path absent" is
        expected, not exceptional -- an uncommitted fixture file must not
        blow up `list_concepts()`."""
        repo = FakeRepo(tmp_path)
        repo.write(_TOOL_FILE, "defineTool(server, 'get', {}, async () => ({}));\n")
        # Deliberately no repo.commit() -- the file exists on disk but has
        # no HEAD blob yet (a fresh repo has no commits at all).
        source = RepoDocsSource(tmp_path)
        keys = _run(source.list_concepts())
        get_key = next(k for k in keys if k.rel_path == "tool/get.md")
        assert get_key.git_blob_sha == ""


# ── read_concept / sample_rows / find (concrete Source-protocol methods) ─


class TestReadConceptSampleRowsFind:
    def test_read_concept_returns_just_the_tool_registration_span(
        self, tmp_path: Path
    ) -> None:
        _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        keys = _run(source.list_concepts())
        get_key = next(k for k in keys if k.rel_path == "tool/get.md")
        raw = _run(source.read_concept(get_key))
        assert "'get'" in raw.text
        assert "create_content_item" not in raw.text  # scoped to the span, not the file

    def test_read_concept_returns_the_full_navigation_page(
        self, tmp_path: Path
    ) -> None:
        _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        keys = _run(source.list_concepts())
        nav_key = next(k for k in keys if k.concept_type == "navigation")
        raw = _run(source.read_concept(nav_key))
        assert "Getting started" in raw.text

    def test_sample_rows_returns_a_bounded_sample(self, tmp_path: Path) -> None:
        _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        keys = _run(source.list_concepts())
        get_key = next(k for k in keys if k.rel_path == "tool/get.md")
        rows = _run(source.sample_rows(get_key, 2))
        assert len(rows) == 2

    def test_sample_rows_of_zero_is_empty(self, tmp_path: Path) -> None:
        _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        keys = _run(source.list_concepts())
        get_key = next(k for k in keys if k.rel_path == "tool/get.md")
        assert _run(source.sample_rows(get_key, 0)) == []

    def test_find_matches_a_tool_name_case_insensitively(
        self, tmp_path: Path
    ) -> None:
        _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        found = _run(source.find("CREATE_CONTENT_ITEM"))
        assert {k.rel_path for k in found} == {"tool/create_content_item.md"}

    def test_find_with_empty_query_returns_nothing(self, tmp_path: Path) -> None:
        _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        assert _run(source.find("")) == []


# ── PC-5 (ID-163 TECH, DR-086): git-blob citation mint on read_concept ──


class TestPC5GitBlobCitationMint:
    """`read_concept` mints, per backing artefact READ, a git-blob citation
    anchor into `self.seen_anchors` — the exact analogue of L-records'
    per-row `canonical://` mint (`enrich.py:_mint`), generalised to the
    system-bundle's public blob-URL scheme (S3/DR-086)."""

    def test_e1_read_concept_mints_the_line_range_citation(self, tmp_path: Path) -> None:
        _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        keys = _run(source.list_concepts())
        get_key = next(k for k in keys if k.rel_path == "tool/get.md")
        raw = _run(source.read_concept(get_key))
        _file_part, _, range_part = get_key.source_ref.partition("#L")
        lstart, lend = (int(v) for v in range_part.split("-L"))
        expected = build_git_blob_citation(
            get_key.git_blob_sha, _TOOL_FILE, line_start=lstart, line_end=lend
        )
        assert raw.resource == expected
        assert expected in source.seen_anchors

    def test_e2_read_concept_mints_the_whole_page_citation_with_no_line_range(
        self, tmp_path: Path
    ) -> None:
        _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        keys = _run(source.list_concepts())
        nav_key = next(k for k in keys if k.concept_type == "navigation")
        raw = _run(source.read_concept(nav_key))
        expected = build_git_blob_citation(nav_key.git_blob_sha, _NAV_FILE)
        assert raw.resource == expected
        assert "#L" not in raw.resource
        assert expected in source.seen_anchors

    def test_mint_base_is_the_public_canonical_repo(self, tmp_path: Path) -> None:
        """S3/DR-086 hard rule, proven by construction: every minted
        anchor resolves on the PUBLIC canonical repo, never a private
        host."""
        _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        keys = _run(source.list_concepts())
        for key in keys:
            raw = _run(source.read_concept(key))
            assert raw.resource.startswith(
                "https://github.com/ai-solution-hub/canonical/blob/"
            )

    def test_seen_anchors_accumulates_one_distinct_anchor_per_concept_read(
        self, tmp_path: Path
    ) -> None:
        _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        keys = _run(source.list_concepts())
        assert len(keys) == 3
        for key in keys:
            _run(source.read_concept(key))
        assert len(source.seen_anchors) == 3

    def test_a_path_absent_at_head_mints_nothing_unread_artefact_uncitable(
        self, tmp_path: Path
    ) -> None:
        """Mirrors the S4 `git_blob_sha == ""` posture (path absent at
        HEAD is expected, not exceptional) — but an unpinned artefact
        cannot resolve a public URL, so `read_concept` mints NOTHING
        rather than emitting a malformed citation."""
        repo = FakeRepo(tmp_path)
        repo.write(_TOOL_FILE, "defineTool(server, 'get', {}, async () => ({}));\n")
        # Deliberately no repo.commit() -- no HEAD blob exists yet.
        source = RepoDocsSource(tmp_path)
        keys = _run(source.list_concepts())
        get_key = next(k for k in keys if k.rel_path == "tool/get.md")
        assert get_key.git_blob_sha == ""
        raw = _run(source.read_concept(get_key))
        assert raw.resource == ""
        assert source.seen_anchors == set()

    def test_sample_rows_also_mints_since_it_reads_via_read_concept(
        self, tmp_path: Path
    ) -> None:
        """`sample_rows` delegates to `read_concept` internally — a
        backing artefact sampled this run is just as "read" as one
        fully read, so it mints too (no separate, unminted read path)."""
        _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        keys = _run(source.list_concepts())
        get_key = next(k for k in keys if k.rel_path == "tool/get.md")
        _run(source.sample_rows(get_key, 2))
        assert len(source.seen_anchors) == 1

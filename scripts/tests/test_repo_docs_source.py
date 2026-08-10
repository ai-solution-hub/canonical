"""Tests for the repo/docs Source adapter (ID-163 {163.4} PC-1 — the KA3
two-extractor PROTOTYPE).

Verifies: `RepoConceptKey`'s frozen/deterministic memo-key shape (mirrors
`ConceptKey`, BI-18), its `__post_init__` SHAPE gate (ID-427 {427.5} —
the shared `check_type_shape` rule; the per-bundle-class type sets are
gone with DR-141 and the S546 uniformity ruling), the E1
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
from scripts.cocoindex_pipeline.sources.base import Source
from scripts.cocoindex_pipeline.sources.repo_docs import (
    RepoConceptKey,
    RepoDocsSource,
    _DEFINE_TOOL_CALL_RE,
    _git_blob_sha,
    _read_source_ref,
    _span_content_hash,
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

    def test_span_content_hash_participates_in_equality_the_e1_memo_lever(self) -> None:
        """{163.18}/S488: the per-span E1 lever. A bumped `span_content_hash`
        on an otherwise-identical key is a DIFFERENT frozen instance — the
        same unconditional `_canonicalize_dataclass` fingerprinting that
        makes `git_blob_sha` a lever makes this one, so a single-tool span
        edit is a memo-MISS for exactly that concept."""
        a = RepoConceptKey(
            rel_path="tool/get.md",
            concept_type="tool",
            source_ref="x#L1-L2",
            span_content_hash="span1",
        )
        b = dataclasses.replace(a, span_content_hash="span2")
        assert a != b
        assert hash(a) != hash(b)


class TestRepoConceptKeyTypeShapeGate:
    """REPLACES `TestRepoConceptKeyPC4TypeGate` (ID-427 {427.5}).

    That class asserted PC-4/DR-079's per-class gate: a `RepoConceptKey`
    accepted exactly the five `system_baseline` types and rejected a
    `client_business` type "proving the per-class gate is class-CORRECT".
    DR-141 plus the owner's S546 uniformity ruling withdraw the per-class
    taxonomy outright — *"we should be conformant and uniform across bundle
    classes"* — so class-correctness is no longer a property to assert.
    `RepoConceptKey` now applies the SAME `check_type_shape` rule as
    `ConceptKey` and the write gate: one rule, every bundle class."""

    def test_accepts_every_label_this_adapter_actually_emits(self) -> None:
        for concept_type in ("schema", "tool", "api", "navigation", "playbook"):
            RepoConceptKey(
                rel_path=f"{concept_type}/x.md",
                concept_type=concept_type,
                source_ref="x",
                git_blob_sha="sha1",
            )

    def test_a_system_bundle_key_accepts_a_business_label(self) -> None:
        """INVERTS `test_rejects_a_business_type_off_the_system_baseline_
        class`. The bundle-class type sets are not disjoint any more
        because they do not exist; `company` here is just a label."""
        key = RepoConceptKey(
            rel_path="company/x.md",
            concept_type="company",
            source_ref="x",
            git_blob_sha="sha1",
        )
        assert key.concept_type == "company"

    def test_a_system_bundle_key_accepts_document_the_uniformity_ruling(self) -> None:
        """PI-7 as behaviour at the key layer: `document` belonged to no
        class's set, and a system-baseline concept can now carry it."""
        key = RepoConceptKey(
            rel_path="documents/x.md",
            concept_type="document",
            source_ref="x",
            git_blob_sha="sha1",
        )
        assert key.concept_type == "document"

    def test_rejects_a_malformed_type_label(self) -> None:
        """REPLACES `test_rejects_an_arbitrary_off_class_type`. `bogus` was
        rejected for being off-class and is now accepted; what survives is
        the refusal of a label that is not well FORMED."""
        RepoConceptKey(
            rel_path="bogus/x.md",
            concept_type="bogus",
            source_ref="x",
            git_blob_sha="sha1",
        )  # no longer raises
        for malformed in ("Q A Pair!", "x", "a_very_long_five_word_type_label", ""):
            with pytest.raises(ValueError, match="well-formed OKF type label"):
                RepoConceptKey(
                    rel_path="bogus/x.md",
                    concept_type=malformed,
                    source_ref="x",
                    git_blob_sha="sha1",
                )

    def test_q_a_pair_is_refused_here_too(self) -> None:
        """BI-3 reaches `RepoConceptKey` for the first time — it inherits
        the reserved name from the shared shape rule."""
        with pytest.raises(ValueError, match="q_a_pair"):
            RepoConceptKey(
                rel_path="q_a_pairs/1.md",
                concept_type="q_a_pair",
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
        # {163.18}/S488: per-span memo lever — two tools in ONE file have
        # DISTINCT span hashes (not a shared file blob sha), and E1 keys
        # deliberately carry no file sha at all.
        assert len({k.span_content_hash for k in tool_keys}) == 2
        assert {k.git_blob_sha for k in tool_keys} == {""}


# ── S4 — the memo change signal, grain-split per {163.18}/S488 ──────────
#
# E1 (tool) keys on a per-span `span_content_hash` (git_blob_sha stays "");
# E2 (navigation) keys on the file-grained `git_blob_sha`.


# The `_seed_two_pillars` tool file with ONE line changed in-place (the
# 'get' tool's title) — a single-tool edit that does NOT add/remove lines,
# so the sibling 'create_content_item' span keeps its exact line range.
_TOOL_FILE_GET_EDITED = (
    "import { defineTool } from './shared';\n"
    "export async function registerContentTools(server) {\n"
    "  defineTool(\n"
    "    server,\n"
    "    'get',\n"
    "    { title: 'Get Content (touched)', description: 'Retrieve (parens ok)' },\n"
    "    async () => ({}),\n"
    "  );\n"
    "  defineTool(\n"
    "    server,\n"
    "    'create_content_item',\n"
    "    { title: 'Create' },\n"
    "    async () => ({}),\n"
    "  );\n"
    "}\n"
)


class TestS4MemoChangeSignalGrainSplit:
    def test_unchanged_backing_artefact_produces_an_identical_key_memo_hit(
        self, tmp_path: Path
    ) -> None:
        _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        first = {k.rel_path: k for k in _run(source.list_concepts())}
        second = {k.rel_path: k for k in _run(source.list_concepts())}
        assert first == second  # byte-identical keys -> cocoindex memo-HIT
        # E1 keys on the per-span hash; E2 on the file blob sha.
        assert first["tool/get.md"].span_content_hash
        assert first["tool/get.md"].git_blob_sha == ""
        assert first["navigation/getting-started.md"].git_blob_sha

    def test_editing_one_tool_span_changes_only_that_concepts_key_memo_miss(
        self, tmp_path: Path
    ) -> None:
        """The {163.18} headline: a single-tool edit redrafts EXACTLY that
        one concept. Editing the 'get' span (in-place, no line shift) is a
        memo-MISS for 'get' alone — its file-sibling 'create_content_item'
        and the navigation page are byte-identical memo-HITs."""
        repo = _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        before = {k.rel_path: k for k in _run(source.list_concepts())}

        repo.write(_TOOL_FILE, _TOOL_FILE_GET_EDITED).commit("edit only the get span")
        after = {k.rel_path: k for k in _run(source.list_concepts())}

        # The edited span: changed hash AND changed key (memo-MISS).
        assert (
            before["tool/get.md"].span_content_hash
            != after["tool/get.md"].span_content_hash
        )
        assert before["tool/get.md"] != after["tool/get.md"]
        # The file-SIBLING tool: untouched span -> identical key (memo-HIT),
        # despite sharing the same backing .ts file. This is the property the
        # file-grained git_blob_sha interim ({163.4}) could not provide.
        assert (
            before["tool/create_content_item.md"]
            == after["tool/create_content_item.md"]
        )
        # The navigation page: untouched -> identical key.
        assert (
            before["navigation/getting-started.md"]
            == after["navigation/getting-started.md"]
        )

    def test_an_unrelated_line_edit_leaves_all_span_keys_unchanged(
        self, tmp_path: Path
    ) -> None:
        """An edit OUTSIDE every `defineTool` span (a trailing line appended
        below both tools, so no span's line range shifts) changes the file's
        git blob sha but touches no span's backing text — so every E1 key is
        an unchanged memo-HIT. Proves E1 memo tracks the SPAN, not the file."""
        repo = _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        before = {
            k.rel_path: k
            for k in _run(source.list_concepts())
            if k.concept_type == "tool"
        }

        original = (
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
            "}\n"
        )
        repo.write(_TOOL_FILE, original + "// unrelated trailing line\n").commit(
            "unrelated edit below every span"
        )
        after = {
            k.rel_path: k
            for k in _run(source.list_concepts())
            if k.concept_type == "tool"
        }

        assert before == after  # no span key changed
        assert {k.span_content_hash for k in after.values()} == {
            k.span_content_hash for k in before.values()
        }

    def test_a_touched_navigation_page_changes_its_git_blob_sha_memo_miss(
        self, tmp_path: Path
    ) -> None:
        """E2's file-grained lever is unchanged ({163.18} touched only E1):
        editing the whole-page nav concept is a memo-MISS via git_blob_sha,
        while the untouched tool spans stay identical memo-HITs."""
        repo = _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        before = {k.rel_path: k for k in _run(source.list_concepts())}

        repo.write(_NAV_FILE, "# Getting started\n\nEdited navigation copy.\n").commit(
            "edit the navigation page"
        )
        after = {k.rel_path: k for k in _run(source.list_concepts())}

        nav = "navigation/getting-started.md"
        assert before[nav].git_blob_sha != after[nav].git_blob_sha
        assert before[nav] != after[nav]
        assert before["tool/get.md"] == after["tool/get.md"]
        assert before["tool/create_content_item.md"] == after["tool/create_content_item.md"]

    def test_a_path_absent_at_head_does_not_raise_e1_hashes_span_without_git(
        self, tmp_path: Path
    ) -> None:
        """Mirrors `git_sync.py`'s `_read_head` posture: "path absent" is
        expected, not exceptional -- an uncommitted fixture file must not
        blow up `list_concepts()`. E1's span hash needs no git at all, so an
        uncommitted tool still enumerates with a real `span_content_hash`
        (and git_blob_sha "" — E1 never carries the file sha)."""
        repo = FakeRepo(tmp_path)
        repo.write(_TOOL_FILE, "defineTool(server, 'get', {}, async () => ({}));\n")
        # Deliberately no repo.commit() -- the file exists on disk but has
        # no HEAD blob yet (a fresh repo has no commits at all).
        source = RepoDocsSource(tmp_path)
        keys = _run(source.list_concepts())
        get_key = next(k for k in keys if k.rel_path == "tool/get.md")
        assert get_key.git_blob_sha == ""
        assert get_key.span_content_hash  # span hash computed without git


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


# ── PC-5 (ID-163 TECH, DR-086b): git-blob citation mint on read_concept ──


class TestPC5GitBlobCitationMint:
    """`read_concept` mints, per backing artefact READ, a git-blob citation
    anchor into `self.seen_anchors` — the exact analogue of L-records'
    per-row `canonical://` mint (`enrich.py:_mint`), generalised to the
    system-bundle's public blob-URL scheme (S3/DR-086b)."""

    def test_e1_read_concept_mints_the_line_range_citation(self, tmp_path: Path) -> None:
        _seed_two_pillars(FakeRepo(tmp_path))
        source = RepoDocsSource(tmp_path)
        keys = _run(source.list_concepts())
        get_key = next(k for k in keys if k.rel_path == "tool/get.md")
        raw = _run(source.read_concept(get_key))
        _file_part, _, range_part = get_key.source_ref.partition("#L")
        lstart, lend = (int(v) for v in range_part.split("-L"))
        # {163.18}: the E1 key carries NO file sha (span-scoped memo) — the
        # citation pin stays the REAL, file-blob-based git sha, resolved at
        # mint time. Prove the minted anchor is exactly that file blob sha.
        assert get_key.git_blob_sha == ""
        file_blob_sha = _git_blob_sha(tmp_path, _TOOL_FILE)
        assert file_blob_sha  # a real committed blob sha
        expected = build_git_blob_citation(
            file_blob_sha, _TOOL_FILE, line_start=lstart, line_end=lend
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
        """S3/DR-086b hard rule, proven by construction: every minted
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


# ── F2 ({163.19}) — the TS-state span scanner ───────────────────────────
#
# The original quote-only `_match_closing_paren` died on the real corpus
# (`ValueError: unbalanced parentheses` at content.ts index 55376): an
# apostrophe inside a LINE COMMENT (workspaces.ts — "the `workspaces`
# table's") flipped it into string state, swallowing every later paren.
# The hardened scanner skips comments, template-literal text (resuming the
# count inside `${...}` interpolation), and regex literals. Each fixture
# below seeds ONE hazard state and asserts the exact span line range plus
# the {163.18} invariant: `span_content_hash` == hash of the read-back span.


def _one_hazard_tool(repo: FakeRepo, body_lines: "list[str]") -> RepoConceptKey:
    """Seed one `hazard` tool whose handler body is `body_lines`, then
    return its enumerated key. Layout is fixed: `defineTool(` opens on L3,
    the body starts on L7, and the closing `);` lands on L7+len(body)."""
    lines = [
        "import { defineTool } from './shared';",
        "export function registerHazardTools(server) {",
        "  defineTool(",
        "    server,",
        "    'hazard',",
        "    { title: 'Hazard' },",
        *body_lines,
        "  );",
        "}",
        "export const AFTER_THE_CALL = (1);",
    ]
    repo.write(_TOOL_FILE, "\n".join(lines) + "\n")
    keys = _run(RepoDocsSource(repo.root).list_concepts())
    tool_keys = [k for k in keys if k.concept_type == "tool"]
    assert len(tool_keys) == 1, "hazard corpus must enumerate exactly one tool"
    return tool_keys[0]


def _assert_span(repo: FakeRepo, key: RepoConceptKey, lend: int) -> None:
    """The span must run L3 → the true closing `);` line, and its hash must
    equal the hash of the exact text `read_concept` would draft from — the
    {163.18} G-SPAN-HASH re-verification on the hardened enumerator."""
    assert key.source_ref == f"{_TOOL_FILE}#L3-L{lend}"
    span = _read_source_ref(repo.root, key.source_ref)
    assert span.lstrip().startswith("defineTool(")
    assert span.rstrip().endswith(");")
    assert key.span_content_hash == _span_content_hash(span)


class TestF2TSStateSpanScanner:
    def test_apostrophe_in_a_line_comment_does_not_flip_string_state(
        self, tmp_path: Path
    ) -> None:
        """THE real-corpus F2 trigger (workspaces.ts:66): one possessive
        apostrophe in a `//` comment swallowed the rest of the file."""
        repo = FakeRepo(tmp_path)
        key = _one_hazard_tool(
            repo,
            [
                "    async () => {",
                "      // the workspaces table's rows (legacy filter)",
                "      return {};",
                "    },",
            ],
        )
        _assert_span(repo, key, 11)

    def test_unbalanced_open_paren_in_a_line_comment_is_not_counted(
        self, tmp_path: Path
    ) -> None:
        repo = FakeRepo(tmp_path)
        key = _one_hazard_tool(
            repo,
            [
                "    async () => {",
                "      // opens ( but never closes",
                "      return {};",
                "    },",
            ],
        )
        _assert_span(repo, key, 11)

    def test_unbalanced_close_paren_in_a_block_comment_is_not_counted(
        self, tmp_path: Path
    ) -> None:
        repo = FakeRepo(tmp_path)
        key = _one_hazard_tool(
            repo,
            [
                "    async () => {",
                "      /* don't count this ) stray close",
                "         nor this one ) either */",
                "      return {};",
                "    },",
            ],
        )
        _assert_span(repo, key, 12)

    def test_unbalanced_close_paren_in_a_string_is_not_counted(
        self, tmp_path: Path
    ) -> None:
        """The one state the ORIGINAL scanner already handled — kept as a
        regression pin so the rewrite never loses it."""
        repo = FakeRepo(tmp_path)
        key = _one_hazard_tool(
            repo,
            [
                "    async () => {",
                "      const msg = 'all done :)' + \"and again )\";",
                "      return {};",
                "    },",
            ],
        )
        _assert_span(repo, key, 11)

    def test_template_interpolation_and_nested_template_resume_the_count(
        self, tmp_path: Path
    ) -> None:
        """Template TEXT is skipped (the stray `(` never counts) but code
        inside `${...}` — including a NESTED template — is real TS state
        the scanner re-enters. The original scanner treated the nested
        backtick as the CLOSE of the outer template and drowned."""
        repo = FakeRepo(tmp_path)
        key = _one_hazard_tool(
            repo,
            [
                "    async () => {",
                "      const msg = `open ( ${fmt(`inner ${n}`)} tail`;",
                "      return {};",
                "    },",
            ],
        )
        _assert_span(repo, key, 11)

    def test_regex_literal_parens_are_not_counted(self, tmp_path: Path) -> None:
        repo = FakeRepo(tmp_path)
        key = _one_hazard_tool(
            repo,
            [
                "    async (value) => {",
                "      const clean = value.replace(/\\)/g, '').replace(/[()]/g, '');",
                "      return { clean };",
                "    },",
            ],
        )
        _assert_span(repo, key, 11)

    def test_regex_after_a_return_keyword_is_a_regex_not_division(
        self, tmp_path: Path
    ) -> None:
        """`return /re/` ends on an identifier char, which the
        last-significant-char heuristic alone reads as an expression end
        (division) — the keyword list is what catches it."""
        repo = FakeRepo(tmp_path)
        key = _one_hazard_tool(
            repo,
            [
                "    async (value) => {",
                "      return /\\(open/.test(value);",
                "    },",
            ],
        )
        _assert_span(repo, key, 10)

    def test_division_is_not_mistaken_for_a_regex_literal(
        self, tmp_path: Path
    ) -> None:
        """`(total / 2) + (n / 4)` — reading either `/` as a regex would
        swallow the `)` after it and derail the depth count."""
        repo = FakeRepo(tmp_path)
        key = _one_hazard_tool(
            repo,
            [
                "    async (total, n) => {",
                "      const half = (total / 2) + (n / 4);",
                "      return { half };",
                "    },",
            ],
        )
        _assert_span(repo, key, 11)


# ── F2 ({163.19}) — the REAL lib/mcp/tools corpus, not FakeRepo ─────────
#
# FakeRepo fixtures HID F2: the fixtures' TS was too clean to contain a
# commented apostrophe. This class enumerates the actual checked-in corpus
# (37 `defineTool` call sites at {163.19} time) so any future TS state the
# scanner mishandles surfaces here first.

_REPO_ROOT = Path(__file__).resolve().parents[2]
_REAL_TOOLS_DIR = _REPO_ROOT / "lib" / "mcp" / "tools"


def _real_corpus_tool_keys() -> "list[RepoConceptKey]":
    if not _REAL_TOOLS_DIR.is_dir():
        pytest.skip("real lib/mcp/tools corpus not present in this checkout")
    keys = _run(RepoDocsSource(_REPO_ROOT).list_concepts())
    return [k for k in keys if k.concept_type == "tool"]


class TestF2RealCorpusRegression:
    def test_list_concepts_survives_the_full_real_corpus(self) -> None:
        """The F2 repro itself: before {163.19} this raised `ValueError:
        unbalanced parentheses scanning from index 55376` (content.ts) —
        with governance.ts, procurement.ts and workspaces.ts also fatal.
        One key per `defineTool(server, '<name>'` call site, none dropped
        (the regex count is the same enumeration the scanner starts from,
        so equality proves no call site died mid-scan)."""
        tool_keys = _real_corpus_tool_keys()
        expected = sum(
            len(_DEFINE_TOOL_CALL_RE.findall(p.read_text(encoding="utf-8")))
            for p in _REAL_TOOLS_DIR.glob("*.ts")
        )
        assert expected > 0
        assert len(tool_keys) == expected

    def test_every_real_span_ends_at_a_true_closing_paren(self) -> None:
        """A truncated or overshot span would end mid-argument; every real
        `defineTool(...)` statement ends `);` on its own line."""
        for key in _real_corpus_tool_keys():
            span = _read_source_ref(_REPO_ROOT, key.source_ref)
            assert span.lstrip().startswith("defineTool("), key.source_ref
            assert span.rstrip().endswith(");"), key.source_ref

    def test_every_real_span_hash_matches_the_read_back_span(self) -> None:
        """{163.18} G-SPAN-HASH re-verified on the hardened enumerator:
        each E1 key's memo lever is the hash of EXACTLY the text
        `read_concept` drafts from, and E1 keys still carry no file sha."""
        for key in _real_corpus_tool_keys():
            span = _read_source_ref(_REPO_ROOT, key.source_ref)
            assert key.span_content_hash == _span_content_hash(span), key.source_ref
            assert key.git_blob_sha == ""

"""Tests for producer/bundle_writer.py — validator-gated `declare_file` per
concept + `index.md`/`log.md` writers + the DR-027 ontology artefact
(ID-132 {132.10} G-BUNDLE).

Per the {132.10} testStrategy:

  - a concept failing the validator is NOT `declare_file`-written (BI-13);
  - `index.md` renders nav over a ~30-50-file fixture bundle;
  - `log.md` appends one block per run;
  - a no-op re-run produces a no-op diff (BI-18).

**id-429 amends the index half.** BI-5's ~17-theme axis is retired
({429.3}, DESIGN D3 — the owner ruled the requirement not live in S546,
closing id-323), and the producer now emits ONE index per directory whose
axis is the directory itself ({429.5}, D1/D7). That is a design decision
the owner took, NOT a conformance fix: §8 says an index MAY appear in any
directory and §11 forbids rejecting a bundle for missing ones.

`localfs.declare_file` is stubbed with a REAL filesystem side effect
(mirrors the installed `cocoindex==1.0.7`
`connectors/localfs/_target.py:declare_file`'s own `mkdir`+`write_bytes`)
rather than a no-op MagicMock — bundle_writer's own added/changed/removed
diffing reads `bundle_dir`'s on-disk state between calls (see the module
docstring's `_existing_concept_paths` rationale), so the stub must actually
write files for that logic to be exercised meaningfully. Booting the real
cocoindex `App`/`update()` machinery is unnecessary for testing this
module's OWN orchestration logic (the declare_file LINEAGE/reconciliation
behaviour itself was verified separately via an unsandboxed real-engine
probe — the {132.10} EXECUTOR-VERIFY finding cited in the module
docstring).

De-identified throughout: directory names and concept titles below are
generic placeholder business categories, never the real first-client corpus.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# ── Path setup — mirrors test_producer_enrich.py / test_producer_web_pass.py.

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from conftest import stubbed_sys_modules  # noqa: E402


def _make_coco_stub() -> MagicMock:
    stub = MagicMock(name="cocoindex")

    def _fn_decorator(**kwargs: object):
        def _wrap(func: object) -> object:
            func.__coco_fn_kwargs__ = dict(kwargs)  # type: ignore[attr-defined]
            return func

        return _wrap

    stub.fn = _fn_decorator
    return stub


def _declare_file_side_effect(path, content, *, create_parent_dirs: bool = False) -> None:
    """Mirrors the REAL `cocoindex.connectors.localfs.declare_file`
    filesystem side effect exactly (`_target.py`: `path.parent.mkdir(...)`
    then `path.write_bytes(...)`) — read directly off the installed
    `cocoindex==1.0.7` source during the {132.10} EXECUTOR-VERIFY probe."""
    target = Path(path)
    if create_parent_dirs:
        target.parent.mkdir(parents=True, exist_ok=True)
    data = content.encode() if isinstance(content, str) else content
    target.write_bytes(data)


def _make_localfs_stub() -> MagicMock:
    stub = MagicMock(name="cocoindex.connectors.localfs")
    stub.declare_file = MagicMock(side_effect=_declare_file_side_effect)
    return stub


_coco_stub = _make_coco_stub()
_localfs_stub = _make_localfs_stub()

with stubbed_sys_modules(
    {"cocoindex": _coco_stub, "cocoindex.connectors.localfs": _localfs_stub}
):
    from scripts.cocoindex_pipeline.producer import bundle_writer  # noqa: E402

from scripts.cocoindex_pipeline.producer.enrich import ConceptDraft  # noqa: E402
from scripts.cocoindex_pipeline.producer.frontmatter import (  # noqa: E402
    build_concept_frontmatter,
    render_source_footnotes,
    sources_from_citations,
)
from scripts.cocoindex_pipeline.producer import iri_projection  # noqa: E402
from scripts.cocoindex_pipeline.producer.resource_uri import (  # noqa: E402
    build_source_document_uri,
)
from scripts.cocoindex_pipeline.producer.validator import (  # noqa: E402
    ALLOWED_ENTITY_TYPES,
    ALLOWED_RELATIONSHIP_TYPES,
    EffectiveOntology,
)
from scripts.cocoindex_pipeline.producer.web_pass import (  # noqa: E402
    ReferenceConceptDraft,
)
from scripts.cocoindex_pipeline.sources.base import ConceptKey  # noqa: E402

# lib/okf/parse-index.ts / lib/okf/parse-log.ts regex mirrors — Python-side
# defence-in-depth so a format drift is caught here TOO, not only by the
# TS round-trip Vitest test (S451 rider — a mismatch degrades BundleNav
# SILENTLY, so both sides check independently). Post OKF v0.1 conformance
# (SPEC §7): `##` log headings are ISO DATES (newest first) and each run's
# records are `* **Run <ISO-ts> — …:**` bullets.
_TS_HEADING_RE = re.compile(r"^(#{2,3})\s+(.+?)\s*$")
_TS_CONCEPT_BULLET_RE = re.compile(r"^[*-]\s*\[(.+?)\]\(([^)\s]+\.md)\)(?:\s*[-—]\s*(.*))?$")
_TS_DATE_HEADING_RE = re.compile(r"^##\s+(.+?)\s*$")
_TS_RUN_BULLET_RE = re.compile(r"^\*\s+\*\*Run\s+(\S+)\s+[—-]")

_SAMPLE_UUID = "11111111-1111-4111-8111-111111111111"


@pytest.fixture(autouse=True)
def _reset_declare_file_calls():
    _localfs_stub.declare_file.reset_mock()
    yield


_SD_URI = build_source_document_uri(_SAMPLE_UUID)


def _fm(
    *,
    type="topic",
    title="Title",
    description="Desc",
    tags=("tag",),
    resource=None,
    citations=(_SD_URI,),
):
    """A v0.2 frontmatter: `generated` replaces `timestamp` (id-426), the
    record anchor rides `sources[]` (S546 F2-B), `resource` — when set —
    is a real web URL (the reference-concept shape only)."""
    return build_concept_frontmatter(
        type=type,
        title=title,
        description=description,
        generated_by="kh-concept-producer/test-model-1",
        generated_at="2026-07-08T00:00:00Z",
        tags=tags,
        resource=resource,
        sources=sources_from_citations(list(citations)),
    )


def _draft(
    rel_path: str, *, title="Title", description="Desc", body_suffix="", type="topic"
) -> ConceptDraft:
    key = ConceptKey(rel_path=rel_path, concept_type="topic", scope_tag=rel_path)
    body = (
        f"A distilled synthesis about {title}.{body_suffix}\n\n"
        f"{render_source_footnotes(sources_from_citations([_SD_URI]))}"
    )
    return ConceptDraft(
        key=key,
        frontmatter=_fm(type=type, title=title, description=description),
        body=body,
        primary_anchor=_SD_URI,
    )


# ─────────────────────────────────────────────────────────────────────────
# declare_concept — BI-13 gate then BI-11 declare_file
# ─────────────────────────────────────────────────────────────────────────


def test_declare_concept_valid_writes_file(tmp_path: Path) -> None:
    draft = _draft("topics/alpha.md", title="Alpha")
    result = bundle_writer.declare_concept(tmp_path, draft)

    assert result.written is True
    assert result.errors == ()
    assert result.is_new is True
    _localfs_stub.declare_file.assert_called_once()
    written_path = (tmp_path / "topics/alpha.md")
    written = written_path.read_text(encoding="utf-8")
    # v0.2 (id-426): the draft is written AS-IS — provenance is the
    # frontmatter `sources:` list plus the `[^id]` footnote definitions the
    # single shared emitters already rendered at draft time; no write-time
    # trailer normalisation exists any more (F1-A).
    assert written == draft.rendered_markdown
    assert written.startswith("---\n")
    assert "sources:\n" in written
    assert f"    resource: {_SD_URI}\n" in written
    assert "# Citations" not in written


def test_declare_concept_invalid_not_written(tmp_path: Path) -> None:
    # BI-4: an out-of-set type fails check_concept.
    bad_frontmatter = _fm(type="not-a-real-type")
    draft = ConceptDraft(
        key=ConceptKey(rel_path="topics/bad.md", concept_type="topic", scope_tag="bad"),
        frontmatter=bad_frontmatter,
        body="A distilled synthesis.\n",
        primary_anchor=_SD_URI,
    )

    result = bundle_writer.declare_concept(tmp_path, draft)

    assert result.written is False
    assert result.errors  # non-empty — BI-13 aggregate violations
    _localfs_stub.declare_file.assert_not_called()
    assert not (tmp_path / "topics/bad.md").exists()


def test_declare_concept_reference_draft_uses_rel_path_not_key(tmp_path: Path) -> None:
    # v0.2 reference-concept shape (id-426 point 4): resource is the REAL
    # fetched URL; the record anchor rides sources[].
    ref_fm = _fm(
        type="topic",
        tags=("reference",),
        resource="https://client.example/certifications/iso-27001",
    )
    ref_draft = ReferenceConceptDraft(
        rel_path="references/iso-27001.md",
        frontmatter=ref_fm,
        body="Gated-corpus enrichment.\n\n"
        + render_source_footnotes(sources_from_citations([_SD_URI])),
    )

    result = bundle_writer.declare_concept(tmp_path, ref_draft)

    assert result.rel_path == "references/iso-27001.md"
    assert result.written is True
    assert (tmp_path / "references/iso-27001.md").exists()


def test_declare_concept_classifies_new_changed_unchanged(tmp_path: Path) -> None:
    draft_v1 = _draft("topics/alpha.md", title="Alpha")
    r1 = bundle_writer.declare_concept(tmp_path, draft_v1)
    assert r1.is_new is True and r1.changed is False

    r2 = bundle_writer.declare_concept(tmp_path, draft_v1)
    assert r2.is_new is False and r2.changed is False  # byte-identical content

    draft_v2 = _draft("topics/alpha.md", title="Alpha", body_suffix=" Updated.")
    r3 = bundle_writer.declare_concept(tmp_path, draft_v2)
    assert r3.is_new is False and r3.changed is True


def test_declare_concept_writes_the_v02_provenance_surface_as_is(
    tmp_path: Path,
) -> None:
    """v0.2 (id-426, F1-A): no write-time trailer normalisation — the
    draft's `sources:` frontmatter (record anchor + bundle-absolute
    cross-link) and its `[^id]` footnote definitions land on disk exactly
    as the shared emitters rendered them; no `# Citations` heading is ever
    emitted."""
    citations = [_SD_URI, "certifications/iso-9001.md"]
    sources = sources_from_citations(citations)
    key = ConceptKey(rel_path="topics/alpha.md", concept_type="topic", scope_tag="alpha")
    draft = ConceptDraft(
        key=key,
        frontmatter=_fm(title="Alpha", citations=citations),
        body=(
            "A distilled synthesis.\n\n"
            f"{render_source_footnotes(sources)}"
        ),
        primary_anchor=_SD_URI,
    )

    result = bundle_writer.declare_concept(tmp_path, draft)

    assert result.written is True
    written = (tmp_path / "topics/alpha.md").read_text(encoding="utf-8")
    assert written == draft.rendered_markdown
    assert f"    resource: {_SD_URI}\n" in written
    assert "    resource: /certifications/iso-9001.md\n" in written
    assert "[^certifications-iso-9001]: /certifications/iso-9001.md" in written
    assert "# Citations" not in written


# ─────────────────────────────────────────────────────────────────────────
# regenerate_indexes — BI-11, the pure per-index renderer.
#
# id-429 {429.3} (D3): the ~17-theme machinery is RETIRED, not replaced.
# `IndexTheme` -> `IndexSection`, kept as the renderer's structural node;
# `build_index_themes` and the `unthemed_heading` fallback are gone. These
# tests assert the renderer's contract against `IndexSection` directly.
# ─────────────────────────────────────────────────────────────────────────


def _synthetic_catalogue(n: int = 36):
    """`n` synthetic concept frontmatters keyed by rel_path — the
    ~30-50-file fixture bundle the {132.10} testStrategy specifies."""
    return {
        f"topics/concept-{idx}.md": _fm(
            title=f"Concept {idx}",
            description=f"A one-line summary of concept {idx}.",
        )
        for idx in range(n)
    }


def _concept_section(concepts, heading: str = "Concepts"):
    return bundle_writer.IndexSection(
        heading=heading,
        entries=tuple(
            bundle_writer.IndexConceptEntry(
                title=fm.title, rel_path=rel_path, description=fm.description
            )
            for rel_path, fm in sorted(concepts.items())
        ),
    )


def test_regenerate_indexes_renders_sections_over_fixture_bundle() -> None:
    concepts = _synthetic_catalogue(36)
    text = bundle_writer.regenerate_indexes(
        [_concept_section(concepts)], okf_version=bundle_writer.OKF_VERSION
    )

    headings = [m for line in text.splitlines() if (m := _TS_HEADING_RE.match(line))]
    assert [h.group(2) for h in headings] == ["Concepts"]

    bullets = [
        m for line in text.splitlines() if (m := _TS_CONCEPT_BULLET_RE.match(line))
    ]
    assert len(bullets) == len(concepts)
    assert {b.group(2) for b in bullets} == set(concepts)
    # Every bullet carries a description (§8's SHOULD; validator-guaranteed).
    assert all(b.group(3) for b in bullets)


def test_regenerate_indexes_stamps_okf_version_frontmatter_when_given() -> None:
    """SPEC §12 / DR-019 house rule (id-426 emission contract point 5): the
    bundle-root `index.md` opens with a frontmatter block carrying EXACTLY
    one key — `okf_version: "0.2"` — followed by the `# OKF Concept Bundle`
    heading."""
    text = bundle_writer.regenerate_indexes(
        [_concept_section(_synthetic_catalogue(4))],
        okf_version=bundle_writer.OKF_VERSION,
    )

    # single-key discipline: exactly one line between the fences.
    assert text.splitlines()[:4] == [
        "---",
        'okf_version: "0.2"',
        "---",
        "# OKF Concept Bundle",
    ]


def test_regenerate_indexes_emits_no_frontmatter_when_no_version_given() -> None:
    """§12 + §8's single exception permit a frontmatter block in the
    bundle-ROOT index only. `okf_version=None` is the nested form and must
    open straight on the `#` title — no fence, no key."""
    text = bundle_writer.regenerate_indexes(
        [_concept_section({"iso-27001.md": _fm(title="ISO 27001", description="Cert.")})],
        title="Certifications",
        okf_version=None,
    )

    assert text.splitlines()[0] == "# Certifications"
    assert "---" not in text
    assert "okf_version" not in text


def test_regenerate_indexes_requires_the_okf_version_keyword() -> None:
    """AC-5 made structural rather than conventional (D7): the stamp is a
    REQUIRED parameter, so a nested index cannot silently acquire
    frontmatter AND the root index cannot silently lose it."""
    with pytest.raises(TypeError):
        bundle_writer.regenerate_indexes([])  # type: ignore[call-arg]


def test_regenerate_indexes_nests_a_level_3_subsection_under_its_parent() -> None:
    """`IndexSection` keeps `IndexTheme`'s structural contract: a `###`
    subsection is emitted nested under its `##` parent, never bare — the
    parser's "no preceding `##`" branch is a defensive fallback for
    malformed input, never this writer's output."""
    child = bundle_writer.IndexSection(
        heading="Certifications",
        level=3,
        entries=(
            bundle_writer.IndexConceptEntry(
                title="ISO 27001", rel_path="iso-27001.md", description="Cert."
            ),
        ),
    )
    parent = bundle_writer.IndexSection(heading="Concepts", children=(child,))

    text = bundle_writer.regenerate_indexes([parent], okf_version=None)

    assert "## Concepts" in text
    assert "### Certifications" in text
    assert text.index("## Concepts") < text.index("### Certifications")


def test_index_section_rejects_an_unparseable_heading_level() -> None:
    with pytest.raises(ValueError, match="level must be 2 or 3"):
        bundle_writer.IndexSection(heading="Concepts", level=4)  # type: ignore[arg-type]


def test_index_section_rejects_a_level_3_carrying_children() -> None:
    with pytest.raises(ValueError, match="cannot itself carry children"):
        bundle_writer.IndexSection(
            heading="Sub",
            level=3,
            children=(bundle_writer.IndexSection(heading="Deeper", level=3),),
        )


# ─────────────────────────────────────────────────────────────────────────
# {429.3} — prove the theme retirement AT THE CALLERS, not by grep.
#
# A call still passing `theme_config` must FAIL. That is what stops a future
# caller quietly re-supplying a config whose axis the owner ruled not live
# (S546, closing id-323) — a silently-ignored kwarg would not.
# ─────────────────────────────────────────────────────────────────────────


def test_write_bundle_no_longer_accepts_theme_config(tmp_path: Path) -> None:
    with pytest.raises(TypeError, match="theme_config"):
        bundle_writer.write_bundle(
            tmp_path,
            [_draft("topics/a.md", title="A")],
            **{"theme_config": [("Company Overview", ("topics/a.md",))]},
        )


def test_the_theme_machinery_is_gone_from_the_module() -> None:
    """The retirement is a rename plus two deletions (D3). Asserted against
    the imported module object, so a partial revert that restores the old
    builder alongside the new one is caught."""
    assert not hasattr(bundle_writer, "build_index_themes")
    assert not hasattr(bundle_writer, "IndexTheme")
    assert hasattr(bundle_writer, "IndexSection")


# ─────────────────────────────────────────────────────────────────────────
# log.md — BI-11/BI-18/BI-22
# ─────────────────────────────────────────────────────────────────────────


def test_render_log_entry_emits_spec7_date_heading_and_run_bullets() -> None:
    """SPEC §7: the `##` heading is the ISO 8601 DATE (`YYYY-MM-DD`), and
    every category line is a `* **Run <ISO-ts> — <Action> (N):**` bullet
    carrying the FULL run timestamp (BI-11 per-run visibility)."""
    summary = bundle_writer.RunSummary(added=("topics/a.md",))
    text = bundle_writer.render_log_entry(summary, timestamp="2026-07-08T12:00:00Z")

    lines = text.splitlines()
    match = _TS_DATE_HEADING_RE.match(lines[0])
    assert match is not None
    assert match.group(1) == "2026-07-08"
    assert lines[2] == "* **Run 2026-07-08T12:00:00Z — Added (1):** topics/a.md"


def test_render_log_entry_no_op_run_still_emits_a_visible_bullet() -> None:
    """BI-11 is unconditional — a no-op run's record is still one visible
    per-run bullet, in the same `**Run <ts> — …**` shape."""
    text = bundle_writer.render_log_entry(
        bundle_writer.RunSummary(), timestamp="2026-07-08T12:00:00Z"
    )
    assert (
        "* **Run 2026-07-08T12:00:00Z — No changes** (no-op re-run)." in text
    )


def test_append_log_entry_prepends_new_date_sections_newest_first(tmp_path: Path) -> None:
    summary1 = bundle_writer.RunSummary(added=("topics/a.md",))
    bundle_writer.append_log_entry(tmp_path, summary1, timestamp="2026-07-08T00:00:00Z")

    summary2 = bundle_writer.RunSummary(added=("topics/b.md",))
    bundle_writer.append_log_entry(tmp_path, summary2, timestamp="2026-07-09T00:00:00Z")

    text = (tmp_path / "log.md").read_text(encoding="utf-8")
    headings = [
        m.group(1) for line in text.splitlines() if (m := _TS_DATE_HEADING_RE.match(line))
    ]
    # SPEC §7: date-grouped, NEWEST FIRST (prepend).
    assert headings == ["2026-07-09", "2026-07-08"]
    # first run's content is PRESERVED, not overwritten.
    assert "topics/a.md" in text
    assert "topics/b.md" in text
    assert text.find("topics/b.md") < text.find("topics/a.md")


def test_append_log_entry_merges_same_date_runs_newest_run_first(tmp_path: Path) -> None:
    """Two runs on the SAME date share ONE `## YYYY-MM-DD` heading; the
    newer run's bullets are inserted at the TOP of that section."""
    bundle_writer.append_log_entry(
        tmp_path,
        bundle_writer.RunSummary(added=("topics/a.md",)),
        timestamp="2026-07-08T09:00:00Z",
    )
    bundle_writer.append_log_entry(
        tmp_path,
        bundle_writer.RunSummary(changed=("topics/a.md",)),
        timestamp="2026-07-08T15:00:00Z",
    )

    text = (tmp_path / "log.md").read_text(encoding="utf-8")
    headings = [
        m.group(1) for line in text.splitlines() if (m := _TS_DATE_HEADING_RE.match(line))
    ]
    assert headings == ["2026-07-08"]  # ONE heading per date
    run_ts = [
        m.group(1) for line in text.splitlines() if (m := _TS_RUN_BULLET_RE.match(line))
    ]
    assert run_ts == ["2026-07-08T15:00:00Z", "2026-07-08T09:00:00Z"]


# ─────────────────────────────────────────────────────────────────────────
# write_bundle — the per-run orchestration (BI-13/BI-5/BI-11/BI-18/BI-22)
# ─────────────────────────────────────────────────────────────────────────


def test_write_bundle_validator_failure_excluded_from_write_and_index(tmp_path: Path) -> None:
    good = _draft("topics/good.md", title="Good")
    bad = ConceptDraft(
        key=ConceptKey(rel_path="topics/bad.md", concept_type="topic", scope_tag="bad"),
        frontmatter=_fm(type="not-a-real-type"),
        body="body\n\n# Citations\n- " + build_source_document_uri(_SAMPLE_UUID) + "\n",
    )

    summary = bundle_writer.write_bundle(tmp_path, [good, bad])

    assert summary.added == ("topics/good.md",)
    assert len(summary.validator_failures) == 1
    assert summary.validator_failures[0][0] == "topics/bad.md"
    assert not (tmp_path / "topics/bad.md").exists()
    assert (tmp_path / "topics/good.md").exists()

    index_text = (tmp_path / "index.md").read_text(encoding="utf-8")
    assert "topics/good.md" in index_text
    assert "topics/bad.md" not in index_text

    log_text = (tmp_path / "log.md").read_text(encoding="utf-8")
    assert "topics/bad.md" in log_text  # WARNING line names the rejected concept


def test_write_bundle_removed_concept_detected(tmp_path: Path) -> None:
    d1 = _draft("topics/a.md", title="A")
    d2 = _draft("topics/b.md", title="B")
    d3 = _draft("topics/c.md", title="C")
    bundle_writer.write_bundle(tmp_path, [d1, d2, d3])

    _localfs_stub.declare_file.reset_mock()
    summary2 = bundle_writer.write_bundle(tmp_path, [d1, d2])  # c dropped

    assert summary2.removed == ("topics/c.md",)
    # bundle_writer never itself unlinks a removed concept — it relies on
    # the REAL engine's own declare_file lineage (EXECUTOR-VERIFY finding).
    called_paths = {str(c.args[0]) for c in _localfs_stub.declare_file.call_args_list}
    assert str(tmp_path / "topics/c.md") not in called_paths
    assert (tmp_path / "topics/c.md").exists()  # only the ENGINE deletes it, not this call


# ─────────────────────────────────────────────────────────────────────────
# id-429 {429.2} — SPEC §3.1 reserved filenames are scoped: `index.md` /
# `log.md` at ANY depth, every other reserved artefact at the bundle ROOT
# only. Mirrors `lib/okf/bundle-graph.ts`'s already-correct split (basename
# skip for index/log; full-relative-path `RESERVED_ROOT_DOCS` for
# README/CONFORMANCE).
# ─────────────────────────────────────────────────────────────────────────


def test_nested_index_and_log_are_never_reported_removed_on_any_run(
    tmp_path: Path,
) -> None:
    """The measured defect this fixes: `_existing_concept_paths` compared the
    FULL bundle-relative path against a set of BARE basenames, so
    `certifications/index.md` was counted as a previous-run concept and landed
    in `RunSummary.removed` — on EVERY run, forever, polluting `log.md` and
    the human-edit reconcile set.

    Run TWICE over an unchanged draft set: the second run is the one that
    catches a naive fix (e.g. one that suppresses the entry only on the run
    that created it, or that leans on `written` membership rather than on the
    reservation itself)."""
    # Seeded in directories the run drafts NOTHING into, so the only thing
    # under test is the reservation — not whether the producer happens to
    # re-declare a path itself.
    (tmp_path / "certifications").mkdir(parents=True)
    (tmp_path / "certifications" / "index.md").write_text(
        "# Certifications\n", encoding="utf-8"
    )
    (tmp_path / "case-studies").mkdir(parents=True)
    (tmp_path / "case-studies" / "log.md").write_text(
        "## 2026-01-01\n\n* Hand-authored by the client (SPEC §9 permits it).\n",
        encoding="utf-8",
    )

    drafts = [_draft("topics/a.md", title="A")]

    summary1 = bundle_writer.write_bundle(
        tmp_path, drafts, timestamp="2026-08-10T00:00:00Z"
    )
    summary2 = bundle_writer.write_bundle(
        tmp_path, drafts, timestamp="2026-08-10T01:00:00Z"
    )

    for summary in (summary1, summary2):
        assert "certifications/index.md" not in summary.removed
        assert "case-studies/log.md" not in summary.removed
    # ...and never miscounted as concepts in the other direction either.
    for summary in (summary1, summary2):
        assert "certifications/index.md" not in summary.added
        assert "case-studies/log.md" not in summary.added

    # The client's hand-authored nested log survives untouched — the producer
    # never declares one (D8), so the engine never orphan-deletes it.
    assert (tmp_path / "case-studies" / "log.md").exists()


def test_nested_readme_is_still_counted_as_a_concept(tmp_path: Path) -> None:
    """`README.md`/`CONFORMANCE.md` stay ROOT-only. A nested
    `guides/README.md` is a legitimate concept document — the deliberate rule
    `lib/okf/bundle-graph.ts`'s `RESERVED_ROOT_DOCS` already applies on the
    consumer side. Widening the {429.2} basename reservation to cover them
    would silently drop such a file out of the reconcile set."""
    (tmp_path / "guides").mkdir(parents=True)
    (tmp_path / "guides" / "README.md").write_text("# Guides\n", encoding="utf-8")

    summary = bundle_writer.write_bundle(tmp_path, [_draft("topics/a.md", title="A")])

    # Counted as a previous-run concept, and this run does not produce it, so
    # it is a genuine `removed` — the behaviour a nested index must NOT have.
    assert "guides/README.md" in summary.removed


def test_root_reserved_artefacts_keep_their_root_only_behaviour(
    tmp_path: Path,
) -> None:
    """The root four the producer itself writes/reads — `ontology.json`,
    `README.md`, `CONFORMANCE.md`, `context.jsonld` — must never surface as a
    `RunSummary.removed` entry (S464 rider R1 / the v0.1 conformance wave /
    {132.44})."""
    (tmp_path / "README.md").write_text("# Bundle\n", encoding="utf-8")
    (tmp_path / "CONFORMANCE.md").write_text("# Conformance\n", encoding="utf-8")

    summary = bundle_writer.write_bundle(tmp_path, [_draft("topics/a.md", title="A")])

    for reserved in (
        "ontology.json",
        "README.md",
        "CONFORMANCE.md",
        "context.jsonld",
        "index.md",
        "log.md",
    ):
        assert reserved not in summary.removed
        assert reserved not in summary.added


# ─────────────────────────────────────────────────────────────────────────
# G-PARSE-HARDEN Leg 2 ({132.45}, {132.35} Defect B): a transiently-failed
# draft must keep its last-good bundle version — never look like a
# confirmed source deletion.
# ─────────────────────────────────────────────────────────────────────────


def test_write_bundle_transient_draft_failure_keeps_last_good_version_not_removed(
    tmp_path: Path,
) -> None:
    d1 = _draft("topics/a.md", title="A")
    d2 = _draft("topics/b.md", title="B")
    d3 = _draft("topics/c.md", title="C")
    bundle_writer.write_bundle(tmp_path, [d1, d2, d3])
    original_c = (tmp_path / "topics/c.md").read_text(encoding="utf-8")

    _localfs_stub.declare_file.reset_mock()
    # c's draft failed THIS run (still present in the source catalogue) —
    # d3 is simply not offered this time, exactly as a caught upstream
    # exception would leave it out of `write_bundle`'s `drafts` argument.
    summary2 = bundle_writer.write_bundle(
        tmp_path, [d1, d2], failed_rel_paths=("topics/c.md",)
    )

    # NOT reported as removed — Defect B's headline behaviour.
    assert summary2.removed == ()
    assert summary2.failed == ("topics/c.md",)
    # The last-good content survives on disk, byte-identical.
    assert (tmp_path / "topics/c.md").read_text(encoding="utf-8") == original_c
    # And it WAS re-declared this run (kept in the engine's this-run
    # declared keyset) — never silently skipped, which would leave the
    # REAL engine's own orphan-delete reconciliation free to remove it
    # regardless of what RunSummary.removed reports (module docstring's
    # EXECUTOR-VERIFY finding).
    called_paths = {str(c.args[0]) for c in _localfs_stub.declare_file.call_args_list}
    assert str(tmp_path / "topics/c.md") in called_paths


def test_write_bundle_still_removes_a_concept_genuinely_absent_from_the_source(
    tmp_path: Path,
) -> None:
    """Counterpart proof: `failed_rel_paths` must NOT blanket-suppress
    `removed` — a concept that is simply gone (no failure reported for it)
    is still correctly reported as removed."""
    d1 = _draft("topics/a.md", title="A")
    d2 = _draft("topics/b.md", title="B")
    d3 = _draft("topics/c.md", title="C")
    bundle_writer.write_bundle(tmp_path, [d1, d2, d3])

    summary2 = bundle_writer.write_bundle(tmp_path, [d1, d2], failed_rel_paths=())

    assert summary2.removed == ("topics/c.md",)
    assert summary2.failed == ()


def test_write_bundle_failed_rel_path_with_no_prior_content_has_nothing_to_reaffirm(
    tmp_path: Path,
) -> None:
    """A concept whose FIRST-EVER draft attempt failed has no last-good
    version to keep — it must not error, must not appear as `removed`
    (it was never on disk to begin with), but IS still recorded in
    `failed` for `log.md` visibility (silent success is forbidden)."""
    d1 = _draft("topics/a.md", title="A")

    summary = bundle_writer.write_bundle(
        tmp_path, [d1], failed_rel_paths=("topics/never-drafted.md",)
    )

    assert summary.failed == ("topics/never-drafted.md",)
    assert summary.removed == ()
    assert not (tmp_path / "topics/never-drafted.md").exists()


def test_run_summary_with_only_a_failed_entry_is_not_a_no_op() -> None:
    """Defect B design guidance: silent success is forbidden — a run that
    only has a transient drafting failure (physical bundle content
    otherwise unchanged) must NOT report as a no-op."""
    summary = bundle_writer.RunSummary(failed=("topics/c.md",))
    assert summary.is_no_op is False


def test_render_log_entry_emits_a_failed_drafting_warning_line() -> None:
    summary = bundle_writer.RunSummary(failed=("topics/c.md",))
    text = bundle_writer.render_log_entry(summary, timestamp="2026-07-17T12:00:00Z")
    assert (
        "* **Run 2026-07-17T12:00:00Z — WARNING Failed drafting (1):** topics/c.md"
        in text
    )


def test_write_bundle_moved_concept_recorded_and_excluded_from_removed(tmp_path: Path) -> None:
    old = _draft("topics/old-name.md", title="Renamed Concept")
    bundle_writer.write_bundle(tmp_path, [old])

    new = _draft("topics/new-name.md", title="Renamed Concept")
    summary2 = bundle_writer.write_bundle(
        tmp_path, [new], moved={"topics/old-name.md": "topics/new-name.md"}
    )

    assert summary2.moved == (("topics/old-name.md", "topics/new-name.md"),)
    assert summary2.removed == ()  # accounted for via `moved`, not `removed`


def test_write_bundle_no_op_rerun_produces_no_op_diff(tmp_path: Path) -> None:
    concepts = _synthetic_catalogue(30)
    drafts = [
        _draft(rel_path, title=fm.title, description=fm.description)
        for rel_path, fm in concepts.items()
    ]

    summary1 = bundle_writer.write_bundle(
        tmp_path, drafts, timestamp="2026-07-08T00:00:00Z"
    )
    assert len(summary1.added) == len(drafts)

    index_after_run1 = (tmp_path / "index.md").read_text(encoding="utf-8")
    concept_content_after_run1 = {
        rel_path: (tmp_path / rel_path).read_text(encoding="utf-8") for rel_path in concepts
    }

    summary2 = bundle_writer.write_bundle(
        tmp_path, drafts, timestamp="2026-07-09T00:00:00Z"
    )

    # No-op diff: nothing added/changed/removed/moved; every concept
    # reported unchanged.
    assert summary2.added == ()
    assert summary2.changed == ()
    assert summary2.removed == ()
    assert summary2.moved == ()
    assert summary2.is_no_op is True
    assert set(summary2.unchanged) == set(concepts)

    # declare_file is STILL called every run (BI-18: always declare the
    # desired state; the engine's own lineage no-ops the physical write) —
    # but the CONTENT is byte-identical across both runs.
    index_after_run2 = (tmp_path / "index.md").read_text(encoding="utf-8")
    assert index_after_run2 == index_after_run1
    for rel_path in concepts:
        assert (tmp_path / rel_path).read_text(encoding="utf-8") == concept_content_after_run1[rel_path]

    # log.md gained exactly one additional no-op run record (BI-11
    # unconditional) — SPEC §7: newest date section FIRST.
    log_text = (tmp_path / "log.md").read_text(encoding="utf-8")
    headings = [
        m.group(1) for line in log_text.splitlines() if (m := _TS_DATE_HEADING_RE.match(line))
    ]
    assert headings == ["2026-07-09", "2026-07-08"]
    assert "* **Run 2026-07-09T00:00:00Z — No changes** (no-op re-run)." in log_text


# ─────────────────────────────────────────────────────────────────────────
# case_study cross-grain slug collision (ID-132 {132.29}) — a buyer that is
# BOTH a named-client entity and a won-bid issuing_organisation slugs
# identically in sources/l_records.py (READ-ONLY, correct: the two
# ConceptKeys differ by workspace_id and therefore memoise separately —
# this is purely a bundle PHYSICAL-write-target clash).
# ─────────────────────────────────────────────────────────────────────────


def _case_study_draft(
    rel_path: str,
    *,
    title: str,
    entity_id: "str | None" = None,
    workspace_id: "str | None" = None,
) -> ConceptDraft:
    key = ConceptKey(
        rel_path=rel_path,
        concept_type="case_study",
        entity_id=entity_id,
        workspace_id=workspace_id,
    )
    body = (
        f"A distilled synthesis about {title}.\n\n"
        f"{render_source_footnotes(sources_from_citations([_SD_URI]))}"
    )
    return ConceptDraft(
        key=key,
        frontmatter=_fm(
            type="case_study",
            title=title,
            description=f"{title} case study.",
        ),
        body=body,
        primary_anchor=_SD_URI,
    )


def test_named_client_and_won_bid_same_slug_reconcile_without_overwrite(
    tmp_path: Path,
) -> None:
    # Same buyer -> same slugified rel_path from BOTH grains (the {132.29}
    # collision scenario) — l_records.py's Source adapter is correct; the
    # collision is purely a bundle-write-target clash bundle_writer must
    # resolve.
    named_client = _case_study_draft(
        "case-studies/acme-ltd.md", title="Acme Ltd (named client)", entity_id="Acme Ltd"
    )
    won_bid = _case_study_draft(
        "case-studies/acme-ltd.md",
        title="Acme Ltd (won-bid outcome)",
        entity_id="Acme Ltd",
        workspace_id=_SAMPLE_UUID,
    )

    summary = bundle_writer.write_bundle(tmp_path, [named_client, won_bid])

    # Both concepts land — neither silently clobbers the other.
    assert len(summary.added) == 2
    named_client_path = tmp_path / "case-studies/acme-ltd.md"
    won_bid_path = tmp_path / "case-studies/won-bid/acme-ltd.md"
    assert named_client_path.exists()
    assert won_bid_path.exists()
    assert named_client_path != won_bid_path
    assert "named client" in named_client_path.read_text(encoding="utf-8")
    assert "won-bid outcome" in won_bid_path.read_text(encoding="utf-8")

    # The reported bundle paths reflect the actual (redirected) write
    # targets — index.md/log.md never point at a path that wasn't written.
    assert set(summary.added) == {"case-studies/acme-ltd.md", "case-studies/won-bid/acme-ltd.md"}

    index_text = (tmp_path / "index.md").read_text(encoding="utf-8")
    assert "case-studies/acme-ltd.md" in index_text
    assert "case-studies/won-bid/acme-ltd.md" in index_text


def test_write_bundle_raises_on_duplicate_write_path_instead_of_overwriting(
    tmp_path: Path,
) -> None:
    # Defense-in-depth, general case: ANY two drafts resolving to the same
    # physical bundle path in one run must fail loudly, never silently
    # overwrite — not only the named-client/won-bid case_study scenario.
    first = _draft("topics/dup.md", title="First")
    second = _draft("topics/dup.md", title="Second")

    with pytest.raises(ValueError, match="collision"):
        bundle_writer.write_bundle(tmp_path, [first, second])

    # Refusing to write means NEITHER draft's content landed.
    assert not (tmp_path / "topics/dup.md").exists()


# ─────────────────────────────────────────────────────────────────────────
# id-429 {429.5} — one index per directory (D1/D5/D6/D7).
#
# A design decision the owner took, NOT a conformance fix: §8 says an index
# MAY appear in any directory and §11 forbids rejecting a bundle for missing
# ones. One assertion per decided rule, over a synthetic multi-level draft
# set.
# ─────────────────────────────────────────────────────────────────────────

_ENTRY_RE = re.compile(r"^\* \[(.+?)\]\(([^)]+)\)(?:\s*[-—]\s*(.*))?$")


def _read_index(bundle_dir: Path, directory: str = "") -> str:
    rel = "index.md" if not directory else f"{directory}/index.md"
    return (bundle_dir / rel).read_text(encoding="utf-8")


def _section_entries(text: str, heading: str) -> "list[tuple[str, str, str]]":
    """`(label, target, description)` for every bullet under `## <heading>`."""
    entries: "list[tuple[str, str, str]]" = []
    inside = False
    for line in text.splitlines():
        if line.startswith("#"):
            inside = line == f"## {heading}"
            continue
        if inside and (m := _ENTRY_RE.match(line)):
            entries.append((m.group(1), m.group(2), m.group(3) or ""))
    return entries


def _multi_level_drafts():
    """root concept + `topics/` + `case-studies/` (with the {132.29} won-bid
    redirect) + `case-studies/won-bid/2025/` + a `reports/` that holds ONLY a
    child directory."""
    return [
        _draft("overview.md", title="Overview", description="The bundle root concept."),
        _draft("topics/alpha.md", title="Alpha", description="Alpha topic."),
        _draft("topics/beta.md", title="Beta", description="Beta topic."),
        _case_study_draft(
            "case-studies/acme-ltd.md", title="Acme Ltd", entity_id="Acme Ltd"
        ),
        # Identity rel_path `case-studies/acme-ltd.md`; PHYSICAL write path
        # `case-studies/won-bid/acme-ltd.md` (the {132.29} redirect).
        _case_study_draft(
            "case-studies/acme-ltd.md",
            title="Acme Ltd won bid",
            entity_id="Acme Ltd",
            workspace_id=_SAMPLE_UUID,
        ),
        _draft(
            "case-studies/won-bid/2025/legacy.md",
            title="Legacy 2025",
            description="An archived won bid.",
        ),
        _draft("reports/2026/q1.md", title="Q1 2026", description="Quarterly report."),
    ]


def test_an_index_is_declared_at_every_level_root_to_leaf(tmp_path: Path) -> None:
    """D7: every directory on the path from the root to every concept gets an
    index — including `reports/`, an INTERMEDIATE directory that holds no
    concepts of its own, only a child directory. Without that the root->leaf
    chain breaks and a reader navigating in hits a bare file list."""
    bundle_writer.write_bundle(tmp_path, _multi_level_drafts())

    for directory in (
        "",
        "case-studies",
        "case-studies/won-bid",
        "case-studies/won-bid/2025",
        "reports",
        "reports/2026",
        "topics",
    ):
        rel = "index.md" if not directory else f"{directory}/index.md"
        assert (tmp_path / rel).is_file(), f"missing index for {directory!r}"

    # `reports/` holds no concepts of its own — it is a pure waypoint.
    reports = _read_index(tmp_path, "reports")
    assert _section_entries(reports, "Concepts") == []
    assert [t for _, t, _ in _section_entries(reports, "Directories")] == ["2026/"]


def test_only_the_bundle_root_index_carries_okf_version_frontmatter(
    tmp_path: Path,
) -> None:
    """AC-5, made structural rather than conventional (D7): the renderer
    takes the stamp as a required parameter, so a nested index CANNOT acquire
    frontmatter §12 permits the bundle root alone."""
    bundle_writer.write_bundle(tmp_path, _multi_level_drafts())

    assert _read_index(tmp_path).splitlines()[:3] == [
        "---",
        'okf_version: "0.2"',
        "---",
    ]
    for directory in (
        "case-studies",
        "case-studies/won-bid",
        "case-studies/won-bid/2025",
        "reports",
        "reports/2026",
        "topics",
    ):
        text = _read_index(tmp_path, directory)
        assert not text.startswith("---"), directory
        assert "okf_version" not in text, directory


def test_directory_membership_and_counts_are_immediate_not_recursive(
    tmp_path: Path,
) -> None:
    """The assertion that catches the natural recursive-walk implementation.

    `case-studies/` lists its OWN concept only — not `won-bid/`'s, and not
    `won-bid/2025/`'s — and its entry for `won-bid/` counts `won-bid/`'s
    IMMEDIATE members (`1 concept, 1 subdirectory`), never the 2 concepts a
    recursive count would report. D6: the count exists to predict the page
    the reader is about to open, and that page lists immediate members."""
    bundle_writer.write_bundle(tmp_path, _multi_level_drafts())

    case_studies = _read_index(tmp_path, "case-studies")
    assert [t for _, t, _ in _section_entries(case_studies, "Concepts")] == [
        "acme-ltd.md"
    ]
    assert _section_entries(case_studies, "Directories") == [
        ("Won bid", "won-bid/", "1 concept, 1 subdirectory")
    ]

    won_bid = _read_index(tmp_path, "case-studies/won-bid")
    assert [t for _, t, _ in _section_entries(won_bid, "Concepts")] == ["acme-ltd.md"]
    assert _section_entries(won_bid, "Directories") == [("2025", "2025/", "1 concept")]


def test_entry_links_are_relative_to_the_index_own_directory(tmp_path: Path) -> None:
    """D5: no leading slash anywhere, and a nested index links a bare
    basename. `certifications/index.md` links `iso-27001.md`, never
    `/certifications/iso-27001.md` — §6.1's bundle-absolute recommendation is
    scoped to concept-to-concept links, where it buys move-stability an index
    regenerated in full every run does not need."""
    bundle_writer.write_bundle(tmp_path, _multi_level_drafts())

    for directory in ("topics", "case-studies", "case-studies/won-bid", "reports"):
        text = _read_index(tmp_path, directory)
        for _, target, _ in [
            *_section_entries(text, "Concepts"),
            *_section_entries(text, "Directories"),
        ]:
            assert not target.startswith("/"), (directory, target)
            assert "/" not in target.rstrip("/"), (directory, target)


def test_a_redirected_won_bid_concept_indexes_where_its_file_actually_is(
    tmp_path: Path,
) -> None:
    """§2 row 2 — proves the PHYSICAL-path keying survived. The won-bid
    `case_study` draft's IDENTITY rel_path is `case-studies/acme-ltd.md`, but
    `bundle_write_path` redirects its file to `case-studies/won-bid/`. Group
    by identity instead and the index links a path that does not exist."""
    bundle_writer.write_bundle(tmp_path, _multi_level_drafts())

    won_bid_labels = [l for l, _, _ in _section_entries(
        _read_index(tmp_path, "case-studies/won-bid"), "Concepts"
    )]
    case_study_labels = [l for l, _, _ in _section_entries(
        _read_index(tmp_path, "case-studies"), "Concepts"
    )]

    assert "Acme Ltd won bid" in won_bid_labels
    assert "Acme Ltd won bid" not in case_study_labels
    assert case_study_labels == ["Acme Ltd"]
    # Every link an index emits resolves to a real file.
    for directory in ("case-studies", "case-studies/won-bid"):
        for _, target, _ in _section_entries(_read_index(tmp_path, directory), "Concepts"):
            assert (tmp_path / directory / target).is_file()


def test_index_entries_are_ascii_ordered(tmp_path: Path) -> None:
    """D6: ASCII-ascending by link target. Asserted with targets whose ASCII
    and case-insensitive orders DISAGREE — a case-folding sort would put
    `apple` first, and the resulting churn would show up as a diff on every
    run in a client-owned git repo (DR-016)."""
    drafts = [
        _draft("topics/apple.md", title="Apple", description="A."),
        _draft("topics/Zulu.md", title="Zulu", description="Z."),
    ]
    bundle_writer.write_bundle(tmp_path, drafts)

    targets = [t for _, t, _ in _section_entries(_read_index(tmp_path, "topics"), "Concepts")]
    assert targets == ["Zulu.md", "apple.md"]


def test_two_consecutive_runs_produce_byte_identical_indexes(tmp_path: Path) -> None:
    """D6 determinism. The real failure mode is not cosmetic: the bundle is a
    client-owned git repo (DR-016), so a non-deterministic index produces a
    diff on every run, forever. Also proves the {429.2} interaction — a
    nested index is never reported added/removed on either run."""
    drafts = _multi_level_drafts()

    summary1 = bundle_writer.write_bundle(
        tmp_path, drafts, timestamp="2026-08-10T00:00:00Z"
    )
    directories = [
        "",
        "case-studies",
        "case-studies/won-bid",
        "case-studies/won-bid/2025",
        "reports",
        "reports/2026",
        "topics",
    ]
    after_run1 = {d: _read_index(tmp_path, d) for d in directories}

    summary2 = bundle_writer.write_bundle(
        tmp_path, drafts, timestamp="2026-08-11T00:00:00Z"
    )

    for directory in directories:
        assert _read_index(tmp_path, directory) == after_run1[directory], directory

    assert summary2.is_no_op is True
    for summary in (summary1, summary2):
        for directory in directories:
            rel = "index.md" if not directory else f"{directory}/index.md"
            assert rel not in summary.added
            assert rel not in summary.removed


def test_a_concept_that_failed_to_draft_is_absent_from_its_index(
    tmp_path: Path,
) -> None:
    """D7, stated as a decided consequence: membership is `written` — this
    run's VALIDATED set — not the on-disk tree. A re-affirmed failed concept
    keeps its file (never orphan-deleted) but is not in this run's index;
    including it would mean re-parsing frontmatter off disk to recover a
    title and description the run never produced. It stays reachable via the
    file tree and the graph, and is named in `log.md`'s `failed`."""
    alpha = _draft("topics/alpha.md", title="Alpha", description="Alpha topic.")
    beta = _draft("topics/beta.md", title="Beta", description="Beta topic.")
    bundle_writer.write_bundle(tmp_path, [alpha, beta])
    beta_on_disk = (tmp_path / "topics/beta.md").read_text(encoding="utf-8")

    summary = bundle_writer.write_bundle(
        tmp_path, [alpha], failed_rel_paths=("topics/beta.md",)
    )

    targets = [t for _, t, _ in _section_entries(_read_index(tmp_path, "topics"), "Concepts")]
    assert targets == ["alpha.md"]
    # ...while the file itself survives, byte-identical, and the failure is
    # visible rather than silent.
    assert (tmp_path / "topics/beta.md").read_text(encoding="utf-8") == beta_on_disk
    assert summary.failed == ("topics/beta.md",)


def test_a_directory_losing_its_last_concept_stops_having_an_index_declared(
    tmp_path: Path,
) -> None:
    """D7: no special case for a vanished directory — the index is simply not
    declared, and cocoindex's OWN orphan-delete reconciliation removes the
    stale file on the next run (module docstring's EXECUTOR-VERIFY finding).
    This module never unlinks, so the assertion is the ABSENCE of the
    `declare_file` call, not the absence of the file."""
    root = _draft("overview.md", title="Overview", description="Root concept.")
    alpha = _draft("topics/alpha.md", title="Alpha", description="Alpha topic.")
    bundle_writer.write_bundle(tmp_path, [root, alpha])
    assert (tmp_path / "topics/index.md").is_file()

    _localfs_stub.declare_file.reset_mock()
    bundle_writer.write_bundle(tmp_path, [root])

    declared = {str(c.args[0]) for c in _localfs_stub.declare_file.call_args_list}
    assert str(tmp_path / "topics/index.md") not in declared
    assert str(tmp_path / "index.md") in declared
    # The physical delete is the engine's, never ours.
    assert (tmp_path / "topics/index.md").exists()


def test_the_root_index_is_declared_even_for_an_empty_bundle(tmp_path: Path) -> None:
    """D7: the root index is ALWAYS declared — it carries the §12
    `okf_version` stamp, which must not disappear when the corpus is
    empty."""
    bundle_writer.write_bundle(tmp_path, [])

    text = _read_index(tmp_path)
    assert text.splitlines() == ["---", 'okf_version: "0.2"', "---", "# OKF Concept Bundle"]


def test_the_root_index_still_enumerates_every_concept(tmp_path: Path) -> None:
    """The deliberate {429.6} seam. D2 turns the root into a directory
    listing — but `parseBundleNav` drops any bullet whose target is not
    `.md`, so a root of directory entries returns non-empty sections with
    ZERO concepts, which suppresses `<BundleNav>`'s absent-index fallback and
    renders an EMPTY nav rail. D2 is therefore gated on id-439. Until then
    the root keeps today's behaviour, bundle-root-relative links and all, so
    this subtask carries no consumer risk."""
    bundle_writer.write_bundle(tmp_path, _multi_level_drafts())

    root = _read_index(tmp_path)
    targets = [t for _, t, _ in _section_entries(root, "Concepts")]
    assert targets == [
        "case-studies/acme-ltd.md",
        "case-studies/won-bid/2025/legacy.md",
        "case-studies/won-bid/acme-ltd.md",
        "overview.md",
        "reports/2026/q1.md",
        "topics/alpha.md",
        "topics/beta.md",
    ]
    assert _section_entries(root, "Directories") == []


# ─────────────────────────────────────────────────────────────────────────
# DR-027 ontology artefact
# ─────────────────────────────────────────────────────────────────────────


def test_write_ontology_artefact_base_only_when_no_overlay(tmp_path: Path) -> None:
    content = bundle_writer.write_ontology_artefact(tmp_path)
    payload = json.loads(content)

    # ID-427 {427.5}: the pinned base snapshot lost its `concept_types`
    # row with `ALLOWED_CONCEPT_TYPES` — publishing a base concept-type
    # vocabulary in an artefact after deleting it from the gate would
    # re-assert the closed taxonomy in a different file. ({427.11} retires
    # the whole `base` key; the two surviving dimensions are asserted here
    # because they are genuinely closed CVs and must NOT vanish with it.)
    assert "concept_types" not in payload["base"]
    assert payload["base"]["entity_types"] == sorted(ALLOWED_ENTITY_TYPES)
    assert payload["base"]["relationship_types"] == sorted(ALLOWED_RELATIONSHIP_TYPES)
    assert payload["overlay"] is None
    on_disk = json.loads((tmp_path / "ontology.json").read_text(encoding="utf-8"))
    assert on_disk == payload


def test_write_ontology_artefact_with_client_overlay(tmp_path: Path) -> None:
    # C-2 (ID-132 {132.34} OQ-OV-6): the overlay is now the provenance-
    # wrapped shape `write_bundle` supplies via `read_client_overlay` —
    # `write_ontology_artefact` itself stays a pure echo of whatever
    # mapping it is handed (the assertion below is still `== overlay`).
    overlay = {
        "source": "ontology-overlay.json",
        "sha256": "d34db33f" * 8,
        "concept_types": [],
        "entity_types": ["widget"],
        "relationship_types": [],
    }
    content = bundle_writer.write_ontology_artefact(tmp_path, client_overlay=overlay)
    payload = json.loads(content)

    # The overlay is still echoed VERBATIM, `concept_types` key and all —
    # a client bundle declaring concept types stays schema-valid and its
    # declaration still surfaces in the artefact; it simply no longer
    # gates any write ({427.5}).
    assert payload["overlay"] == overlay
    assert "concept_types" not in payload["base"]
    assert payload["base"]["entity_types"] == sorted(ALLOWED_ENTITY_TYPES)


# ─────────────────────────────────────────────────────────────────────────
# {132.44} context.jsonld emission (bl-457 G-IRI-PROJECTION IRI-4/5/6/9/12)
# ─────────────────────────────────────────────────────────────────────────


def test_context_filename_is_reserved() -> None:
    """{132.44}: `context.jsonld` is a reserved bundle-level filename —
    parity with `ontology.json`/`README.md`/etc (never mistaken for a
    concept `.md` path). It is a `.jsonld` file, so `_existing_concept_
    paths`'s `rglob("*.md")` scan structurally never picks it up either
    way — asserted for intent/parity per IRI-PROJECTION.md's direct-reads
    note on `_RESERVED_BUNDLE_FILENAMES`."""
    assert "context.jsonld" in bundle_writer._RESERVED_BUNDLE_FILENAMES
    assert bundle_writer.CONTEXT_FILENAME == "context.jsonld"


def test_write_context_artefact_base_only_when_no_client_id(tmp_path: Path) -> None:
    """IRI-4/5: every base-vocabulary term across both surviving dimensions
    resolves to its base IRI; no `client` prefix is emitted absent a
    client-id (IRI-6)."""
    eo = EffectiveOntology.base_only()
    content = bundle_writer.write_context_artefact(tmp_path, eo)
    payload = json.loads(content)

    assert set(payload) == {"@context"}
    context = payload["@context"]
    assert "client" not in context
    # {427.5}: no concept-type term is projected — the dimension went with
    # its base register, so `context.jsonld` carries entity and
    # relationship terms only (TECH §2.10).
    assert "case_study" not in context
    for term in ALLOWED_ENTITY_TYPES:
        assert context[term] == iri_projection.mint_iri(term, scope=None)
    for term in ALLOWED_RELATIONSHIP_TYPES:
        assert context[term] == iri_projection.mint_iri(term, scope=None)

    on_disk = json.loads((tmp_path / "context.jsonld").read_text(encoding="utf-8"))
    assert on_disk == payload


def test_write_context_artefact_projects_overlay_under_client_ns_when_client_id_set(
    tmp_path: Path,
) -> None:
    """IRI-2/5/6: with an explicit client-id, an overlay term mints under
    the client namespace (never under base)."""
    eo = EffectiveOntology.compose({"entity_types": ["widget"]})
    content = bundle_writer.write_context_artefact(tmp_path, eo, client_id="acme")
    context = json.loads(content)["@context"]

    assert context["client"] == f"{iri_projection._client_namespace('acme')}#"
    assert context["widget"] == iri_projection.mint_iri("widget", scope="acme")
    assert "/base#" not in context["widget"]


def test_write_context_artefact_persists_only_the_context_key(tmp_path: Path) -> None:
    """This Subtask's diagnostics-persistence design decision: `project_
    context` returns `{"@context": ..., "diagnostics": ...}` as SIBLING
    keys, but `context.jsonld`'s on-disk shape stays spec-conformant —
    ONLY `"@context"` is persisted, even when a run produces a non-empty
    `diagnostics` (a slug collision here) — `project_context` already logs
    every diagnostic finding at WARNING as it occurs, so nothing is
    silently lost by leaving it out of the file."""
    eo = EffectiveOntology.compose({"entity_types": ["Foo Bar", "foo-bar"]})
    content = bundle_writer.write_context_artefact(tmp_path, eo, client_id="acme")
    payload = json.loads(content)

    assert list(payload.keys()) == ["@context"]
    on_disk = json.loads((tmp_path / "context.jsonld").read_text(encoding="utf-8"))
    assert list(on_disk.keys()) == ["@context"]


def test_write_bundle_writes_context_jsonld_base_only_when_no_client_id(
    tmp_path: Path,
) -> None:
    """IRI-4/5/9: a full `write_bundle` run (no `client_id` kwarg) ships
    `context.jsonld` base-only, alongside every other bundle artefact."""
    draft = _draft("topics/alpha.md", title="Alpha")

    bundle_writer.write_bundle(tmp_path, [draft])

    assert (tmp_path / "context.jsonld").is_file()
    payload = json.loads((tmp_path / "context.jsonld").read_text(encoding="utf-8"))
    assert "client" not in payload["@context"]
    # {427.5}: no concept-type term is projected any more, so the base
    # assertion moves to a surviving dimension (`organisation` is an
    # `ALLOWED_ENTITY_TYPES` member). The claim is unchanged: a base term
    # ships under the base namespace with no client prefix.
    assert "topic" not in payload["@context"]
    assert payload["@context"]["organisation"] == iri_projection.mint_iri(
        "organisation", scope=None
    )


def test_write_bundle_projects_overlay_iris_under_client_ns_when_client_id_passed(
    tmp_path: Path,
) -> None:
    """IRI-2/5/6: a `write_bundle(..., client_id=...)` run composes the
    client-authored overlay (`ontology-overlay.json`) into the SAME
    `EffectiveOntology` `context.jsonld` projects — an overlay term mints
    under the client namespace when `client_id` is supplied."""
    (tmp_path / "ontology-overlay.json").write_text(
        json.dumps({"entity_types": ["widget"]}), encoding="utf-8"
    )
    draft = _draft("topics/alpha.md", title="Alpha")

    bundle_writer.write_bundle(
        tmp_path, [draft], bundle_class="client_business", client_id="acme"
    )

    payload = json.loads((tmp_path / "context.jsonld").read_text(encoding="utf-8"))
    context = payload["@context"]
    assert context["client"] == f"{iri_projection._client_namespace('acme')}#"
    assert context["widget"] == iri_projection.mint_iri("widget", scope="acme")


def test_write_bundle_client_id_absent_is_base_only_and_run_not_aborted(
    tmp_path: Path,
) -> None:
    """IRI-6: an overlay IS present but `client_id` is NOT passed to
    `write_bundle` — overlay-term IRIs are never guessed/derived; the
    overlay term is left un-projected (advisory) and the run is NOT
    aborted (concept files, index.md, log.md, ontology.json all still
    land normally). `bundle_class="client_business"` here is orthogonal to
    this test's IRI-6 assertion — it is passed only so the OV-10 gate
    (ID-132 {132.37}) permits the overlay to compose at all; see
    `test_write_bundle_hard_rejects_...` below for the class-gate's own
    tests."""
    (tmp_path / "ontology-overlay.json").write_text(
        json.dumps({"entity_types": ["widget"]}), encoding="utf-8"
    )
    draft = _draft("topics/alpha.md", title="Alpha")

    summary = bundle_writer.write_bundle(tmp_path, [draft], bundle_class="client_business")

    assert summary.added == ("topics/alpha.md",)
    payload = json.loads((tmp_path / "context.jsonld").read_text(encoding="utf-8"))
    context = payload["@context"]
    assert "client" not in context
    assert "widget" not in context


def test_write_bundle_context_jsonld_byte_identical_on_two_identical_runs(
    tmp_path: Path,
) -> None:
    """IRI-12/BI-18: two runs over unchanged inputs (same effective
    ontology, same client-id) produce a byte-identical `context.jsonld` —
    no spurious churn feeding the {132.35} BI-18 re-proof."""
    draft = _draft("topics/alpha.md", title="Alpha")

    bundle_writer.write_bundle(tmp_path, [draft], client_id="acme")
    first = (tmp_path / "context.jsonld").read_bytes()

    bundle_writer.write_bundle(tmp_path, [draft], client_id="acme")
    second = (tmp_path / "context.jsonld").read_bytes()

    assert first == second


def test_write_bundle_does_not_report_a_committed_context_jsonld_as_removed(
    tmp_path: Path,
) -> None:
    """§9 reserved-file parity (mirrors README.md/CONFORMANCE.md): a
    pre-existing `context.jsonld` from a prior run is never reported as
    `RunSummary.removed` — trivially true since it is not a `.md` path
    `_existing_concept_paths` scans, but asserted here for parity/defence-
    in-depth with the other reserved bundle-level artefacts."""
    (tmp_path / "context.jsonld").write_text('{"@context": {}}\n', encoding="utf-8")
    draft = _draft("topics/alpha.md", title="Alpha")

    summary = bundle_writer.write_bundle(tmp_path, [draft])

    assert summary.removed == ()
    log_text = (tmp_path / "log.md").read_text(encoding="utf-8")
    assert "context.jsonld" not in log_text


# ─────────────────────────────────────────────────────────────────────────
# Client-CV-overlay (ID-132 {132.34} G-OVERLAY-CV, DR-054) — OV-1..OV-13
# ─────────────────────────────────────────────────────────────────────────


def test_readme_and_overlay_filenames_are_reserved(tmp_path: Path) -> None:
    """Rider R1 + OV-1 + OKF v0.1 conformance: the committed bundle README,
    the hand-authored bundle-root CONFORMANCE.md and the client-authored
    overlay source are ALL reserved bundle-level filenames — never mistaken
    for a concept `.md` path."""
    assert "README.md" in bundle_writer._RESERVED_BUNDLE_FILENAMES
    assert "CONFORMANCE.md" in bundle_writer._RESERVED_BUNDLE_FILENAMES
    assert "ontology-overlay.json" in bundle_writer._RESERVED_BUNDLE_FILENAMES


def test_write_bundle_does_not_report_a_committed_conformance_doc_as_removed(
    tmp_path: Path,
) -> None:
    """OKF v0.1 conformance hygiene: a hand-authored bundle-root
    `CONFORMANCE.md` is a `.md` file scanned by `_existing_concept_paths`'s
    `rglob("*.md")` — reserving it prevents the false
    `Removed (N): CONFORMANCE.md` audit-log line (mirrors README's R1)."""
    (tmp_path / "CONFORMANCE.md").write_text("# Conformance\n", encoding="utf-8")
    draft = _draft("topics/alpha.md", title="Alpha")

    summary = bundle_writer.write_bundle(tmp_path, [draft])

    assert summary.removed == ()
    log_text = (tmp_path / "log.md").read_text(encoding="utf-8")
    assert "CONFORMANCE.md" not in log_text
    assert (tmp_path / "CONFORMANCE.md").exists()  # untouched, never declare_file'd


def test_write_bundle_does_not_report_a_committed_readme_as_removed(tmp_path: Path) -> None:
    """Rider R1: `README.md` is a `.md` file, so — unlike `ontology.json` —
    it IS scanned by `_existing_concept_paths`'s `rglob("*.md")` and must be
    reserved to avoid a false `Removed: README.md` `log.md` line."""
    (tmp_path / "README.md").write_text("# Bundle repo\n", encoding="utf-8")
    draft = _draft("topics/alpha.md", title="Alpha")

    summary = bundle_writer.write_bundle(tmp_path, [draft])

    assert summary.removed == ()
    log_text = (tmp_path / "log.md").read_text(encoding="utf-8")
    assert "Removed: README.md" not in log_text
    assert (tmp_path / "README.md").exists()  # untouched, never declare_file'd


def test_overlay_file_is_read_and_never_declared_or_deleted(tmp_path: Path) -> None:
    """OV-1/OV-4: a fixture bundle repo with `ontology-overlay.json` at its
    root is read by the producer and composed into `ontology.json`; the
    client-authored file itself is never `declare_file`-written (DR-016)."""
    (tmp_path / "ontology-overlay.json").write_text(
        json.dumps({"entity_types": ["widget"]}), encoding="utf-8"
    )
    draft = _draft("topics/alpha.md", title="Alpha")

    bundle_writer.write_bundle(tmp_path, [draft], bundle_class="client_business")

    declared_paths = {str(call.args[0]) for call in _localfs_stub.declare_file.call_args_list}
    assert str(tmp_path / "ontology-overlay.json") not in declared_paths
    ontology = json.loads((tmp_path / "ontology.json").read_text(encoding="utf-8"))
    assert ontology["overlay"]["entity_types"] == ["widget"]


def test_write_bundle_is_base_only_when_no_overlay_file_present(tmp_path: Path) -> None:
    """OV-4/OV-10/OV-12: absent overlay file (the platform bundle's
    permanent state, and any client bundle before its first overlay
    commit) composes `overlay: null` and still publishes successfully."""
    draft = _draft("topics/alpha.md", title="Alpha")

    summary = bundle_writer.write_bundle(tmp_path, [draft])

    assert summary.added == ("topics/alpha.md",)
    ontology = json.loads((tmp_path / "ontology.json").read_text(encoding="utf-8"))
    assert ontology["overlay"] is None


def test_overlay_with_known_keys_parses(tmp_path: Path) -> None:
    """OV-2: the three permitted dimension keys parse; an omitted key
    defaults to an empty list."""
    (tmp_path / "ontology-overlay.json").write_text(
        json.dumps({"entity_types": ["widget"], "relationship_types": ["partners_with"]}),
        encoding="utf-8",
    )
    overlay = bundle_writer.read_client_overlay(tmp_path)

    assert overlay["entity_types"] == ["widget"]
    assert overlay["relationship_types"] == ["partners_with"]
    assert overlay["concept_types"] == []


def test_overlay_with_unknown_key_fails_loud(tmp_path: Path) -> None:
    """OV-2/OQ-OV-4: a singular-typo key (`entity_type` vs `entity_types`)
    is an unknown top-level key — rejected, never silently ignored."""
    (tmp_path / "ontology-overlay.json").write_text(
        json.dumps({"entity_type": ["widget"]}), encoding="utf-8"
    )
    with pytest.raises(bundle_writer.OntologyOverlayError):
        bundle_writer.read_client_overlay(tmp_path)


def test_overlay_with_non_list_value_fails_loud(tmp_path: Path) -> None:
    """OV-2: a dimension value that isn't a list of strings fails loud."""
    (tmp_path / "ontology-overlay.json").write_text(
        json.dumps({"entity_types": "widget"}), encoding="utf-8"
    )
    with pytest.raises(bundle_writer.OntologyOverlayError):
        bundle_writer.read_client_overlay(tmp_path)


def test_overlay_expressing_removal_fails_loud(tmp_path: Path) -> None:
    """OV-3: the closed schema has no removal mechanism — any attempt (a
    `remove`/`exclude` key, a negation) is already an unknown top-level key
    and therefore fails per OV-2/OV-5."""
    (tmp_path / "ontology-overlay.json").write_text(
        json.dumps({"remove": {"entity_types": ["organisation"]}}), encoding="utf-8"
    )
    with pytest.raises(bundle_writer.OntologyOverlayError):
        bundle_writer.read_client_overlay(tmp_path)


def test_overlay_that_is_not_valid_json_fails_loud(tmp_path: Path) -> None:
    """OV-5: malformed JSON is a validation failure, not a silent skip."""
    (tmp_path / "ontology-overlay.json").write_text("{not valid json", encoding="utf-8")
    with pytest.raises(bundle_writer.OntologyOverlayError):
        bundle_writer.read_client_overlay(tmp_path)


def test_write_bundle_aborts_and_publishes_nothing_on_malformed_overlay(
    tmp_path: Path,
) -> None:
    """OV-5: a present-but-invalid overlay ABORTS the whole producer run —
    it never degrades to a base-only or partial ontology. No concept file,
    no `index.md`/`log.md`/`ontology.json` — nothing is published this run."""
    (tmp_path / "ontology-overlay.json").write_text("{not valid json", encoding="utf-8")
    draft = _draft("topics/alpha.md", title="Alpha")

    with pytest.raises(bundle_writer.OntologyOverlayError):
        bundle_writer.write_bundle(tmp_path, [draft])

    assert not (tmp_path / "topics/alpha.md").exists()
    assert not (tmp_path / "ontology.json").exists()
    assert not (tmp_path / "log.md").exists()


def test_ontology_artefact_overlay_carries_source_and_sha256_provenance(
    tmp_path: Path,
) -> None:
    """OV-6: a composed overlay's artefact entry records `source` + a
    content `sha256` alongside the overlay's own terms."""
    raw = json.dumps({"entity_types": ["widget"]}).encode("utf-8")
    (tmp_path / "ontology-overlay.json").write_bytes(raw)
    draft = _draft("topics/alpha.md", title="Alpha")

    bundle_writer.write_bundle(tmp_path, [draft], bundle_class="client_business")

    ontology = json.loads((tmp_path / "ontology.json").read_text(encoding="utf-8"))
    overlay = ontology["overlay"]
    assert overlay["source"] == "ontology-overlay.json"
    assert overlay["sha256"] == hashlib.sha256(raw).hexdigest()


def test_overlay_present_empty_is_distinct_from_overlay_absent(tmp_path: Path) -> None:
    """OV-11: an absent overlay file composes `overlay: null`; a PRESENT
    overlay file that adds nothing composes a non-null `overlay` object
    with empty term lists + provenance — the two states are observably
    distinct even though both yield a base-identical effective set."""
    absent_draft = _draft("topics/absent.md", title="Absent")
    absent_summary = bundle_writer.write_bundle(tmp_path, [absent_draft])
    absent_ontology = json.loads((tmp_path / "ontology.json").read_text(encoding="utf-8"))
    assert absent_ontology["overlay"] is None
    assert absent_summary.added == ("topics/absent.md",)

    (tmp_path / "ontology-overlay.json").write_text(json.dumps({}), encoding="utf-8")
    present_draft = _draft("topics/present.md", title="Present")
    bundle_writer.write_bundle(
        tmp_path, [absent_draft, present_draft], bundle_class="client_business"
    )
    present_ontology = json.loads((tmp_path / "ontology.json").read_text(encoding="utf-8"))

    overlay = present_ontology["overlay"]
    assert overlay is not None
    assert overlay["concept_types"] == []
    assert overlay["entity_types"] == []
    assert overlay["relationship_types"] == []
    assert overlay["source"] == "ontology-overlay.json"


def test_write_bundle_writes_a_client_type_with_or_without_an_overlay(
    tmp_path: Path,
) -> None:
    """REPLACES `test_write_bundle_accepts_overlay_added_concept_type_
    only_with_overlay`, whose whole subject was that a client\'s own
    concept type needed PERMISSION from an `ontology-overlay.json` — the
    "only_with_overlay" in its name is the inversion DR-141 withdrew.

    Asserted the other way round now, at the same `write_bundle` surface:
    the SAME concept is written with no overlay AND with one, and a shipped
    client bundle that still declares `concept_types` keeps validating (the
    overlay key stays schema-valid — {427.11} owns the artefact half)."""
    draft = _draft("topics/widget.md", title="Widget", type="widget_type")

    no_overlay_dir = tmp_path / "no-overlay"
    no_overlay_dir.mkdir()
    no_overlay_summary = bundle_writer.write_bundle(no_overlay_dir, [draft])
    assert no_overlay_summary.added == ("topics/widget.md",)
    assert no_overlay_summary.validator_failures == ()
    assert (no_overlay_dir / "topics/widget.md").exists()

    overlay_dir = tmp_path / "with-overlay"
    overlay_dir.mkdir()
    (overlay_dir / "ontology-overlay.json").write_text(
        json.dumps({"concept_types": ["widget_type"]}), encoding="utf-8"
    )
    overlay_summary = bundle_writer.write_bundle(
        overlay_dir, [draft], bundle_class="client_business"
    )
    assert overlay_summary.added == ("topics/widget.md",)
    assert overlay_summary.validator_failures == ()
    assert (overlay_dir / "topics/widget.md").exists()


# ─────────────────────────────────────────────────────────────────────────
# Bundle-CLASS discriminator (ID-132 {132.37} G-OVERLAY-PLATFORM-REJECT,
# DR-054/DR-079) — OV-10
# ─────────────────────────────────────────────────────────────────────────


def test_ontology_overlay_class_error_is_an_ontology_overlay_error(tmp_path: Path) -> None:
    """`OntologyOverlayClassError` subclasses `OntologyOverlayError` — an
    existing `except OntologyOverlayError` catch site keeps working
    unchanged even though this is a distinct failure mode (a present-and-
    VALID overlay in the wrong bundle class, not a schema violation)."""
    assert issubclass(bundle_writer.OntologyOverlayClassError, bundle_writer.OntologyOverlayError)


def test_write_bundle_hard_rejects_overlay_for_each_non_client_business_class(
    tmp_path: Path,
) -> None:
    """OV-10: DR-079's other three ratified bundle classes — system-
    baseline, showcase, internal-dev — are ALL platform-owned and ride the
    same `write_bundle` spine; every one of them must hard-reject a stray
    overlay exactly like the (retired-terminology) 'platform bundle' case
    OV-10 originally named. Nothing is published this run (mirrors OV-5's
    all-or-nothing fail-loud posture)."""
    (tmp_path / "ontology-overlay.json").write_text(
        json.dumps({"entity_types": ["widget"]}), encoding="utf-8"
    )
    draft = _draft("topics/alpha.md", title="Alpha")

    for non_client_class in ("system_baseline", "showcase", "internal_dev"):
        with pytest.raises(bundle_writer.OntologyOverlayClassError):
            bundle_writer.write_bundle(tmp_path, [draft], bundle_class=non_client_class)

        assert not (tmp_path / "topics/alpha.md").exists()
        assert not (tmp_path / "ontology.json").exists()
        assert not (tmp_path / "log.md").exists()


def test_write_bundle_hard_rejects_overlay_when_bundle_class_is_unset(
    tmp_path: Path,
) -> None:
    """OV-10: an unresolved/ambiguous `bundle_class` (the default, `None`)
    is deliberately NOT treated as a safe stand-in for `"client_business"`
    — a silently-permissive default is exactly the bug this Subtask kills.
    A stray overlay file discovered with no class signal at all hard-
    rejects, same as a confirmed non-client-business class."""
    (tmp_path / "ontology-overlay.json").write_text(
        json.dumps({"entity_types": ["widget"]}), encoding="utf-8"
    )
    draft = _draft("topics/alpha.md", title="Alpha")

    with pytest.raises(bundle_writer.OntologyOverlayClassError):
        bundle_writer.write_bundle(tmp_path, [draft])

    assert not (tmp_path / "topics/alpha.md").exists()
    assert not (tmp_path / "ontology.json").exists()


def test_write_bundle_composes_overlay_when_bundle_class_is_client_business(
    tmp_path: Path,
) -> None:
    """OV-10/OV-4: the ONE permitted class — `"client_business"` — composes
    a discovered overlay normally, exactly as before this Subtask's gate
    existed (the testStrategy's "a client-bundle run with the same file
    composes normally" clause)."""
    (tmp_path / "ontology-overlay.json").write_text(
        json.dumps({"entity_types": ["widget"]}), encoding="utf-8"
    )
    draft = _draft("topics/alpha.md", title="Alpha")

    summary = bundle_writer.write_bundle(tmp_path, [draft], bundle_class="client_business")

    assert summary.added == ("topics/alpha.md",)
    ontology = json.loads((tmp_path / "ontology.json").read_text(encoding="utf-8"))
    assert ontology["overlay"]["entity_types"] == ["widget"]


def test_write_bundle_non_client_business_class_without_overlay_file_stays_base_only(
    tmp_path: Path,
) -> None:
    """OV-10/OV-12: the gate only fires when an overlay is DISCOVERED — a
    non-client-business bundle_class with no overlay file present composes
    `overlay: null` and publishes successfully, same as always (the
    testStrategy's "platform run without the file stays base-only
    overlay:null" clause)."""
    draft = _draft("topics/alpha.md", title="Alpha")

    summary = bundle_writer.write_bundle(tmp_path, [draft], bundle_class="showcase")

    assert summary.added == ("topics/alpha.md",)
    ontology = json.loads((tmp_path / "ontology.json").read_text(encoding="utf-8"))
    assert ontology["overlay"] is None


def test_write_bundle_explicit_client_ontology_overlay_kwarg_bypasses_the_class_gate(
    tmp_path: Path,
) -> None:
    """The OV-10 class gate only guards the auto-discovered (`read_client_
    overlay`) path — the pre-existing `client_ontology_overlay` kwarg is a
    caller-supplied escape hatch (tests; `write_ontology_artefact`'s own
    direct-call test) that has already taken responsibility for its
    provenance, so it composes regardless of `bundle_class` (no overlay
    FILE was discovered on disk to reject)."""
    draft = _draft("topics/alpha.md", title="Alpha")

    summary = bundle_writer.write_bundle(
        tmp_path,
        [draft],
        client_ontology_overlay={"entity_types": ["widget"]},
        bundle_class="showcase",
    )

    assert summary.added == ("topics/alpha.md",)
    ontology = json.loads((tmp_path / "ontology.json").read_text(encoding="utf-8"))
    assert ontology["overlay"]["entity_types"] == ["widget"]


# ── ID-163 {163.7} PC-6 — DR-054 overlay-rejection regression anchor ─────
# The OV-10 guard exercised here is NOT net-new (already covered generically
# by `test_write_bundle_hard_rejects_overlay_for_each_non_client_business_class`
# above, which loops `bundle_class` over all three non-client-business
# classes including `system_baseline`). These two tests exist as a
# standalone, PC-6-traceable pair — pinned to `write_bundle`'s inline OV-10
# class-gate in `bundle_writer.py` (`if overlay is not None and
# bundle_class != _CLIENT_BUSINESS_BUNDLE_CLASS: raise
# OntologyOverlayClassError(...)`) — so a future regression specifically on
# the `system_baseline` class is caught even if the broader parametrized
# test above is ever narrowed or removed.


def test_system_baseline_bundle_class_hard_rejects_a_present_overlay(
    tmp_path: Path,
) -> None:
    """PC-6 (TECH id-163, DR-054): a discovered, schema-valid
    `ontology-overlay.json` in a `system_baseline` bundle must RAISE
    `OntologyOverlayClassError` before any `declare_file` call — nothing is
    published this run (OV-5's all-or-nothing fail-loud posture). Proves
    DR-054's 'only client_business may author an overlay' invariant holds
    for the system class."""
    (tmp_path / "ontology-overlay.json").write_text(
        json.dumps({"entity_types": ["widget"]}), encoding="utf-8"
    )
    draft = _draft("topics/alpha.md", title="Alpha")

    with pytest.raises(bundle_writer.OntologyOverlayClassError):
        bundle_writer.write_bundle(tmp_path, [draft], bundle_class="system_baseline")

    assert not (tmp_path / "topics/alpha.md").exists()
    assert not (tmp_path / "ontology.json").exists()
    assert not (tmp_path / "log.md").exists()


def test_client_business_bundle_class_still_composes_a_present_overlay_control(
    tmp_path: Path,
) -> None:
    """PC-6 (TECH id-163) control for the test above: the SAME
    `ontology-overlay.json` file, under `bundle_class="client_business"`,
    composes normally instead of raising — proving the `system_baseline`
    rejection is a class-discriminator, not an unconditional block on the
    overlay file's mere presence."""
    (tmp_path / "ontology-overlay.json").write_text(
        json.dumps({"entity_types": ["widget"]}), encoding="utf-8"
    )
    draft = _draft("topics/alpha.md", title="Alpha")

    summary = bundle_writer.write_bundle(tmp_path, [draft], bundle_class="client_business")

    assert summary.added == ("topics/alpha.md",)
    ontology = json.loads((tmp_path / "ontology.json").read_text(encoding="utf-8"))
    assert ontology["overlay"]["entity_types"] == ["widget"]


# ─────────────────────────────────────────────────────────────────────────
# ID-427 {427.5} / DR-141 — `type` is a label, and bundle classes are
# UNIFORM (owner ruling, S546).
#
# REPLACES the five per-class effective-ontology tests ({163.17}/PC-4):
# `system_baseline accepts the five system types`, `system_baseline rejects
# a business type`, `client_business and unset stay byte-identical` (which
# proved its point by asserting `schema` was REJECTED under both),
# `showcase is provably the business set` (same, by rejection), and
# `internal_dev fails loud at gate entry`. Every one of them asserted the
# class-scoped taxonomy as behaviour, so none can be restated once the
# taxonomy is deleted — they are replaced, not repaired. What survives is
# their genuine subject: that `write_bundle` writes what a run drafts, and
# does not silently swallow a rejection.
# ─────────────────────────────────────────────────────────────────────────


def test_write_bundle_writes_a_type_no_register_ever_held(tmp_path: Path) -> None:
    """AC 2, stated as the artefact. `procurement_policy` was never a
    member of `ALLOWED_CONCEPT_TYPES`, of any `_CLASS_CONCEPT_TYPES` entry,
    of the Source-side `CONCEPT_TYPES`, or of the TS legend — and no
    register was edited to make this pass. It lands on disk, it is reported
    in the run summary, and it reaches `log.md`."""
    draft = _draft("topics/alpha.md", title="Alpha", type="procurement_policy")

    summary = bundle_writer.write_bundle(tmp_path, [draft])

    assert summary.added == ("topics/alpha.md",)
    assert summary.validator_failures == ()
    written = (tmp_path / "topics/alpha.md").read_text(encoding="utf-8")
    assert "type: procurement_policy" in written
    assert "topics/alpha.md" in (tmp_path / "log.md").read_text(encoding="utf-8")


def test_write_bundle_system_baseline_writes_a_concept_typed_document(
    tmp_path: Path,
) -> None:
    """PI-7 — the owner's S546 uniformity ruling as behaviour, on the
    class that used to own the narrowest set. `document` belonged to NO
    class's type set; a `system_baseline` run writes it."""
    draft = _draft("topics/alpha.md", title="Alpha", type="document")

    summary = bundle_writer.write_bundle(
        tmp_path, [draft], bundle_class="system_baseline"
    )

    assert summary.added == ("topics/alpha.md",)
    assert summary.validator_failures == ()
    assert (tmp_path / "topics/alpha.md").exists()


@pytest.mark.parametrize(
    "bundle_class", [None, "client_business", "showcase", "system_baseline"]
)
def test_every_bundle_class_gates_a_type_identically(
    tmp_path: Path, bundle_class
) -> None:
    """The four replaced tests' shared claim, inverted into one. `schema`
    was previously written under `system_baseline` and REJECTED under
    `client_business`/`showcase`/unset; `topic` was the mirror image. Both
    are now written under every class — there is one gate, not four."""
    for concept_type in ("schema", "topic"):
        run_dir = tmp_path / f"{bundle_class}-{concept_type}"
        run_dir.mkdir()
        summary = bundle_writer.write_bundle(
            run_dir,
            [_draft("topics/alpha.md", title="Alpha", type=concept_type)],
            bundle_class=bundle_class,
        )
        assert summary.added == ("topics/alpha.md",), (bundle_class, concept_type)
        assert summary.validator_failures == ()


def test_write_bundle_internal_dev_reaches_the_write_loop(tmp_path: Path) -> None:
    """REPLACES `test_write_bundle_internal_dev_fails_loud_at_gate_entry_
    with_value_error` (bl-478). That fail-loud's stated requirement was
    that `internal_dev` had "no ratified BI-4 type set YET" — it guarded a
    register, and it deletes with it. An `internal_dev` run is now an
    ordinary run: it reaches the write loop, writes its concept, and emits
    its bundle artefacts."""
    draft = _draft("topics/alpha.md", title="Alpha", type="topic")

    summary = bundle_writer.write_bundle(tmp_path, [draft], bundle_class="internal_dev")

    assert summary.added == ("topics/alpha.md",)
    assert summary.validator_failures == ()
    assert (tmp_path / "topics/alpha.md").exists()
    assert (tmp_path / "log.md").exists()
    assert (tmp_path / "ontology.json").exists()


def test_write_bundle_still_soft_rejects_a_malformed_type(tmp_path: Path) -> None:
    """The control the replaced rejection tests were really buying: the
    BI-13 gate still refuses, still reports the refusal in `validator_
    failures`, and still writes nothing for the refused concept. Only the
    REASON changed — malformed shape, not non-membership."""
    draft = _draft("topics/alpha.md", title="Alpha", type="Not A Type!")

    summary = bundle_writer.write_bundle(tmp_path, [draft])

    assert summary.added == ()
    assert len(summary.validator_failures) == 1
    rel_path, errors = summary.validator_failures[0]
    assert rel_path == "topics/alpha.md"
    assert any("snake_case" in error for error in errors)
    assert not (tmp_path / "topics/alpha.md").exists()


def test_write_bundle_still_refuses_q_a_pair_as_a_type(tmp_path: Path) -> None:
    """BI-3 at the write gate, unconditional and unaffected by {427.5}."""
    draft = _draft("topics/alpha.md", title="Alpha", type="q_a_pair")

    summary = bundle_writer.write_bundle(tmp_path, [draft])

    assert summary.added == ()
    assert len(summary.validator_failures) == 1
    _, errors = summary.validator_failures[0]
    assert any("BI-3" in error for error in errors)


# ── ID-132 {132.36} G-CONCEPT-FEEDER — `concept-feeder.json` reader +
# class-gate ─────────────────────────────────────────────────────────────


def test_concept_feeder_filename_is_reserved() -> None:
    assert "concept-feeder.json" in bundle_writer._RESERVED_BUNDLE_FILENAMES


def test_read_concept_feeder_config_absent_returns_none(tmp_path: Path) -> None:
    """Absence is NOT an error (OV-4/OV-11 posture mirrored for the
    feeder) — a bundle with no `concept-feeder.json` enumerates only the
    base 5 types."""
    assert bundle_writer.read_concept_feeder_config(tmp_path) is None


def test_read_concept_feeder_config_parses_a_well_formed_file(tmp_path: Path) -> None:
    (tmp_path / "concept-feeder.json").write_text(
        json.dumps(
            {
                "concept_types": {
                    "partner": {"grain": "entity_mention", "entity_type": "partner"},
                }
            }
        ),
        encoding="utf-8",
    )

    config = bundle_writer.read_concept_feeder_config(tmp_path)

    assert config == {
        "partner": {"grain": "entity_mention", "entity_type": "partner"},
    }


def test_read_concept_feeder_config_missing_concept_types_key_is_empty(
    tmp_path: Path,
) -> None:
    (tmp_path / "concept-feeder.json").write_text(json.dumps({}), encoding="utf-8")

    config = bundle_writer.read_concept_feeder_config(tmp_path)

    assert config == {}


def test_concept_feeder_config_that_is_not_valid_json_fails_loud(tmp_path: Path) -> None:
    (tmp_path / "concept-feeder.json").write_text("{not valid json", encoding="utf-8")

    with pytest.raises(bundle_writer.ConceptFeederConfigError):
        bundle_writer.read_concept_feeder_config(tmp_path)


def test_concept_feeder_config_non_object_top_level_fails_loud(tmp_path: Path) -> None:
    (tmp_path / "concept-feeder.json").write_text(json.dumps(["not", "an", "object"]), encoding="utf-8")

    with pytest.raises(bundle_writer.ConceptFeederConfigError):
        bundle_writer.read_concept_feeder_config(tmp_path)


def test_concept_feeder_config_unknown_top_level_key_fails_loud(tmp_path: Path) -> None:
    (tmp_path / "concept-feeder.json").write_text(
        json.dumps({"concept_type": {}}), encoding="utf-8"  # singular typo
    )

    with pytest.raises(bundle_writer.ConceptFeederConfigError):
        bundle_writer.read_concept_feeder_config(tmp_path)


def test_concept_feeder_config_declaring_a_base_ratified_type_fails_loud(
    tmp_path: Path,
) -> None:
    """BI-4: a feeder entry may only name a NEW, overlay-added type — one of
    the base 5 (already routed by the base `_list_*_concepts` methods)
    would be an ambiguous shadow."""
    (tmp_path / "concept-feeder.json").write_text(
        json.dumps(
            {
                "concept_types": {
                    "product": {"grain": "entity_mention", "entity_type": "product"},
                }
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(bundle_writer.ConceptFeederConfigError):
        bundle_writer.read_concept_feeder_config(tmp_path)


def test_concept_feeder_config_declaring_q_a_pair_fails_loud(tmp_path: Path) -> None:
    """BI-3: a q_a_pair is never a concept — unconditional, even via the
    feeder config."""
    (tmp_path / "concept-feeder.json").write_text(
        json.dumps(
            {
                "concept_types": {
                    "q_a_pair": {"grain": "entity_mention", "entity_type": "x"},
                }
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(bundle_writer.ConceptFeederConfigError):
        bundle_writer.read_concept_feeder_config(tmp_path)


def test_concept_feeder_config_unrecognised_grain_fails_loud(tmp_path: Path) -> None:
    """v1 supports exactly ONE grain (`entity_mention`) — a client-declared
    grain outside that closed set is a config error, never a silent skip."""
    (tmp_path / "concept-feeder.json").write_text(
        json.dumps(
            {
                "concept_types": {
                    "partner": {"grain": "raw_sql", "entity_type": "partner"},
                }
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(bundle_writer.ConceptFeederConfigError):
        bundle_writer.read_concept_feeder_config(tmp_path)


def test_concept_feeder_config_unknown_grain_config_key_fails_loud(tmp_path: Path) -> None:
    (tmp_path / "concept-feeder.json").write_text(
        json.dumps(
            {
                "concept_types": {
                    "partner": {
                        "grain": "entity_mention",
                        "entity_type": "partner",
                        "extra": "surprise",
                    },
                }
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(bundle_writer.ConceptFeederConfigError):
        bundle_writer.read_concept_feeder_config(tmp_path)


def test_concept_feeder_config_empty_entity_type_fails_loud(tmp_path: Path) -> None:
    (tmp_path / "concept-feeder.json").write_text(
        json.dumps(
            {"concept_types": {"partner": {"grain": "entity_mention", "entity_type": ""}}}
        ),
        encoding="utf-8",
    )

    with pytest.raises(bundle_writer.ConceptFeederConfigError):
        bundle_writer.read_concept_feeder_config(tmp_path)


def test_concept_feeder_config_malformed_type_label_fails_loud_at_read(
    tmp_path: Path,
) -> None:
    """ID-427 {427.5}, net-new. Before this subtask the {132.36} contextvar
    widened `ConceptKey`'s gate to accept whatever the feeder declared, so
    a malformed name reached enumeration and was soft-rejected at BI-13.
    `ConceptKey` now applies the shape rule, so an unchecked malformed name
    would abort the run mid-`list_concepts`. It is caught at READ instead —
    this module's own stated fail-loud-at-read posture."""
    (tmp_path / "concept-feeder.json").write_text(
        json.dumps(
            {
                "concept_types": {
                    "Partner Co": {"grain": "entity_mention", "entity_type": "partner"},
                }
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(bundle_writer.ConceptFeederConfigError, match="well-formed"):
        bundle_writer.read_concept_feeder_config(tmp_path)


def test_concept_feeder_config_accepts_a_novel_well_formed_label(tmp_path: Path) -> None:
    """The other half: a feeder may declare a label no register ever held,
    with no `ontology-overlay.json` permitting it (DR-141)."""
    (tmp_path / "concept-feeder.json").write_text(
        json.dumps(
            {
                "concept_types": {
                    "framework": {"grain": "entity_mention", "entity_type": "framework"},
                }
            }
        ),
        encoding="utf-8",
    )

    config = bundle_writer.read_concept_feeder_config(tmp_path)

    assert config == {
        "framework": {"grain": "entity_mention", "entity_type": "framework"}
    }


def test_require_client_business_bundle_class_accepts_client_business() -> None:
    # Does not raise.
    bundle_writer.require_client_business_bundle_class(
        "client_business", filename="concept-feeder.json"
    )


def test_require_client_business_bundle_class_rejects_every_other_class_and_none() -> None:
    for non_client_class in (None, "system_baseline", "showcase", "internal_dev"):
        with pytest.raises(bundle_writer.OntologyOverlayClassError):
            bundle_writer.require_client_business_bundle_class(
                non_client_class, filename="concept-feeder.json"
            )

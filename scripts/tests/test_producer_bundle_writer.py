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

import asyncio
import dataclasses
import hashlib
import json
import re
import sys
from pathlib import Path, PurePosixPath
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
from scripts.cocoindex_pipeline.sources import l_records, repo_docs  # noqa: E402
from scripts.cocoindex_pipeline.sources.base import (  # noqa: E402
    ConceptKey,
    ConceptKeyLike,
    ConceptRaw,
    CorpusCensus,
    Coverage,
    GrainEnumeration,
    GrainSpec,
    mint_concept_slug,
)
from scripts.cocoindex_pipeline.sources.repo_docs import (  # noqa: E402
    RepoConceptKey,
    RepoConceptRaw,
)


def _run(coro):
    """ID-427 {427.7}: the grain-registry tests below drive the real
    `LRecordsSource` (over a pool double) as far as the emitted bundle, so
    this file now needs an async runner — mirrors
    `test_l_records_source.py`'s own `_run`."""
    return asyncio.run(coro)

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
    key = ConceptKey(
        rel_path=rel_path,
        concept_type="topic",
        grain="topic_scope_tag",
        scope_tag=rel_path,
    )
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
        key=ConceptKey(
            rel_path="topics/bad.md",
            concept_type="topic",
            grain="topic_scope_tag",
            scope_tag="bad",
        ),
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
    # FIXTURE UPDATED by {427.6}/DR-141 — was `type="topic", tags=("reference",)`.
    # This test's own claim (a ReferenceConceptDraft is routed by `rel_path`,
    # never by `key`) is untouched; only the fixture's fidelity to what
    # `web_pass.py` now emits changed. The two are independent — `rel_path`
    # was never derived from `type` — which is exactly why the assertions
    # below still read the same.
    ref_fm = _fm(
        type="reference",
        tags=(),
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


def test_declare_concept_writes_free_form_facet_tags_unrewritten(
    tmp_path: Path,
) -> None:
    """ID-427 {427.6} / DR-141 — facet tags survive with no registry behind
    them. `metric` and `dataset` were `RECOGNISED_FACET_TAGS` members; a
    `methodology` tag was ALIASED onto `playbook` by `normalise_facet_tags`.
    All four names now ride `tags:` as ordinary open BI-12 entries and land
    on disk verbatim — nothing folds `methodology`, and nothing rejects a
    tag for being unregistered.

    NET-NEW, and deliberately at the WRITE boundary rather than the gate:
    the deleted alias-fold was a write-path normalisation
    (`normalise_facet_tags`' own docstring called itself "the shared
    normalisation downstream writers call"), so proving it is gone means
    reading the emitted file, not a validator return value.
    """
    draft = ConceptDraft(
        key=ConceptKey(
            rel_path="topics/facets.md",
            concept_type="topic",
            grain="topic_scope_tag",
            scope_tag="facets",
        ),
        frontmatter=_fm(
            type="topic", tags=("metric", "dataset", "methodology", "playbook")
        ),
        body="A distilled synthesis about facets.\n\n"
        + render_source_footnotes(sources_from_citations([_SD_URI])),
        primary_anchor=_SD_URI,
    )

    result = bundle_writer.declare_concept(tmp_path, draft)

    assert result.written is True
    assert result.errors == ()
    written = (tmp_path / "topics/facets.md").read_text(encoding="utf-8")
    # Verbatim and in order — `methodology` is NOT collapsed onto `playbook`.
    assert "tags:\n  - metric\n  - dataset\n  - methodology\n  - playbook\n" in written


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
    key = ConceptKey(
        rel_path="topics/alpha.md",
        concept_type="topic",
        grain="topic_scope_tag",
        scope_tag="alpha",
    )
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
        key=ConceptKey(
            rel_path="topics/bad.md",
            concept_type="topic",
            grain="topic_scope_tag",
            scope_tag="bad",
        ),
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
# identically in sources/l_records.py.
#
# **ID-427 {427.8}: resolved at the source, not here.** {132.29} left both
# grains minting ONE identity `rel_path` and had this module redirect the
# won-bid file into a `won-bid/` sibling at write time. The won-bid grain now
# DECLARES `case-studies/won-bid`, so the two grains mint two identities and
# `bundle_writer` writes each concept to the path it is called by. The files
# land exactly where they always did; the fixtures below mint the won-bid
# identity from the grain registry so a future change to that registry entry
# moves the test with the code rather than leaving a stale literal behind.
# ─────────────────────────────────────────────────────────────────────────


def _won_bid_rel_path(basename: str) -> str:
    """The won-bid grain's own declared directory, read off the registry —
    never a literal. This is the {427.8} property under test: there is one
    place that decides where a won-bid concept lives."""
    spec = next(
        s for s in l_records._BUILTIN_GRAINS if s.name == l_records.WON_BID_GRAIN
    )
    return f"{spec.directory}/{basename}"


def _case_study_draft(
    rel_path: str,
    *,
    title: str,
    entity_id: "str | None" = None,
    form_instance_id: "str | None" = None,
) -> ConceptDraft:
    key = ConceptKey(
        rel_path=rel_path,
        concept_type="case_study",
        grain=(
            "case_study_won_bid" if form_instance_id is not None
            else "case_study_named_client"
        ),
        entity_id=entity_id,
        form_instance_id=form_instance_id,
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
    """THE {132.29} claim, carried unchanged across {427.8}: a named-client
    and a won-bid case study for the SAME buyer both write, and neither
    overwrites the other.

    The claim is the same; the mechanism it rests on is not. The buyer slugs
    identically in both grains, so before {427.8} the two drafts shared one
    identity `rel_path` and were separated only by a write-time redirect in
    this module. They now arrive already distinct, because the won-bid grain
    declares its own directory. Kept — and kept at `write_bundle`, not at a
    path helper — because "both files exist with the right bodies" is the
    property the client actually has, and it must survive whichever
    mechanism delivers it. The **shipped showcase bundle collides on exactly
    this shape** (`case-studies/northgate-borough-council.md` and
    `case-studies/won-bid/northgate-borough-council.md` are both committed),
    so this is a real layout, not a constructed one."""
    named_client = _case_study_draft(
        "case-studies/acme-ltd.md", title="Acme Ltd (named client)", entity_id="Acme Ltd"
    )
    won_bid = _case_study_draft(
        _won_bid_rel_path("acme-ltd.md"),
        title="Acme Ltd (won-bid outcome)",
        entity_id="Acme Ltd",
        form_instance_id=_SAMPLE_UUID,
    )
    # The two identities differ, and they differ by DIRECTORY — the same
    # buyer slug in both. This is what the redirect used to manufacture at
    # write time and what the grain registry now supplies at mint time.
    assert named_client.key.rel_path != won_bid.key.rel_path
    assert (
        PurePosixPath(named_client.key.rel_path).name
        == PurePosixPath(won_bid.key.rel_path).name
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

    # UNCHANGED PHYSICAL PATHS (TECH §2.5): the two strings below are the
    # ones the {132.29} redirect produced, byte for byte. No file moves and
    # `RunSummary.moved` stays empty — the concept's identity changed, not
    # its location.
    assert set(summary.added) == {"case-studies/acme-ltd.md", "case-studies/won-bid/acme-ltd.md"}
    assert summary.moved == ()

    index_text = (tmp_path / "index.md").read_text(encoding="utf-8")
    assert "case-studies/acme-ltd.md" in index_text
    assert "case-studies/won-bid/acme-ltd.md" in index_text


def test_the_shipped_showcase_case_study_layout_is_what_the_grains_declare(
    tmp_path: Path,
) -> None:
    """**Unchanged physical path, asserted against the shipped showcase
    layout** (the ratified {427.8} test bullet).

    `canonical-okf-showcase` is a separate repo and is deliberately NOT read
    from here — a test that depends on a checkout outside this one is a test
    that fails for the wrong reason. Its layout is transcribed instead: the
    bundle ships `case-studies/<four named clients>.md` alongside
    `case-studies/won-bid/northgate-borough-council.md`, and Northgate is
    present in BOTH. Re-emitting that same buyer set through `write_bundle`
    must reproduce those paths exactly."""
    shipped = {
        "case-studies/corvedale-academies-trust.md",
        "case-studies/northgate-borough-council.md",
        "case-studies/ridgeway-commercial-services-ltd.md",
        "case-studies/st-aldhelm-s-nhs-foundation-trust.md",
        "case-studies/wyndale-metropolitan-borough-council.md",
        "case-studies/won-bid/northgate-borough-council.md",
    }
    named_clients = [
        _case_study_draft(p, title=p, entity_id=p)
        for p in sorted(shipped)
        if not p.startswith("case-studies/won-bid/")
    ]
    won_bid = _case_study_draft(
        _won_bid_rel_path("northgate-borough-council.md"),
        title="Northgate Borough Council (won bid)",
        entity_id="Northgate Borough Council",
        form_instance_id=_SAMPLE_UUID,
    )

    summary = bundle_writer.write_bundle(tmp_path, [*named_clients, won_bid])

    assert set(summary.added) == shipped
    for rel in shipped:
        assert (tmp_path / rel).is_file(), rel


def test_a_bi9_cross_link_to_a_won_bid_concept_opens(tmp_path: Path) -> None:
    """**ID-427 {427.8}, net-new — the ratified test bullet.** A BI-9
    cross-link to a won-bid concept must resolve to a path the reader can
    open.

    `producer/enrich.py` builds the BI-9 catalogue from
    `ConceptKey.rel_path` (`:970`), so a citation names an identity; this
    module writes to a bundle path. While the two could differ the citation
    named a file that, for a non-colliding buyer, did not exist — and for a
    colliding one resolved to the OTHER grain's concept. The two are one
    string now, so the claim is checkable end-to-end: take the path the
    catalogue would offer and open it under the emitted bundle.

    (`test_producer_enrich.py::...test_a_won_bid_concept_is_bi9_citable_and_
    routes_to_its_own_grain` owns the catalogue/router half. This half owns
    the file.)"""
    named_client = _case_study_draft(
        "case-studies/acme-ltd.md", title="Acme Ltd", entity_id="Acme Ltd"
    )
    won_bid = _case_study_draft(
        _won_bid_rel_path("acme-ltd.md"),
        title="Acme Ltd won bid",
        entity_id="Acme Ltd",
        form_instance_id=_SAMPLE_UUID,
    )

    bundle_writer.write_bundle(tmp_path, [named_client, won_bid])

    # The catalogue enrich.py would offer for these two concepts.
    catalogue_paths = {d.key.rel_path for d in (named_client, won_bid)}
    assert len(catalogue_paths) == 2
    for cited in sorted(catalogue_paths):
        assert (tmp_path / cited).is_file(), cited

    # …and each opens the RIGHT concept, not its same-slug sibling.
    assert "won bid" in (tmp_path / won_bid.key.rel_path).read_text(encoding="utf-8")
    assert "won bid" not in (
        tmp_path / named_client.key.rel_path
    ).read_text(encoding="utf-8")


def test_content_version_does_not_reach_the_bundle_write_path(
    tmp_path: Path,
) -> None:
    """MD-4 (ID-132 {132.38} G-MEMO-DELTA): `content_version` participates
    ONLY in the cocoindex memo fingerprint — never in identity, routing,
    dedup, the write path, or `find()`.

    **MOVED HERE by ID-427 {427.8}** from
    `test_producer_enrich.py::TestContentVersionNonLeak::test_bundle_write_
    path_for_key_is_identical`, whose subject function this Subtask deleted.
    Its two sibling legs (read dispatch, `find` membership) stay in that
    class, which names this one and where it went. `declare_concept` is the
    boundary that now decides a concept's file, so it is where the leg has
    to be if it is to fail when a leak is introduced."""
    base = dict(
        concept_type="topic", grain="topic_scope_tag", scope_tag="gdpr"
    )
    drafts = [
        dataclasses.replace(
            _draft("topics/gdpr.md", title="GDPR"),
            key=ConceptKey(rel_path="topics/gdpr.md", **base, content_version=v),
        )
        for v in ("v-a", "v-b")
    ]

    results = [bundle_writer.declare_concept(tmp_path, d) for d in drafts]

    assert [r.rel_path for r in results] == ["topics/gdpr.md", "topics/gdpr.md"]
    assert all(r.written for r in results)


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
    """root concept + `topics/` + `case-studies/` + the won-bid grain's own
    `case-studies/won-bid/` + `case-studies/won-bid/2025/` + a `reports/`
    that holds ONLY a child directory."""
    return [
        _draft("overview.md", title="Overview", description="The bundle root concept."),
        _draft("topics/alpha.md", title="Alpha", description="Alpha topic."),
        _draft("topics/beta.md", title="Beta", description="Beta topic."),
        _case_study_draft(
            "case-studies/acme-ltd.md", title="Acme Ltd", entity_id="Acme Ltd"
        ),
        # ID-427 {427.8}: this draft's identity is `case-studies/won-bid/
        # acme-ltd.md`, minted from the grain's declared directory. It was
        # `case-studies/acme-ltd.md` plus a write-time redirect to the same
        # place — the emitted tree below is unchanged either way, which is
        # the point.
        _case_study_draft(
            _won_bid_rel_path("acme-ltd.md"),
            title="Acme Ltd won bid",
            entity_id="Acme Ltd",
            form_instance_id=_SAMPLE_UUID,
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


def test_a_won_bid_concept_indexes_in_its_own_grain_directory(
    tmp_path: Path,
) -> None:
    """§2 row 2. RENAMED from `test_a_redirected_won_bid_concept_indexes_
    where_its_file_actually_is` — the old name asserted the redirect ID-427
    {427.8} deleted, and its rationale ("group by identity instead and the
    index links a path that does not exist") described a hazard that can no
    longer exist, since identity IS the path.

    The claim that survives, and is the reason this is kept rather than
    folded into the membership test above: two concepts with the SAME
    basename, from two grains, must index in two different directories and
    every emitted link must resolve to a real file. That was the visible
    symptom of the {132.29} collision and is what a future regression would
    break first."""
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
# DR-027 as amended (S546) — the overlay-carrier ontology artefact
# ─────────────────────────────────────────────────────────────────────────


def test_write_ontology_artefact_has_no_base_key_and_ships_overlay_null(
    tmp_path: Path,
) -> None:
    """REPLACES `test_write_ontology_artefact_base_only_when_no_overlay`,
    whose entire subject — the shape of the pinned `base` snapshot — is
    what DR-027's S546 amendment retired. Its three `payload["base"]`
    assertions are INVERTED here into a single absence assertion, not
    dropped: `base` is the key whose removal is this Subtask.

    `overlay: null` SURVIVES the amendment (DR-054, re-affirmed S546 — the
    overlay carrier is `ontology.json`'s surviving purpose), so a bundle
    with no overlay still ships a present-and-null key rather than an
    empty object."""
    content = bundle_writer.write_ontology_artefact(tmp_path)
    payload = json.loads(content)

    assert "base" not in payload
    assert payload == {"overlay": None}
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
        "entity_types": ["widget"],
        "relationship_types": [],
    }
    content = bundle_writer.write_ontology_artefact(tmp_path, client_overlay=overlay)
    payload = json.loads(content)

    # The overlay is echoed VERBATIM — this writer is a pure echo and does
    # not know the schema. The `concept_types: []` entry this fixture
    # carried retired at S550 with the dimension itself; `read_client_
    # overlay` can no longer produce one.
    assert payload["overlay"] == overlay
    # The two `payload["base"][...]` assertions that stood here are
    # INVERTED, not dropped: {427.11} retires the key they read.
    assert "base" not in payload
    assert set(payload) == {"overlay"}


def test_base_ontology_snapshot_is_absent_from_the_module() -> None:
    """DR-027 as amended (S546), executed by ID-427 {427.11}: the pinned
    bundle-shipped base snapshot is GONE from the writer, not merely
    unreferenced by the payload. Asserted on the module surface because a
    helper left behind is a helper the next wave re-wires — the register
    itself stays in `validator.py`, where DR-027's UNCHANGED platform-repo
    half keeps it (still the BI-13 gate, still composed by
    `EffectiveOntology`)."""
    assert not hasattr(bundle_writer, "_base_ontology_snapshot")
    # DR-027's platform half is untouched — the registers are still live,
    # they are just no longer asserted to bundle consumers.
    assert EffectiveOntology.base_only().entity_types == ALLOWED_ENTITY_TYPES
    assert (
        EffectiveOntology.base_only().relationship_types == ALLOWED_RELATIONSHIP_TYPES
    )


def test_the_overlay_schema_admits_exactly_the_two_widening_dimensions() -> None:
    """INVERTS the {427.11} guard that pinned all THREE keys with
    `concept_types` included. That guard's stated reason was
    backwards-compatibility for an already-valid client file; the owner
    rejected it at S550 (nothing is live, so nothing is compatible with
    the old shape) and the requirement reason is the load-bearing one:
    DR-054 admits a dimension so an overlay can WIDEN legality, and DR-141
    withdrew the concept-type legality gate, leaving nothing to widen.

    Pinned as an EXACT tuple, both halves, so 'tidying' in either
    direction fails loudly — re-adding the retired key, or quietly
    dropping one of the two dimensions that still compose."""
    assert bundle_writer._OVERLAY_DIMENSIONS == (
        "entity_types",
        "relationship_types",
    )
    assert "concept_types" not in bundle_writer._OVERLAY_DIMENSIONS


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


def test_write_context_artefact_asserts_no_base_vocabulary(tmp_path: Path) -> None:
    """**TQ-1's acceptance, asserted on the ARTEFACT.** REPLACES
    `test_write_context_artefact_base_only_when_no_client_id`, whose whole
    subject — the base projection — is what ID-427 {427.14} retires under
    DR-027 as amended (S546 extension, S548 amendment). Its two
    `mint_iri(..., scope=None)` loops are INVERTED here into absence
    assertions rather than dropped: the base terms are what this Subtask
    removes, so their absence is the claim.

    The emitted `@context` asserts NO base entity term, NO base
    relationship term, and no `base` namespace prefix — DR-027 as amended
    says the platform CVs *"are simply no longer asserted to bundle
    consumers"*, and 22 base IRIs written into a client's repo is that
    assertion.

    The `base` register itself is UNTOUCHED (DR-027's platform-repo half):
    asserted below so a future reader cannot mistake this for a retirement
    of the vocabulary rather than of its projection."""
    eo = EffectiveOntology.base_only()
    content = bundle_writer.write_context_artefact(tmp_path, eo)
    payload = json.loads(content)

    assert set(payload) == {"@context"}
    context = payload["@context"]
    assert "client" not in context
    assert "base" not in context
    for term in ALLOWED_ENTITY_TYPES:
        assert term not in context
    for term in ALLOWED_RELATIONSHIP_TYPES:
        assert term not in context
    # A base-only run therefore declares nothing at all.
    assert context == {}

    # The registers survive — this Subtask retires an ASSERTION, not a
    # vocabulary (DR-027's platform-repo half, explicitly unchanged).
    assert EffectiveOntology.base_only().entity_types == ALLOWED_ENTITY_TYPES
    assert (
        EffectiveOntology.base_only().relationship_types == ALLOWED_RELATIONSHIP_TYPES
    )

    on_disk = json.loads((tmp_path / "context.jsonld").read_text(encoding="utf-8"))
    assert on_disk == payload


def test_write_context_artefact_still_writes_the_file_with_no_overlay(
    tmp_path: Path,
) -> None:
    """**TQ-1a is UNRESOLVED — this test pins a DEFAULT, not a ruling.**

    TQ-1a, carried verbatim in `tasks/id-427.md`, asks which of two
    observably-different readings of *"overlay-driven emission only"* is
    meant: (a) the artefact is not WRITTEN AT ALL on a run composing no
    overlay, or (b) it is still always written and its `@context` carries
    only overlay-derived terms. {427.14} could not name a requirement whose
    current source discriminates them — both satisfy *"declare the client's
    overlay vocabulary"* vacuously when there is no overlay — so it took
    (b) as the reversible default and left the question open.

    Why (b) and not (a): a file that stops being `declare_file`d is a file
    cocoindex's reconciliation DELETES from every existing bundle, whereas
    an empty `@context` asserts nothing and withdraws later in one line.

    **If TQ-1a is ever ruled (a), this test inverts to
    `assert not (tmp_path / "context.jsonld").exists()`.** Do not read its
    green as the answer."""
    bundle_writer.write_context_artefact(tmp_path, EffectiveOntology.base_only())

    assert (tmp_path / "context.jsonld").is_file()
    payload = json.loads((tmp_path / "context.jsonld").read_text(encoding="utf-8"))
    assert payload == {"@context": {}}


def test_write_context_artefact_keeps_overlay_terms_when_a_client_declares_them(
    tmp_path: Path,
) -> None:
    """The retirement is of the BASE half only. A client bundle whose
    `ontology-overlay.json` extends a dimension still gets those terms in
    `@context`, minted under its own client namespace — that is the whole
    of what "overlay-driven emission" leaves behind."""
    eo = EffectiveOntology.compose(
        {"entity_types": ["widget"], "relationship_types": ["ships_with"]}
    )
    content = bundle_writer.write_context_artefact(tmp_path, eo, client_id="acme")
    context = json.loads(content)["@context"]

    assert context["widget"] == iri_projection.mint_iri("widget", scope="acme")
    assert context["ships_with"] == iri_projection.mint_iri(
        "ships_with", scope="acme"
    )
    assert context["client"] == f"{iri_projection._client_namespace('acme')}#"
    # ...and the base half is still absent, alongside them.
    for term in ALLOWED_ENTITY_TYPES:
        assert term not in context


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


def test_write_bundle_ships_a_context_jsonld_that_declares_no_vocabulary(
    tmp_path: Path,
) -> None:
    """IRI-4/9: a full `write_bundle` run (no `client_id` kwarg) still ships
    `context.jsonld` alongside every other bundle artefact — and it declares
    nothing, because there is no client overlay to declare.

    The pre-{427.14} form of this test asserted `payload["@context"]
    ["organisation"] == mint_iri("organisation", scope=None)`. That
    assertion is inverted, not deleted: `organisation` is exactly the kind
    of base term DR-027 as amended stopped asserting to bundle
    consumers."""
    draft = _draft("topics/alpha.md", title="Alpha")

    bundle_writer.write_bundle(tmp_path, [draft])

    assert (tmp_path / "context.jsonld").is_file()
    context = json.loads(
        (tmp_path / "context.jsonld").read_text(encoding="utf-8")
    )["@context"]
    assert "client" not in context
    assert "base" not in context
    assert "topic" not in context
    assert "organisation" not in context
    assert context == {}


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
    """OV-2: the two permitted dimension keys parse; an omitted key
    defaults to an empty list."""
    (tmp_path / "ontology-overlay.json").write_text(
        json.dumps({"entity_types": ["widget"], "relationship_types": ["partners_with"]}),
        encoding="utf-8",
    )
    overlay = bundle_writer.read_client_overlay(tmp_path)

    assert overlay["entity_types"] == ["widget"]
    assert overlay["relationship_types"] == ["partners_with"]
    # S550: the retired dimension is not defaulted-in either — a reader
    # must not find an empty `concept_types` list to mistake for a
    # declaration the client never made.
    assert "concept_types" not in overlay


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
    assert overlay["entity_types"] == []
    assert overlay["relationship_types"] == []
    assert overlay["source"] == "ontology-overlay.json"
    # S550: the composed shape is provenance + the two surviving
    # dimensions, and nothing else.
    assert set(overlay) == {"source", "sha256", "entity_types", "relationship_types"}


def test_write_bundle_writes_a_client_type_with_or_without_an_overlay(
    tmp_path: Path,
) -> None:
    """REPLACES `test_write_bundle_accepts_overlay_added_concept_type_
    only_with_overlay`, whose whole subject was that a client\'s own
    concept type needed PERMISSION from an `ontology-overlay.json` — the
    "only_with_overlay" in its name is the inversion DR-141 withdrew.

    Asserted the other way round now, at the same `write_bundle` surface:
    the SAME concept type is written with no overlay AND with one.

    S550 re-vehicled the second half onto an `entity_types` overlay. The
    fixture used to declare `concept_types: ["widget_type"]`, which made
    the claim weaker than it looked — it read as "the overlay granted the
    permission after all". A client bundle can no longer declare a concept
    type AT ALL, so `widget_type` is written beside an overlay that has no
    way of mentioning it. That is the DR-141 posture stated exactly."""
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
        json.dumps({"entity_types": ["widget"]}), encoding="utf-8"
    )
    overlay_summary = bundle_writer.write_bundle(
        overlay_dir, [draft], bundle_class="client_business"
    )
    assert overlay_summary.added == ("topics/widget.md",)
    assert overlay_summary.validator_failures == ()
    assert (overlay_dir / "topics/widget.md").exists()


def test_an_overlay_declaring_the_retired_concept_types_dimension_is_refused(
    tmp_path: Path,
) -> None:
    """INVERTS `test_client_concept_types_overlay_echoes_into_the_artefact_
    and_gates_nothing`, whose subject was that this key still validated and
    still echoed. S550 retires the dimension, so a declaring overlay is now
    a fail-loud OV-5 abort, and NOTHING is published on the run.

    The MESSAGE is asserted, not just the exception type. The generic
    unknown-key text would be the wrong diagnosis: `concept_types` is
    neither a typo nor an invention, it is a dimension that was documented
    and then retired, and OVERLAY-CV.md §OV-2 — the ratified carrier a
    client is handed — still lists it. The failure has to say which of
    those it is, or an author who followed the spec has nowhere to go."""
    declared = _draft("topics/declared.md", title="Declared", type="declared_type")
    (tmp_path / "ontology-overlay.json").write_text(
        json.dumps({"concept_types": ["declared_type"]}), encoding="utf-8"
    )

    with pytest.raises(bundle_writer.OntologyOverlayError) as excinfo:
        bundle_writer.write_bundle(
            tmp_path, [declared], bundle_class="client_business"
        )

    message = str(excinfo.value)
    assert "concept_types" in message
    # Names the retirement and its ratified ground, so the author learns
    # WHY rather than being told their key is unrecognised.
    assert "RETIRED" in message
    assert "DR-141" in message
    # Points at what still works, so "remove the key" is actionable
    # without a second trip to the spec.
    assert "entity_types" in message and "relationship_types" in message
    # Never the generic diagnosis — this assertion is what fails if the
    # named branch is later 'tidied' into the unknown-key path.
    assert "unknown top-level key" not in message

    # OV-5 fail-loud is all-or-nothing: the run publishes nothing.
    assert not (tmp_path / "topics/declared.md").exists()
    assert not (tmp_path / "ontology.json").exists()


def test_a_surviving_dimension_overlay_still_composes_and_still_echoes(
    tmp_path: Path,
) -> None:
    """The half of the retired test that SURVIVES, kept so the S550
    retirement cannot quietly take DR-054's carrier with it: an overlay
    declaring the two remaining dimensions still validates, still WIDENS
    the effective ontology (the thing DR-054 admits a dimension for), and
    is still echoed into `ontology.json`.

    The concept-type half is asserted alongside it in its DR-141 form —
    the client's own `type` label is written on the same run by an overlay
    that cannot mention it."""
    concept = _draft("topics/widget.md", title="Widget", type="client_chosen_type")
    (tmp_path / "ontology-overlay.json").write_text(
        json.dumps(
            {"entity_types": ["widget"], "relationship_types": ["partners_with"]}
        ),
        encoding="utf-8",
    )

    summary = bundle_writer.write_bundle(
        tmp_path, [concept], bundle_class="client_business"
    )

    assert summary.validator_failures == ()
    assert summary.added == ("topics/widget.md",)

    payload = json.loads((tmp_path / "ontology.json").read_text(encoding="utf-8"))
    assert payload["overlay"]["entity_types"] == ["widget"]
    assert payload["overlay"]["relationship_types"] == ["partners_with"]
    assert payload["overlay"]["source"] == "ontology-overlay.json"
    assert "concept_types" not in payload["overlay"]
    assert "base" not in payload

    # It WIDENS, which is the requirement DR-054 admits a dimension for —
    # and the reason these two stayed while `concept_types` went.
    composed = EffectiveOntology.compose(payload["overlay"])
    assert "widget" in composed.entity_types
    assert "partners_with" in composed.relationship_types


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


def test_a_declaration_free_stray_overlay_still_trips_the_class_gate(
    tmp_path: Path,
) -> None:
    """The OV-10 class gate is UNCHANGED by {427.11} or by S550 — asserted
    here in the one adjacency where either deletion could plausibly be
    mistaken for reaching it.

    The tempting inference is that an overlay declaring NOTHING is
    harmless in a platform-owned bundle, since it composes nothing and
    widens nothing. It is not. DR-054/DR-079's gate is keyed on the FILE's
    presence in a non-`client_business` class, never on what the file
    happens to declare, and its live requirement — a platform-owned bundle
    must never compose client-owned config — is untouched by either
    retirement. This test fails the moment someone 'tidies' the gate to
    skip empty or inert overlays.

    S550 re-vehicled the fixture from `{"concept_types": [...]}` onto `{}`.
    The old vehicle stopped reaching this gate at all: schema validation
    runs first in `write_bundle`, so a retired-dimension overlay now fails
    as a schema error and this test would have passed for the wrong
    reason. An empty object is the stronger vehicle anyway — it is the
    maximally inert overlay that is still schema-valid."""
    (tmp_path / "ontology-overlay.json").write_text(json.dumps({}), encoding="utf-8")
    draft = _draft("topics/alpha.md", title="Alpha")

    for non_client_class in ("system_baseline", "showcase", "internal_dev"):
        with pytest.raises(bundle_writer.OntologyOverlayClassError):
            bundle_writer.write_bundle(tmp_path, [draft], bundle_class=non_client_class)

        assert not (tmp_path / "topics/alpha.md").exists()
        assert not (tmp_path / "ontology.json").exists()


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
        "partner": {
            "grain": "entity_mention",
            "entity_type": "partner",
            # ID-427 {427.7}, TECH §2.7: an omitted `directory` resolves to
            # the declared type name — the same string the pre-{427.7}
            # `{concept_type}/` layout minted, so no feeder concept moves.
            "directory": "partner",
        },
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
        "framework": {
            "grain": "entity_mention",
            "entity_type": "framework",
            # ID-427 {427.7}: `directory` defaults to the declared type name.
            "directory": "framework",
        }
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


# =========================================================================
# ID-427 {427.7} — the grain registry, asserted as the STRUCTURE it buys
#
# These tests are not about the refactor. They are about the one property
# whose absence produced the inversion DR-141 names: **adding a grain is a
# registry entry, and nothing else.** A test that only checked the six
# built-in grains still work would pass just as well against the old
# four-edits-in-four-places shape, and would therefore prove nothing.
# =========================================================================


class _PermissivePool:
    """A pool that answers every query with zero rows. The built-in grains
    therefore enumerate nothing, leaving exactly the grain under test in the
    keyset — these tests are about ONE grain's route, not about a corpus."""

    def __init__(self) -> None:
        self.queries: "list[str]" = []

    async def fetch(self, query: str, *args: object) -> "list[dict]":
        self.queries.append(query)
        return []


def _grain_draft(key: ConceptKeyLike, *, title: str, type_label: str) -> ConceptDraft:
    """Stands in for the Pass-1 agent loop, exactly as `_draft` does for
    every other test in this file: the model call is not the subject here,
    the route from a registry entry to a file on disk is.

    ID-427 {427.16}: takes `ConceptKeyLike`, so the `RepoDocsSource` pillar
    tests below reuse it unchanged with a `RepoConceptKey`. Nothing in the
    write path reads more than `.rel_path` off a draft's key
    (`bundle_writer._rel_path_of`), which is exactly what that protocol
    promises."""
    return ConceptDraft(
        key=key,
        frontmatter=_fm(type=type_label, title=title),
        body=(
            f"A distilled synthesis about {title}.\n\n"
            f"{render_source_footnotes(sources_from_citations([_SD_URI]))}"
        ),
        primary_anchor=_SD_URI,
    )


def _register_grain(monkeypatch: pytest.MonkeyPatch, spec: GrainSpec) -> None:
    """The ONLY production change these tests make. If a future edit means a
    grain also needs a dispatcher arm, a directory literal, or a register
    entry, this helper stops being sufficient and these tests fail — which is
    the regression they exist to catch."""
    monkeypatch.setattr(
        l_records, "_BUILTIN_GRAINS", (*l_records._BUILTIN_GRAINS, spec)
    )


def _fake_grain(**overrides: object) -> GrainSpec:
    """A grain over a corpus this codebase has never had: two 'widgets',
    enumerated from nothing but the grain's own declaration."""
    rows = ("Sprocket", "Flywheel")

    async def _list(src: object, spec: GrainSpec) -> GrainEnumeration:
        return GrainEnumeration(
            keys=tuple(
                ConceptKey(
                    rel_path=f"{spec.directory}/{mint_concept_slug(name)}.md",
                    concept_type=spec.type_label,
                    grain=spec.name,
                    entity_id=name,
                )
                for name in rows
            )
        )

    async def _read(src: object, spec: GrainSpec, key: ConceptKey) -> ConceptRaw:
        return ConceptRaw(
            source_documents=[{"id": _SAMPLE_UUID, "filename": key.entity_id}]
        )

    async def _sample(
        src: object, spec: GrainSpec, key: ConceptKey, n: int
    ) -> "list[dict]":
        return [{"id": _SAMPLE_UUID, "filename": key.entity_id}][:n]

    defaults: "dict[str, object]" = dict(
        name="widget_catalogue",
        directory="widgets",
        type_label="widget",
        list=_list,
        read=_read,
        sample=_sample,
    )
    return GrainSpec(**{**defaults, **overrides})  # type: ignore[arg-type]


class TestAGrainIsOneRegistryEntry:
    """**The assertion this subtask exists to make.**"""

    def test_a_grain_registered_in_a_test_appears_in_the_emitted_bundle(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """One registry entry — no `read_concept` arm, no `sample_rows` arm,
        no `_source_documents_*` arm, no directory literal, no type register
        — and the grain's concepts are enumerated, read, sampled, written to
        the directory the grain declared, reported in the run summary, and
        listed in that directory's own index.

        Before {427.7} this took four edits in `l_records.py` (a fifth in
        `enrich.py` if the grain sampled source_documents) plus, before
        {427.5}, four type-register edits. That cost is *why* the producer
        had no catch-all grain, which is why knowledge keying onto no grain
        was never enumerated at all — the defect id-427 exists to fix."""
        _register_grain(monkeypatch, _fake_grain())
        src = l_records.LRecordsSource(_PermissivePool())

        keys = _run(src.list_concepts())

        # 1. Enumerated.
        assert [k.rel_path for k in keys] == [
            "widgets/sprocket.md",
            "widgets/flywheel.md",
        ]
        assert {k.concept_type for k in keys} == {"widget"}
        assert {k.grain for k in keys} == {"widget_catalogue"}

        # 2. Read and sampled — routed by `grain`, with no dispatcher arm.
        raw = _run(src.read_concept(keys[0]))
        assert [r["filename"] for r in raw.source_documents] == ["Sprocket"]
        assert _run(src.sample_rows(keys[0], 5)) == [
            {"id": _SAMPLE_UUID, "filename": "Sprocket"}
        ]

        # 3. Emitted.
        summary = bundle_writer.write_bundle(
            tmp_path,
            [_grain_draft(k, title=k.entity_id, type_label="widget") for k in keys],
        )

        assert sorted(summary.added) == ["widgets/flywheel.md", "widgets/sprocket.md"]
        written = (tmp_path / "widgets" / "sprocket.md").read_text(encoding="utf-8")
        assert "type: widget" in written
        # 4. And carried into the per-directory index id-429 emits (IA-1:
        #    every concept has a directory, and the grain declared it).
        index = (tmp_path / "widgets" / "index.md").read_text(encoding="utf-8")
        assert "(sprocket.md)" in index
        assert "(flywheel.md)" in index

    def test_relabelling_a_grain_changes_the_emitted_type_and_moves_no_file(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """PI-5, asserted directly and in both halves.

        The label and the location are separate declarations, so changing one
        cannot change the other. Not a stylistic preference: a directory
        derived from the type would make every relabel a file MOVE, churning
        BI-2 concept identity, the cocoindex memo key, every BI-9 cross-link
        and the client's git history."""
        _register_grain(monkeypatch, _fake_grain())
        before = _run(l_records.LRecordsSource(_PermissivePool()).list_concepts())

        monkeypatch.setattr(
            l_records,
            "_BUILTIN_GRAINS",
            tuple(
                dataclasses.replace(spec, type_label="component")
                if spec.name == "widget_catalogue"
                else spec
                for spec in l_records._BUILTIN_GRAINS
            ),
        )
        after = _run(l_records.LRecordsSource(_PermissivePool()).list_concepts())

        # The emitted type changed …
        assert {k.concept_type for k in before} == {"widget"}
        assert {k.concept_type for k in after} == {"component"}
        # … and the identity — physical path, memo key, BI-9 citation target
        # — did not.
        assert [k.rel_path for k in before] == [k.rel_path for k in after]

        summary = bundle_writer.write_bundle(
            tmp_path,
            [_grain_draft(k, title=k.entity_id, type_label="component") for k in after],
        )

        assert summary.moved == ()
        assert sorted(summary.added) == ["widgets/flywheel.md", "widgets/sprocket.md"]
        written = (tmp_path / "widgets" / "sprocket.md").read_text(encoding="utf-8")
        assert "type: component" in written

    def test_relabelling_the_won_bid_grain_does_not_move_its_file(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """PI-5 asserted where it is HARDEST, not where it is easy.
        **RENAMED and RE-STAGED by ID-427 {427.8}** from
        `test_relabelling_the_won_bid_grain_still_redirects_its_write_path`.

        Its subject — `bundle_writer.bundle_write_path_for_key` and the
        {132.29} redirect behind it — is deleted by this Subtask, so the old
        body cannot run. Its CLAIM is kept verbatim and is why the test
        stays: the won-bid grain is the one grain with a counterexample, so
        testing the relabel only against a freshly-invented grain (the test
        directly above) would pass while PI-5 was false here.

        {427.7} made the claim true by re-keying the redirect from
        `concept_type` onto `grain`. {427.8} makes it true by construction
        instead: the path comes from `GrainSpec.directory`, and nothing on
        the write path reads a type at all. Asserted end-to-end through
        `write_bundle` rather than against a path helper, because after this
        Subtask there IS no path helper — and a test that asserts a field
        equals itself would prove nothing."""
        won_bid_dir = next(
            s.directory
            for s in l_records._BUILTIN_GRAINS
            if s.name == l_records.WON_BID_GRAIN
        )
        monkeypatch.setattr(
            l_records,
            "_BUILTIN_GRAINS",
            tuple(
                dataclasses.replace(spec, type_label="won_bid")
                if spec.name == l_records.WON_BID_GRAIN
                else spec
                for spec in l_records._BUILTIN_GRAINS
            ),
        )
        relabelled = next(
            s for s in l_records._BUILTIN_GRAINS if s.name == l_records.WON_BID_GRAIN
        )
        # The emitted label changed; the declared directory did not.
        assert relabelled.type_label == "won_bid"
        assert relabelled.directory == won_bid_dir

        key = ConceptKey(
            rel_path=f"{relabelled.directory}/acme-corp.md",
            concept_type="won_bid",  # relabelled: no longer 'case_study'
            grain=l_records.WON_BID_GRAIN,
            entity_id="Acme Corp",
            form_instance_id="ws-1",
        )
        named_client = ConceptKey(
            rel_path="case-studies/acme-corp.md",
            concept_type="won_bid",  # SAME label, different grain
            grain="case_study_named_client",
            entity_id="Acme Corp",
        )

        summary = bundle_writer.write_bundle(
            tmp_path,
            [
                _grain_draft(key, title="Acme Corp won bid", type_label="won_bid"),
                _grain_draft(named_client, title="Acme Corp", type_label="won_bid"),
            ],
        )

        # No collision, no clobber, and the file is exactly where it was
        # before the relabel — the pre-{427.8} outcome, reached without a
        # redirect.
        assert summary.moved == ()
        assert sorted(summary.added) == [
            "case-studies/acme-corp.md",
            "case-studies/won-bid/acme-corp.md",
        ]
        assert "type: won_bid" in (
            tmp_path / "case-studies/won-bid/acme-corp.md"
        ).read_text(encoding="utf-8")

    def test_two_grains_may_share_one_directory(self) -> None:
        """id-429 IA-4: many-to-one is permitted.

        **RE-STAGED by ID-427 {427.8}.** This test previously read the
        property off the built-in registry (`both case_study grains own
        case-studies`) and said so explicitly so that {427.8} — which
        changes one of them — could not be blocked by a uniqueness
        constraint quietly introduced here. That reading is now false as an
        observation, and reading it off the built-ins was always the weaker
        test: it measured today's entries, not the rule. IA-4 is a property
        of the REGISTRY, so it is asserted against the registry: a grain
        registered into a directory a built-in already owns is enumerated
        and written there, with no uniqueness check anywhere in the path.

        The {427.8} fact the old assertion carried is kept as its own claim
        below: the two `case_study` grains share a type LABEL and no longer
        share a directory, which is DR-141's decoupling made visible."""
        labels = [
            (spec.type_label, spec.directory)
            for spec in l_records._BUILTIN_GRAINS
            if spec.type_label == "case_study"
        ]
        assert labels == [
            ("case_study", "case-studies"),
            ("case_study", "case-studies/won-bid"),
        ]

    def test_a_grain_may_be_registered_into_a_directory_a_builtin_owns(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """id-429 IA-4 at the registry, not at today's entries — the half of
        the assertion above that {427.8} took away. Nothing rejects two
        grains naming one directory, and both concepts reach it."""
        extra = dataclasses.replace(
            next(
                s
                for s in l_records._BUILTIN_GRAINS
                if s.name == "case_study_named_client"
            ),
            name="case_study_partner",
            directory="case-studies",
            type_label="partnership",
        )
        monkeypatch.setattr(
            l_records, "_BUILTIN_GRAINS", (*l_records._BUILTIN_GRAINS, extra)
        )
        assert (
            len(l_records.BUILTIN_GRAIN_DIRECTORIES)
            < len(l_records._BUILTIN_GRAINS)
        )

        summary = bundle_writer.write_bundle(
            tmp_path,
            [
                _grain_draft(
                    ConceptKey(
                        rel_path="case-studies/acme-ltd.md",
                        concept_type="case_study",
                        grain="case_study_named_client",
                        entity_id="Acme Ltd",
                    ),
                    title="Acme Ltd",
                    type_label="case_study",
                ),
                _grain_draft(
                    ConceptKey(
                        rel_path="case-studies/beta-llp.md",
                        concept_type="partnership",
                        grain="case_study_partner",
                        entity_id="Beta LLP",
                    ),
                    title="Beta LLP",
                    type_label="partnership",
                ),
            ],
        )

        assert sorted(summary.added) == [
            "case-studies/acme-ltd.md",
            "case-studies/beta-llp.md",
        ]


# =========================================================================
# ID-427 {427.16} — THE SAME PROPERTY, FOR THE OTHER SOURCE
#
# TECH §1's fourth consequence: *"`repo_docs.RepoDocsSource` uses the same
# registry shape for its two pillars, so the two Sources stop being parallel
# implementations of the same idea (id-362 F1)."* {427.7} proved the
# one-registry-entry property for `LRecordsSource` above and left this
# adapter enumerating from a hardcoded tuple with its directories inlined;
# {427.9} added `Coverage`/`census()` and disclosed the registry as an open
# gap. These tests are that gap closed — the SAME claim, asserted the SAME
# way, so the two cannot drift apart again without one of them failing.
# =========================================================================


def _register_pillar(monkeypatch: pytest.MonkeyPatch, spec: GrainSpec) -> None:
    """The ONLY production change these tests make — the exact counterpart
    of `_register_grain` above. If a future edit means a repo/docs pillar
    also needs an enumeration arm, a `read_concept` branch, a directory
    literal or a `type:` literal, this helper stops being sufficient and
    these tests fail, which is the regression they exist to catch."""
    monkeypatch.setattr(
        repo_docs, "_BUILTIN_GRAINS", (*repo_docs._BUILTIN_GRAINS, spec)
    )


def _fake_pillar(**overrides: object) -> GrainSpec:
    """A pillar over a corpus this adapter has never had: two OpenAPI
    operations, resolved from nothing but the pillar's own declaration.

    Deliberately NOT a third instance of E1 or E2 — the module docstring's
    KA3 gate says a pillar needing a bespoke read grid is the escalation
    trigger, so the pillar that proves "one entry is enough" must be one
    whose read the built-ins do not already answer. This one's `read`
    returns synthesised text with no file behind it at all."""
    operations = ("listWidgets", "createWidget")

    async def _list(src: object, spec: GrainSpec) -> GrainEnumeration:
        return GrainEnumeration(
            keys=tuple(
                RepoConceptKey(
                    rel_path=f"{spec.directory}/{mint_concept_slug(op)}.md",
                    concept_type=spec.type_label,
                    grain=spec.name,
                    source_ref=f"openapi.yaml#/paths/{op}",
                )
                for op in operations
            ),
            covers=Coverage.of({"openapi_operations": list(operations)}),
        )

    async def _read(
        src: object, spec: GrainSpec, key: RepoConceptKey
    ) -> RepoConceptRaw:
        return RepoConceptRaw(text=f"operation {key.source_ref}", resource="")

    async def _sample(
        src: object, spec: GrainSpec, key: RepoConceptKey, n: int
    ) -> "list[dict]":
        return [{"line": 1, "text": f"operation {key.source_ref}"}][:n]

    defaults: "dict[str, object]" = dict(
        name="openapi_operation",
        directory="api",
        type_label="api",
        list=_list,
        read=_read,
        sample=_sample,
        sample_kind=repo_docs.ARTEFACT_LINES,
    )
    return GrainSpec(**{**defaults, **overrides})  # type: ignore[arg-type]


class TestARepoPillarIsOneRegistryEntry:
    """**The assertion {427.16} exists to make** — the `RepoDocsSource` half
    of `TestAGrainIsOneRegistryEntry`."""

    def test_a_pillar_registered_in_a_test_appears_in_the_emitted_bundle(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """One registry entry — no `list_concepts` arm, no `read_concept`
        branch, no `sample_rows` branch, no directory literal, no `type:`
        literal — and the pillar's concepts are enumerated, read, sampled,
        written to the directory the pillar declared, reported in the run
        summary, and listed in that directory's own index.

        Before {427.16} this took four edits in `repo_docs.py`, which is why
        the module docstring's reserved `api`/`schema`/`playbook` pillars had
        never been added: the KA3 prototype proved the two GRAINS were
        enough, and the code then made using that result expensive. The
        pillar registered here is deliberately an `api` one, so the test
        measures the cost of the very extension the docstring reserves."""
        checkout = tmp_path / "checkout"
        checkout.mkdir()
        bundle = tmp_path / "bundle"
        _register_pillar(monkeypatch, _fake_pillar())
        src = repo_docs.RepoDocsSource(checkout)

        keys = _run(src.list_concepts())

        # 1. Enumerated. (The two built-in pillars find nothing in an empty
        #    checkout, so the keyset is exactly the pillar under test.)
        assert [k.rel_path for k in keys] == [
            "api/listwidgets.md",
            "api/createwidget.md",
        ]
        assert {k.concept_type for k in keys} == {"api"}
        assert {k.grain for k in keys} == {"openapi_operation"}

        # 2. Read and sampled — routed by `grain`, with no dispatcher arm.
        #    Neither built-in read could have served these: there is no file
        #    behind `openapi.yaml#/paths/listWidgets` in this checkout, so a
        #    `_read_source_ref` fallthrough would raise FileNotFoundError.
        raw = _run(src.read_concept(keys[0]))
        assert raw.text == "operation openapi.yaml#/paths/listWidgets"
        assert _run(src.sample_rows(keys[0], 5)) == [
            {"line": 1, "text": "operation openapi.yaml#/paths/listWidgets"}
        ]

        # 3. Emitted.
        summary = bundle_writer.write_bundle(
            bundle,
            [
                _grain_draft(k, title=k.rel_path.split("/")[-1], type_label="api")
                for k in keys
            ],
        )

        assert sorted(summary.added) == ["api/createwidget.md", "api/listwidgets.md"]
        written = (bundle / "api" / "listwidgets.md").read_text(encoding="utf-8")
        assert "type: api" in written
        # 4. And carried into the per-directory index id-429 emits (IA-1:
        #    every concept has a directory, and the pillar declared it).
        index = (bundle / "api" / "index.md").read_text(encoding="utf-8")
        assert "(listwidgets.md)" in index
        assert "(createwidget.md)" in index

    def test_the_pre_427_16_hardcoded_enumeration_would_not_have_seen_it(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The negative control — the test above must be able to FAIL.

        Re-introduces the exact property {427.16} removed: an enumeration
        that names its pillars instead of iterating the registry. A
        registered pillar then contributes nothing, so if `list_concepts`
        ever regresses to that shape the assertion above stops holding. This
        is the {427.7} discipline (four negative controls, each restoring one
        pre-change property) applied to this adapter's one."""
        checkout = tmp_path / "checkout"
        checkout.mkdir()
        _register_pillar(monkeypatch, _fake_pillar())

        async def _hardcoded(self) -> "list[RepoConceptKey]":
            keys: "list[RepoConceptKey]" = []
            for spec in (
                self._grains[repo_docs.TOOL_GRAIN],
                self._grains[repo_docs.NAVIGATION_GRAIN],
            ):
                keys.extend((await spec.list(self, spec)).keys)
            self._coverage = Coverage()
            return keys

        monkeypatch.setattr(repo_docs.RepoDocsSource, "list_concepts", _hardcoded)
        src = repo_docs.RepoDocsSource(checkout)

        assert _run(src.list_concepts()) == []

    def test_relabelling_a_pillar_changes_the_emitted_type_and_moves_no_file(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """PI-5 for this adapter, in both halves.

        The pre-{427.16} code interpolated `f"tool/{name}.md"` and
        `concept_type="tool"` at two separate literal sites, so the two were
        only accidentally independent — an edit that "kept them in sync"
        would have made a relabel move every file, churning BI-2 identity,
        the cocoindex memo key and every BI-9 cross-link. They are now one
        declaration each and cannot be confused."""
        checkout = tmp_path / "checkout"
        checkout.mkdir()
        bundle = tmp_path / "bundle"
        _register_pillar(monkeypatch, _fake_pillar())
        before = _run(repo_docs.RepoDocsSource(checkout).list_concepts())

        monkeypatch.setattr(
            repo_docs,
            "_BUILTIN_GRAINS",
            tuple(
                dataclasses.replace(spec, type_label="rest_endpoint")
                if spec.name == "openapi_operation"
                else spec
                for spec in repo_docs._BUILTIN_GRAINS
            ),
        )
        after = _run(repo_docs.RepoDocsSource(checkout).list_concepts())

        # The emitted type changed …
        assert {k.concept_type for k in before} == {"api"}
        assert {k.concept_type for k in after} == {"rest_endpoint"}
        # … and the identity — physical path, memo key, BI-9 citation target
        # — did not.
        assert [k.rel_path for k in before] == [k.rel_path for k in after]

        summary = bundle_writer.write_bundle(
            bundle,
            [
                _grain_draft(
                    k, title=k.rel_path.split("/")[-1], type_label="rest_endpoint"
                )
                for k in after
            ],
        )

        assert summary.moved == ()
        assert sorted(summary.added) == ["api/createwidget.md", "api/listwidgets.md"]
        assert "type: rest_endpoint" in (bundle / "api" / "listwidgets.md").read_text(
            encoding="utf-8"
        )

    def test_the_shipped_pillars_declare_the_directories_they_already_wrote(
        self, tmp_path: Path
    ) -> None:
        """The regression that matters most to a live bundle: {427.16}
        turned two path literals into two declarations, and a declaration
        that disagreed with the literal would MOVE every shipped concept.

        Asserted against the emitted `rel_path`s of a real enumeration over a
        seeded checkout, not against the `GrainSpec.directory` strings — a
        test that read the declaration back would agree with itself no matter
        what the enumeration did with it."""
        checkout = tmp_path / "checkout"
        tools = checkout / "lib" / "mcp" / "tools"
        tools.mkdir(parents=True)
        (tools / "content.ts").write_text(
            "export async function reg(server) {\n"
            "  defineTool(server, 'get', {}, async () => ({}));\n"
            "}\n",
            encoding="utf-8",
        )
        nav = checkout / "docs" / "navigation"
        nav.mkdir(parents=True)
        (nav / "getting-started.md").write_text("# Start\n", encoding="utf-8")

        keys = _run(repo_docs.RepoDocsSource(checkout).list_concepts())

        assert sorted(k.rel_path for k in keys) == [
            "navigation/getting-started.md",
            "tool/get.md",
        ]
        assert {(k.concept_type, k.grain) for k in keys} == {
            ("tool", repo_docs.TOOL_GRAIN),
            ("navigation", repo_docs.NAVIGATION_GRAIN),
        }


class TestReservedConceptSlugs:
    """id-429 **IA-3**, net-new and created by id-427 (DESIGN §5).

    OKF §3.1 reserves `index.md`/`log.md` at every level of the hierarchy.
    Under the closed type vocabulary a concept could never land on one;
    {427.5} opened the vocabulary, and id-429 {429.5} then made the producer
    declare an `index.md` per directory AFTER the concept loop — so a concept
    at `<dir>/index.md` is actively OVERWRITTEN within the same run, last
    write wins, and reconciled away on the next. That sequencing is why this
    guard is blocking rather than advisory."""

    def test_a_scope_tag_named_index_writes_beside_the_directory_index(
        self, tmp_path: Path
    ) -> None:
        class _IndexScopeTagPool(_PermissivePool):
            async def fetch(self, query: str, *args: object) -> "list[dict]":
                self.queries.append(query)
                if "AS scope_tag FROM q_a_pairs" in query:
                    return [{"scope_tag": "Index"}]
                return []

        keys = _run(l_records.LRecordsSource(_IndexScopeTagPool()).list_concepts())

        assert [k.rel_path for k in keys] == ["topics/index-concept.md"]

        summary = bundle_writer.write_bundle(
            tmp_path, [_grain_draft(keys[0], title="Index", type_label="topic")]
        )

        # The concept is on disk under its renamed slug …
        assert summary.added == ("topics/index-concept.md",)
        concept = (tmp_path / "topics" / "index-concept.md").read_text(encoding="utf-8")
        assert "A distilled synthesis about Index." in concept
        # … and the directory's own index is a real index, not the concept.
        index = (tmp_path / "topics" / "index.md").read_text(encoding="utf-8")
        assert "(index-concept.md)" in index
        assert "A distilled synthesis" not in index

    def test_a_document_named_log_is_renamed_not_refused(self) -> None:
        """TECH §2.6: a client document legitimately called "Log" is a data
        fact, not a configuration error. Aborting a whole producer run over
        one would violate DR-047's narrowly-scoped degrade posture, so the
        slug is renamed deterministically instead."""
        assert mint_concept_slug("Log") == "log-concept"
        assert mint_concept_slug("index") == "index-concept"
        # Identity on everything else — the guard must not perturb any of the
        # concept paths the bundle already ships.
        assert mint_concept_slug("iso-27001") == "iso-27001"
        assert mint_concept_slug("Acme Corp") == "acme-corp"
        assert mint_concept_slug("logistics") == "logistics"
        assert mint_concept_slug("index-concept") == "index-concept"

    def test_a_feeder_declaring_a_reserved_directory_is_refused_at_read_time(
        self, tmp_path: Path
    ) -> None:
        """The other half of §2.6, and the reason the two halves differ: a
        DIRECTORY name is the client's configuration choice, not a data fact,
        so it fails loud at config-read — `ConceptFeederConfigError`'s own
        documented posture — rather than being silently renamed."""
        (tmp_path / "concept-feeder.json").write_text(
            json.dumps(
                {
                    "concept_types": {
                        "framework": {
                            "grain": "entity_mention",
                            "entity_type": "framework",
                            "directory": "log",
                        }
                    }
                }
            ),
            encoding="utf-8",
        )

        with pytest.raises(bundle_writer.ConceptFeederConfigError, match="reserves"):
            bundle_writer.read_concept_feeder_config(tmp_path)

    def test_a_feeder_may_declare_a_directory_that_differs_from_its_type(
        self, tmp_path: Path
    ) -> None:
        """TECH §2.7 — the decoupling the `directory` key exists for, and the
        reason it is not derived: an arbitrary client-chosen type name has no
        principled English-plural rule."""
        (tmp_path / "concept-feeder.json").write_text(
            json.dumps(
                {
                    "concept_types": {
                        "framework": {
                            "grain": "entity_mention",
                            "entity_type": "framework",
                            "directory": "frameworks",
                        }
                    }
                }
            ),
            encoding="utf-8",
        )

        config = bundle_writer.read_concept_feeder_config(tmp_path)

        assert config["framework"]["directory"] == "frameworks"

    def test_a_feeder_declared_directory_is_where_its_concepts_land(self) -> None:
        """The `directory` key reaching the emitted rel_path — a feeder grain
        is an ordinary registry entry, so its directory is honoured the same
        way a built-in grain's is."""

        class _FrameworkPool(_PermissivePool):
            async def fetch(self, query: str, *args: object) -> "list[dict]":
                self.queries.append(query)
                if "entity_type = $1 ORDER BY 1" in query and args == ("framework",):
                    return [{"canonical_name": "NIST CSF"}]
                return []

        src = l_records.LRecordsSource(
            _FrameworkPool(),
            concept_feeder_config={
                "framework": {
                    "grain": "entity_mention",
                    "entity_type": "framework",
                    "directory": "frameworks",
                }
            },
        )

        keys = _run(src.list_concepts())

        assert [k.rel_path for k in keys] == ["frameworks/nist-csf.md"]
        assert keys[0].concept_type == "framework"
        assert keys[0].grain == "feeder:framework"

    def test_the_feeder_collision_guard_reads_the_grain_registry(self) -> None:
        """{427.5} parked this guard on a hand-mirrored constant carrying an
        explicit {427.7} expiry. It is sourced from the registry now, so a
        grain added or relabelled there cannot leave the guard stale — the
        drift the stopgap could not prevent. The guard itself is KEPT: its
        requirement (`l_records`' ordered dispatch would enumerate a shadowed
        label twice) is live, and deleting it would degrade a clear config
        error into an opaque write-path collision."""
        assert not hasattr(bundle_writer, "_BUILTIN_GRAIN_TYPE_LABELS")
        assert l_records.BUILTIN_GRAIN_TYPE_LABELS == {
            spec.type_label for spec in l_records._BUILTIN_GRAINS
        }

        with pytest.raises(bundle_writer.ConceptFeederConfigError, match="BUILT-IN"):
            bundle_writer._validate_concept_feeder_schema(
                {
                    "concept_types": {
                        "topic": {"grain": "entity_mention", "entity_type": "topic"}
                    }
                }
            )


# =========================================================================
# ID-427 {427.9} — the corpus census, asserted as the SILENCE it removes
#
# DR-141's load-bearing failure is the negative answer: a user must be able
# to trust "we do not know this — escalate to an SME" over "I could not find
# it", and that needs the bundle to be a faithful projection of the corpus.
# Before this, `RunSummary` had no field that COULD carry an un-enumerated
# unit (the S546 grounding audit's own finding about
# `bundle_writer.py:528-570`) — every field is populated from drafts that
# already exist, so a unit no grain reached left no trace anywhere. These
# tests are about what the run log can now say.
# =========================================================================


def _census(sd: int, qa: int, *, sd_routed: int, qa_routed: int) -> CorpusCensus:
    return CorpusCensus(
        considered=(("source_documents", sd), ("q_a_pairs", qa)),
        routed=(("source_documents", sd_routed), ("q_a_pairs", qa_routed)),
    )


class TestTheCensusReachesTheLog:
    """TECH §2.11: the `Considered` line is emitted on every run that took a
    census — including a no-op one — and the `Unrouted` line follows it when
    non-zero."""

    def test_a_run_that_changes_nothing_still_says_what_it_considered(
        self, tmp_path: Path
    ) -> None:
        """*"A no-op run still says what it considered."* Before {427.9} a
        no-op run's entire record was `No changes (no-op re-run)` — a
        statement about the BUNDLE that says nothing about the corpus behind
        it. Both claims now sit on the same run's record, and they are
        genuinely different: nothing changed, AND nothing was left behind."""
        drafts = [_draft("topics/alpha.md", title="Alpha")]
        census = _census(42, 310, sd_routed=42, qa_routed=310)
        bundle_writer.write_bundle(
            tmp_path, drafts, census=census, timestamp="2026-08-10T09:00:00Z"
        )

        summary = bundle_writer.write_bundle(
            tmp_path, drafts, census=census, timestamp="2026-08-10T10:00:00Z"
        )

        assert summary.is_no_op is True
        log_text = (tmp_path / "log.md").read_text(encoding="utf-8")
        assert (
            "* **Run 2026-08-10T10:00:00Z — Considered (2):** "
            "source_documents 42 (routed 42), q_a_pairs 310 (routed 310)"
        ) in log_text
        assert (
            "* **Run 2026-08-10T10:00:00Z — No changes** (no-op re-run)."
        ) in log_text

    def test_a_fully_covered_corpus_reports_considered_equals_routed(
        self, tmp_path: Path
    ) -> None:
        """The state {427.10}'s residual grain exists to reach, asserted on
        the emitted artefact rather than on the dataclass: both kinds report
        equal counts, and NO `Unrouted` line is written at all."""
        summary = bundle_writer.write_bundle(
            tmp_path,
            [_draft("topics/alpha.md", title="Alpha")],
            census=_census(7, 19, sd_routed=7, qa_routed=19),
            timestamp="2026-08-10T11:00:00Z",
        )

        assert summary.census.unrouted == ()
        assert summary.census.unrouted_total == 0
        log_text = (tmp_path / "log.md").read_text(encoding="utf-8")
        assert "source_documents 7 (routed 7), q_a_pairs 19 (routed 19)" in log_text
        assert "Unrouted" not in log_text

    def test_an_unrouted_run_is_not_a_no_op_though_every_file_is_identical(
        self, tmp_path: Path
    ) -> None:
        """**The assertion this subtask exists to make.** A re-run over an
        unchanged corpus writes byte-identical files, so every pre-{427.9}
        signal reports a no-op — and `run_producer_flow` skips git-staging
        for a no-op run (owner ruling S456), which would leave the one line
        reporting the hole uncommitted. The census is the only thing that
        can tell this run apart from a genuinely idle one, on exactly the
        precedent `failed` already sets."""
        drafts = [_draft("topics/alpha.md", title="Alpha")]
        covered = _census(9, 40, sd_routed=9, qa_routed=40)
        bundle_writer.write_bundle(
            tmp_path, drafts, census=covered, timestamp="2026-08-10T09:00:00Z"
        )
        content_after_run1 = {
            path.relative_to(tmp_path).as_posix(): path.read_text(encoding="utf-8")
            for path in sorted(tmp_path.rglob("*"))
            if path.is_file() and path.name != bundle_writer.LOG_FILENAME
        }

        summary = bundle_writer.write_bundle(
            tmp_path,
            drafts,
            census=_census(9, 40, sd_routed=6, qa_routed=28),
            timestamp="2026-08-10T10:00:00Z",
        )

        # Every pre-census signal reports an idle run …
        assert summary.added == ()
        assert summary.changed == ()
        assert summary.removed == ()
        assert summary.failed == ()
        content_after_run2 = {
            path.relative_to(tmp_path).as_posix(): path.read_text(encoding="utf-8")
            for path in sorted(tmp_path.rglob("*"))
            if path.is_file() and path.name != bundle_writer.LOG_FILENAME
        }
        assert content_after_run2 == content_after_run1
        # … and it is NOT a no-op, because knowledge is unrouted.
        assert summary.census.unrouted_total == 15
        assert summary.is_no_op is False

        log_text = (tmp_path / bundle_writer.LOG_FILENAME).read_text(encoding="utf-8")
        assert (
            "* **Run 2026-08-10T10:00:00Z — Unrouted (15):** "
            "source_documents 3, q_a_pairs 12"
        ) in log_text
        # The no-op bullet is keyed on the absence of CHANGE lines, not on
        # `is_no_op` — those were one condition until {427.9} and are no
        # longer, and the log must be able to report both truths at once.
        assert (
            "* **Run 2026-08-10T10:00:00Z — No changes** (no-op re-run)."
        ) in log_text

    def test_a_run_with_no_census_writes_no_census_line(self, tmp_path: Path) -> None:
        """The distinction {427.7} asked the next subtask to keep: an empty
        `CorpusCensus` is NOT "a census that found nothing" — a census that
        ran and found nothing still lists its kinds with zeros. A direct
        `write_bundle` call was handed drafts, never a corpus, so printing
        `Considered (0)` for it would report a measurement nobody took."""
        bundle_writer.write_bundle(
            tmp_path,
            [_draft("topics/alpha.md", title="Alpha")],
            timestamp="2026-08-10T12:00:00Z",
        )

        log_text = (tmp_path / bundle_writer.LOG_FILENAME).read_text(encoding="utf-8")
        assert "Considered" not in log_text
        assert "Unrouted" not in log_text

    def test_a_census_that_measured_zero_still_says_so(self, tmp_path: Path) -> None:
        """The other half of that distinction, and the negative control for
        the test above: a real census over an EMPTY corpus emits the line
        with zeros. Were the render condition "some count is non-zero"
        rather than "a census was taken", this line would silently vanish —
        which is the emptiness-as-evidence error the wave's dispatch
        controls name."""
        bundle_writer.write_bundle(
            tmp_path,
            [_draft("topics/alpha.md", title="Alpha")],
            census=_census(0, 0, sd_routed=0, qa_routed=0),
            timestamp="2026-08-10T13:00:00Z",
        )

        log_text = (tmp_path / bundle_writer.LOG_FILENAME).read_text(encoding="utf-8")
        assert (
            "* **Run 2026-08-10T13:00:00Z — Considered (2):** "
            "source_documents 0 (routed 0), q_a_pairs 0 (routed 0)"
        ) in log_text


class TestBI10NoUuidReachesTheLog:
    """BI-10: record pointers are `resource:`/citations. A run log is
    neither, so no uuid may appear in `log.md` — asserted directly on the
    artefact (TECH §2.11's "counts only")."""

    _UUID_RE = re.compile(
        r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
        r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    )

    def test_no_uuid_appears_anywhere_in_log_md(self, tmp_path: Path) -> None:
        """The census identifies the units it counts BY uuid — every
        coverage query selects `id` — so this is the one place a record uuid
        could newly leak into a human-readable artefact. The run below
        carries a real `source_documents` uuid in the drafts' own citations,
        so a uuid is genuinely in scope: this asserts it does not travel
        into the log, not that none existed."""
        bundle_writer.write_bundle(
            tmp_path,
            [
                _draft("topics/alpha.md", title="Alpha"),
                _draft("topics/beta.md", title="Beta"),
            ],
            census=_census(9, 40, sd_routed=6, qa_routed=28),
            timestamp="2026-08-10T14:00:00Z",
        )

        log_text = (tmp_path / bundle_writer.LOG_FILENAME).read_text(encoding="utf-8")
        assert "Unrouted" in log_text  # the census really did report a hole
        assert self._UUID_RE.search(log_text) is None
        # Negative control on the assertion itself: the SAME uuid is present
        # in the concept this run wrote, so the regex can find one when
        # there is one to find.
        concept_text = (tmp_path / "topics/alpha.md").read_text(encoding="utf-8")
        assert self._UUID_RE.search(concept_text) is not None

    def test_every_census_bullet_matches_the_parse_log_run_contract(
        self, tmp_path: Path
    ) -> None:
        """The census adds a NEW bullet shape to `log.md`, and TECH §3 left
        `lib/okf/parse-log.ts` explicitly UNSWEPT for it. This is the
        Python-side half of the S451 defence-in-depth rider: every emitted
        bullet must match the `**Run <ts> — …**` regex the TS parser groups
        runs by, and every bullet of one run must carry the SAME timestamp
        — that is what makes the parser fold the census into the run's own
        entry rather than splitting it into a run of its own.

        Its limit, stated rather than implied: `_TS_RUN_BULLET_RE` is a
        TRANSCRIPTION of the TS regex, so a change to `parse-log.ts` itself
        will not fail this test."""
        bundle_writer.write_bundle(
            tmp_path,
            [_draft("topics/alpha.md", title="Alpha")],
            census=_census(9, 40, sd_routed=6, qa_routed=28),
            timestamp="2026-08-10T15:00:00Z",
        )

        log_text = (tmp_path / bundle_writer.LOG_FILENAME).read_text(encoding="utf-8")
        bullets = [line for line in log_text.splitlines() if line.startswith("* ")]
        census_bullets = [
            line for line in bullets if "Considered" in line or "Unrouted" in line
        ]
        assert len(census_bullets) == 2
        for line in bullets:
            match = _TS_RUN_BULLET_RE.match(line)
            assert match is not None, line
            assert match.group(1) == "2026-08-10T15:00:00Z"


# ─────────────────────────────────────────────────────────────────────────
# ID-427 {427.10} — the residual concepts at the WRITE boundary
# ─────────────────────────────────────────────────────────────────────────


def _undistilled_draft(document_id: str, filename: str):
    """A REAL `render_undistilled_draft` output, not a hand-built stand-in.
    The claim under test is about what `write_bundle` does with the pages the
    residual grain actually produces, so a fixture draft would test the
    fixture."""
    from scripts.cocoindex_pipeline.producer.enrich import (  # noqa: PLC0415
        render_undistilled_draft,
    )

    basename = l_records.residual_document_basename(
        {"filename": filename}, document_id
    )
    key = ConceptKey(
        rel_path=f"documents/{basename}.md",
        concept_type="document",
        grain=l_records.RESIDUAL_DOCUMENT_UNDISTILLED_GRAIN,
        source_document_id=document_id,
    )
    raw = ConceptRaw(
        source_documents=[
            {
                "id": document_id,
                "filename": filename,
                "logical_path": None,
                "content_type": "policy",
                "extraction_method": "pdf_text",
                "created_at": "2026-05-01T00:00:00Z",
                "updated_at": "2026-05-01T00:00:00Z",
            }
        ]
    )
    return render_undistilled_draft(key, raw)


def test_two_documents_with_one_filename_both_write_without_a_collision(
    tmp_path: Path,
) -> None:
    """PLAN {427.10}: *"two documents with identical filenames produce two
    distinct concepts via the unconditional `-<uuid[:8]>` suffix WITHOUT
    tripping the collision guard"*.

    `write_bundle`'s pre-write guard is the {132.29} one — it refuses the
    whole run before any `declare_file` when two drafts resolve to one path.
    That guard is exactly what a CONDITIONAL suffix would eventually hit, and
    exactly what this corpus would have hit under any naming scheme derived
    from the filename alone."""
    first = _undistilled_draft("aaaaaaaa-1111-4111-8111-111111111111", "report.pdf")
    second = _undistilled_draft("bbbbbbbb-2222-4222-8222-222222222222", "report.pdf")

    summary = bundle_writer.write_bundle(tmp_path, [first, second], [])

    assert summary.validator_failures == ()
    assert set(summary.added) == {
        "documents/report-aaaaaaaa.md",
        "documents/report-bbbbbbbb.md",
    }
    assert (tmp_path / "documents/report-aaaaaaaa.md").is_file()
    assert (tmp_path / "documents/report-bbbbbbbb.md").is_file()
    # Two distinct pages, not one clobbering the other.
    assert (tmp_path / "documents/report-aaaaaaaa.md").read_text() != (
        tmp_path / "documents/report-bbbbbbbb.md"
    ).read_text()


def test_an_undistilled_page_passes_the_bi13_write_gate(tmp_path: Path) -> None:
    """`confidence: no-content` reaches disk. The A19 value has been ratified
    and unreachable since it was ratified (RESEARCH M8) because
    `derive_concept_confidence` returns only `strong`/`partial`; the BI-13
    validator has always accepted it, and nothing had ever asked it to."""
    draft = _undistilled_draft(
        "aaaaaaaa-1111-4111-8111-111111111111", "07-supplier-code.pdf"
    )

    summary = bundle_writer.write_bundle(tmp_path, [draft], [])

    assert summary.validator_failures == ()
    written = (tmp_path / "documents/07-supplier-code-aaaaaaaa.md").read_text()
    assert "confidence: no-content" in written
    assert "Escalate to a subject-matter expert." in written

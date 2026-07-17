"""Tests for producer/bundle_writer.py — validator-gated `declare_file` per
concept + `index.md`/`log.md` writers + the DR-027 ontology artefact
(ID-132 {132.10} G-BUNDLE).

Per the {132.10} testStrategy:

  - a concept failing the validator is NOT `declare_file`-written (BI-13);
  - `index.md` renders themes as nav over a ~30-50-file fixture bundle
    (BI-5);
  - `log.md` appends one block per run;
  - a no-op re-run produces a no-op diff (BI-18).

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

De-identified throughout: theme names and concept titles below are generic
placeholder business categories, never the real first-client corpus.
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
)
from scripts.cocoindex_pipeline.producer import iri_projection  # noqa: E402
from scripts.cocoindex_pipeline.producer.resource_uri import (  # noqa: E402
    build_source_document_uri,
)
from scripts.cocoindex_pipeline.producer.validator import (  # noqa: E402
    ALLOWED_CONCEPT_TYPES,
    ALLOWED_ENTITY_TYPES,
    ALLOWED_RELATIONSHIP_TYPES,
    EffectiveOntology,
)
from scripts.cocoindex_pipeline.producer.web_pass import (  # noqa: E402
    ReferenceConceptDraft,
)
from scripts.cocoindex_pipeline.sources.l_records import ConceptKey  # noqa: E402

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


def _fm(*, type="topic", title="Title", description="Desc", tags=("tag",), resource=None):
    return build_concept_frontmatter(
        type=type,
        title=title,
        description=description,
        timestamp="2026-07-08T00:00:00Z",
        tags=tags,
        resource=resource,
    )


def _draft(
    rel_path: str, *, title="Title", description="Desc", body_suffix="", type="topic"
) -> ConceptDraft:
    key = ConceptKey(rel_path=rel_path, concept_type="topic", scope_tag=rel_path)
    body = (
        f"A distilled synthesis about {title}.{body_suffix}\n\n"
        "# Citations\n"
        f"- {build_source_document_uri(_SAMPLE_UUID)}\n"
    )
    return ConceptDraft(
        key=key,
        frontmatter=_fm(
            type=type, title=title, description=description, resource=build_source_document_uri(_SAMPLE_UUID)
        ),
        body=body,
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
    # The on-disk content is the draft with its `# Citations` trailer
    # normalised to the SPEC §8 numbered-link form (write-time
    # normalisation) — never the raw draft markdown verbatim.
    sd_uri = build_source_document_uri(_SAMPLE_UUID)
    assert written.startswith("---\n")
    assert f"[1] [{sd_uri}]({sd_uri})" in written
    assert written.split("# Citations")[0] == draft.rendered_markdown.split("# Citations")[0]


def test_declare_concept_invalid_not_written(tmp_path: Path) -> None:
    # BI-4: an out-of-set type fails check_concept.
    bad_frontmatter = _fm(type="not-a-real-type")
    draft = ConceptDraft(
        key=ConceptKey(rel_path="topics/bad.md", concept_type="topic", scope_tag="bad"),
        frontmatter=bad_frontmatter,
        body="A distilled synthesis.\n\n# Citations\n- " + build_source_document_uri(_SAMPLE_UUID) + "\n",
    )

    result = bundle_writer.declare_concept(tmp_path, draft)

    assert result.written is False
    assert result.errors  # non-empty — BI-13 aggregate violations
    _localfs_stub.declare_file.assert_not_called()
    assert not (tmp_path / "topics/bad.md").exists()


def test_declare_concept_reference_draft_uses_rel_path_not_key(tmp_path: Path) -> None:
    ref_fm = _fm(
        type="topic",
        tags=("reference",),
        resource=build_source_document_uri(_SAMPLE_UUID),
    )
    ref_draft = ReferenceConceptDraft(
        rel_path="references/iso-27001.md",
        frontmatter=ref_fm,
        body="Gated-corpus enrichment.\n\n# Citations\n- "
        + build_source_document_uri(_SAMPLE_UUID)
        + "\n",
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


def test_declare_concept_normalises_legacy_citation_trailer_to_numbered_links(
    tmp_path: Path,
) -> None:
    """SPEC §5.1/§8 write-time normalisation: a draft whose `# Citations`
    section carries LEGACY bare-path bullets lands on disk in the
    numbered-link form — cross-links bundle-absolute (leading `/`),
    labelled by the target concept's title via `citation_titles`."""
    sd_uri = build_source_document_uri(_SAMPLE_UUID)
    key = ConceptKey(rel_path="topics/alpha.md", concept_type="topic", scope_tag="alpha")
    draft = ConceptDraft(
        key=key,
        frontmatter=_fm(title="Alpha", resource=sd_uri),
        body=(
            "A distilled synthesis.\n\n"
            "# Citations\n"
            f"- {sd_uri}\n"
            "- certifications/iso-9001.md\n"
        ),
    )

    result = bundle_writer.declare_concept(
        tmp_path,
        draft,
        citation_titles={
            "certifications/iso-9001.md": (
                "ISO 9001:2015 — Quality Management Certification"
            )
        },
    )

    assert result.written is True
    written = (tmp_path / "topics/alpha.md").read_text(encoding="utf-8")
    assert f"[1] [{sd_uri}]({sd_uri})" in written
    assert (
        "[2] [ISO 9001:2015 — Quality Management Certification]"
        "(/certifications/iso-9001.md)" in written
    )
    assert "- certifications/iso-9001.md" not in written  # legacy form gone


def test_write_bundle_labels_cross_links_with_the_target_concepts_title(
    tmp_path: Path,
) -> None:
    """`write_bundle` threads a run-wide rel_path -> title map into every
    `declare_concept` call, so a cross-link to a concept drafted THIS run
    is labelled with that concept's real title."""
    target = _draft("topics/beta.md", title="Beta Continuity Plan")
    citing_key = ConceptKey(
        rel_path="topics/alpha.md", concept_type="topic", scope_tag="alpha"
    )
    sd_uri = build_source_document_uri(_SAMPLE_UUID)
    citing = ConceptDraft(
        key=citing_key,
        frontmatter=_fm(title="Alpha", resource=sd_uri),
        body=f"Synthesis.\n\n# Citations\n- {sd_uri}\n- topics/beta.md\n",
    )

    bundle_writer.write_bundle(tmp_path, [citing, target])

    written = (tmp_path / "topics/alpha.md").read_text(encoding="utf-8")
    assert "[2] [Beta Continuity Plan](/topics/beta.md)" in written


# ─────────────────────────────────────────────────────────────────────────
# regenerate_indexes / build_index_themes — BI-5/BI-11
# ─────────────────────────────────────────────────────────────────────────

# De-identified generic placeholder themes (NOT the real first-client
# "BID RESPONSE TOPIC INDEX" set) — six themes over 36 synthetic concepts,
# landing the ~30-50-file target the testStrategy specifies.
_PLACEHOLDER_THEMES = (
    "Company Overview",
    "Security and Compliance",
    "Business Continuity",
    "Delivery and Support",
    "Commercial and Insurance",
    "People and Governance",
)


def _synthetic_catalogue(n: int = 36):
    """`n` synthetic concept frontmatters + a theme_config claiming all of
    them across `_PLACEHOLDER_THEMES`, six per theme."""
    concepts = {}
    theme_config = []
    per_theme = n // len(_PLACEHOLDER_THEMES)
    idx = 0
    for theme in _PLACEHOLDER_THEMES:
        rel_paths = []
        for _ in range(per_theme):
            rel_path = f"topics/concept-{idx}.md"
            concepts[rel_path] = _fm(
                title=f"Concept {idx}", description=f"A one-line summary of concept {idx}."
            )
            rel_paths.append(rel_path)
            idx += 1
        theme_config.append((theme, tuple(rel_paths)))
    return concepts, theme_config


def test_regenerate_indexes_renders_theme_nav_over_fixture_bundle() -> None:
    concepts, theme_config = _synthetic_catalogue(36)
    themes = bundle_writer.build_index_themes(theme_config, concepts)
    text = bundle_writer.regenerate_indexes(themes)

    headings = [
        m for line in text.splitlines() if (m := _TS_HEADING_RE.match(line))
    ]
    assert len(headings) == len(_PLACEHOLDER_THEMES)
    assert {h.group(2) for h in headings} == set(_PLACEHOLDER_THEMES)

    bullets = [
        m for line in text.splitlines() if (m := _TS_CONCEPT_BULLET_RE.match(line))
    ]
    assert len(bullets) == len(concepts)
    bullet_paths = {b.group(2) for b in bullets}
    assert bullet_paths == set(concepts)
    # em-dash separator (this writer's chosen glyph — both are parser-legal).
    assert all(b.group(3) for b in bullets)


def test_regenerate_indexes_stamps_okf_version_frontmatter() -> None:
    """SPEC §11 / DR-019 house rule: the bundle-root `index.md` opens with
    a frontmatter block carrying EXACTLY one key — `okf_version: "0.1"` —
    followed by the `# OKF Concept Bundle` heading. §11 permits ONLY the
    bundle-root index a frontmatter block, and only this key is stamped."""
    concepts, theme_config = _synthetic_catalogue(4)
    themes = bundle_writer.build_index_themes(theme_config, concepts)
    text = bundle_writer.regenerate_indexes(themes)

    lines = text.splitlines()
    # single-key discipline: exactly one line between the fences.
    assert lines[:4] == [
        "---",
        'okf_version: "0.1"',
        "---",
        "# OKF Concept Bundle",
    ]


def test_regenerate_indexes_unthemed_concept_falls_into_trailing_bucket() -> None:
    concepts = {
        "topics/claimed.md": _fm(title="Claimed", description="Claimed desc"),
        "topics/orphan.md": _fm(title="Orphan", description="Orphan desc"),
    }
    theme_config = [("Company Overview", ("topics/claimed.md",))]

    themes = bundle_writer.build_index_themes(theme_config, concepts)
    text = bundle_writer.regenerate_indexes(themes)

    assert "## Other" in text
    assert "topics/orphan.md" in text
    assert "topics/claimed.md" in text


def test_build_index_themes_skips_theme_config_entry_with_no_matching_concept() -> None:
    concepts = {"topics/a.md": _fm(title="A", description="A desc")}
    theme_config = [("Ghost Theme", ("topics/does-not-exist.md",))]

    themes = bundle_writer.build_index_themes(theme_config, concepts)

    ghost = next(t for t in themes if t.heading == "Ghost Theme")
    assert ghost.concepts == ()
    other = next(t for t in themes if t.heading == "Other")
    assert other.concepts[0].rel_path == "topics/a.md"


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

    summary = bundle_writer.write_bundle(
        tmp_path, [good, bad], theme_config=[("Company Overview", ("topics/good.md", "topics/bad.md"))]
    )

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
    concepts, theme_config = _synthetic_catalogue(30)
    drafts = [
        _draft(rel_path, title=fm.title, description=fm.description)
        for rel_path, fm in concepts.items()
    ]

    summary1 = bundle_writer.write_bundle(
        tmp_path, drafts, theme_config=theme_config, timestamp="2026-07-08T00:00:00Z"
    )
    assert len(summary1.added) == len(drafts)

    index_after_run1 = (tmp_path / "index.md").read_text(encoding="utf-8")
    concept_content_after_run1 = {
        rel_path: (tmp_path / rel_path).read_text(encoding="utf-8") for rel_path in concepts
    }

    summary2 = bundle_writer.write_bundle(
        tmp_path, drafts, theme_config=theme_config, timestamp="2026-07-09T00:00:00Z"
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
        "# Citations\n"
        f"- {build_source_document_uri(_SAMPLE_UUID)}\n"
    )
    return ConceptDraft(
        key=key,
        frontmatter=_fm(
            type="case_study",
            title=title,
            description=f"{title} case study.",
            resource=build_source_document_uri(_SAMPLE_UUID),
        ),
        body=body,
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
# DR-027 ontology artefact
# ─────────────────────────────────────────────────────────────────────────


def test_write_ontology_artefact_base_only_when_no_overlay(tmp_path: Path) -> None:
    content = bundle_writer.write_ontology_artefact(tmp_path)
    payload = json.loads(content)

    assert payload["base"]["concept_types"] == sorted(ALLOWED_CONCEPT_TYPES)
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

    assert payload["overlay"] == overlay
    assert payload["base"]["concept_types"] == sorted(ALLOWED_CONCEPT_TYPES)
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
    """IRI-4/5: every base-vocabulary term across all three dimensions
    resolves to its base IRI; no `client` prefix is emitted absent a
    client-id (IRI-6)."""
    eo = EffectiveOntology.base_only()
    content = bundle_writer.write_context_artefact(tmp_path, eo)
    payload = json.loads(content)

    assert set(payload) == {"@context"}
    context = payload["@context"]
    assert "client" not in context
    for term in ALLOWED_CONCEPT_TYPES:
        assert context[term] == iri_projection.mint_iri(term, scope=None)
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
    eo = EffectiveOntology.compose({"concept_types": ["Foo Bar", "foo-bar"]})
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
    assert payload["@context"]["topic"] == iri_projection.mint_iri("topic", scope=None)


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


def test_write_bundle_accepts_overlay_added_concept_type_only_with_overlay(
    tmp_path: Path,
) -> None:
    """OV-8 — the core testStrategy assertion, exercised through
    `write_bundle` (not just the bare validator unit): a concept whose
    `type` is outside the closed BI-4 set is rejected by the base-only
    gate (no overlay file present) and accepted once the SAME bundle_dir
    carries an overlay naming that type."""
    draft = _draft("topics/widget.md", title="Widget", type="widget_type")

    base_only_summary = bundle_writer.write_bundle(tmp_path, [draft])
    assert base_only_summary.added == ()
    assert len(base_only_summary.validator_failures) == 1
    assert not (tmp_path / "topics/widget.md").exists()

    (tmp_path / "ontology-overlay.json").write_text(
        json.dumps({"concept_types": ["widget_type"]}), encoding="utf-8"
    )
    overlay_summary = bundle_writer.write_bundle(
        tmp_path, [draft], bundle_class="client_business"
    )
    assert overlay_summary.added == ("topics/widget.md",)
    assert (tmp_path / "topics/widget.md").exists()


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
# class-gate at `bundle_writer.py:1250` (`if overlay is not None and
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

"""OKF v0.2 bundle producer — promoted records -> bundle files (DR-152 Flow 2).

`build_bundle_files()` is the pure core: given in-memory `QaPairRow` /
`SourceDocumentRow` rows it returns `{rel_path: content_bytes}` for the whole
bundle, with no I/O and no cocoindex dependency — this is what unit tests
exercise directly (HARD LIMITS: no live DB, no live LLM in tests).

`app_main()` is the thin cocoindex wiring around it: read every row from
`q_a_pairs` and `source_documents` via `postgres.PgTableSource`, filter to
`publication_status = 'published'` in Python (the installed cocoindex 1.0.18
`PgTableSource` has no WHERE-clause support — verified by reading
`cocoindex/connectors/postgres/_source.py`; DR-143's publication filter is
therefore applied on every row read, before any row can back or be cited by a
concept, not pushed into SQL), then declare the bundle's files on an
engine-managed `localfs` directory target so retired concepts are deleted by
the engine (DESIGN.md §3). The git commit is a step AFTER `app.update()`
completes, outside this flow (DESIGN.md §3) — not implemented here.

Grain scope (phase 1): `topic` (scope_tag) only. DR-125 makes `scope_tag`
mandatory at promotion, so DR-141's coverage guarantee (every published unit
reachable in >=1 concept) holds with this one grain — see
`test_main.py::test_topic_grain_covers_every_published_pair_dr141`. The
product/certification/company/case_study grains are not implemented this
wave (plan note §Ambiguities item 2) — a documented phase-1 scope decision,
not a silent drop.
"""

from __future__ import annotations

import os
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from produce import document, frontmatter, index, paths

_BUNDLE_TITLE = "Canonical corpus bundle"
_DEFAULT_STALE_AFTER_DAYS = 90

_SLUG_DISALLOWED_RE = re.compile(r"[^a-z0-9_.\-]+")


# ---------------------------------------------------------------------------
# Row schemas — field names are exact `q_a_pairs` / `source_documents` column
# names (verified against supabase/migrations/, not the generated types file
# per the repo's Read-tool deny). `PgTableSource(row_type=...)` SELECTs
# exactly these columns.
# ---------------------------------------------------------------------------


@dataclass
class QaPairRow:
    id: str
    question_text: str
    answer_standard: str
    answer_advanced: str | None
    scope_tag: list[str]
    publication_status: str
    source_document_id: str | None


@dataclass
class SourceDocumentRow:
    id: str
    publication_status: str
    suggested_title: str | None
    logical_path: str | None
    filename: str
    updated_at: datetime | None
    captured_date: datetime | None


# ---------------------------------------------------------------------------
# Pure grouping/rendering core — no I/O, no cocoindex. Unit-tested directly.
# ---------------------------------------------------------------------------


def filter_published(rows: Sequence[QaPairRow]) -> list[QaPairRow]:
    return [r for r in rows if r.publication_status == "published"]


def filter_published_source_documents(
    rows: Sequence[SourceDocumentRow],
) -> dict[str, SourceDocumentRow]:
    return {r.id: r for r in rows if r.publication_status == "published"}


def slugify_tag(tag: str) -> str:
    """A `scope_tag` value as a bundle path segment.

    Tags are curated taxonomy values (already kebab-case in practice), but
    this defends the path scheme rather than trusting the corpus blindly.
    """
    slug = _SLUG_DISALLOWED_RE.sub("-", tag.strip().lower()).strip("-")
    if not slug:
        raise ValueError(f"scope_tag {tag!r} has no valid path characters")
    return slug


def group_by_topic(pairs: Sequence[QaPairRow]) -> dict[str, list[QaPairRow]]:
    """Every `scope_tag` entry on a pair is its own group (coverage, not
    partition — DR-141 rider): a pair with two tags contributes to two
    concepts. A pair with an empty `scope_tag` contributes to none — sanctioned
    by DR-153 (no per-document/per-pair residual); DR-125 makes this case
    unexpected among genuinely promoted pairs.
    """
    groups: dict[str, list[QaPairRow]] = {}
    for pair in pairs:
        for tag in pair.scope_tag:
            groups.setdefault(tag, []).append(pair)
    return groups


def _first_str(*values: str | None) -> str | None:
    for v in values:
        if v:
            return v
    return None


def _date_str(dt: datetime | None) -> str | None:
    return dt.date().isoformat() if dt else None


def _title_from_path(p: str) -> str:
    stem = Path(p).stem
    return " ".join(part.capitalize() for part in re.split(r"[-_]+", stem) if part)


def resolve_source_document_ref(row: SourceDocumentRow) -> document.SourceDocumentRef:
    """Source-shaped enrichment (DR-151 fold): populate `title`/`last_modified`
    only when honestly known from the register row; `author` stays `None`
    (structurally unavailable on `source_documents` today — DR-151)."""
    title = row.suggested_title or _title_from_path(
        _first_str(row.logical_path, row.filename) or ""
    )
    last_modified = _date_str(row.captured_date) or _date_str(row.updated_at)
    return document.SourceDocumentRef(
        id=row.id, title=title or None, last_modified=last_modified
    )


def build_bundle_files(
    *,
    qa_pairs: Sequence[QaPairRow],
    source_documents: Sequence[SourceDocumentRow],
    generated_at: datetime,
    stale_after_days: int = _DEFAULT_STALE_AFTER_DAYS,
    existing_log_bytes: bytes | None = None,
    bundle_title: str = _BUNDLE_TITLE,
) -> dict[str, bytes]:
    """Pure core: rows in, `{bundle-relative path: file bytes}` out.

    Applies the DR-143 publication filter to both row sets before any
    grouping or citation happens — an unpublished `q_a_pair` never reaches a
    concept, and an unpublished (or fixture-absent) `source_documents` row is
    never cited, even by a published pair that names it via
    `source_document_id`.
    """
    published_pairs = filter_published(qa_pairs)
    published_sources = filter_published_source_documents(source_documents)
    groups = group_by_topic(published_pairs)

    files: dict[str, bytes] = {}
    topic_entries: list[index.IndexEntry] = []

    for tag in sorted(groups):
        slug = slugify_tag(tag)
        concept_id = ("topics", slug)
        group_pairs = groups[tag]

        qa_for_concept = [
            document.QaPairForConcept(
                question=p.question_text,
                answer_standard=p.answer_standard,
                answer_advanced=p.answer_advanced,
                source_document_id=p.source_document_id,
            )
            for p in group_pairs
        ]
        source_refs = {
            sid: resolve_source_document_ref(published_sources[sid])
            for p in group_pairs
            if (sid := p.source_document_id) and sid in published_sources
        }

        doc = document.build_topic_concept(
            tag=tag,
            concept_id=concept_id,
            pairs=qa_for_concept,
            source_documents=source_refs,
            generated_at=generated_at,
            stale_after_days=stale_after_days,
        )
        rel_path = paths.concept_id_to_rel_path(concept_id)
        files[rel_path] = frontmatter.serialize(doc).encode("utf-8")
        topic_entries.append(
            index.IndexEntry(
                title=str(doc.data["title"]),
                rel_link=f"{slug}.md",
                description=str(doc.data["description"]),
            )
        )

    root_subdirs: list[index.IndexEntry] = []
    if topic_entries:
        files["topics/index.md"] = index.render_type_index(
            "Topic", topic_entries
        ).encode("utf-8")
        root_subdirs.append(
            index.IndexEntry(
                title="topics",
                rel_link="topics/index.md",
                description=f"{len(topic_entries)} topic concept(s).",
            )
        )

    files["index.md"] = index.render_root_index(root_subdirs).encode("utf-8")
    files["log.md"] = index.seed_log_if_absent(
        existing_log_bytes, bundle_title=bundle_title, today=generated_at.date()
    )

    return files


# ---------------------------------------------------------------------------
# cocoindex wiring — engine-dependent, not exercised by unit tests.
# ---------------------------------------------------------------------------

try:
    import asyncpg
    import cocoindex as coco
    from cocoindex.connectors import localfs, postgres
except ImportError:  # pragma: no cover - deps are planned but optional here
    coco = None  # type: ignore[assignment]


if coco is not None:
    PG_DB = coco.ContextKey[asyncpg.Pool]("pg_db")
    BUNDLE_ROOT = coco.ContextKey[Path]("bundle_root")
    STALE_AFTER_DAYS = coco.ContextKey[int]("stale_after_days", detect_change=True)

    @coco.lifespan
    async def coco_lifespan(builder: coco.EnvironmentBuilder):
        pool = await asyncpg.create_pool(os.environ["PRODUCE_DATABASE_URL"])
        try:
            builder.provide(PG_DB, pool)
            builder.provide(
                BUNDLE_ROOT, Path(os.environ.get("PRODUCE_BUNDLE_ROOT", "./bundle"))
            )
            builder.provide(
                STALE_AFTER_DAYS,
                int(
                    os.environ.get(
                        "PRODUCE_STALE_AFTER_DAYS", str(_DEFAULT_STALE_AFTER_DAYS)
                    )
                ),
            )
            yield
        finally:
            await pool.close()

    @coco.fn
    async def app_main() -> None:
        pool = coco.use_context(PG_DB)
        bundle_root = coco.use_context(BUNDLE_ROOT)
        stale_after_days = coco.use_context(STALE_AFTER_DAYS)

        qa_source = postgres.PgTableSource(
            pool, table_name="q_a_pairs", row_type=QaPairRow
        )
        sd_source = postgres.PgTableSource(
            pool, table_name="source_documents", row_type=SourceDocumentRow
        )
        qa_rows = [row async for row in qa_source.fetch_rows()]
        sd_rows = [row async for row in sd_source.fetch_rows()]

        existing_log_path = bundle_root / "log.md"
        existing_log_bytes = (
            existing_log_path.read_bytes() if existing_log_path.exists() else None
        )

        files = build_bundle_files(
            qa_pairs=qa_rows,
            source_documents=sd_rows,
            generated_at=datetime.now(timezone.utc),
            stale_after_days=stale_after_days,
            existing_log_bytes=existing_log_bytes,
        )

        dir_target = await localfs.mount_dir_target(bundle_root)
        for rel_path, content in files.items():
            dir_target.declare_file(rel_path, content, create_parent_dirs=True)

    app = coco.App(coco.AppConfig(name="OkfBundleProducer"), app_main)

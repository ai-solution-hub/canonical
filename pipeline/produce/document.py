"""Concept-file model — grain-agnostic OKF v0.2 concept rendering.

`build_concept()` is the one generic primitive: given already-resolved data
(title, description, tags, citable sources, Q&A content) it produces a
`frontmatter.FrontmatterDoc`. It knows nothing about SQL, grains, or Postgres.

`build_topic_concept()` is a thin, single-grain convenience wrapper used by
`main.py`'s `topic` (scope_tag) grain for phase 1 — see
`specs/id-465-pipeline-rebase/notes/w3-produce-plan.md` §Ambiguities item 2 for
why the other grains (product/certification/company/case_study) are not
implemented this wave.

No LLM calls here (phase-1 scope call, plan note item 6): concept bodies are a
mechanical Q&A listing, not synthesized prose.

Citation identity: `build_canonical_uri` / `build_q_a_pairs_scope_tag_uri`
implement the frozen `canonical://` scheme from
`initiatives/.../okf-platform/canonical-resolution.md` — the per-row citable
set is restricted to `{source_documents, reference_items}`; `q_a_pairs` is
DB-internal and citable only by the `?scope_tag=`/`?domain=&subtopic=` query
form, never a per-row uuid.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Mapping, Sequence

from pipeline.produce import paths
from pipeline.produce.frontmatter import FrontmatterDoc

_PER_ROW_CITABLE_TABLES = frozenset({"source_documents", "reference_items"})


class CitationError(ValueError):
    """Raised when a caller asks for a citation form the scheme forbids."""


def build_canonical_uri(table: str, row_id: str) -> str:
    """`canonical://<table>/<row_id>` — restricted to the per-row citable set.

    `q_a_pairs` deliberately has no per-row form (it stays DB-internal, cited
    only via `build_q_a_pairs_scope_tag_uri`); any other table name is
    similarly refused rather than silently minting a pointer nothing resolves.
    """
    if table not in _PER_ROW_CITABLE_TABLES:
        raise CitationError(
            f"canonical:// per-row citation is restricted to "
            f"{sorted(_PER_ROW_CITABLE_TABLES)}, got {table!r}"
        )
    return f"canonical://{table}/{row_id}"


def build_q_a_pairs_scope_tag_uri(scope_tag: str) -> str:
    """`canonical://q_a_pairs?scope_tag=<tag>` — the query form (BI-8)."""
    return f"canonical://q_a_pairs?scope_tag={scope_tag}"


@dataclass(frozen=True)
class SourceCitation:
    """One `sources[]` frontmatter entry (OKF v0.2 SPEC §5.1)."""

    id: str
    resource: str
    title: str | None = None
    author: str | None = None
    last_modified: str | None = None  # YYYY-MM-DD

    def to_mapping(self) -> dict[str, Any]:
        out: dict[str, Any] = {"id": self.id, "resource": self.resource}
        if self.title:
            out["title"] = self.title
        if self.author:
            out["author"] = self.author
        if self.last_modified:
            out["last_modified"] = self.last_modified
        return out


@dataclass(frozen=True)
class QaEntry:
    """One published Q&A pair rendered into a concept's body."""

    question: str
    answer_standard: str
    answer_advanced: str | None = None


@dataclass(frozen=True)
class ConceptDraft:
    """Fully-resolved input to `build_concept` — no SQL, no grain knowledge."""

    concept_id: paths.ConceptId
    type: str
    title: str
    description: str
    tags: Sequence[str] = field(default_factory=tuple)
    sources: Sequence[SourceCitation] = field(default_factory=tuple)
    qa_entries: Sequence[QaEntry] = field(default_factory=tuple)


def _iso_utc(dt: datetime) -> str:
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _dedupe_sources(sources: Sequence[SourceCitation]) -> list[SourceCitation]:
    seen: dict[str, SourceCitation] = {}
    for src in sources:
        seen.setdefault(src.id, src)
    return list(seen.values())


def _render_qa_section(entries: Sequence[QaEntry]) -> str:
    lines = ["# Q&A", ""]
    for entry in entries:
        lines.append(f"## {entry.question}")
        lines.append("")
        lines.append(entry.answer_standard)
        if entry.answer_advanced:
            lines.append("")
            lines.append(f"**Additional detail:** {entry.answer_advanced}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _render_trust_and_freshness(*, pair_count: int, stale_after: date) -> str:
    plural = "" if pair_count == 1 else "s"
    return (
        "# Trust and freshness\n\n"
        f"- **Status:** draft — machine-generated from {pair_count} published "
        f"Q&A pair{plural}, not yet human-reviewed.\n"
        f"- **Stale after {stale_after.isoformat()}:** re-generate or review "
        "this concept after this date.\n"
    )


def build_concept(
    draft: ConceptDraft,
    *,
    generated_at: datetime,
    stale_after_days: int,
) -> FrontmatterDoc:
    """Render a `ConceptDraft` into a `FrontmatterDoc` (OKF v0.2 concept file).

    `stale_after` uses `generated_at + stale_after_days` as its only available
    honest default — no per-concept staleness policy exists yet (plan note
    §Ambiguities item 3, marked OWNER-REVIEW).
    """
    sources = _dedupe_sources(draft.sources)
    stale_after = generated_at.date() + timedelta(days=stale_after_days)

    frontmatter: dict[str, Any] = {
        "type": draft.type,
        "title": draft.title,
        "description": draft.description,
    }
    if draft.tags:
        frontmatter["tags"] = list(draft.tags)
    frontmatter["generated"] = {
        "by": "process:pipeline-produce",
        "at": _iso_utc(generated_at),
    }
    frontmatter["status"] = "draft"
    frontmatter["stale_after"] = stale_after.isoformat()
    if sources:
        frontmatter["sources"] = [src.to_mapping() for src in sources]

    body = _render_qa_section(draft.qa_entries)
    body += "\n" + _render_trust_and_freshness(
        pair_count=len(draft.qa_entries), stale_after=stale_after
    )

    return FrontmatterDoc(data=frontmatter, body=body)


# ---------------------------------------------------------------------------
# The `topic` grain (scope_tag) — phase-1's only grain. See module docstring.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class QaPairForConcept:
    """One published `q_a_pairs` row contributing to a concept.

    `source_document_id` is the value STORED on the row (id-59
    `q_a_pairs.source_document_id`) — never re-derived. Callers filter it to
    `None` before constructing this when the referenced `source_documents`
    row is unpublished or absent (DR-143); this module trusts what it is
    handed and does not re-check publication itself.
    """

    question: str
    answer_standard: str
    source_document_id: str | None = None
    answer_advanced: str | None = None


@dataclass(frozen=True)
class SourceDocumentRef:
    """A published `source_documents` row's citable, source-shaped facts.

    `title`/`last_modified` are populated only when honestly known from the
    register row itself (DR-151 fold); `author` is not derivable from
    `source_documents` today (DR-151) and stays `None`.
    """

    id: str
    title: str | None = None
    last_modified: str | None = None
    author: str | None = None


def _humanize_tag(tag: str) -> str:
    return " ".join(part.capitalize() for part in tag.replace("_", "-").split("-") if part)


def build_topic_concept(
    *,
    tag: str,
    concept_id: paths.ConceptId,
    pairs: Sequence[QaPairForConcept],
    source_documents: Mapping[str, SourceDocumentRef],
    generated_at: datetime,
    stale_after_days: int,
) -> FrontmatterDoc:
    """Build a `topic` concept from the published pairs sharing `tag`.

    `source_documents` maps `id -> SourceDocumentRef` for exactly the
    published source_documents rows the caller has resolved as citable; a
    pair whose `source_document_id` is `None` or missing from this mapping
    contributes no per-row citation — it is still covered by the concept
    (its Q&A content is included) and by the query-form `sources` entry, but
    degrades gracefully rather than citing an unpublished or unknown row
    (DR-143).
    """
    sources = [
        SourceCitation(
            id=f"qa-{tag}",
            resource=build_q_a_pairs_scope_tag_uri(tag),
            title=f"Published Q&A pairs tagged '{tag}'",
        )
    ]
    for pair in pairs:
        ref = (
            source_documents.get(pair.source_document_id)
            if pair.source_document_id
            else None
        )
        if ref is None:
            continue
        sources.append(
            SourceCitation(
                id=f"sd-{ref.id[:8]}",
                resource=build_canonical_uri("source_documents", ref.id),
                title=ref.title,
                author=ref.author,
                last_modified=ref.last_modified,
            )
        )

    draft = ConceptDraft(
        concept_id=concept_id,
        type="Topic",
        title=_humanize_tag(tag),
        description=(
            f"{len(pairs)} published Q&A pair{'' if len(pairs) == 1 else 's'} "
            f"tagged `{tag}`."
        ),
        tags=[tag],
        sources=sources,
        qa_entries=[
            QaEntry(
                question=p.question,
                answer_standard=p.answer_standard,
                answer_advanced=p.answer_advanced,
            )
            for p in pairs
        ],
    )
    return build_concept(
        draft, generated_at=generated_at, stale_after_days=stale_after_days
    )

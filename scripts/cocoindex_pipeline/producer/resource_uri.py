"""`canonical://` resource-URI builder — BI-6/BI-7/BI-8/BI-9/BI-10 (ID-132 {132.6}
G-PASS1a).

The bundle-writer + frontmatter emitter's ONLY sanctioned way to mint a
Canonical record pointer. Per PRODUCT.md §B (id-132-okf-concept-producer) +
TECH.md §"Proposed changes per invariant":

- **BI-6** — `canonical://<table>/<uuid>` is a stable, OPAQUE, vendor-
  namespaced POINTER VALUE, never an identity key. Only
  `{source_documents, reference_items}` ever appear in the per-row uuid
  form (`build_per_row_uri` / `build_source_document_uri` /
  `build_reference_item_uri`) — attempting any other table (notably
  `q_a_pairs`) raises `ValueError`.
- **BI-7** — every record uuid a bundle cites is a DETERMINISTIC
  seed-contract `uuid5`: `uuid5(_KH_PIPELINE_DOC_NS, "sd:"+rel_path)` for a
  `source_document`, `uuid5(…, "ri:"+source_url)` for a `reference_item`
  (`derive_source_document_id` / `derive_reference_item_id`, mirroring
  `flow.py:1994` / `flow.py:3869-3870`). The `q_a_pairs` table's PK is an
  OPAQUE, re-minting `gen_random_uuid()` master — it would orphan on a
  full-replace rebuild, so it is NEVER read or emitted here; there is no
  function in this module whose signature accepts a `q_a_pairs` row id.
- **BI-8** — the Q&A corpus is referenced only via the table/query form
  `canonical://q_a_pairs?scope_tag=<tag>` (or `?domain=&subtopic=`),
  never a row uuid (`build_q_a_pairs_query_uri`).
- **BI-9** — concept→concept cross-references cite the concept's bundle
  rel_path (matching ID-131's `citations.cited_concept_path text`), never a
  uuid (`concept_citation_path`).
- **BI-10** — the `resource:` frontmatter field + the `# Citations` body are
  the ONLY ingress of a Canonical uuid into the client-owned bundle.
  `contains_record_pointer` is the shared guard the frontmatter emitter
  (`producer/frontmatter.py`) uses to prove no OTHER field smuggles one in.

**Pure builder — no runtime DB dependency.** `build_*`/`concept_citation_path`
take already-resolved ids/paths as plain inputs and are buildable against
fixtures alone. `derive_source_document_id` / `derive_reference_item_id`
additionally need the seed-contract namespace constant `_KH_PIPELINE_DOC_NS`
(`flow.py:1708` = `fbfaf1ff-1ee4-583c-9757-1674465b2ec1`) — imported/reused,
never redeclared, via a LAZY function-local import (mirrors `server.py`'s
`_build_dsn` lazy import) because `flow.py` eagerly imports `cocoindex` +
`asyncpg` + `aiohttp` + `httpx` at module scope; a module-level import here
would drag all of that into every caller of this pure-builder module and
break the collection-safety property `_coco_api.py` documents.
"""

from __future__ import annotations

import re
import uuid

_SCHEME = "canonical://"

TABLE_SOURCE_DOCUMENTS = "source_documents"
TABLE_REFERENCE_ITEMS = "reference_items"
TABLE_Q_A_PAIRS = "q_a_pairs"

# BI-6: the ONLY tables allowed in the per-row `canonical://<table>/<uuid>`
# anchor form. `q_a_pairs` is deliberately absent — BI-7/BI-8 route it
# through `build_q_a_pairs_query_uri` instead.
_PER_ROW_ANCHOR_TABLES = frozenset({TABLE_SOURCE_DOCUMENTS, TABLE_REFERENCE_ITEMS})

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_EMBEDDED_UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


def _seed_contract_namespace() -> uuid.UUID:
    """Return `_KH_PIPELINE_DOC_NS` via a lazy, function-local import.

    Reuses the single frozen SEED-CONTRACT constant (`flow.py:1708`) rather
    than redeclaring the literal — but importing `flow` eagerly at module
    scope would pull in `cocoindex`/`asyncpg`/`aiohttp`/`httpx`, breaking this
    module's pure-builder/collection-safety posture. `server.py`'s
    `_build_dsn` lazy import is the precedent for this pattern.
    """
    from scripts.cocoindex_pipeline.flow import _KH_PIPELINE_DOC_NS

    return _KH_PIPELINE_DOC_NS


def derive_source_document_id(rel_path: str) -> uuid.UUID:
    """BI-7: the deterministic seed-contract id for a `source_documents` row.

    Mirrors `flow.py:1994` (`uuid.uuid5(_KH_PIPELINE_DOC_NS, f"sd:{rel_path}")`)
    exactly — same namespace, same `"sd:"` prefix, same field.
    """
    if not rel_path:
        raise ValueError("rel_path must be non-empty (BI-7)")
    return uuid.uuid5(_seed_contract_namespace(), f"sd:{rel_path}")


def derive_reference_item_id(source_url: str) -> uuid.UUID:
    """BI-7: the deterministic seed-contract id for a `reference_items` row.

    Mirrors `flow.py:3870`
    (`uuid.uuid5(_KH_PIPELINE_DOC_NS, f"ri:{item.url}")`) exactly — same
    namespace, same `"ri:"` prefix, same field.
    """
    if not source_url:
        raise ValueError("source_url must be non-empty (BI-7)")
    return uuid.uuid5(_seed_contract_namespace(), f"ri:{source_url}")


def build_per_row_uri(table: str, record_id: "uuid.UUID | str") -> str:
    """BI-6: `canonical://<table>/<uuid>` for a per-row record anchor.

    Raises `ValueError` for any table outside `{source_documents,
    reference_items}` — this is the structural guarantee that the opaque,
    re-minting `q_a_pairs.gen_random_uuid()` master is never emitted in the
    per-row form (BI-7): there is no valid `table` argument that produces it.
    """
    if table not in _PER_ROW_ANCHOR_TABLES:
        raise ValueError(
            "canonical:// per-row anchors are only valid for "
            f"{sorted(_PER_ROW_ANCHOR_TABLES)} (BI-6); got table={table!r}. "
            "The q_a_pairs corpus MUST use build_q_a_pairs_query_uri (BI-8) — "
            "its gen_random_uuid() PK is never bundle-cited (BI-7)."
        )
    try:
        parsed = (
            record_id if isinstance(record_id, uuid.UUID) else uuid.UUID(str(record_id))
        )
    except (ValueError, AttributeError, TypeError) as exc:
        raise ValueError(f"record_id must be a valid uuid, got {record_id!r}") from exc
    return f"{_SCHEME}{table}/{parsed}"


def build_source_document_uri(record_id: "uuid.UUID | str") -> str:
    """BI-6: `canonical://source_documents/<uuid>`."""
    return build_per_row_uri(TABLE_SOURCE_DOCUMENTS, record_id)


def build_reference_item_uri(record_id: "uuid.UUID | str") -> str:
    """BI-6: `canonical://reference_items/<uuid>`."""
    return build_per_row_uri(TABLE_REFERENCE_ITEMS, record_id)


def source_document_uri_from_rel_path(rel_path: str) -> str:
    """BI-6 + BI-7 composed: derive the seed-contract id from `rel_path` and
    build its `canonical://source_documents/<uuid>` anchor in one call."""
    return build_source_document_uri(derive_source_document_id(rel_path))


def reference_item_uri_from_source_url(source_url: str) -> str:
    """BI-6 + BI-7 composed: derive the seed-contract id from `source_url`
    and build its `canonical://reference_items/<uuid>` anchor in one call."""
    return build_reference_item_uri(derive_reference_item_id(source_url))


def build_q_a_pairs_query_uri(
    *,
    scope_tag: "str | None" = None,
    domain: "str | None" = None,
    subtopic: "str | None" = None,
) -> str:
    """BI-8: the Q&A corpus table/query resource form.

    `canonical://q_a_pairs?scope_tag=<tag>` OR
    `canonical://q_a_pairs?domain=<domain>&subtopic=<subtopic>` — NEVER a row
    uuid. There is deliberately no `record_id`/`uuid` parameter on this
    function: the q_a_pairs `gen_random_uuid()` master cannot be passed to it
    even by caller error (BI-7).
    """
    if scope_tag is not None:
        if domain is not None or subtopic is not None:
            raise ValueError(
                "scope_tag is mutually exclusive with domain/subtopic (BI-8)"
            )
        if not scope_tag:
            raise ValueError("scope_tag must be non-empty (BI-8)")
        query = f"scope_tag={scope_tag}"
    else:
        if not domain or not subtopic:
            raise ValueError(
                "either scope_tag, or both domain and subtopic, are required (BI-8)"
            )
        query = f"domain={domain}&subtopic={subtopic}"
    return f"{_SCHEME}{TABLE_Q_A_PAIRS}?{query}"


def concept_citation_path(rel_path: str) -> str:
    """BI-9: a concept→concept cross-reference cites the target concept's
    bundle rel_path — matching ID-131's `citations.cited_concept_path text`
    column — never a uuid and never a `canonical://` pointer.
    """
    if not rel_path or not rel_path.strip():
        raise ValueError("concept citation rel_path must be non-empty (BI-9)")
    if rel_path.startswith(_SCHEME):
        raise ValueError(
            "concept→concept citations use the bundle rel_path, never a "
            f"canonical:// uri (BI-9); got {rel_path!r}"
        )
    if _UUID_RE.match(rel_path):
        raise ValueError(
            "concept→concept citations use the bundle rel_path, never a "
            f"bare uuid (BI-9); got {rel_path!r}"
        )
    return rel_path


def is_canonical_resource_uri(value: str) -> bool:
    """True iff `value` is a `canonical://` pointer (BI-6 scheme prefix)."""
    return isinstance(value, str) and value.startswith(_SCHEME)


# ── OKF §8 numbered-link citation entries (SPEC v0.1 conformance) ─────────
#
# The on-disk `# Citations` trailer entry form is `[n] [label](target)` —
# a numbered, REAL markdown link (SPEC §5.1/§8), where `target` is either a
# `canonical://` record anchor or a bundle-ABSOLUTE concept path with a
# leading `/` (`/certifications/iso-9001.md`). The LEGACY form (bare-path
# `- <target>` bullets, the pre-conformance shipped-bundle format) must
# still parse — prior committed bundles carry it — so every citation
# consumer normalises an entry to its TARGET via `citation_target` before
# comparing, and leading `/` is stripped so targets compare against
# identity rel_paths.

# Optional `[n] ` ordinal prefix on a trailer line.
_CITATION_ORDINAL_PREFIX_RE = re.compile(r"^\[\d+\]\s+")
# A whole-string markdown link `[label](target)` — label greedy so a label
# containing brackets still parses up to the LAST `](`; targets are
# rel_paths / canonical:// uris (never contain whitespace or parens).
_CITATION_MD_LINK_RE = re.compile(r"^\[(?P<label>.+)\]\((?P<target>[^()\s]+)\)$")


def parse_citation_entry(entry: str) -> "tuple[str | None, str]":
    """Parse ONE citation entry string — any accepted form — into
    `(label, target)`.

    Accepted forms (all normalise to the same target):
      - `[n] [label](target)` — the §8 numbered-link trailer line;
      - `[label](target)` — a bare markdown link (no ordinal);
      - `target` — the legacy bare form (label is `None`).

    A `/`-leading target (the §5.1 bundle-absolute concept-path form) is
    stripped of its leading `/` so the returned target is directly
    comparable to identity rel_paths (`certifications/iso-9001.md`);
    `canonical://` targets pass through untouched.
    """
    text = entry.strip()
    text = _CITATION_ORDINAL_PREFIX_RE.sub("", text, count=1)
    match = _CITATION_MD_LINK_RE.match(text)
    if match:
        label: "str | None" = match.group("label")
        target = match.group("target")
    else:
        label = None
        target = text
    if target.startswith("/") and not target.startswith(_SCHEME):
        target = target.lstrip("/")
    return label, target


def citation_target(entry: str) -> str:
    """The normalised citation TARGET of `entry` in any accepted form —
    `parse_citation_entry`'s target half. The single comparison key every
    citation consumer (`_validate_citation`, `_citation_entries`,
    `detect_citation_shrink`, the git-sync shrink guard) uses, so legacy
    bare-path entries and §8 numbered-link entries never falsely diverge."""
    return parse_citation_entry(entry)[1]


def contains_record_pointer(text: str) -> bool:
    """BI-10 guard: True if `text` embeds a `canonical://` uri or a bare
    uuid anywhere in it.

    Used by the frontmatter emitter (`producer/frontmatter.py`) — and, later,
    the BI-13 validator — to prove that ONLY the `resource:` field and the
    `# Citations` body carry a Canonical record uuid; no other frontmatter
    key or body prose may smuggle one in.
    """
    if not text:
        return False
    return _SCHEME in text or bool(_EMBEDDED_UUID_RE.search(text))


# ── PC-5 (ID-163 TECH, DR-086): the git-blob/doc-page citation scheme ─────
#
# The `system_baseline` bundle's concepts have no DB row, so they cannot
# cite a `canonical://` anchor — but the BI-17 provenance DISCIPLINE ("every
# citation is real, minted from a backing artefact this run actually read")
# carries over unchanged, generalised to a second, additive anchor scheme:
# a git-pinned PUBLIC blob URL (DR-086 — the `canonical` repo IS public and
# is the citation base directly; no mirror, no private-docs-site
# indirection — a private URL is never a citation, S3 hard rule).
# `sources/repo_docs.py:RepoDocsSource.read_concept` is the sole mint site
# for this scheme (one anchor per backing artefact READ) — the exact
# analogue of `_mint`'s per-row `canonical://` mint above.
# `producer/enrich.py:_validate_citation` / `producer/web_pass.py:
# _validate_pass2_citation` accept it as an ADDITIVE branch keyed on
# `is_git_blob_citation`, alongside (never replacing) the `canonical://`
# branch — `producer/web_pass.py:_validate_reference_concept_citations`
# (DR-025) is deliberately UNCHANGED: a reference concept exists
# specifically to carry gated-fetch `reference_items` provenance, a
# different concern from a repo git-blob citation.

PUBLIC_CANONICAL_BLOB_BASE = "https://github.com/ai-solution-hub/canonical/blob"
"""S3/DR-086: the ONLY public host a `system_baseline` citation may be
pinned to. The private docs-site — and every bundle repo, platform-owned or
client-owned, all of which are private per DR-086 — is NEVER a mint source.
`is_git_blob_citation` recognises ONLY this prefix, so a private URL simply
does not match: rejected by construction, not by an explicit denylist."""


def build_git_blob_citation(
    git_blob_sha: str,
    path: str,
    *,
    line_start: "int | None" = None,
    line_end: "int | None" = None,
) -> str:
    """PC-5: the git-pinned public blob citation for one backing artefact —
    `<PUBLIC_CANONICAL_BLOB_BASE>/<git_blob_sha>/<path>` for the E2
    doc-page grain (a whole file, no line range), or with a trailing
    `#L<line_start>-L<line_end>` fragment for the E1 code-symbol grain (a
    matched span within the file). `line_start`/`line_end` must both be set
    or both omitted — a partial range is a caller bug, not a valid citation
    shape.

    `git_blob_sha` is the SAME per-artefact change signal
    `RepoConceptKey.git_blob_sha` already carries (S4, file-grained) — this
    function does not compute a new hash, only formats the existing one
    into the citation URL (no per-span synthetic hash; an owner ruling on
    finer S4 granularity is queued separately, out of this Subtask's
    scope).
    """
    if not git_blob_sha:
        raise ValueError(
            "build_git_blob_citation: git_blob_sha must be non-empty — an "
            "artefact absent at HEAD (empty git_blob_sha) cannot be pinned "
            "to a resolvable public blob URL and must not be cited (PC-5)"
        )
    if not path:
        raise ValueError("build_git_blob_citation: path must be non-empty (PC-5)")
    base = f"{PUBLIC_CANONICAL_BLOB_BASE}/{git_blob_sha}/{path}"
    if line_start is None and line_end is None:
        return base
    if line_start is None or line_end is None:
        raise ValueError(
            "build_git_blob_citation: line_start and line_end must both be "
            f"set or both omitted; got line_start={line_start!r}, "
            f"line_end={line_end!r}"
        )
    return f"{base}#L{line_start}-L{line_end}"


def is_git_blob_citation(value: str) -> bool:
    """True iff `value` is a PC-5 git-blob/doc-page citation pinned to the
    PUBLIC canonical repo (S3/DR-086) — the `system_baseline` bundle's
    citation-anchor scheme, additive alongside `is_canonical_resource_uri`'s
    `canonical://` BI-6 scheme. Any other host — including the PRIVATE
    docs-site or any bundle repo — is rejected by construction: it simply
    does not start with `PUBLIC_CANONICAL_BLOB_BASE`."""
    return isinstance(value, str) and value.startswith(f"{PUBLIC_CANONICAL_BLOB_BASE}/")

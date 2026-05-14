"""Stub — full flow lands per `docs/specs/wp6-ontology-harness/TECH.md` §8 cocoindex flow plan.

Typed cocoindex flow stub for the future automated markdown→DB sync.
NOT executed in CI or dev this session. Demonstrates the layered fn-shape
ratified by the WP7 S9 spike so future drift is caught by code review.

Layered fn-shape:
  process_ontology_file(file: FileLike) -> ParsedCV     # outer / file-tier memo
      ├── parse_cv_frontmatter(content_text: str)        # inner / content-tier memo
      └── validate_cv_against_yaml(content_text: str, expected_keys: list[str])

Inner extraction fns MUST consume `content_text: str` (NOT `FileLike`) so
their memoisation key is the file *contents*, not the file *handle*. This
preserves cocoindex's per-tier idempotency: edits to host-file metadata
(mtime, owner, etc.) do not re-trigger inner extraction work.

References (sourced in module docstring rather than runtime imports so the
file is safe to read in environments without cocoindex installed):
- `docs/plans/phase-0-investigation/0.9-spike-S9-cocoindex-idempotency.md` §7.2
  (layered fn-shape rationale).
- `CLAUDE.md` Gotcha — "cocoindex 1.0.3 requires `dangerouslyDisableSandbox: true`"
  for both PyPI install and Rust-engine LMDB startup in dev.
- `docs/plans/phase-0-investigation/phase-b-prerequisite-1-onthology-pipeline.md`
  §6 Phase 1 (build-sequence reference).

Dependencies (declared here, NOT imported at module level so accidental
invocation in a sandboxed env does not blow up):
- cocoindex>=1.0.3
- pyyaml

Credential surface: NONE in this stub. When the future live flow lands, DB
credentials read from `.env.local` per the canonical KH pattern
(`POSTGRES_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`); explicit env-var names
get documented in the live-flow spec, not here. version=N bumps for cascade
invalidation NOT shown here; defer to live wiring per S9 §7.2.
"""

from __future__ import annotations

from dataclasses import dataclass


# ---------------------------------------------------------------------------
# Output shape — what the live flow will materialise per CV file.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ParsedCV:
    """Parsed and validated representation of one ontology CV file.

    Pydantic / dataclass shape; the live flow will swap to a Pydantic
    BaseModel for cocoindex DB write coupling.
    """

    cv_name: str
    layer: int
    provenance_model: str
    client_extensible: bool
    editable_via: str
    core_seed_path: str | None
    status: str
    baseline_values: tuple[dict[str, str], ...]
    related_layers: tuple[int, ...]


@dataclass(frozen=True)
class ValidationReport:
    """Pure-Python YAML-shape check outcome."""

    cv_name: str
    ok: bool
    missing_keys: tuple[str, ...]
    extra_keys: tuple[str, ...]


# ---------------------------------------------------------------------------
# Layered fn-shape — NOT decorated with @coco.fn here (cocoindex import
# deferred to the live wiring); shapes match S9 §7.2.
# ---------------------------------------------------------------------------


def process_ontology_file(file):  # type: ignore[no-untyped-def]
    """OUTER fn — file-tier memo. Re-runs when the file's bytes change.

    Reads one markdown file via FileLike (cocoindex's `localfs.walk_dir`
    yields FileLike entries). Splits into frontmatter + body, then delegates
    parse + validate to inner content-tier fns so metadata edits to the
    host file do not re-trigger inner work.

    NOT IMPLEMENTED — see module docstring.
    """
    raise NotImplementedError(
        "ontology-sync stub — see docs/specs/wp6-ontology-harness/TECH.md §8"
    )


def parse_cv_frontmatter(content_text: str) -> dict:
    """INNER fn — content-tier memo. Re-runs only when the frontmatter
    body (not the wrapping file) changes.

    NOTE the signature: `content_text: str`, NOT `file: FileLike`. This is
    the load-bearing S9 §7.2 finding — inner extraction fns must memoise on
    content bytes, not file handles.

    NOT IMPLEMENTED — see module docstring.
    """
    raise NotImplementedError(
        "ontology-sync stub — see docs/specs/wp6-ontology-harness/TECH.md §8"
    )


def validate_cv_against_yaml(
    content_text: str,
    expected_keys: list[str],
) -> ValidationReport:
    """INNER fn — content-tier memo. Pure-Python YAML-shape check.

    Deliberately NOT a `validate_cv_against_db` shape — DB validation
    requires explicit credential wiring (env vars, target table,
    migration design) that this slice defers. A future engineer who
    lifts this stub into a live flow adds the DB-tier validation at
    that point with explicit credential sourcing.

    NOT IMPLEMENTED — see module docstring.
    """
    raise NotImplementedError(
        "ontology-sync stub — see docs/specs/wp6-ontology-harness/TECH.md §8"
    )


# ---------------------------------------------------------------------------
# Module-level App declaration placeholder. No coco.start(...) call. No
# DB writes. No DB reads.
# ---------------------------------------------------------------------------

# When wired live:
#   import cocoindex as coco
#   ontology_sync_app = coco.App(name="ontology-sync")
#
# Today: ontology_sync_app is intentionally absent. Reading this file does
# not import cocoindex (which requires `dangerouslyDisableSandbox: true`
# for both PyPI install and Rust-engine LMDB startup in dev).


if __name__ == "__main__":
    print("ontology-sync stub — not implemented")

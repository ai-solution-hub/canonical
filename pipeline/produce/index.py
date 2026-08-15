"""S564 index/log format — root index, per-type index, log.md seed/preserve.

Deliberately diverges from the OKF `reference_agent/bundle/index.py` baseline
in two S564-mandated ways (owner, verbatim requirements):

- the bundle-root `index.md` carries exactly one heading, `# Subdirectories`
  — not the reference baseline's type-grouped root index;
- a per-type directory index (e.g. `topics/index.md`) heads with the type
  label directly (`# Topic`) and carries no `Concepts` subheading.

No LLM directory-description synthesis (the reference baseline's
`synthesizer.py` is not ported) — descriptions are mechanical.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class IndexEntry:
    """One `index.md` bullet: a concept file or a subdirectory."""

    title: str
    rel_link: str
    description: str = ""


def _render_list(heading: str, entries: Sequence[IndexEntry]) -> str:
    lines = [f"# {heading}", ""]
    for entry in sorted(entries, key=lambda e: e.title.lower()):
        suffix = f" - {entry.description}" if entry.description else ""
        lines.append(f"* [{entry.title}]({entry.rel_link}){suffix}")
    return "\n".join(lines) + "\n"


def render_root_index(subdirs: Sequence[IndexEntry]) -> str:
    """Bundle-root `index.md` — heading is always `Subdirectories` (S564)."""
    return _render_list("Subdirectories", subdirs)


def render_type_index(type_label: str, entries: Sequence[IndexEntry]) -> str:
    """A per-type directory `index.md` — heading is the type label itself,
    no `Concepts` subheading (S564)."""
    return _render_list(type_label, entries)


_LOG_SEED_TEMPLATE = """\
---
type: Log
title: {title}
---

# Bundle history

## {date}

- **Bootstrapped** by `process:pipeline-produce`.
"""


def seed_log_if_absent(
    existing: bytes | None, *, bundle_title: str, today: date
) -> bytes:
    """Return `log.md`'s bytes for this run.

    `log.md` is never programmatically updated (S564): once it exists,
    whatever is on disk is returned UNCHANGED. Only when it is entirely
    absent does this seed the acme_retail-style human-milestone bootstrap
    entry — once. `main.py` re-`declare_file`s the returned bytes every run
    regardless (the `localfs` dir target deletes anything not re-declared;
    see the module docstring in `main.py`), which is what makes "never
    touches it again" survive the engine's declarative dir-target model.
    """
    if existing is not None:
        return existing
    return _LOG_SEED_TEMPLATE.format(title=bundle_title, date=today.isoformat()).encode(
        "utf-8"
    )

"""OKF v0.2 frontmatter I/O — the sole parse/serialize seam (DR-144).

Every other module in `produce/` reads and writes concept and index files
through this module. It uses `ruamel.yaml` in round-trip mode (not
`yaml.safe_load`/`safe_dump`) so a parse -> serialize cycle over unmodified
data reproduces the source bytes exactly: key order, quoting, and block/flow
style are preserved rather than reformatted from scratch on every write. That
byte-faithfulness is what keeps re-runs of the producer from generating diff
noise on concept files whose underlying data has not changed (id-440's AC
class).

Known upstream limitation (ruamel.yaml 0.19.x, not a bug in this module):
inner whitespace padding on a flow mapping/sequence (`{ k: v }` vs `{k: v}`)
is normalized on re-emit rather than preserved byte-for-byte, even in
round-trip mode — block/flow STYLE choice and block-style formatting (key
order, comments, quoting) round-trip exactly; only that one padding detail
does not. This module's own writes never use padded flow style, so the
producer's own read-modify-write cycles are unaffected.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from io import StringIO
from typing import Any

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

_DELIM = "---"

_yaml = YAML(typ="rt")
_yaml.preserve_quotes = True
_yaml.width = 4096  # do not hard-wrap long lines back out from under us
# 2-space indent for nested mappings; sequence items indented 2 spaces with
# a further 2-space offset for the dash (matches the OKF exemplar bundles'
# `key:\n  - item` style and ruamel's own indent-preserving parse of it).
_yaml.indent(mapping=2, sequence=4, offset=2)


class FrontmatterError(ValueError):
    """Raised for a malformed or unterminated frontmatter block."""


@dataclass
class FrontmatterDoc:
    """A parsed OKF document: the frontmatter mapping plus the raw body.

    `data` is a `ruamel.yaml.comments.CommentedMap` (or a plain dict for a
    producer-constructed document that has never round-tripped through
    `parse`) so that a value parsed from an existing file keeps its
    formatting when re-serialized unchanged.
    """

    data: dict[str, Any] = field(default_factory=CommentedMap)
    body: str = ""


def parse(text: str) -> FrontmatterDoc:
    """Parse an OKF document's frontmatter + body.

    A file with no leading `---` block is treated as frontmatter-less (empty
    `data`, the whole text as `body`) — OKF permits `index.md`/`log.md` files
    with no frontmatter (SPEC §8, §9).
    """
    lines = text.splitlines()
    if not lines or lines[0].strip() != _DELIM:
        return FrontmatterDoc(data=CommentedMap(), body=text)

    end_idx = None
    for i in range(1, len(lines)):
        if lines[i].strip() == _DELIM:
            end_idx = i
            break
    if end_idx is None:
        raise FrontmatterError("Unterminated YAML frontmatter block")

    fm_text = "\n".join(lines[1:end_idx])
    try:
        data = _yaml.load(fm_text)
    except Exception as exc:  # ruamel raises its own YAMLError subclasses
        raise FrontmatterError(f"Invalid YAML in frontmatter: {exc}") from exc
    if data is None:
        data = CommentedMap()
    if not isinstance(data, dict):
        raise FrontmatterError("Frontmatter must be a YAML mapping")

    body = "\n".join(lines[end_idx + 1 :])
    if body.startswith("\n"):
        body = body[1:]
    return FrontmatterDoc(data=data, body=body)


def serialize(doc: FrontmatterDoc) -> str:
    """Serialize a `FrontmatterDoc` back to OKF document text.

    Data with no keys produces no frontmatter block at all (round-trips a
    frontmatter-less `parse()` result). Otherwise emits the standard
    `---\\n<yaml>\\n---\\n\\n<body>` shape, with the body guaranteed to end in
    exactly one trailing newline.
    """
    body = doc.body if doc.body.endswith("\n") else doc.body + "\n"
    if not doc.data:
        return body

    buf = StringIO()
    _yaml.dump(doc.data, buf)
    fm_text = buf.getvalue().rstrip("\n")
    return f"{_DELIM}\n{fm_text}\n{_DELIM}\n\n{body}"

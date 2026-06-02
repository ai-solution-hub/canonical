"""Guard: ban the bare `cocoindex_pipeline` top-level alias (ID-67.5 / bl-185).

`scripts/` is on the pytest pythonpath, so the pipeline package resolves under
BOTH the canonical `scripts.cocoindex_pipeline.*` spelling AND the bare top-level
alias `cocoindex_pipeline.*`. The bare alias creates a SECOND `sys.modules`
identity for the same physical files → double `coco.ContextKey` registration and
independent ContextVar storage (the ID-44.5 / ID-177 ContextKey-leak root cause).

ID-67 canonicalised the whole pipeline + test corpus onto
`scripts.cocoindex_pipeline.*`. The `pytest_collection_finish` hook in
`conftest.py` fails collection if any bare-alias key is resident — because every
test module is imported during collection, a FUTURE module-level bare-alias
import is caught fast. These tests exercise the pure predicate that hook calls
(`_bare_cocoindex_alias_keys`) deterministically, WITHOUT actually breaking real
collection.
"""

from conftest import _bare_cocoindex_alias_keys


class _Sentinel:
    """A trivial stand-in for a `sys.modules` value object."""


# A single shared object is enough — the predicate inspects keys, not values.
_OBJ = _Sentinel()


def test_canonical_and_unrelated_keys_are_not_flagged() -> None:
    """POSITIVE: canonical `scripts.cocoindex_pipeline.*` keys plus unrelated
    keys (`cocoindex`) are never flagged — the predicate returns an empty list."""
    modules = {
        "scripts.cocoindex_pipeline.flow": _OBJ,
        "scripts.cocoindex_pipeline": _OBJ,
        "cocoindex": _OBJ,
    }

    assert _bare_cocoindex_alias_keys(modules) == []


def test_bare_alias_keys_are_flagged() -> None:
    """NEGATIVE: the exact bare-alias keys are flagged while the canonical
    `scripts.cocoindex_pipeline.flow` key alongside them is left alone — proving
    the guard would FAIL collection on a deliberately-bare import."""
    modules = {
        "cocoindex_pipeline": _OBJ,
        "cocoindex_pipeline.flow": _OBJ,
        "scripts.cocoindex_pipeline.flow": _OBJ,
    }

    flagged = _bare_cocoindex_alias_keys(modules)

    # Order-insensitive: exactly the two bare-alias keys, nothing more.
    assert sorted(flagged) == ["cocoindex_pipeline", "cocoindex_pipeline.flow"]


def test_bare_top_level_package_alone_is_flagged() -> None:
    """The bare top-level package key (no submodule) is flagged on its own."""
    assert _bare_cocoindex_alias_keys({"cocoindex_pipeline": _OBJ}) == [
        "cocoindex_pipeline"
    ]


def test_empty_mapping_is_clean() -> None:
    """No modules → nothing flagged."""
    assert _bare_cocoindex_alias_keys({}) == []


def test_prefix_lookalike_is_not_flagged() -> None:
    """A key that merely CONTAINS the alias string but does not start with the
    bare prefix (e.g. the canonical `scripts.cocoindex_pipeline...`, or an
    unrelated `cocoindex_pipeline_extras` sibling package) is not flagged."""
    modules = {
        "scripts.cocoindex_pipeline.extraction": _OBJ,
        # Lookalike: shares the stem but is a distinct top-level name, not the
        # bare `cocoindex_pipeline` package nor a `cocoindex_pipeline.` submodule.
        "cocoindex_pipeline_extras": _OBJ,
    }

    assert _bare_cocoindex_alias_keys(modules) == []

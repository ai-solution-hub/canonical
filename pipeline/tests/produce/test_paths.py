from __future__ import annotations

from pathlib import Path

import pytest
from produce.paths import (
    concept_id_to_path,
    concept_id_to_rel_path,
    parse_concept_id,
    path_to_concept_id,
)


def test_concept_id_to_path():
    root = Path("/bundle")
    assert concept_id_to_path(root, ("topics", "data-protection")) == Path(
        "/bundle/topics/data-protection.md"
    )


def test_concept_id_to_rel_path():
    assert concept_id_to_rel_path(("topics", "data-protection")) == "topics/data-protection.md"


def test_round_trip_path_to_concept_id():
    root = Path("/bundle")
    concept_id = ("topics", "data-protection")
    path = concept_id_to_path(root, concept_id)
    assert path_to_concept_id(root, path) == concept_id


def test_root_level_concept_id():
    root = Path("/bundle")
    assert concept_id_to_path(root, ("index",)) == Path("/bundle/index.md")


def test_parse_concept_id():
    assert parse_concept_id("topics/data-protection") == ("topics", "data-protection")


def test_empty_concept_id_rejected():
    with pytest.raises(ValueError):
        concept_id_to_path(Path("/bundle"), ())
    with pytest.raises(ValueError):
        parse_concept_id("")


@pytest.mark.parametrize("bad_segment", ["../escape", "", "a/b", ".leading-dot"])
def test_invalid_segment_rejected(bad_segment):
    with pytest.raises(ValueError):
        concept_id_to_path(Path("/bundle"), (bad_segment,))

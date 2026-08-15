"""The binding gate assigns a retention class per source binding (R1/R2).

Contracts: corpus reframe R1 (sources are evidence streams with a
per-binding retention class), R2's LIGHT gate (connect a source, assign a
retention class — DR-020 restated by DR-025). DR-148's per-class survival
semantics are phase-scoped: the localfs walked corpus is `keep_and_watch`
(engine-owned declarative mention rows — exactly what `ingest` declares);
the `ingest_once` promotion-boundary path arrives with its connector, and
its survival semantics join this suite then.

Vocabulary spellings are the DB CHECK constraint's
(`source_documents_retention_class_check`, verified live on platform
staging S565).
"""

from __future__ import annotations

import pytest
from ingest.main import VALID_RETENTION_CLASSES, validate_retention_class


def test_vocabulary_is_the_four_ratified_classes() -> None:
    assert VALID_RETENTION_CLASSES == {
        "keep_and_watch",
        "ingest_once",
        "live_connected",
        "external_referenced",
    }


@pytest.mark.parametrize("value", sorted(VALID_RETENTION_CLASSES))
def test_every_ratified_class_is_accepted(value: str) -> None:
    assert validate_retention_class(value) == value


@pytest.mark.parametrize("value", ["keep-and-watch", "KEEP_AND_WATCH", "", "forever"])
def test_unknown_class_is_refused_not_coerced(value: str) -> None:
    """DR-025 posture: a binding without a valid retention class is a config
    error surfaced loudly — never silently defaulted past the gate. (Note
    the hyphenated doc spelling is deliberately refused: the DB constraint
    is underscored, and a silent respell would be a coercion.)"""
    with pytest.raises(RuntimeError, match="INGEST_RETENTION_CLASS"):
        validate_retention_class(value)


def test_admission_call_carries_the_binding_class() -> None:
    """The resolver invocation threads the binding's class — structurally
    asserted so the parameter can't quietly regress to the None it was
    before this wave."""
    import inspect

    from ingest import main as ingest_main

    sig = inspect.signature(ingest_main._resolve_source_identity)
    assert "retention_class" in sig.parameters
    src = inspect.getsource(ingest_main.process_file)
    assert "retention_class=coco.use_context(RETENTION_CLASS)" in src

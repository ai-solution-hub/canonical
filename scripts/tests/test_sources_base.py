"""ID-427 {427.4} — the two OKF Source adapters share ONE `Source` protocol.

Closes id-362 F1 leg 1. Before {427.4}, `sources/l_records.py` and
`sources/repo_docs.py` each declared their own `@runtime_checkable Source`
protocol; `repo_docs.py`'s docstring conceded the consequence — *"the two
declarations are structurally identical by design and must be kept in sync
by hand"*. `sources/base.py` now holds the single declaration.

The protocol is the **public contract** id-362 F1 asks for, so asserting on
it is behaviour, not structure (PLAN {427.4}). Two halves are asserted here
because they fail independently:

- **Runtime** — `isinstance(x, Source)`. `runtime_checkable` checks that the
  four method NAMES are present and nothing else, so this half alone would
  still pass if the signatures had silently diverged.
- **Static** — the `TYPE_CHECKING` block at the bottom. A type checker
  resolves each adapter against the protocol's actual key/raw parameters,
  which is the half that catches a signature drift the isinstance check
  cannot see.
"""

from pathlib import Path
from typing import TYPE_CHECKING, Any

from scripts.cocoindex_pipeline.sources import l_records, repo_docs
from scripts.cocoindex_pipeline.sources.base import ConceptKey, ConceptRaw, Source
from scripts.cocoindex_pipeline.sources.l_records import LRecordsSource
from scripts.cocoindex_pipeline.sources.repo_docs import (
    RepoConceptKey,
    RepoConceptRaw,
    RepoDocsSource,
)


class _StubPool:
    """`LRecordsSource.__init__` only stores its `pool`; no query is issued
    by a protocol conformance check, so the adapter needs no `FakePool`
    dispatch rules here (that machinery lives in
    `test_l_records_source.py`, which exercises the queries themselves)."""

    async def fetch(self, query: str, *args: Any) -> "list[dict]":
        return []


class TestBothAdaptersSatisfyTheSharedSourceProtocol:
    def test_l_records_source_satisfies_it(self) -> None:
        assert isinstance(LRecordsSource(pool=_StubPool()), Source)

    def test_repo_docs_source_satisfies_it(self, tmp_path: Path) -> None:
        assert isinstance(RepoDocsSource(tmp_path), Source)

    def test_both_satisfy_the_same_protocol_object(self, tmp_path: Path) -> None:
        """The point of {427.4}: one declaration accepts both adapters. Two
        hand-synced declarations would also pass the two tests above
        individually — this is the one that needed the duplicate gone."""
        adapters = [LRecordsSource(pool=_StubPool()), RepoDocsSource(tmp_path)]

        assert all(isinstance(adapter, Source) for adapter in adapters)

    def test_neither_adapter_module_declares_a_rival_source_name(self) -> None:
        """`sources/base.py` is the ONLY import path for the protocol. A
        re-export on either adapter would restore the two-import-paths
        ambiguity that let the declarations drift apart in the first place,
        so the absence of the name is part of the contract."""
        assert not hasattr(l_records, "Source")
        assert not hasattr(repo_docs, "Source")


if TYPE_CHECKING:
    # The static half. These bindings are never executed — a type checker
    # resolves each adapter against the protocol's declared key/raw pair,
    # which is exactly what `isinstance` above cannot verify.
    _l_records_conforms: Source[ConceptKey, ConceptRaw] = LRecordsSource(
        pool=_StubPool()
    )
    _repo_docs_conforms: Source[RepoConceptKey, RepoConceptRaw] = RepoDocsSource(".")

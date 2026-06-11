"""Unit tests for the cocoindex-path parity driver ({101.9}, PC-6 lane 3).

The driver (`scripts/cocoindex_pipeline/parity_driver.py`) replicates the
`flow.py::ingest_file` relationship + holder write-site IN-MEMORY for the
cross-path eval. These tests pin the two PURE helpers the driver owns —
`build_triples` (10-set filter + per-doc dedup + relationship-canonical
endpoints) and `build_holder_states` (re-keying `derive_holder_metadata`'s map
onto the per-mention canonical) — against fixture mention/relationship
stand-ins. No LLM, no DB, no subprocess.

The LLM extraction legs (`extract_relationships` / `extract_entity_mentions`)
are NOT exercised here — they are the production `@coco.fn` extractors covered
by `test_cocoindex_extractors.py`; the driver only composes them with the
already-tested canonicalisation + holder ports.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from scripts.cocoindex_pipeline.canonicalisation import (
    canonicalise_entity_name,
    canonicalise_for_relationship,
)
from scripts.cocoindex_pipeline.parity_driver import (
    build_holder_diagnostics,
    build_holder_states,
    build_triples,
)

# Client org in RAW space — build_holder_states relationship-canonicalises it
# internally (same as flow.py:2253), so we pass the raw branding name.
_CLIENT_ORG_RAW = "Knowledge Hub Ltd"


@dataclass(frozen=True)
class _Mention:
    """Duck-typed entity-mention stand-in (matches EntityMentionExtraction shape)."""

    entity_name: str
    entity_type: str


@dataclass(frozen=True)
class _Rel:
    """Duck-typed relationship stand-in (matches RelationshipExtraction shape)."""

    source: str
    relationship: str
    target: str


# ── build_triples — 10-set filter ────────────────────────────────────────────


def test_build_triples_canonicalises_both_endpoints() -> None:
    """Both source + target run through canonicalise_for_relationship.

    "ISO/IEC 27001:2022" → "iso 27001"; "Acme Ltd" → "acme limited" (Ltd→Limited).
    """
    rels = [_Rel(source="Acme Ltd", relationship="holds", target="ISO/IEC 27001:2022")]
    triples = build_triples(rels)
    assert triples == [
        {
            "source_entity": "acme limited",
            "relationship_type": "holds",
            "target_entity": "iso 27001",
        }
    ]


def test_build_triples_drops_out_of_10_set_predicate() -> None:
    """An out-of-10-set predicate is skipped (Inv-4 defensive drop), the rest kept."""
    rels = [
        _Rel(source="Acme", relationship="holds", target="ISO 27001"),
        _Rel(source="Acme", relationship="invented_predicate", target="Widget"),
        _Rel(source="Acme", relationship="uses", target="AWS"),
    ]
    triples = build_triples(rels)
    predicates = {t["relationship_type"] for t in triples}
    assert predicates == {"holds", "uses"}
    assert "invented_predicate" not in predicates


@pytest.mark.parametrize(
    "predicate",
    [
        "holds",
        "complies_with",
        "delivers_to",
        "uses",
        "demonstrated_by",
        "requires",
        "part_of",
        "supersedes",
        "references",
        "evidences",
    ],
)
def test_build_triples_keeps_every_member_of_the_10_set(predicate: str) -> None:
    """Each of the 10 canonical predicates survives the filter."""
    rels = [_Rel(source="Acme", relationship=predicate, target="Target")]
    triples = build_triples(rels)
    assert len(triples) == 1
    assert triples[0]["relationship_type"] == predicate


# ── build_triples — per-doc dedup ────────────────────────────────────────────


def test_build_triples_dedups_on_canonical_natural_key() -> None:
    """Two raw triples collapsing to the same canonical (source, pred, target)
    yield ONE triple (first-wins, mirroring flow.py:2362-2364)."""
    rels = [
        _Rel(source="Acme Ltd", relationship="holds", target="ISO 27001"),
        # Same canonical endpoints after canonicalise_for_relationship:
        _Rel(source="Acme Ltd.", relationship="holds", target="ISO/IEC 27001"),
    ]
    triples = build_triples(rels)
    assert len(triples) == 1
    assert triples[0]["source_entity"] == canonicalise_for_relationship("Acme Ltd")


def test_build_triples_distinct_predicates_not_deduped() -> None:
    """Same endpoints but different predicate → two distinct triples."""
    rels = [
        _Rel(source="Acme", relationship="holds", target="ISO 27001"),
        _Rel(source="Acme", relationship="complies_with", target="ISO 27001"),
    ]
    triples = build_triples(rels)
    assert len(triples) == 2


def test_build_triples_empty_input_yields_empty() -> None:
    assert build_triples([]) == []


# ── build_holder_states — re-keying + self/supplier ──────────────────────────


def test_build_holder_states_self_keyed_by_per_mention_canonical() -> None:
    """A self-held cert is keyed by its per-mention canonical_name."""
    mentions = [_Mention("ISO 27001", "certification")]
    rels = [_Rel(source="Knowledge Hub Ltd", relationship="holds", target="ISO 27001")]
    states = build_holder_states(mentions, rels, _CLIENT_ORG_RAW)
    key = canonicalise_entity_name("ISO 27001", "certification")
    assert states == {key: {"holder": "self"}}


def test_build_holder_states_supplier_carries_name() -> None:
    """A supplier-held cert carries holder:supplier + supplier_name."""
    mentions = [_Mention("ISO 27001", "certification")]
    rels = [_Rel(source="Globex Inc", relationship="holds", target="ISO 27001")]
    states = build_holder_states(mentions, rels, _CLIENT_ORG_RAW)
    key = canonicalise_entity_name("ISO 27001", "certification")
    assert states[key]["holder"] == "supplier"
    assert states[key]["supplier_name"] == canonicalise_for_relationship("Globex Inc")


def test_build_holder_states_no_signal_cert_absent() -> None:
    """A cert with no holder signal is ABSENT (Inv-10 — never defaulted)."""
    mentions = [_Mention("ISO 27001", "certification")]
    states = build_holder_states(mentions, [], _CLIENT_ORG_RAW)
    assert states == {}


def test_build_holder_states_non_cert_never_keyed() -> None:
    """Non-cert mentions never appear in holder_states (Inv-14)."""
    mentions = [
        _Mention("Knowledge Hub Ltd", "organisation"),
        _Mention("ISO 27001", "certification"),
    ]
    rels = [_Rel(source="Knowledge Hub Ltd", relationship="holds", target="ISO 27001")]
    states = build_holder_states(mentions, rels, _CLIENT_ORG_RAW)
    org_key = canonicalise_entity_name("Knowledge Hub Ltd", "organisation")
    assert org_key not in states


def test_build_holder_states_r4_fail_fast_on_empty_client_org() -> None:
    """An empty client org raises (R4 fail-fast) — propagated to the driver's
    per-doc error field."""
    mentions = [_Mention("ISO 27001", "certification")]
    rels = [_Rel(source="Knowledge Hub Ltd", relationship="holds", target="ISO 27001")]
    with pytest.raises(ValueError):
        build_holder_states(mentions, rels, "")


# ── build_holder_diagnostics — expected-class bucketing inputs (bl-288) ───────


def test_build_holder_diagnostics_flags_client_org_space_mismatch() -> None:
    """"Knowledge Hub Ltd" → rel "knowledge hub limited" ≠ lower "knowledge hub
    ltd" → client_org_space_mismatch True (bl-288 bug B signature)."""
    mentions = [_Mention("ISO 27001", "certification")]
    diags = build_holder_diagnostics(mentions, "Knowledge Hub Ltd")
    key = canonicalise_entity_name("ISO 27001", "certification")
    assert diags[key]["client_org_space_mismatch"] is True


def test_build_holder_diagnostics_no_client_org_mismatch_when_spaces_agree() -> None:
    """A client org whose rel canonical == its bare lowercase → no mismatch."""
    mentions = [_Mention("ISO 27001", "certification")]
    # "acme" canonicalises to "acme" in both spaces (no Ltd→Limited rewrite).
    diags = build_holder_diagnostics(mentions, "acme")
    key = canonicalise_entity_name("ISO 27001", "certification")
    assert diags[key]["client_org_space_mismatch"] is False


def test_build_holder_diagnostics_only_keys_certifications() -> None:
    """Non-cert mentions never get a diagnostics entry (Inv-14 parity)."""
    mentions = [
        _Mention("ISO 27001", "certification"),
        _Mention("Acme Ltd", "organisation"),
    ]
    diags = build_holder_diagnostics(mentions, "Knowledge Hub Ltd")
    org_key = canonicalise_entity_name("Acme Ltd", "organisation")
    cert_key = canonicalise_entity_name("ISO 27001", "certification")
    assert org_key not in diags
    assert cert_key in diags
    assert "cert_space_mismatch" in diags[cert_key]

"""Parity tests for derive_holder_metadata ({101.8}, PRODUCT §PC-5 / §PC-6 lane 2).

Ports the holder-rule semantics of ``deriveHolderMetadata``
(``lib/ai/classify.ts:524-595``) into the cocoindex pipeline. The six mandated
cases (testStrategy):

  1. self-attribution           — holds rel, source == client org → holder:self
  2. supplier-disclaimer        — holds rel, source != client org → holder:supplier
  3. S196 synonym fallback      — complies_with / evidences with no canonical holds
  4. untouched-not-self (Inv-10)— no-signal cert gets NO holder key (absent from map)
  5. non-cert never stamped (Inv-14)
  6. R2-divergence              — raw entity_name whose canonicalise_entity_name
                                  canonical DIVERGES from its
                                  canonicalise_for_relationship canonical, proving
                                  membership is computed in relationship-canonical space

Plus the R4 fail-fast (unset client org → ValueError raise).

These are pure-function tests (no LLM, no DB) — they construct lightweight
mention / relationship stand-ins exposing the same duck-typed attributes
(``.entity_name`` / ``.entity_type`` for mentions; ``.source`` /
``.relationship`` / ``.target`` for relationships) the flow wiring passes.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from scripts.cocoindex_pipeline.canonicalisation import (
    canonicalise_entity_name,
    canonicalise_for_relationship,
)
from scripts.cocoindex_pipeline.holder_rule import derive_holder_metadata

# Client org in RELATIONSHIP-canonical space, as the flow wiring resolves it
# (it relationship-canonicalises the raw PIPELINE_CLIENT_ORG value so the
# self-vs-supplier comparison lands in the same space as the holds sources —
# "Knowledge Hub Ltd" → "knowledge hub limited" via Ltd→Limited).
_CLIENT_ORG = canonicalise_for_relationship("Knowledge Hub Ltd")  # "knowledge hub limited"


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


def _key(entity_name: str, entity_type: str = "certification") -> tuple[str, str]:
    """The (per_doc_canonical, entity_type) map key the em-loop looks up."""
    return (canonicalise_entity_name(entity_name, entity_type), entity_type)


# ── Case 1 — self-attribution ────────────────────────────────────────────────


def test_self_attribution() -> None:
    """A `holds` rel whose source canonicalises to the client org → holder:self."""
    mentions = [_Mention("ISO 27001", "certification")]
    rels = [_Rel(source="Knowledge Hub Ltd", relationship="holds", target="ISO 27001")]

    result = derive_holder_metadata(mentions, rels, _CLIENT_ORG)

    assert result == {_key("ISO 27001"): {"holder": "self"}}


# ── Case 2 — supplier-disclaimer attribution ─────────────────────────────────


def test_supplier_disclaimer_attribution() -> None:
    """A `holds` rel whose source is NOT the client org → holder:supplier."""
    mentions = [_Mention("ISO 27001", "certification")]
    supplier_source = "Acme Security Services"
    rels = [_Rel(source=supplier_source, relationship="holds", target="ISO 27001")]

    result = derive_holder_metadata(mentions, rels, _CLIENT_ORG)

    expected_supplier = canonicalise_for_relationship(supplier_source)
    assert result == {
        _key("ISO 27001"): {
            "holder": "supplier",
            "supplier_name": expected_supplier,
        }
    }


# ── Case 3 — S196 synonym fallback ───────────────────────────────────────────


@pytest.mark.parametrize("predicate", ["complies_with", "evidences"])
def test_s196_synonym_fallback(predicate: str) -> None:
    """complies_with / evidences with no canonical holds, cert target, org source."""
    mentions = [
        _Mention("ISO 27001", "certification"),
        _Mention("Acme Ltd", "organisation"),
    ]
    rels = [_Rel(source="Acme Ltd", relationship=predicate, target="ISO 27001")]

    result = derive_holder_metadata(mentions, rels, _CLIENT_ORG)

    expected_supplier = canonicalise_for_relationship("Acme Ltd")
    assert result == {
        _key("ISO 27001"): {
            "holder": "supplier",
            "supplier_name": expected_supplier,
        }
    }


def test_canonical_holds_wins_over_synonym_on_tie() -> None:
    """When BOTH a holds and a synonym target the same cert, holds wins (Pass-1)."""
    mentions = [
        _Mention("ISO 27001", "certification"),
        _Mention("Acme Ltd", "organisation"),
    ]
    rels = [
        _Rel(source="Knowledge Hub Ltd", relationship="holds", target="ISO 27001"),
        _Rel(source="Acme Ltd", relationship="complies_with", target="ISO 27001"),
    ]

    result = derive_holder_metadata(mentions, rels, _CLIENT_ORG)

    # holds (client org) wins → self, NOT the synonym's supplier attribution.
    assert result == {_key("ISO 27001"): {"holder": "self"}}


def test_synonym_rejected_when_source_not_org() -> None:
    """A synonym whose source is neither client org nor an extracted org is dropped."""
    mentions = [
        _Mention("ISO 27001", "certification"),
        _Mention("Cyber Essentials Plus", "certification"),
    ]
    # cert complies_with cert — garbage rel, source is not an organisation.
    rels = [
        _Rel(
            source="Cyber Essentials Plus",
            relationship="complies_with",
            target="ISO 27001",
        )
    ]

    result = derive_holder_metadata(mentions, rels, _CLIENT_ORG)

    assert result == {}


# ── Case 4 — untouched-not-self (Inv-10) ─────────────────────────────────────


def test_no_signal_cert_has_no_holder_key() -> None:
    """A cert mention with NO holds/synonym rel is ABSENT — never defaulted self."""
    mentions = [_Mention("ISO 27001", "certification")]
    rels: list[_Rel] = []  # no relationships at all

    result = derive_holder_metadata(mentions, rels, _CLIENT_ORG)

    assert _key("ISO 27001") not in result
    assert result == {}


def test_unrelated_rel_does_not_stamp_cert() -> None:
    """A cert with only an unrelated (non-holds, non-synonym) rel stays untouched."""
    mentions = [
        _Mention("ISO 27001", "certification"),
        _Mention("Acme Ltd", "organisation"),
    ]
    rels = [_Rel(source="Acme Ltd", relationship="uses", target="ISO 27001")]

    result = derive_holder_metadata(mentions, rels, _CLIENT_ORG)

    assert result == {}


# ── Case 5 — non-cert never stamped (Inv-14) ─────────────────────────────────


def test_non_cert_never_stamped() -> None:
    """Even with a `holds` rel targeting a non-cert mention, no stamp is produced."""
    mentions = [
        _Mention("Knowledge Hub Ltd", "organisation"),
        _Mention("Some Framework", "framework"),
    ]
    # holds targeting a framework (non-cert) — must NOT stamp.
    rels = [
        _Rel(source="Knowledge Hub Ltd", relationship="holds", target="Some Framework")
    ]

    result = derive_holder_metadata(mentions, rels, _CLIENT_ORG)

    assert result == {}


# ── Case 6 — R2-divergence (relationship-canonical membership) ───────────────


def test_r2_divergence_membership_in_relationship_canonical_space() -> None:
    """The org-source membership set must be built in RELATIONSHIP-canonical space.

    "Acme Ltd" diverges between the two canonicalisers:
      - canonicalise_for_relationship("Acme Ltd") == "acme limited"  (Ltd→Limited)
      - canonicalise_entity_name("Acme Ltd", "organisation") == "acme ltd"

    The synonym rel's source "Acme Ltd" canonicalises (relationship space) to
    "acme limited". The org mention "Acme Ltd" must contribute "acme limited"
    to org_sources for the membership test to pass. If the port built the set
    from canonicalise_entity_name (the TS R2 bug) it would contribute "acme ltd"
    and the membership test would MISS — the synonym would be rejected and no
    stamp produced. Proving the stamp IS produced proves the bridge is via the
    raw entity_name in relationship-canonical space.
    """
    # Sanity: the two canonicalisers genuinely diverge for this input.
    assert canonicalise_for_relationship("Acme Ltd") == "acme limited"
    assert canonicalise_entity_name("Acme Ltd", "organisation") == "acme ltd"
    assert canonicalise_for_relationship("Acme Ltd") != canonicalise_entity_name(
        "Acme Ltd", "organisation"
    )

    mentions = [
        _Mention("ISO 27001", "certification"),
        _Mention("Acme Ltd", "organisation"),
    ]
    rels = [_Rel(source="Acme Ltd", relationship="evidences", target="ISO 27001")]

    result = derive_holder_metadata(mentions, rels, _CLIENT_ORG)

    # The synonym is accepted because "acme limited" (relationship-canonical) is
    # in org_sources — proving membership is in relationship-canonical space.
    assert result == {
        _key("ISO 27001"): {
            "holder": "supplier",
            "supplier_name": "acme limited",
        }
    }


# ── R4 fail-fast — unset client org → ValueError raise ───────────────────────


@pytest.mark.parametrize("bad_value", ["", None])
def test_unset_client_org_raises(bad_value: object) -> None:
    """An unset/empty client org raises immediately (R4) — never silent."""
    mentions = [_Mention("ISO 27001", "certification")]
    rels = [_Rel(source="Knowledge Hub Ltd", relationship="holds", target="ISO 27001")]

    with pytest.raises(ValueError, match="PIPELINE_CLIENT_ORG"):
        derive_holder_metadata(mentions, rels, bad_value)  # type: ignore[arg-type]


# ── Determinism ──────────────────────────────────────────────────────────────


def test_derive_is_deterministic() -> None:
    """Same inputs → identical output across repeated calls (no hidden state)."""
    mentions = [
        _Mention("ISO 27001", "certification"),
        _Mention("Acme Ltd", "organisation"),
    ]
    rels = [_Rel(source="Acme Ltd", relationship="holds", target="ISO 27001")]

    first = derive_holder_metadata(mentions, rels, _CLIENT_ORG)
    for _ in range(3):
        assert derive_holder_metadata(mentions, rels, _CLIENT_ORG) == first

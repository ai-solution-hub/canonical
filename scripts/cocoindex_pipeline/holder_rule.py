"""Holder-rule attribution for certification entity mentions ({101.8}).

Python port of ``deriveHolderMetadata`` (``lib/ai/classify.ts:524-595``),
PRODUCT §PC-5 / §PC-6 lane 2. Decides, per certification mention, whether the
certification is held by the client org itself (``holder: 'self'``) or by a
named supplier (``holder: 'supplier'`` + ``supplier_name``), by reading the
extracted ``holds`` relationships (and two S196 synonyms) for that cert.

This is a PURE function — no LLM call, no DB access, no global state. It takes
the already-extracted mentions + relationships for ONE document and returns a
``holder_by_mention_id`` map the {101.7}/{101.8} em-declare loop merges into
each certification mention's ``metadata`` jsonb.

Map identity (R-IDENTITY)
-------------------------
The returned map is keyed by ``(per_doc_canonical, entity_type)`` — the SAME
natural key the em-declare loop uses AFTER its per-(canonical, type) dedup
(``flow.py`` ``_em_dedup``). ``per_doc_canonical`` is
``canonicalise_entity_name(mention.entity_name, mention.entity_type)``. The
loop looks up ``holder_by_mention_id[(per_doc_canonical, entity_type)]`` and
merges the result (empty dict when absent) into ``metadata``. Only certs that
received a holder signal appear in the map (Inv-10 — no-signal certs are
absent, so the loop merges nothing and leaves span-only metadata untouched).

R2 BRIDGE (LOAD-BEARING)
------------------------
The ``cert_targets`` / ``org_sources`` membership sets are built by applying
``canonicalise_for_relationship`` to each mention's RAW ``entity_name`` — NOT
the per-mention ``canonicalise_entity_name`` canonical. Both sides of every
set-membership comparison therefore live in RELATIONSHIP-canonical space (the
same space the relationship endpoints are canonicalised into below), so a cert
target emitted by the relationship canonicaliser matches a cert MENTION on the
identical canonical string.

The TS oracle at classify.ts:524-595 has a VISIBLE R2 mismatch: it builds the
sets from ``row.canonical_name`` (the per-mention/storage canonical), then
compares them against relationship-canonical targets/sources — the two spaces
DIVERGE (e.g. "Acme Ltd" → relationship-canonical "acme limited" vs
per-mention canonical "acme ltd"), so a legitimate org source would miss its
own membership set. This port FIXES the mismatch per the ratified spec by
building BOTH membership sets in relationship-canonical space. The parity
suite includes an explicit R2-divergence case proving the relationship-canonical
comparison is the one that matches.

R4 FAIL-FAST (client-org env knob)
----------------------------------
``client_org_lower`` is the client organisation name in RELATIONSHIP-canonical
space. The {101.8} flow wiring resolves it from the REQUIRED
``PIPELINE_CLIENT_ORG`` env knob and runs it through
``canonicalise_for_relationship`` before passing it here, so the self-vs-supplier
comparison (``source_c == client_org_lower``) lands in the SAME canonical space
as the relationship-canonicalised ``holds`` source (e.g. "Knowledge Hub Ltd" →
"knowledge hub limited"). This is the consistent-space refinement of the TS
oracle, which compared a relationship-canonical source against a merely-lowercased
``BRANDING.organisationName`` (a latent space mismatch). This function raises
``ValueError`` immediately when it is unset/empty so a misconfigured run cannot
mis-attribute every cert as ``holder: 'supplier'`` against the wrong org
(mirrors the ``NEXT_PUBLIC_CLIENT_ID`` guard at
``scripts/eval-holder-rule-ts.ts:756``).
The env-knob name ``PIPELINE_CLIENT_ORG`` follows the ``PIPELINE_*`` convention
used by ``PIPELINE_RUN_WEBHOOK_URL`` in ``flow.py``. The flow wiring runs this
raise inside its Inv-15 best-effort try/except, so a misconfigured run LOGS the
fault and still writes span-only em metadata rather than aborting the doc.

Stamping rules (Inv-14 / Inv-10)
--------------------------------
- ONLY ``certification``-type mentions are ever stamped (Inv-14). Non-cert
  mentions are never present in the returned map.
- A cert with a resolved holder source == ``client_org_lower`` → ``{"holder":
  "self"}``.
- A cert with a resolved holder source != ``client_org_lower`` → ``{"holder":
  "supplier", "supplier_name": <source>}``.
- A cert with NO holder signal is ABSENT from the map — never defaulted to
  ``'self'`` (Inv-10).
"""

from __future__ import annotations

from typing import Any

from scripts.cocoindex_pipeline.canonicalisation import (
    canonicalise_entity_name,
    canonicalise_for_relationship,
)

# Env knob the flow wiring reads for the client-org self-vs-supplier split.
# PIPELINE_* convention (cf. PIPELINE_RUN_WEBHOOK_URL in flow.py).
CLIENT_ORG_ENV_VAR = "PIPELINE_CLIENT_ORG"

# Certification-context synonyms for `holds`. The classifier sometimes emits
# `complies_with` or `evidences` when the content phrases a certification
# differently (e.g. "our ISO 27001 compliance", "evidenced by our DBS check").
# S196 fix: accept these synonyms ONLY when the target is a certification
# mention AND no canonical `holds` rel exists for that target (holds wins over
# synonyms on tie). Mirrors HOLDS_SYNONYMS at classify.ts:522.
HOLDS_SYNONYMS: frozenset[str] = frozenset({"complies_with", "evidences"})


def derive_holder_metadata(
    mentions: list[Any],
    relationships: list[Any],
    client_org_lower: str,
) -> dict[tuple[str, str], dict[str, Any]]:
    """Derive holder metadata for each certification mention.

    Args:
        mentions: The document's extracted entity mentions. Each item exposes
            ``.entity_name`` (raw extracted str) and ``.entity_type`` (one of
            the 12 canonical entity_type values).
        relationships: The document's extracted relationship triples. Each item
            exposes ``.source`` / ``.relationship`` / ``.target`` (raw strs).
            This is the SAME raw list the {101.7} er-declare loop consumes — do
            NOT re-extract.
        client_org_lower: The lowercase client organisation name, resolved by
            the flow wiring from ``PIPELINE_CLIENT_ORG``. REQUIRED — raises
            ``ValueError`` when unset/empty (R4 fail-fast).

    Returns:
        ``holder_by_mention_id`` keyed by ``(per_doc_canonical, entity_type)``
        (see module docstring R-IDENTITY). Values are the holder-metadata dict
        to merge into the cert mention's ``metadata`` jsonb. ONLY certification
        mentions that received a holder signal are present (Inv-10 / Inv-14).
    """
    # R4 fail-fast: a missing client org would mis-attribute every cert.
    if not client_org_lower:
        raise ValueError(
            f"client_org_lower is unset/empty — set {CLIENT_ORG_ENV_VAR} so "
            "holder attribution can resolve the self-vs-supplier split. "
            "Without it every certification would be mis-derived as "
            "holder='supplier' against the wrong organisation."
        )

    # Pass 1: canonical `holds` relationships. Last-wins on duplicate target
    # (mirrors the TS single-source assumption — upstream dedup at classifier
    # output is the intended safeguard, not this map).
    holds_by_target: dict[str, str] = {}
    for rel in relationships:
        if rel.relationship == "holds":
            target_c = canonicalise_for_relationship(rel.target)
            source_c = canonicalise_for_relationship(rel.source)
            holds_by_target[target_c] = source_c

    # R2 BRIDGE (load-bearing): build the membership sets in RELATIONSHIP-canonical
    # space, from each mention's RAW entity_name — NOT canonicalise_entity_name —
    # so both sides of the Pass-2 comparison live in the same canonical space.
    cert_targets: set[str] = set()
    org_sources: set[str] = set()
    for mention in mentions:
        rel_canonical = canonicalise_for_relationship(mention.entity_name)
        if mention.entity_type == "certification":
            cert_targets.add(rel_canonical)
        elif mention.entity_type == "organisation":
            org_sources.add(rel_canonical)

    # Pass 2: S196 synonym fallback. Accept a `complies_with` / `evidences` rel
    # ONLY when (a) the target is a certification mention, AND (b) the source is
    # the client org OR an extracted organisation mention, AND (c) no canonical
    # `holds` rel already won that target (holds wins on tie).
    for rel in relationships:
        if rel.relationship in HOLDS_SYNONYMS:
            target_c = canonicalise_for_relationship(rel.target)
            if target_c in holds_by_target:
                continue
            if target_c not in cert_targets:
                continue
            source_c = canonicalise_for_relationship(rel.source)
            source_is_client_org = source_c == client_org_lower
            source_is_extracted_org = source_c in org_sources
            if not source_is_client_org and not source_is_extracted_org:
                continue
            holds_by_target[target_c] = source_c

    # Stamp: ONLY certification mentions (Inv-14), ONLY those with a holder
    # signal (Inv-10 — no-signal certs are absent from the returned map).
    holder_by_mention_id: dict[tuple[str, str], dict[str, Any]] = {}
    for mention in mentions:
        if mention.entity_type != "certification":
            continue
        target_c = canonicalise_for_relationship(mention.entity_name)
        holds_source = holds_by_target.get(target_c)
        if holds_source is None:
            continue  # Inv-10: no signal → leave untouched (never default 'self').
        per_doc_canonical = canonicalise_entity_name(
            mention.entity_name, mention.entity_type
        )
        key = (per_doc_canonical, mention.entity_type)
        if holds_source == client_org_lower:
            holder_by_mention_id[key] = {"holder": "self"}
        else:
            holder_by_mention_id[key] = {
                "holder": "supplier",
                "supplier_name": holds_source,
            }
    return holder_by_mention_id

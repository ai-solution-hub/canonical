"""Cocoindex-path parity driver for the cross-path eval (ID-101 §{101.9}, PC-6 lane 3).

Runs one or more fixture documents through the COCOINDEX extraction path
IN-MEMORY and emits the canonicalised relationship triples + per-cert holder
states as JSON — with ZERO DB writes and WITHOUT standing up the full cocoindex
flow/DB (no LMDB, no `app_main`, no `declare_row`).

It is invoked as a subprocess by `scripts/eval-holder-rule-ts.ts` under
`--path=both|cocoindex`:

    echo '{"documents":[{"item_id":"...","content_text":"..."}]}' \
        | PIPELINE_CLIENT_ORG="Acme Ltd" \
          python3 -m scripts.cocoindex_pipeline.parity_driver

Design contract (LOAD-BEARING)
------------------------------
The driver REPLICATES the `flow.py::ingest_file` relationship + holder write-site
EXACTLY, by IMPORTING the production functions (it never re-implements the
canonicalisation / holder logic):

- relationship endpoints: `canonicalise_for_relationship(rel.source/target)`
  (the same call flow.py:2360-2361 makes);
- 10-set predicate filter: `_RELATIONSHIP_PREDICATES` (imported from flow.py,
  the same frozenset the write-site uses at flow.py:2348);
- per-doc dedup: first-wins on the canonical `(source_c, predicate, target_c)`
  natural key (flow.py:2362-2364);
- holder derivation: `derive_holder_metadata(mentions, relationships,
  canonicalise_for_relationship(client_org_raw))` — the SAME call shape
  flow.py:2253-2255 makes, against the SAME raw `relationships` list.

The Python side is therefore byte-identical to what the cocoindex flow would
PERSIST for the same extraction output — which is precisely the cross-path seam
the parity comparator measures (Inv-2 triple set, Inv-9 holder state).

Stdin shape
-----------
``{"documents": [{"item_id": str, "content_text": str}, ...]}``
(``client_org`` may also be supplied in the payload; the env knob
``PIPELINE_CLIENT_ORG`` takes precedence and is the canonical source.)

Stdout shape
------------
``{"documents": [{"item_id": str, "triples": [{"source_entity", "relationship_type",
"target_entity"}], "holder_states": {canonical_name: {"holder", ["supplier_name"]}},
"error"?: str}]}``

Holder-state keying: keyed by the per-mention `canonical_name`
(`canonicalise_entity_name(entity_name, "certification")`) so the TS comparator
can match it against the persisted `entity_mentions.canonical_name` column — the
SAME natural key the flow em-declare loop writes (flow.py:2301).

R4 fail-fast: a missing/empty `PIPELINE_CLIENT_ORG` makes `derive_holder_metadata`
raise; the driver surfaces it per-document as an `error` field (parity with the
flow's Inv-15 best-effort: the doc still emits its triples) and exits non-zero
ONLY when the knob is wholly unset (mirrors the eval's NEXT_PUBLIC_CLIENT_ID
guard).
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

from scripts.cocoindex_pipeline.canonicalisation import (
    canonicalise_entity_name,
    canonicalise_for_relationship,
)
from scripts.cocoindex_pipeline.extraction import (
    extract_entity_mentions,
    extract_relationships,
)
from scripts.cocoindex_pipeline.flow import _RELATIONSHIP_PREDICATES
from scripts.cocoindex_pipeline.holder_rule import (
    CLIENT_ORG_ENV_VAR,
    derive_holder_metadata,
)


def build_triples(relationships: list[Any]) -> list[dict[str, str]]:
    """Replicate the flow.py::ingest_file relationship write-site (flow.py:2343-2375).

    10-set predicate filter + `canonicalise_for_relationship` on both endpoints +
    per-doc dedup on the canonical `(source_c, predicate, target_c)` natural key
    (first-wins, mirroring the `if key in _er_dedup: continue` skip). Returns the
    canonicalised triples in a stable (insertion) order — the comparator compares
    on SET equality, so order is irrelevant, but determinism aids diffing.
    """
    seen: set[tuple[str, str, str]] = set()
    triples: list[dict[str, str]] = []
    for rel in relationships:
        predicate = rel.relationship
        if predicate not in _RELATIONSHIP_PREDICATES:
            # Inv-4: out-of-10-set predicate — skip (the flow logs; we drop).
            continue
        source_c = canonicalise_for_relationship(rel.source)
        target_c = canonicalise_for_relationship(rel.target)
        key = (source_c, predicate, target_c)
        if key in seen:
            continue
        seen.add(key)
        triples.append(
            {
                "source_entity": source_c,
                "relationship_type": predicate,
                "target_entity": target_c,
            }
        )
    return triples


def build_holder_states(
    mentions: list[Any],
    relationships: list[Any],
    client_org_raw: str,
) -> dict[str, dict[str, Any]]:
    """Derive per-cert holder states keyed by per-mention `canonical_name`.

    Calls the production `derive_holder_metadata` with the SAME arguments the
    flow makes (flow.py:2253-2255): the raw mention + relationship lists and the
    relationship-canonicalised client org. `derive_holder_metadata` returns a map
    keyed by `(per_doc_canonical, entity_type)`; we re-key on `per_doc_canonical`
    alone (all entries are certification-type per Inv-14) so the TS comparator can
    match the persisted `entity_mentions.canonical_name` column.

    Raises `ValueError` (R4) when `client_org_raw` canonicalises to empty — the
    caller catches and records it per-document.
    """
    client_org_lower = canonicalise_for_relationship(client_org_raw)
    holder_by_key = derive_holder_metadata(mentions, relationships, client_org_lower)
    holder_states: dict[str, dict[str, Any]] = {}
    for (per_doc_canonical, _entity_type), holder_md in holder_by_key.items():
        holder_states[per_doc_canonical] = holder_md
    return holder_states


def build_holder_diagnostics(
    mentions: list[Any],
    client_org_raw: str,
) -> dict[str, dict[str, Any]]:
    """Per-cert diagnostics that let the TS comparator bucket EXPECTED-class
    holder divergences (the two bl-288 TS-oracle space mismatches).

    The TS oracle (`deriveHolderMetadata`, classify.ts:524-595) carries two
    latent canonical-space mismatches the Python port FIXES per the ratified
    spec (holder_rule.py R2/R4 docstrings):

      A. Pass-2 membership sets built from the per-mention `row.canonical_name`
         (``canonicalise_entity_name``) but compared against relationship-canonical
         targets/sources. When a cert's per-mention canonical DIFFERS from its
         relationship canonical, the TS oracle's set-membership check MISSES it,
         so the TS oracle never stamps a holder the Python port (correctly,
         relationship-canonical on both sides) derives.

      B. self-comparison vs merely-lowercased branding: TS compares a
         relationship-canonical holds source against
         ``BRANDING.organisationName.toLowerCase()``. When the client org's
         relationship canonical DIFFERS from its bare lowercase (e.g.
         "Knowledge Hub Ltd" → rel "knowledge hub limited" vs lower "knowledge
         hub ltd"), a self-held cert is mis-attributed as supplier by the TS
         oracle.

    Keyed by the SAME per-mention `canonical_name` as `build_holder_states`, each
    entry carries the two canonical forms + boolean flags so the comparator can
    attribute a divergence to a known TS bug WITHOUT re-running the TS oracle:

      - ``per_mention_canonical`` / ``relationship_canonical`` — the cert's two
        canonical forms; ``cert_space_mismatch`` is True when they differ (bug A).
      - ``client_org_space_mismatch`` — True when the client org's relationship
        canonical differs from its bare lowercase (bug B). Doc-scoped (same for
        every cert in the doc).
    """
    client_org_rel = canonicalise_for_relationship(client_org_raw)
    client_org_space_mismatch = client_org_rel != (client_org_raw or "").strip().lower()

    diagnostics: dict[str, dict[str, Any]] = {}
    for mention in mentions:
        if mention.entity_type != "certification":
            continue
        per_mention = canonicalise_entity_name(
            mention.entity_name, mention.entity_type
        )
        rel_canonical = canonicalise_for_relationship(mention.entity_name)
        diagnostics[per_mention] = {
            "per_mention_canonical": per_mention,
            "relationship_canonical": rel_canonical,
            "cert_space_mismatch": per_mention != rel_canonical,
            "client_org_space_mismatch": client_org_space_mismatch,
        }
    return diagnostics


async def _process_document(
    item_id: str,
    content_text: str,
    client_org_raw: str,
) -> dict[str, Any]:
    """Run ONE document through the cocoindex extraction path in-memory.

    Mirrors flow.py's Inv-15 best-effort holder handling: a holder-derivation
    fault (e.g. R4 missing client org) is recorded as an `error` but the triples
    are still emitted (the relationship write-site does not depend on holder).
    """
    relationships = await extract_relationships(content_text)
    mentions = await extract_entity_mentions(content_text)

    triples = build_triples(relationships)

    holder_states: dict[str, dict[str, Any]] = {}
    # Diagnostics are independent of the (possibly-raising) holder derivation —
    # they only need the mentions + client org, so compute them outside the
    # try/except so the comparator can bucket even on an R4 holder fault.
    holder_diagnostics = build_holder_diagnostics(mentions, client_org_raw)
    error: str | None = None
    try:
        holder_states = build_holder_states(mentions, relationships, client_org_raw)
    except Exception as exc:  # noqa: BLE001 — Inv-15 best-effort holder parity
        error = f"{type(exc).__name__}: {exc}"

    result: dict[str, Any] = {
        "item_id": item_id,
        "triples": triples,
        "holder_diagnostics": holder_diagnostics,
        "holder_states": holder_states,
    }
    if error is not None:
        result["error"] = error
    return result


async def _run(payload: dict[str, Any]) -> dict[str, Any]:
    documents = payload.get("documents", [])
    if not isinstance(documents, list):
        raise ValueError("payload.documents must be a list")

    # Env knob takes precedence over a payload-supplied client_org (the env is the
    # canonical source — see holder_rule.py CLIENT_ORG_ENV_VAR / R4 fail-fast).
    client_org_raw = os.environ.get(CLIENT_ORG_ENV_VAR) or payload.get(
        "client_org", ""
    )

    out_docs: list[dict[str, Any]] = []
    for doc in documents:
        item_id = doc.get("item_id", "")
        content_text = doc.get("content_text", "")
        out_docs.append(
            await _process_document(item_id, content_text, client_org_raw)
        )
    return {"documents": out_docs}


def main() -> int:
    """Read the JSON payload from stdin, emit the parity JSON to stdout.

    Logs (stderr) stay clean of the JSON payload so the TS caller can parse
    stdout directly. Exits 2 on a hard configuration fault (unparseable payload
    or wholly-unset client org with documents present).
    """
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        sys.stderr.write(f"[parity-driver] ERROR: invalid JSON payload: {exc}\n")
        return 2

    documents = payload.get("documents", [])
    client_org_raw = os.environ.get(CLIENT_ORG_ENV_VAR) or payload.get(
        "client_org", ""
    )
    if documents and not client_org_raw:
        sys.stderr.write(
            f"[parity-driver] ERROR: {CLIENT_ORG_ENV_VAR} is unset and no "
            "payload.client_org supplied — holder derivation cannot resolve the "
            "self-vs-supplier split. Set the env knob and retry.\n"
        )
        return 2

    output = asyncio.run(_run(payload))
    sys.stdout.write(json.dumps(output))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

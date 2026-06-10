"""Per-document deterministic canonicalisation for entity names.

PRODUCT.md Inv-4: the per-item phase writes a deterministic per-doc
canonical_name via this function BEFORE Stage-5 runs. The Stage-5
post-pass (§P-6) UPDATEs the value when cross-document resolution
maps to a different canonical; Stage-5 NEVER inserts rows.

Algorithm mirrors the legacy canonicalise() semantics so
pipeline-produced canonicals match the established canonicalisation contract.
"""

from __future__ import annotations

import re
import unicodedata

_ISO_SLASH_RE = re.compile(r"\biso\s*/\s*iec\s+", re.IGNORECASE)
_ISO_TIGHT_RE = re.compile(r"\biso\s*(\d{4,5})\b", re.IGNORECASE)
_ISO_VERSION_RE = re.compile(r":(\d{4})\b")


def canonicalise_entity_name(name: str, entity_type: str) -> str:
    """Return the per-document canonical for an entity name.

    Args:
        name: The raw entity name extracted by the LLM.
        entity_type: One of the 12 canonical entity_type values
            (database.types.ts:1141 enum).

    Returns:
        The lowercase + ASCII-folded + entity_type-aware-normalised
        canonical_name. Deterministic + idempotent.
    """
    if not name:
        return ""
    # Step 1: trim
    result = name.strip()
    # Step 2: ASCII-fold then lowercase
    result = unicodedata.normalize("NFKD", result)
    result = "".join(c for c in result if not unicodedata.combining(c))
    result = result.lower()
    # Step 3: entity_type-aware normalisation
    if entity_type == "certification":
        result = _ISO_SLASH_RE.sub("iso ", result)
        result = _ISO_TIGHT_RE.sub(lambda m: f"iso {m.group(1)}", result)
        result = _ISO_VERSION_RE.sub("", result)
    # Steps for technology/product trailing-suffix strip omitted for brevity
    # — TECH commits the v1 surface; richer rules surfaced in {53.4} PLAN.
    return result.strip()


# ──────────────────────────────────────────────────────────────────────────
# Cross-language relationship canonicaliser ({101.5}, PC-3 / PC-6 lane 1).
#
# This is a SEPARATE canonicaliser from canonicalise_entity_name() above.
# It is the Python port of the TypeScript relationship-writer chain
#   resolveAlias(canonicalise(name)).toLowerCase()
# used by the legacy relationship writer at lib/ai/classify.ts:1785-1819.
#
# It reproduces the 12-step TS canonicalise() body
# (lib/entities/entity-dedup.ts:114), the BASELINE_ALIASES resolveAlias()
# pass (lib/entities/entity-aliases.ts:16,92), then a final .lower().
#
# Do NOT conflate this with canonicalise_entity_name() (the ISO-only,
# per-mention canonicaliser). They diverge by design — collapsing them
# reintroduces the R1 relationship-vs-mention divergence this subtask closes.
# ──────────────────────────────────────────────────────────────────────────

# Known abbreviations that should remain uppercase.
# Source of truth: ABBREVIATIONS in lib/entities/entity-dedup.ts:9.
_ABBREVIATIONS: dict[str, str] = {
    "gdpr": "GDPR",
    "ico": "ICO",
    "owasp": "OWASP",
    "crest": "CREST",
    "csv": "CSV",
    "pdf": "PDF",
    "sla": "SLA",
    "ims": "IMS",
    "isms": "ISMS",
    "uk": "UK",
    "dpo": "DPO",
    "tls": "TLS",
    "ssl": "SSL",
    "https": "HTTPS",
    "http": "HTTP",
    "html": "HTML",
    "css": "CSS",
    "mysql": "MySQL",
    "api": "API",
    "sql": "SQL",
    "hmrc": "HMRC",
    "sme": "SME",
    "saml": "SAML",
    "sso": "SSO",
    "aws": "AWS",
    "mfa": "MFA",
    "nhs": "NHS",
    "ncsc": "NCSC",
    "plc": "PLC",
    "lms": "LMS",
    "pdms": "PDMS",
    "wcag": "WCAG",
    "vpn": "VPN",
    "ssh": "SSH",
    "sftp": "SFTP",
    "saas": "SaaS",
    "cctv": "CCTV",
    "dpia": "DPIA",
    "ppon": "PPON",
    "hl7": "HL7",
}

# Generic baseline alias map (client-independent, always available).
# Source of truth: BASELINE_ALIASES in lib/entities/entity-aliases.ts:16.
#
# FOLLOW-UP (documented divergence, NOT implemented in v1): the TS
# resolveAlias() also consults the entity_aliases DB table (merged over this
# baseline, DB wins on conflict — loadAliases() in entity-aliases.ts:50).
# This port intentionally ships ONLY the static BASELINE_ALIASES; DB-backed
# alias loading is a deliberate follow-up. Until then, relationship endpoints
# resolved against client-specific DB aliases will diverge between the TS
# writer (DB-aware) and this Python port (baseline-only).
_BASELINE_ALIASES: dict[str, str] = {
    "ISO Certification": "ISO 27001",
    "Iso Certifications": "ISO 27001",
    "ISO 27001 2013": "ISO 27001",
    "ISO 27000": "ISO 27001",
    "ISO 9001 2015": "ISO 9001",
    "wordpress": "WordPress",
    "Wordpress": "WordPress",
    "Csharp": "C#",
    "csharp": "C#",
    "Asp Net": "ASP.NET",
    "Asp.net": "ASP.NET",
    "agile": "Agile",
    "Hcaptcha": "hCaptcha",
    "Wcag 2 1 Aa": "WCAG 2.1 AA",
}

# Step 1→2: slug detector — starts alphanumeric, contains a '-' or '_',
# and has no whitespace. Mirrors TS /^[a-z0-9].*[-_]/.test(s) && !/\s/.test(s).
_SLUG_LEAD_RE = re.compile(r"^[a-z0-9].*[-_]")
_WHITESPACE_RE = re.compile(r"\s")

# Step 3: ISO basic — "ISO27001" → "ISO 27001". TS /^iso\s*(\d)/i.
_REL_ISO_BASIC_RE = re.compile(r"^iso\s*(\d)", re.IGNORECASE)
# Step 4: ISO extended — "ISO/IEC 27001", "Iso Iec 27001", "ISO-27001".
# TS /^iso[/\-\s]*(?:iec[/\-\s]*)?(\d)/i.
_REL_ISO_EXT_RE = re.compile(r"^iso[/\-\s]*(?:iec[/\-\s]*)?(\d)", re.IGNORECASE)
# Step 5: strip ISO version suffix — "ISO 27001:2022" → "ISO 27001".
# TS /^(ISO \d+)[:\s]\d{4}$/ (NO ignorecase — case-sensitive in oracle).
_REL_ISO_VERSION_RE = re.compile(r"^(ISO \d+)[:\s]\d{4}$")
# Step 6: Cyber Essentials variants.
_REL_CE_RE = re.compile(r"^cyber\s*essentials\b", re.IGNORECASE)
_REL_CE_PLUS_RE = re.compile(r"^(Cyber Essentials)\s+plus$", re.IGNORECASE)
# Step 7: WCAG version — "Wcag 2 1 Aa" → "WCAG 2.1 AA".
_REL_WCAG_VER_RE = re.compile(r"^wcag\s+(\d)\s+(\d)\s*(aa|a)$", re.IGNORECASE)
_REL_WCAG_WORD_RE = re.compile(r"\bwcag\b", re.IGNORECASE)
# Step 8: company suffix normalisation.
_REL_LTD_RE = re.compile(r"\bLtd\.?$", re.IGNORECASE)
_REL_PLC_RE = re.compile(r"\bPLC$", re.IGNORECASE)
_REL_INC_RE = re.compile(r"\bInc\.?$", re.IGNORECASE)
# Step 10: all-lowercase-leading detector. TS /^[a-z]/.
_LEADS_LOWER_RE = re.compile(r"^[a-z]")
# Step 12: trailing period.
_TRAILING_PERIOD_RE = re.compile(r"\.$")


def _rel_slug_to_proper_case(slug: str) -> str:
    """Slug → Title Case, preserving abbreviations.

    Port of slugToProperCase() in entity-dedup.ts:69.
    """
    words = re.split(r"[-_]", slug)
    out: list[str] = []
    for word in words:
        lower = word.lower()
        if lower in _ABBREVIATIONS:
            out.append(_ABBREVIATIONS[lower])
        else:
            out.append(word[:1].upper() + word[1:].lower())
    return " ".join(out)


def _rel_title_case(text: str) -> str:
    """Title-case a multi-word string, preserving abbreviations.

    Port of titleCase() in entity-dedup.ts:83. TS splits on /\\s+/.
    """
    words = re.split(r"\s+", text)
    out: list[str] = []
    for word in words:
        lower = word.lower()
        if lower in _ABBREVIATIONS:
            out.append(_ABBREVIATIONS[lower])
        else:
            out.append(word[:1].upper() + word[1:].lower())
    return " ".join(out)


def _rel_canonicalise(name: str) -> str:
    """Port of the 12-step TS canonicalise() body (entity-dedup.ts:114).

    Called with NO entity-type argument, so the type-aware plural branch
    (step 11) stays inert — matching the legacy relationship-writer call
    shape at classify.ts:1785-1819.
    """
    result = name.strip()

    # 1 → 2. Slug-style → Title Case.
    if _SLUG_LEAD_RE.search(result) and not _WHITESPACE_RE.search(result):
        result = _rel_slug_to_proper_case(result)

    # 3. ISO basic: "ISO27001" → "ISO 27001". TS String.replace = first match.
    result = _REL_ISO_BASIC_RE.sub(lambda m: f"ISO {m.group(1)}", result, count=1)

    # 4. ISO extended: "ISO/IEC 27001" / "Iso Iec 27001" / "ISO-27001".
    result = _REL_ISO_EXT_RE.sub(lambda m: f"ISO {m.group(1)}", result, count=1)

    # 5. Strip ISO version suffix: "ISO 27001:2022" → "ISO 27001".
    result = _REL_ISO_VERSION_RE.sub(lambda m: m.group(1), result, count=1)

    # 6. Cyber Essentials variants.
    result = _REL_CE_RE.sub("Cyber Essentials", result, count=1)
    result = _REL_CE_PLUS_RE.sub(lambda m: f"{m.group(1)} Plus", result, count=1)

    # 7. WCAG normalisation.
    result = _REL_WCAG_VER_RE.sub(
        lambda m: f"WCAG {m.group(1)}.{m.group(2)} {m.group(3).upper()}",
        result,
        count=1,
    )
    result = _REL_WCAG_WORD_RE.sub("WCAG", result)  # /gi → replace all

    # 8. Company suffix normalisation.
    result = _REL_LTD_RE.sub("Limited", result, count=1)
    result = _REL_PLC_RE.sub("PLC", result, count=1)
    result = _REL_INC_RE.sub("Inc", result, count=1)

    # 9. Single-word abbreviation fix.
    lower = result.lower()
    if lower in _ABBREVIATIONS:
        result = _ABBREVIATIONS[lower]

    # 10. Multi-word title case for all-lowercase inputs.
    if _LEADS_LOWER_RE.search(result) and result.lower() not in _ABBREVIATIONS:
        result = _rel_title_case(result)

    # 11. Plural normalisation — type-aware. INERT here (no entity_type arg),
    #     mirroring the legacy relationship-writer call shape.

    # 12. Strip trailing periods.
    result = _TRAILING_PERIOD_RE.sub("", result, count=1)

    return result


def _rel_resolve_alias(canonical_name: str) -> str:
    """Port of resolveAlias() (entity-aliases.ts:92), baseline-only.

    The TS oracle's sync path returns ``map[name] ?? name`` against the
    baseline map (the writer at classify.ts:1788 does NOT await loadAliases,
    so the cache is unpopulated and resolveAlias falls back to BASELINE_ALIASES).
    """
    return _BASELINE_ALIASES.get(canonical_name, canonical_name)


def canonicalise_for_relationship(name: str) -> str:
    """Canonical endpoint for entity-relationship source/target names.

    Cross-language port of the TS relationship-writer chain
    ``resolveAlias(canonicalise(name)).toLowerCase()``
    (lib/ai/classify.ts:1788). Used so pipeline-produced relationship
    endpoints (source_entity / target_entity in entity_relationships)
    match the TS writer byte-for-byte.

    Distinct from canonicalise_entity_name() — see module-level note above.

    Args:
        name: The raw entity name as extracted for a relationship endpoint.

    Returns:
        The lowercase canonical relationship endpoint. Deterministic.
    """
    return _rel_resolve_alias(_rel_canonicalise(name)).lower()

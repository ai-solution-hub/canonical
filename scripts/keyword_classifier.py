"""Keyword-based classification for Q&A pairs.

Assigns primary and secondary categories to bid library Q&A pairs
based on keyword matching against the question and answer text.

Categories (aligned with common bid/tender domains):
  - security: data protection, cyber security, GDPR, ISO 27001, encryption
  - compliance: regulatory, audit, certification, legal, standards
  - implementation: deployment, migration, onboarding, integration, setup
  - support: SLA, helpdesk, maintenance, incident, escalation
  - corporate: company info, financial, insurance, references, staffing
  - product-feature: functionality, features, capabilities, technical specs
  - methodology: approach, process, quality, project management, delivery

Usage:
    from scripts.keyword_classifier import classify_pairs

    enriched = classify_pairs(pairs)
    # Each pair now has 'primary_domain' and 'primary_subtopic' fields
"""

import re
from typing import Optional


# ── Keyword definitions ──────────────────────────────────────────────────

# Each category has a dict of subtopics, each mapping to a list of keywords.
# Keywords are matched case-insensitively against the combined question + answer text.

CATEGORY_KEYWORDS: dict[str, dict[str, list[str]]] = {
    "security": {
        "data-protection": [
            "data protection", "gdpr", "data privacy", "personal data",
            "data processing", "data controller", "data processor",
            "data subject", "privacy impact", "dpia", "information commissioner",
            "ico", "lawful basis", "data retention", "data breach",
            "data classification", "data handling",
        ],
        "cyber-security": [
            "cyber security", "cybersecurity", "penetration test",
            "pen test", "vulnerability", "threat", "malware", "ransomware",
            "firewall", "intrusion detection", "ids", "ips", "siem",
            "security incident", "security monitoring", "soc",
            "security operations", "zero trust",
        ],
        "encryption": [
            "encryption", "encrypted", "tls", "ssl", "aes",
            "at rest", "in transit", "key management", "certificate",
            "pki", "cryptographic", "hashing",
        ],
        "access-control": [
            "access control", "authentication", "authorisation", "authorization",
            "mfa", "multi-factor", "two-factor", "2fa", "rbac",
            "role-based", "single sign-on", "sso", "active directory",
            "ldap", "identity management", "privileged access", "pam",
        ],
        "iso-27001": [
            "iso 27001", "iso27001", "isms", "information security management",
            "annex a", "statement of applicability", "soa",
        ],
    },
    "compliance": {
        "standards": [
            "iso 9001", "iso9001", "iso 14001", "iso14001",
            "cyber essentials", "cyber essentials plus",
            "pci dss", "pci", "soc 2", "soc2", "nist",
            "cis benchmark", "cobit",
        ],
        "regulatory": [
            "regulatory", "regulation", "legislation", "legal requirement",
            "statutory", "act of parliament", "uk law", "eu law",
            "freedom of information", "foi", "equality act",
            "modern slavery", "anti-bribery", "bribery act",
        ],
        "audit": [
            "audit", "audited", "auditing", "internal audit",
            "external audit", "audit trail", "audit log",
            "compliance monitoring", "assurance",
        ],
        "certification": [
            "certification", "certified", "accreditation", "accredited",
            "iso certified", "certificate of", "approved supplier",
        ],
    },
    "implementation": {
        "deployment": [
            "deployment", "deploy", "go-live", "go live", "rollout",
            "roll-out", "implementation plan", "implementation timeline",
            "cutover", "launch",
        ],
        "migration": [
            "migration", "migrate", "data migration", "system migration",
            "legacy", "transition", "transfer",
        ],
        "onboarding": [
            "onboarding", "onboard", "user training", "training plan",
            "training programme", "knowledge transfer", "handover",
            "getting started", "setup guide",
        ],
        "integration": [
            "integration", "integrate", "api", "interface",
            "interoperability", "connect", "connector", "webhook",
            "middleware", "integration point",
        ],
    },
    "support": {
        "sla": [
            "sla", "service level", "uptime", "availability",
            "response time", "resolution time", "service credit",
            "guaranteed", "99.9", "99.99",
        ],
        "helpdesk": [
            "helpdesk", "help desk", "service desk", "support desk",
            "ticket", "ticketing", "support portal", "support hours",
            "support team", "technical support",
        ],
        "maintenance": [
            "maintenance", "patching", "patch management", "update",
            "upgrade", "release cycle", "version", "downtime",
            "scheduled maintenance", "maintenance window",
        ],
        "incident": [
            "incident", "incident management", "major incident",
            "escalation", "escalation path", "p1", "p2", "priority 1",
            "priority 2", "root cause", "rca", "post-incident",
        ],
    },
    "corporate": {
        "company-info": [
            "company", "organisation", "organization", "founded",
            "employees", "headcount", "turnover", "revenue",
            "annual report", "company registration", "companies house",
        ],
        "financial-standing": [
            "financial", "accounts", "profit", "loss", "balance sheet",
            "credit rating", "financial standing", "insolvency",
            "parent company", "subsidiary",
        ],
        "insurance": [
            "insurance", "indemnity", "professional indemnity",
            "public liability", "employers liability",
            "product liability", "insurance cover", "insured",
        ],
        "references": [
            "reference", "case study", "testimonial", "client list",
            "previous experience", "similar contract", "track record",
            "portfolio", "examples of work",
        ],
        "staffing": [
            "staffing", "staff", "personnel", "cv", "curriculum vitae",
            "qualifications", "experience", "team structure",
            "organisation chart", "org chart", "key personnel",
            "named resource", "resource plan",
        ],
    },
    "product-feature": {
        "functionality": [
            "functionality", "feature", "function", "capability",
            "can the system", "does the system", "able to",
            "support for", "module", "component",
        ],
        "technical": [
            "architecture", "technology stack", "tech stack",
            "programming language", "database", "hosting",
            "cloud", "on-premise", "on-premises", "saas",
            "platform", "infrastructure", "scalability",
            "performance", "capacity",
        ],
        "reporting": [
            "reporting", "report", "dashboard", "analytics",
            "business intelligence", "bi", "data export",
            "visualisation", "visualization", "kpi",
        ],
        "usability": [
            "usability", "user interface", "ui", "ux",
            "user experience", "accessibility", "wcag",
            "responsive", "mobile", "browser support",
        ],
    },
    "methodology": {
        "approach": [
            "approach", "methodology", "method", "framework",
            "process", "workflow", "procedure", "strategy",
        ],
        "project-management": [
            "project management", "project plan", "gantt",
            "milestone", "deliverable", "work package",
            "prince2", "agile", "scrum", "waterfall",
            "sprint", "kanban", "risk register",
        ],
        "quality": [
            "quality management", "quality assurance", "qa",
            "quality control", "qc", "testing", "test plan",
            "acceptance criteria", "defect", "bug",
            "continuous improvement",
        ],
        "delivery": [
            "delivery", "delivery plan", "delivery model",
            "service delivery", "delivery timeline",
            "phased delivery", "iterative",
        ],
    },
}


# ── Scoring engine ───────────────────────────────────────────────────────

def _build_text_block(pair: dict) -> str:
    """Build a combined text block from a Q&A pair for keyword matching."""
    parts = [
        pair.get("question_text", ""),
        pair.get("answer_standard", ""),
        pair.get("answer_advanced", ""),
        pair.get("section_name", ""),
    ]
    return " ".join(parts).lower()


def _score_category(text: str, subtopics: dict[str, list[str]]) -> tuple[float, str]:
    """Score a text block against a category's subtopics.

    Returns (total_score, best_subtopic).
    Score is the sum of keyword matches, with multi-word phrases
    weighted more heavily (2x for 2-word, 3x for 3+ word phrases).
    """
    total_score = 0.0
    subtopic_scores: dict[str, float] = {}

    for subtopic, keywords in subtopics.items():
        sub_score = 0.0
        for keyword in keywords:
            # Count occurrences of the keyword in the text
            count = len(re.findall(re.escape(keyword), text))
            if count > 0:
                # Weight multi-word phrases higher
                word_count = len(keyword.split())
                weight = min(word_count, 3)  # cap at 3x
                sub_score += count * weight
        subtopic_scores[subtopic] = sub_score
        total_score += sub_score

    # Best subtopic
    best_subtopic = ""
    if subtopic_scores:
        best_subtopic = max(subtopic_scores, key=subtopic_scores.get)
        if subtopic_scores[best_subtopic] == 0:
            best_subtopic = ""

    return total_score, best_subtopic


def classify_pair(pair: dict) -> dict:
    """Classify a single Q&A pair using keyword matching.

    Returns the pair dict enriched with:
        - primary_domain: str (e.g., "security")
        - primary_subtopic: str (e.g., "data-protection")
        - secondary_domain: str (may be empty)
        - secondary_subtopic: str (may be empty)
        - classification_confidence: float (0.0-1.0, based on score distribution)
    """
    text = _build_text_block(pair)

    scores: dict[str, tuple[float, str]] = {}
    for category, subtopics in CATEGORY_KEYWORDS.items():
        score, best_sub = _score_category(text, subtopics)
        scores[category] = (score, best_sub)

    # Sort by score descending
    ranked = sorted(scores.items(), key=lambda x: x[1][0], reverse=True)

    # Primary classification. Default to None (not "") so downstream write
    # paths insert SQL NULL when the keyword classifier can't assign a domain.
    # Empty-string defaults produced 18 invisible-to-domain-filter rows during
    # the S175→S181 re-ingestion arc — see cutover report §8.2.
    primary_domain: str | None = None
    primary_subtopic: str | None = None
    secondary_domain: str | None = None
    secondary_subtopic: str | None = None
    confidence = 0.0

    if ranked and ranked[0][1][0] > 0:
        primary_domain = ranked[0][0]
        primary_subtopic = ranked[0][1][1] or None

        total_score = sum(s[0] for _, s in ranked)
        if total_score > 0:
            confidence = ranked[0][1][0] / total_score

        # Secondary: must have a non-zero score and be different from primary
        if len(ranked) > 1 and ranked[1][1][0] > 0:
            secondary_domain = ranked[1][0]
            secondary_subtopic = ranked[1][1][1] or None

    # Enrich the pair
    enriched = dict(pair)
    enriched["primary_domain"] = primary_domain
    enriched["primary_subtopic"] = primary_subtopic
    enriched["secondary_domain"] = secondary_domain
    enriched["secondary_subtopic"] = secondary_subtopic
    enriched["classification_confidence"] = round(confidence, 3)

    # ── Product name disambiguation ──────────────────────────────
    # "Audit" is also a example-client product name (Advanced Audits).
    # If the source file is an Audit product document and the content
    # was classified under compliance>audit, it's more likely about
    # the product's audit capabilities than audit processes.
    source_file = pair.get("source_file", "").lower()
    if (
        "audit" in source_file
        and enriched["primary_domain"] == "compliance"
        and enriched["primary_subtopic"] == "audit"
    ):
        # Check if there are product-feature signals
        pf_score = scores.get("product-feature", (0, ""))[0]
        if pf_score > 0:
            # Reclassify as product-feature
            enriched["primary_domain"] = "product-feature"
            enriched["primary_subtopic"] = scores["product-feature"][1] or None
            enriched["secondary_domain"] = "compliance"
            enriched["secondary_subtopic"] = "audit"

    return enriched


def classify_pairs(pairs: list[dict]) -> list[dict]:
    """Classify a list of Q&A pairs using keyword matching.

    Args:
        pairs: List of Q&A dicts (must have 'question_text' key)

    Returns:
        List of enriched dicts with classification fields added
    """
    return [classify_pair(p) for p in pairs]


# ── Summary statistics ───────────────────────────────────────────────────

def classification_summary(pairs: list[dict]) -> dict[str, int]:
    """Summarise classification results by primary domain.

    Args:
        pairs: List of classified Q&A dicts (with 'primary_domain' field)

    Returns:
        Dict mapping domain names to counts, plus "unclassified" count
    """
    counts: dict[str, int] = {}
    for pair in pairs:
        domain = pair.get("primary_domain", "") or "unclassified"
        counts[domain] = counts.get(domain, 0) + 1
    return dict(sorted(counts.items(), key=lambda x: x[1], reverse=True))


# ── CLI entry point ──────────────────────────────────────────────────────

if __name__ == "__main__":
    import json
    import sys

    if len(sys.argv) < 2:
        print("Usage: python3 scripts/keyword_classifier.py <pairs.json>")
        print("  Input: JSON file with list of dicts, each having 'question_text'")
        sys.exit(1)

    with open(sys.argv[1], "r") as f:
        pairs = json.load(f)

    enriched = classify_pairs(pairs)
    summary = classification_summary(enriched)

    print(f"Classified {len(enriched)} pairs:")
    for domain, count in summary.items():
        print(f"  {domain}: {count}")

    # Write output
    output_path = sys.argv[1].replace(".json", "_classified.json")
    with open(output_path, "w") as f:
        json.dump(enriched, f, indent=2)
    print(f"\nWritten to {output_path}")

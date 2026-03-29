"""Tests for build_taxonomy_section() in classify.py."""

import sys
import os

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kb_pipeline.classify import build_taxonomy_section


class TestBuildTaxonomySection:
    """Tests for building markdown taxonomy section from DB data."""

    def _make_domains(self, *names, with_descriptions=True):
        """Helper to create domain dicts."""
        domains = []
        for i, name in enumerate(names, 1):
            d = {
                "id": f"domain-{i}",
                "name": name,
                "display_order": i,
                "description": f"Description for {name}." if with_descriptions else None,
            }
            domains.append(d)
        return domains

    def _make_subtopics(self, domain_id, *names, with_descriptions=True):
        """Helper to create subtopic dicts."""
        subtopics = []
        for i, name in enumerate(names, 1):
            st = {
                "id": f"subtopic-{domain_id}-{i}",
                "domain_id": domain_id,
                "name": name,
                "display_order": i,
                "description": f"Description for {name}" if with_descriptions else None,
            }
            subtopics.append(st)
        return subtopics

    def test_single_domain_with_subtopics(self):
        """A single domain with subtopics produces correct markdown."""
        domains = self._make_domains("SECURITY")
        subtopics = self._make_subtopics(
            "domain-1", "ai-models-llms", "ai-tools-frameworks"
        )

        result = build_taxonomy_section(domains, subtopics)

        assert "## TAXONOMY REFERENCE" in result
        assert "### Level 1 Domains (Choose exactly ONE primary)" in result
        assert "#### 1. SECURITY" in result
        assert "Description for SECURITY." in result
        assert "**Subtopics:**" in result
        assert "- `ai-models-llms`: Description for ai-models-llms" in result
        assert "- `ai-tools-frameworks`: Description for ai-tools-frameworks" in result
        assert "---" in result

    def test_multiple_domains_numbered_correctly(self):
        """Multiple domains are numbered sequentially."""
        domains = self._make_domains(
            "SECURITY", "COMPLIANCE", "IMPLEMENTATION"
        )
        subtopics = []

        result = build_taxonomy_section(domains, subtopics)

        assert "#### 1. SECURITY" in result
        assert "#### 2. COMPLIANCE" in result
        assert "#### 3. IMPLEMENTATION" in result

    def test_domain_without_description(self):
        """Domains with no description omit the description line."""
        domains = self._make_domains("SECURITY", with_descriptions=False)
        subtopics = []

        result = build_taxonomy_section(domains, subtopics)

        assert "#### 1. SECURITY" in result
        # Should NOT have a description line between heading and ---
        lines = result.split("\n")
        heading_idx = next(
            i for i, l in enumerate(lines) if "#### 1. SECURITY" in l
        )
        # Next non-empty line should be ---
        next_non_empty = next(
            l.strip() for l in lines[heading_idx + 1:] if l.strip()
        )
        assert next_non_empty == "---"

    def test_subtopics_without_descriptions(self):
        """Subtopics with no description omit the colon suffix."""
        domains = self._make_domains("SECURITY")
        subtopics = self._make_subtopics(
            "domain-1", "ai-models-llms", with_descriptions=False
        )

        result = build_taxonomy_section(domains, subtopics)

        assert "- `ai-models-llms`" in result
        # Should NOT have ": None" or ": "
        for line in result.split("\n"):
            if "`ai-models-llms`" in line:
                assert line.strip() == "- `ai-models-llms`"

    def test_subtopics_filtered_by_domain_id(self):
        """Subtopics are correctly assigned to their parent domain."""
        domains = self._make_domains("DOMAIN A", "DOMAIN B")
        subtopics_a = self._make_subtopics("domain-1", "sub-a1", "sub-a2")
        subtopics_b = self._make_subtopics("domain-2", "sub-b1")
        all_subtopics = subtopics_a + subtopics_b

        result = build_taxonomy_section(domains, all_subtopics)

        lines = result.split("\n")

        # Find domain A section
        domain_a_idx = next(i for i, l in enumerate(lines) if "DOMAIN A" in l)
        domain_b_idx = next(i for i, l in enumerate(lines) if "DOMAIN B" in l)

        # sub-a1 and sub-a2 should appear between DOMAIN A and DOMAIN B
        section_a = "\n".join(lines[domain_a_idx:domain_b_idx])
        assert "`sub-a1`" in section_a
        assert "`sub-a2`" in section_a
        assert "`sub-b1`" not in section_a

        # sub-b1 should appear after DOMAIN B
        section_b = "\n".join(lines[domain_b_idx:])
        assert "`sub-b1`" in section_b
        assert "`sub-a1`" not in section_b

    def test_empty_domains(self):
        """Empty domain list produces header only."""
        result = build_taxonomy_section([], [])

        assert "## TAXONOMY REFERENCE" in result
        assert "### Level 1 Domains (Choose exactly ONE primary)" in result
        # No domain headings
        assert "####" not in result

    def test_domain_with_no_subtopics_omits_subtopics_label(self):
        """A domain with no subtopics does not show the Subtopics label."""
        domains = self._make_domains("SOLO DOMAIN")
        subtopics = []

        result = build_taxonomy_section(domains, subtopics)

        assert "#### 1. SOLO DOMAIN" in result
        assert "**Subtopics:**" not in result

    def test_mixed_descriptions_present_and_absent(self):
        """Mix of subtopics with and without descriptions renders correctly."""
        domains = self._make_domains("TEST DOMAIN")
        subtopics = [
            {
                "id": "st-1",
                "domain_id": "domain-1",
                "name": "has-desc",
                "description": "A described subtopic",
                "display_order": 1,
            },
            {
                "id": "st-2",
                "domain_id": "domain-1",
                "name": "no-desc",
                "description": None,
                "display_order": 2,
            },
            {
                "id": "st-3",
                "domain_id": "domain-1",
                "name": "empty-desc",
                "description": "",
                "display_order": 3,
            },
        ]

        result = build_taxonomy_section(domains, subtopics)

        assert "- `has-desc`: A described subtopic" in result
        # no-desc should not have a colon
        for line in result.split("\n"):
            if "`no-desc`" in line:
                assert line.strip() == "- `no-desc`"
            if "`empty-desc`" in line:
                assert line.strip() == "- `empty-desc`"

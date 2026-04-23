"""Tests for the holder-disambiguation evaluation diff logic.

Tests the compute_diff and normalise_rel functions from
scripts/kb_pipeline/eval_holder_rule.py using synthetic fixtures.
Does NOT require a live DB connection or API key.
"""

import pytest

from kb_pipeline.eval_holder_rule import compute_diff, normalise_rel


CLIENT_ORG = "Example Client Ltd"


class TestNormaliseRel:
    """Tests for normalise_rel helper."""

    def test_normalises_entity_relationships_format(self):
        """DB format with source_entity, relationship_type, target_entity."""
        rel = {
            "source_entity": "Example Client Ltd",
            "relationship_type": "holds",
            "target_entity": "ISO 27001",
        }
        result = normalise_rel(rel)
        assert result == ("Example Client Ltd", "holds", "iso 27001")

    def test_normalises_classification_output_format(self):
        """Classification output with source, relationship_type, target."""
        rel = {
            "source": "example-datacentre",
            "relationship_type": "holds",
            "target": "ISO 27001",
        }
        result = normalise_rel(rel)
        assert result == ("example-datacentre", "holds", "iso 27001")

    def test_strips_whitespace(self):
        rel = {
            "source": "  example-datacentre  ",
            "relationship_type": "  holds  ",
            "target": "  ISO 27001  ",
        }
        result = normalise_rel(rel)
        assert result == ("example-datacentre", "holds", "iso 27001")

    def test_handles_missing_keys(self):
        rel = {}
        result = normalise_rel(rel)
        assert result == ("", "", "")


class TestComputeDiff:
    """Tests for compute_diff -- the core evaluation metric logic."""

    def test_no_changes(self):
        """When existing and new rels are identical, everything is unchanged."""
        existing = [
            {
                "source_entity": "Example Client Ltd",
                "relationship_type": "holds",
                "target_entity": "iso 27001",
            },
            {
                "source_entity": "Example Client Ltd",
                "relationship_type": "holds",
                "target_entity": "cyber essentials plus",
            },
        ]
        new = [
            {
                "source": "Example Client Ltd",
                "relationship_type": "holds",
                "target": "iso 27001",
            },
            {
                "source": "Example Client Ltd",
                "relationship_type": "holds",
                "target": "cyber essentials plus",
            },
        ]
        diff = compute_diff(existing, new, client_org=CLIENT_ORG)

        assert len(diff["unchanged"]) == 2
        assert len(diff["removed"]) == 0
        assert len(diff["added"]) == 0
        assert len(diff["changed_holder"]) == 0
        assert len(diff["precision_regressions"]) == 0

    def test_supplier_attribution_change(self):
        """example-datacentre false positive case -- source changes from client to supplier."""
        existing = [
            {
                "source_entity": "Example Client Ltd",
                "relationship_type": "holds",
                "target_entity": "iso 27001",
            },
        ]
        new = [
            {
                "source": "example-datacentre",
                "relationship_type": "holds",
                "target": "iso 27001",
            },
        ]
        diff = compute_diff(existing, new, client_org=CLIENT_ORG)

        assert len(diff["unchanged"]) == 0
        assert len(diff["changed_holder"]) == 1
        assert diff["changed_holder"][0]["before_source"] == CLIENT_ORG
        assert diff["changed_holder"][0]["after_source"] == "example-datacentre"
        assert diff["changed_holder"][0]["target"] == "iso 27001"
        # This is a correct supplier attribution, but compute_diff flags it
        # as a precision regression (the caller determines correctness)
        assert len(diff["precision_regressions"]) == 1

    def test_three_example-datacentre_positive_controls(self):
        """All 3 known example-datacentre false positives change -- spec section 4.3."""
        existing = [
            {
                "source_entity": "Example Client Ltd",
                "relationship_type": "holds",
                "target_entity": "iso 27001",
            },
            {
                "source_entity": "Example Client Ltd",
                "relationship_type": "holds",
                "target_entity": "iso 9001",
            },
            {
                "source_entity": "Example Client Ltd",
                "relationship_type": "holds",
                "target_entity": "iso 14001",
            },
            # Self-held cert that should NOT change
            {
                "source_entity": "Example Client Ltd",
                "relationship_type": "holds",
                "target_entity": "cyber essentials plus",
            },
        ]
        new = [
            {
                "source": "example-datacentre",
                "relationship_type": "holds",
                "target": "iso 27001",
            },
            {
                "source": "example-datacentre",
                "relationship_type": "holds",
                "target": "iso 9001",
            },
            {
                "source": "example-datacentre",
                "relationship_type": "holds",
                "target": "iso 14001",
            },
            {
                "source": "Example Client Ltd",
                "relationship_type": "holds",
                "target": "cyber essentials plus",
            },
        ]
        diff = compute_diff(existing, new, client_org=CLIENT_ORG)

        assert len(diff["unchanged"]) == 1  # cyber essentials plus
        assert len(diff["changed_holder"]) == 3
        # All 3 are holder changes from client to example-datacentre
        for change in diff["changed_holder"]:
            assert change["before_source"] == CLIENT_ORG
            assert change["after_source"] == "example-datacentre"

    def test_removed_relationship(self):
        """A relationship in existing but not in new is 'removed'."""
        existing = [
            {
                "source_entity": "Example Client Ltd",
                "relationship_type": "holds",
                "target_entity": "iso 27001",
            },
            {
                "source_entity": "Example Client Ltd",
                "relationship_type": "holds",
                "target_entity": "iso 9001",
            },
        ]
        new = [
            {
                "source": "Example Client Ltd",
                "relationship_type": "holds",
                "target": "iso 27001",
            },
        ]
        diff = compute_diff(existing, new, client_org=CLIENT_ORG)

        assert len(diff["unchanged"]) == 1
        assert len(diff["removed"]) == 1
        removed = diff["removed"][0]
        assert removed["target"] == "iso 9001"

    def test_added_relationship(self):
        """A relationship in new but not existing is 'added'."""
        existing = [
            {
                "source_entity": "Example Client Ltd",
                "relationship_type": "holds",
                "target_entity": "iso 27001",
            },
        ]
        new = [
            {
                "source": "Example Client Ltd",
                "relationship_type": "holds",
                "target": "iso 27001",
            },
            {
                "source": "Example Client Ltd",
                "relationship_type": "holds",
                "target": "iso 9001",
            },
        ]
        diff = compute_diff(existing, new, client_org=CLIENT_ORG)

        assert len(diff["unchanged"]) == 1
        assert len(diff["added"]) == 1
        added = diff["added"][0]
        assert added["target"] == "iso 9001"

    def test_case_insensitive_comparison(self):
        """Different casing should be treated as identical."""
        existing = [
            {
                "source_entity": "Example Client Ltd",
                "relationship_type": "holds",
                "target_entity": "ISO 27001",
            },
        ]
        new = [
            {
                "source": "Example Client Ltd",
                "relationship_type": "holds",
                "target": "iso 27001",
            },
        ]
        diff = compute_diff(existing, new, client_org=CLIENT_ORG)

        assert len(diff["unchanged"]) == 1
        assert len(diff["changed_holder"]) == 0

    def test_empty_inputs(self):
        """Empty lists produce empty diff."""
        diff = compute_diff([], [], client_org=CLIENT_ORG)

        assert len(diff["unchanged"]) == 0
        assert len(diff["removed"]) == 0
        assert len(diff["added"]) == 0
        assert len(diff["changed_holder"]) == 0
        assert len(diff["precision_regressions"]) == 0

    def test_supplier_to_supplier_change_not_regression(self):
        """Source changing from one supplier to another is not a precision regression."""
        existing = [
            {
                "source_entity": "acme hosting",
                "relationship_type": "holds",
                "target_entity": "iso 27001",
            },
        ]
        new = [
            {
                "source": "example-datacentre",
                "relationship_type": "holds",
                "target": "iso 27001",
            },
        ]
        diff = compute_diff(existing, new, client_org=CLIENT_ORG)

        assert len(diff["changed_holder"]) == 1
        # Not a precision regression because old source was not the client org
        assert len(diff["precision_regressions"]) == 0

    def test_mixed_scenario(self):
        """Complex scenario with unchanged, changed, removed, and added rels."""
        existing = [
            # Should stay unchanged
            {
                "source_entity": "Example Client Ltd",
                "relationship_type": "holds",
                "target_entity": "cyber essentials plus",
            },
            # Should change to example-datacentre (positive control)
            {
                "source_entity": "Example Client Ltd",
                "relationship_type": "holds",
                "target_entity": "iso 27001",
            },
            # Should be removed (classifier no longer sees it)
            {
                "source_entity": "Example Client Ltd",
                "relationship_type": "holds",
                "target_entity": "iso 45001",
            },
        ]
        new = [
            # Unchanged
            {
                "source": "Example Client Ltd",
                "relationship_type": "holds",
                "target": "cyber essentials plus",
            },
            # Changed holder
            {
                "source": "example-datacentre",
                "relationship_type": "holds",
                "target": "iso 27001",
            },
            # New detection
            {
                "source": "Example Client Ltd",
                "relationship_type": "holds",
                "target": "iso 22301",
            },
        ]
        diff = compute_diff(existing, new, client_org=CLIENT_ORG)

        assert len(diff["unchanged"]) == 1
        # removed includes both the old iso 27001 (source changed) and iso 45001
        assert len(diff["removed"]) == 2
        # added includes both the new iso 27001 (source changed) and iso 22301
        assert len(diff["added"]) == 2
        assert len(diff["changed_holder"]) == 1
        assert diff["changed_holder"][0]["after_source"] == "example-datacentre"

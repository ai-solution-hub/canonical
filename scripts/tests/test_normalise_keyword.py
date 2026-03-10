"""Tests for normalise_keyword() in classify.py."""

import sys
import os

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kb_pipeline.classify import normalise_keyword, _to_singular


class TestNormaliseKeyword:
    """Tests for AI keyword normalisation."""

    # ── Basic lowercase ──

    def test_basic_lowercase(self):
        """Mixed-case non-proper-noun keyword is lowercased."""
        assert normalise_keyword("Audit System") == "audit system"

    def test_already_lowercase(self):
        """Already lowercase keyword is unchanged."""
        assert normalise_keyword("data protection") == "data protection"

    def test_all_uppercase_non_proper(self):
        """All-caps non-proper-noun keyword is lowercased."""
        assert normalise_keyword("DISASTER RECOVERY") == "disaster recovery"

    # ── Proper noun preservation ──

    def test_iso_27001_preserved(self):
        """ISO 27001 is a known proper noun and preserved."""
        assert normalise_keyword("ISO 27001") == "ISO 27001"

    def test_iso_27001_case_insensitive(self):
        """ISO 27001 is recognised regardless of input casing."""
        assert normalise_keyword("iso 27001") == "ISO 27001"

    def test_gdpr_preserved(self):
        """GDPR is preserved as-is."""
        assert normalise_keyword("GDPR") == "GDPR"

    def test_gdpr_lowercase_input(self):
        """GDPR is recognised from lowercase input."""
        assert normalise_keyword("gdpr") == "GDPR"

    def test_cyber_essentials_plus(self):
        """Complex proper noun 'Cyber Essentials Plus' is preserved."""
        assert normalise_keyword("Cyber Essentials Plus") == "Cyber Essentials Plus"

    def test_cyber_essentials_plus_lowercase(self):
        """Cyber Essentials Plus recognised from lowercase input."""
        assert normalise_keyword("cyber essentials plus") == "Cyber Essentials Plus"

    def test_cyber_essentials_without_plus(self):
        """Cyber Essentials (without Plus) is also a proper noun."""
        assert normalise_keyword("Cyber Essentials") == "Cyber Essentials"

    def test_nhs_preserved(self):
        """NHS acronym is preserved."""
        assert normalise_keyword("NHS") == "NHS"

    def test_companies_house_preserved(self):
        """Companies House is preserved as a proper noun."""
        assert normalise_keyword("Companies House") == "Companies House"

    def test_pci_dss_preserved(self):
        """PCI DSS is preserved."""
        assert normalise_keyword("PCI DSS") == "PCI DSS"

    def test_soc_2_preserved(self):
        """SOC 2 is preserved."""
        assert normalise_keyword("SOC 2") == "SOC 2"

    def test_prince2_preserved(self):
        """PRINCE2 is preserved."""
        assert normalise_keyword("PRINCE2") == "PRINCE2"

    def test_iso_9001_preserved(self):
        """ISO 9001 is preserved."""
        assert normalise_keyword("ISO 9001") == "ISO 9001"

    def test_iso_14001_preserved(self):
        """ISO 14001 is preserved."""
        assert normalise_keyword("ISO 14001") == "ISO 14001"

    def test_iso_22301_preserved(self):
        """ISO 22301 is preserved."""
        assert normalise_keyword("ISO 22301") == "ISO 22301"

    # ── Plural to singular ──

    def test_plural_to_singular_simple(self):
        """Simple plural 'access controls' becomes 'access control'."""
        assert normalise_keyword("access controls") == "access control"

    def test_plural_to_singular_data_centres(self):
        """'data centres' becomes 'data centre'."""
        assert normalise_keyword("data centres") == "data centre"

    def test_no_singular_for_access(self):
        """Words ending in 'ss' are not singularised ('access' stays 'access')."""
        assert normalise_keyword("access") == "access"

    def test_no_singular_for_short_words(self):
        """Short words (<=3 chars) are not singularised."""
        assert normalise_keyword("bus") == "bus"
        assert normalise_keyword("gas") == "gas"

    def test_no_singular_for_us_ending(self):
        """Words ending in 'us' are not singularised."""
        assert normalise_keyword("nexus") == "nexus"

    # ── Whitespace trimming ──

    def test_leading_trailing_whitespace(self):
        """Leading and trailing whitespace is stripped."""
        assert normalise_keyword("  data protection  ") == "data protection"

    def test_only_whitespace(self):
        """Whitespace-only input returns empty string."""
        assert normalise_keyword("   ") == ""

    def test_empty_string(self):
        """Empty string input returns empty string."""
        assert normalise_keyword("") == ""

    # ── Combined normalisation ──

    def test_trim_and_lowercase(self):
        """Trim + lowercase applied together."""
        assert normalise_keyword("  Disaster Recovery  ") == "disaster recovery"

    def test_trim_and_singular(self):
        """Trim + singular applied together."""
        assert normalise_keyword("  background checks  ") == "background check"

    def test_proper_noun_with_whitespace(self):
        """Proper noun with extra whitespace is trimmed and matched."""
        assert normalise_keyword("  ISO 27001  ") == "ISO 27001"


class TestToSingular:
    """Tests for the _to_singular helper."""

    def test_regular_plural(self):
        assert _to_singular("controls") == "control"

    def test_ss_ending(self):
        assert _to_singular("access") == "access"

    def test_us_ending(self):
        assert _to_singular("nexus") == "nexus"

    def test_short_word(self):
        assert _to_singular("bus") == "bus"

    def test_already_singular(self):
        assert _to_singular("audit") == "audit"

    def test_single_char_s(self):
        """Single character 's' is too short to singularise."""
        assert _to_singular("s") == "s"

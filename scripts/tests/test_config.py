"""Tests for config.py — shared configuration for Knowledge Hub pipeline.

Tests cover environment loading, singleton caching, taxonomy injection,
taxonomy section replacement, and Supabase credential getters.

No production code issues discovered during test writing.
"""

import sys
import os

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import patch, MagicMock, mock_open
import pytest

import kb_pipeline.config as config_module
from kb_pipeline.config import (
    _replace_taxonomy_section,
    get_env,
    get_supabase_anon_key,
    get_supabase_secret_key,
    get_supabase_url,
    get_system_prompt,
    load_env,
)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# load_env — filesystem mocked, ~5 tests
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TestLoadEnv:
    """Tests for load_env() which returns os.environ as a dict.

    Since python-dotenv loads .env at module import time, load_env() now
    simply returns dict(os.environ). These tests verify the dict conversion
    and that environment variables are accessible.
    """

    def test_returns_dict_of_environ(self):
        """load_env() returns a plain dict containing os.environ entries."""
        with patch.dict(os.environ, {"FOO": "bar", "BAZ": "qux"}, clear=False):
            result = load_env()
        assert isinstance(result, dict)
        assert result["FOO"] == "bar"
        assert result["BAZ"] == "qux"

    def test_returns_snapshot_not_live_reference(self):
        """load_env() returns a snapshot dict, not a live reference to os.environ."""
        result = load_env()
        assert result is not os.environ

    def test_includes_existing_env_vars(self):
        """load_env() includes pre-existing environment variables like PATH."""
        result = load_env()
        # PATH should always exist in the environment
        assert "PATH" in result


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# get_env — singleton, ~2 tests
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TestGetEnv:
    """Tests for the get_env() lazy singleton."""

    def setup_method(self):
        """Reset singleton state before each test."""
        config_module._env = None

    def teardown_method(self):
        """Reset singleton state after each test."""
        config_module._env = None

    @patch("kb_pipeline.config.load_env")
    def test_returns_cached_dict_on_second_call(self, mock_load):
        """get_env() caches the result — load_env is called only once."""
        mock_load.return_value = {"A": "1"}

        first = get_env()
        second = get_env()

        assert first is second
        mock_load.assert_called_once()

    @patch("kb_pipeline.config.load_env")
    def test_loads_env_on_first_call(self, mock_load):
        """get_env() calls load_env on first invocation."""
        mock_load.return_value = {"KEY": "val"}
        result = get_env()
        assert result == {"KEY": "val"}
        mock_load.assert_called_once()


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# get_system_prompt — taxonomy injection, ~4 tests
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TestGetSystemPrompt:
    """Tests for system prompt loading with optional DB taxonomy injection."""

    def setup_method(self):
        """Reset singleton state before each test."""
        config_module._system_prompt = None
        config_module._use_static_taxonomy = False

    def teardown_method(self):
        """Reset singleton state after each test."""
        config_module._system_prompt = None
        config_module._use_static_taxonomy = False

    @patch("kb_pipeline.config.load_system_prompt")
    def test_static_taxonomy_returns_raw_prompt(self, mock_load):
        """When static taxonomy mode is set, the raw prompt is returned unchanged."""
        config_module._use_static_taxonomy = True
        mock_load.return_value = "Raw prompt with <!-- TAXONOMY_START -->old<!-- TAXONOMY_END -->"

        result = get_system_prompt()

        assert result == "Raw prompt with <!-- TAXONOMY_START -->old<!-- TAXONOMY_END -->"

    @patch("kb_pipeline.config._replace_taxonomy_section")
    @patch("kb_pipeline.config.load_system_prompt")
    def test_db_taxonomy_replaces_section(self, mock_load, mock_replace):
        """DB taxonomy mode fetches taxonomy and replaces the prompt section."""
        raw = "Prompt <!-- TAXONOMY_START -->old<!-- TAXONOMY_END --> end"
        mock_load.return_value = raw
        mock_replace.return_value = "Prompt <!-- TAXONOMY_START -->\nnew\n<!-- TAXONOMY_END --> end"

        with patch("kb_pipeline.store.fetch_taxonomy", return_value=(
            [{"name": "AI"}], [{"name": "models"}]
        )):
            with patch("kb_pipeline.classify.build_taxonomy_section", return_value="new"):
                with patch("kb_pipeline.classify.set_valid_taxonomy"):
                    result = get_system_prompt()

        assert "new" in result

    @patch("kb_pipeline.config.load_system_prompt")
    def test_db_taxonomy_failure_falls_back_to_static(self, mock_load):
        """When DB taxonomy fetch fails, falls back to static prompt."""
        raw = "Static prompt content"
        mock_load.return_value = raw

        with patch("kb_pipeline.store.fetch_taxonomy", side_effect=Exception("DB down")):
            result = get_system_prompt()

        assert result == raw

    @patch("kb_pipeline.config.load_system_prompt")
    def test_caches_after_first_call(self, mock_load):
        """System prompt is cached after first call."""
        config_module._use_static_taxonomy = True
        mock_load.return_value = "Cached prompt"

        first = get_system_prompt()
        second = get_system_prompt()

        assert first is second
        mock_load.assert_called_once()


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# _replace_taxonomy_section — pure function, ~2 tests
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TestReplaceTaxonomySection:
    """Tests for taxonomy section replacement in prompt text."""

    def test_replaces_content_between_markers(self):
        """Content between TAXONOMY_START and TAXONOMY_END markers is replaced."""
        prompt = (
            "Before\n"
            "<!-- TAXONOMY_START -->\nOld taxonomy content\n<!-- TAXONOMY_END -->\n"
            "After"
        )
        result = _replace_taxonomy_section(prompt, "New taxonomy")
        assert "New taxonomy" in result
        assert "Old taxonomy content" not in result
        assert "Before" in result
        assert "After" in result

    def test_raises_value_error_if_markers_missing(self):
        """Raises ValueError when taxonomy markers are not present."""
        prompt = "No markers here"
        with pytest.raises(ValueError):
            _replace_taxonomy_section(prompt, "New content")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Supabase credential getters — ~3 tests each with present/missing
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TestSupabaseCredentialGetters:
    """Tests for Supabase URL and key getters."""

    def setup_method(self):
        """Reset env singleton before each test."""
        config_module._env = None

    def teardown_method(self):
        """Reset env singleton after each test."""
        config_module._env = None

    @patch("kb_pipeline.config.load_env")
    def test_get_supabase_url_returns_value(self, mock_load):
        """get_supabase_url returns the URL when set."""
        mock_load.return_value = {"SUPABASE_URL": "https://abc.supabase.co"}
        assert get_supabase_url() == "https://abc.supabase.co"

    @patch("kb_pipeline.config.load_env")
    def test_get_supabase_url_raises_when_missing(self, mock_load):
        """get_supabase_url raises RuntimeError when not set."""
        mock_load.return_value = {}
        with pytest.raises(RuntimeError, match="SUPABASE_URL"):
            get_supabase_url()

    @patch("kb_pipeline.config.load_env")
    def test_get_supabase_secret_key_returns_value(self, mock_load):
        """get_supabase_secret_key returns the key when set."""
        mock_load.return_value = {"SUPABASE_SECRET_KEY": "secret-123"}
        assert get_supabase_secret_key() == "secret-123"

    @patch("kb_pipeline.config.load_env")
    def test_get_supabase_secret_key_raises_when_missing(self, mock_load):
        """get_supabase_secret_key raises RuntimeError when not set."""
        mock_load.return_value = {}
        with pytest.raises(RuntimeError, match="SUPABASE_SECRET_KEY"):
            get_supabase_secret_key()

    @patch("kb_pipeline.config.load_env")
    def test_get_supabase_anon_key_returns_value(self, mock_load):
        """get_supabase_anon_key returns the key when set."""
        mock_load.return_value = {"SUPABASE_ANON_KEY": "anon-456"}
        assert get_supabase_anon_key() == "anon-456"

    @patch("kb_pipeline.config.load_env")
    def test_get_supabase_anon_key_falls_back_to_next_public(self, mock_load):
        """get_supabase_anon_key falls back to NEXT_PUBLIC_SUPABASE_ANON_KEY."""
        mock_load.return_value = {"NEXT_PUBLIC_SUPABASE_ANON_KEY": "next-pub-789"}
        assert get_supabase_anon_key() == "next-pub-789"

    @patch("kb_pipeline.config.load_env")
    def test_get_supabase_anon_key_raises_when_missing(self, mock_load):
        """get_supabase_anon_key raises RuntimeError when not set."""
        mock_load.return_value = {}
        with pytest.raises(RuntimeError, match="SUPABASE_ANON_KEY"):
            get_supabase_anon_key()

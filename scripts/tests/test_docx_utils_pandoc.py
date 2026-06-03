"""Unit tests for docx_utils pandoc resolution ({80.3}).

Covers the buildpack-friendly fallback added so the cocoindex image (built by
the {66.7} GHCR workflow with no apt layer) can resolve Track Changes: a system
``pandoc`` on PATH is preferred, otherwise the binary bundled by the
``pypandoc_binary`` wheel (resolved via ``pypandoc.get_pandoc_path()``); None
when neither is available, in which case the caller soft-warns and skips.
"""

import os
import sys
import types
from unittest.mock import patch

import pytest

from docx_utils import (
    _check_pandoc_available,
    _resolve_pandoc_path,
    resolve_track_changes,
)


def _fake_pypandoc(path=None, raises=None):
    """Build a stand-in ``pypandoc`` module for sys.modules injection."""
    mod = types.ModuleType("pypandoc")

    def get_pandoc_path():
        if raises is not None:
            raise raises
        return path

    mod.get_pandoc_path = get_pandoc_path
    return mod


class TestResolvePandocPath:
    def test_prefers_system_pandoc(self):
        with patch("docx_utils.shutil.which", return_value="/usr/bin/pandoc"):
            assert _resolve_pandoc_path() == "/usr/bin/pandoc"
            assert _check_pandoc_available() is True

    def test_falls_back_to_pypandoc_binary(self):
        fake = _fake_pypandoc(path="/bundled/pandoc")
        with patch("docx_utils.shutil.which", return_value=None), patch.dict(
            sys.modules, {"pypandoc": fake}
        ):
            assert _resolve_pandoc_path() == "/bundled/pandoc"
            assert _check_pandoc_available() is True

    def test_none_when_pypandoc_absent(self):
        # A None entry in sys.modules forces `import pypandoc` to raise ImportError.
        with patch("docx_utils.shutil.which", return_value=None), patch.dict(
            sys.modules, {"pypandoc": None}
        ):
            assert _resolve_pandoc_path() is None
            assert _check_pandoc_available() is False

    def test_none_when_pypandoc_has_no_binary(self):
        # pypandoc importable but its bundled binary lookup fails (OSError).
        fake = _fake_pypandoc(raises=OSError("No pandoc was found"))
        with patch("docx_utils.shutil.which", return_value=None), patch.dict(
            sys.modules, {"pypandoc": fake}
        ):
            assert _resolve_pandoc_path() is None


class TestResolveTrackChangesUsesResolvedPath:
    def test_raises_when_no_pandoc(self):
        with patch("docx_utils._resolve_pandoc_path", return_value=None):
            with pytest.raises(FileNotFoundError):
                resolve_track_changes("/tmp/whatever.docx")

    def test_invokes_subprocess_with_resolved_path(self, tmp_path):
        src = tmp_path / "in.docx"
        src.write_bytes(b"PK\x03\x04stub")  # content irrelevant; subprocess is mocked
        with patch(
            "docx_utils._resolve_pandoc_path", return_value="/bundled/pandoc"
        ), patch("docx_utils.subprocess.run") as run:
            out = resolve_track_changes(str(src))
        # argv[0] must be the resolved path, NOT a hardcoded "pandoc".
        argv = run.call_args[0][0]
        assert argv[0] == "/bundled/pandoc"
        assert "--track-changes=accept" in argv
        if os.path.exists(out):
            os.unlink(out)

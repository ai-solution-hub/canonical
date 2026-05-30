"""OQ-channel test isolation harness (bl-201 hermeticity fix, folded into ID-43.10).

PROBLEM (surfaced S283).  Run file-by-file, the OQ suite passes; run as a FULL
suite it produced 13 ``test_decide.py`` failures and a ``test_poll_latency`` hang.
The root cause is test non-hermeticity, NOT a substrate bug:

  (b) The parent ``oq_decide`` send-prompt NUDGE (``send-prompt.sh``) resolves its
      events base via ``resolve_project_root`` → the MAIN repo's
      ``.claude/cmux-events/``.  Inside a live cmux session that directory holds
      real worker ``meta.json`` files, so a test that fires the nudge scans — and
      can drive ``cmux send`` against — the live fleet.  That is the
      "live-cmux send-prompt non-hermeticity": the outcome of a unit test then
      depends on whatever fleet happens to be running.

  (c) ``oq_poll_decision`` is unbounded by design in production (OQ-Q2: no channel
      timeout).  A test that forgets to set ``OQ_POLL_MAX_WAIT`` and never receives
      its decision (e.g. because of cross-test contamination) hangs the whole
      suite — there is no ``pytest-timeout`` plugin installed to cut it.

  (a) Per-test ``oq_root`` isolation: every OQ test already uses the function-scoped
      ``tmp_path`` fixture for its channel root, so each test's questions/decisions/
      oq-state live in a unique directory.  This fixture reinforces that by also
      isolating the *events base* the helpers fall back to.

FIX.  An autouse, function-scoped fixture (so it applies to EVERY test under
``scripts/tests/oq/`` with zero per-test wiring) that, for the duration of each
test:

  * points ``KH_CMUX_EVENTS_DIR`` at a per-test, EMPTY directory.  Every helper
    that resolves an events base honours this override
    (``${KH_CMUX_EVENTS_DIR:-…}``), so the nudge's worker scan finds an empty
    fleet → "no worker named X" → the nudge fails fast and is swallowed by
    ``oq_decide``'s ``|| true``; ``cmux send`` is never reached.  This makes the
    nudge provably non-correctness-bearing in tests (prong b) and isolates any
    fallback fleet scan (prong a).

  * sets a default ``OQ_POLL_MAX_WAIT`` backstop (seconds) so any poll loop a test
    forgets to bound still terminates, turning a suite hang into a bounded
    per-test timeout (prong c).  A test that needs different bounds overrides this
    in its own subprocess ``env=`` (the existing ``test_poll_latency`` pattern),
    and a test that passes an explicit events base to ``oq_scan_fleet`` (the
    positional argument wins over the env override).

The backstop is 20 s — comfortably above the OQ-INV-18 10 s latency budget, so a
legitimately slow-but-correct unblock is never falsely cut, while a genuinely
stuck loop cannot wedge the suite.
"""

from __future__ import annotations

import pytest


# Backstop for any poll loop that a test forgets to bound (seconds).  Chosen
# above the OQ-INV-18 10 s budget so a correct unblock is never falsely cut.
_OQ_POLL_BACKSTOP_SECONDS = "20"


@pytest.fixture(autouse=True)
def _oq_test_isolation(tmp_path_factory, monkeypatch):
    """Isolate every OQ test from the live cmux fleet and bound its poll loops.

    Autouse + function-scoped: applies to all tests under scripts/tests/oq/ and
    is torn down (env restored) after each test by ``monkeypatch``.
    """
    # Prong (a)/(b): redirect the events-base fallback to an empty per-test dir so
    # neither the send-prompt nudge nor any fleet scan can touch the real fleet.
    # The dir is created via tmp_path_factory (a SEPARATE basetemp subtree), NOT
    # inside the test's own ``tmp_path`` — several tests count tmp_path entries.
    isolated_events = tmp_path_factory.mktemp("oq_isolated_events")
    monkeypatch.setenv("KH_CMUX_EVENTS_DIR", str(isolated_events))

    # Prong (c): default-bound every poll loop so a forgotten bound cannot hang
    # the suite.  Tests that need a different bound override via their own env=.
    monkeypatch.setenv("OQ_POLL_MAX_WAIT", _OQ_POLL_BACKSTOP_SECONDS)

    yield

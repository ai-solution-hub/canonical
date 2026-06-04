"""Fixture-staging verify driver (ID-62 / {62.7}) — STAGE-ONLY loopback POSTer.

Drives the live-verification corpus-seed half of ID-62: reads a fixed list of
`(fixture_path, dest_path, title_prefix)` tuples (fixtures live under the repo
checkout's `docs/testing/test-data/**`) and POSTs each one as
`multipart/form-data` to the running cocoindex sidecar's bearer-FREE
`POST /stage` route (`scripts/cocoindex_pipeline/server.py::_stage_handler`).

Run::

    python3 -m scripts.cocoindex_pipeline.verify_driver --fixtures <set>

Loopback is the LOAD-BEARING DEFAULT. The driver talks to the sidecar over
`http://localhost:<port>/stage` (the port resolved exactly as `server.py`
resolves it — `$PORT`, default 8080 — overridable via `--port`/`--url` or the
`COCOINDEX_STAGING_URL` env var). It does NOT raw-write the corpus disk: the
`/stage` route owns the byte-drop, so the driver never needs filesystem access
to the corpus root. (An optional `--disk-drop` fallback is deliberately NOT
implemented — loopback is the only supported path; if a future operator needs a
disk fallback it is a conscious additive change, not a silent default.)

STAGE-ONLY boundary (ID-83 / bl-221 — a CONSCIOUS omission, not an oversight)
-----------------------------------------------------------------------------
Under ID-83 / bl-221 the cocoindex sidecar boot is lifespan-only and a `/stage`
POST writes bytes into the corpus dir but DOES NOT trigger ingestion on its own
(there is no continuous `walk_dir` watcher anymore). Ingestion fires only on an
explicit bearer-gated `POST /walk` (`server.py::_walk_handler`, one-shot
`update_blocking(live=False)`).

This driver therefore stages ONLY. The `POST /walk` step (the stage → walk →
assert sequence) is owned by `{62.9}`'s trigger, NOT by this driver. Keeping the
driver stage-only honours the ID-62 Inv-8 separation (the driver seeds the
corpus; the trigger walks it; the test layer asserts) and keeps the driver free
of any bearer-token / single-flight concern.

NO Supabase, NO SQL (enforced, not merely intended)
---------------------------------------------------
The driver stages bytes and inspects HTTP status codes only. It imports NO
Supabase client, runs NO SQL probe, embeds NO Vitest assertion, and performs NO
poll for landed rows. Verifying that staged bytes produced rows is the test
layer's job ({62.9}/{62.10}), downstream of a `/walk`. A unit test asserts this
module imports no `supabase`/`postgres`/`asyncpg`/`psycopg` symbol so the
boundary cannot silently rot.

Exit semantics
--------------
- Exit 0 iff EVERY `/stage` POST returned a 2xx status.
- Exit non-zero on ANY 4xx/5xx/timeout/connection-refused, printing the failing
  fixture + the `/stage` response status/body so the operator can diagnose
  without re-running.

Idempotence / cleanup
---------------------
Re-running re-stages (the `/stage` route is overwrite-on-name), so there is no
clean-corpus precondition. Cleanup (`dropFixture`) is the test layer's job
({62.8}), NOT the driver's — the driver only seeds.

HTTP client: `requests` (already pinned in requirements.txt). No new external
dependency is introduced.
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import requests

# ──────────────────────────────────────────────────────────────────────────
# Fixture sets
# ──────────────────────────────────────────────────────────────────────────
#
# Each tuple is (fixture_path_in_repo_checkout, dest_path, title_prefix):
#   - fixture_path: repo-relative path under docs/testing/test-data/** whose
#     RAW BYTES are read and POSTed as the multipart `file` part.
#   - dest_path:    corpus-relative target the /stage route writes to.
#   - title_prefix: informational prefix the caller embeds in the dest filename
#     (the /stage route does NO in-byte title injection — OQ-62-6).
#
# Sets are keyed by name so `--fixtures <set>` selects which tuples to stage.
# The default `templates` set draws from the committed
# docs/testing/test-data/templates/** corpus.


@dataclass(frozen=True)
class FixtureTuple:
    """One fixture to stage: source bytes path + corpus dest + title prefix."""

    fixture_path: str
    dest_path: str
    title_prefix: str


FIXTURE_SETS: dict[str, tuple[FixtureTuple, ...]] = {
    "templates": (
        FixtureTuple(
            fixture_path=(
                "docs/testing/test-data/templates/itt-services-efa/"
                "evaluation-matrix-itt-vol8.xlsx"
            ),
            dest_path="verify/itt-services-efa-evaluation-matrix-itt-vol8.xlsx",
            title_prefix="VERIFY-ITT-EFA",
        ),
        FixtureTuple(
            fixture_path=(
                "docs/testing/test-data/templates/"
                "sq-standard-selection-questionnaire/"
                "standard-selection-questionnaire-ppn-03-24.pdf"
            ),
            dest_path="verify/sq-standard-selection-questionnaire-ppn-03-24.pdf",
            title_prefix="VERIFY-SQ-SSQ",
        ),
        FixtureTuple(
            fixture_path=(
                "docs/testing/test-data/templates/rfp-british-council/"
                "annex_2_supplier_response.docx"
            ),
            dest_path="verify/rfp-british-council-annex_2_supplier_response.docx",
            title_prefix="VERIFY-RFP-BC",
        ),
    ),
}


# ──────────────────────────────────────────────────────────────────────────
# URL / port resolution (matches server.py's $PORT convention)
# ──────────────────────────────────────────────────────────────────────────


def resolve_stage_url(
    *, url_arg: str | None = None, port_arg: int | None = None
) -> str:
    """Resolve the `/stage` endpoint URL (loopback default).

    Precedence (first match wins):
      1. explicit `--url` arg (used verbatim, must already include `/stage`),
      2. `COCOINDEX_STAGING_URL` env var (used verbatim),
      3. `http://localhost:<port>/stage` where `<port>` is `--port`, else
         `$PORT` (server.py's convention), else 8080.

    Loopback is the load-bearing default: with no flags and no env override the
    driver targets the co-located sidecar on localhost.
    """
    if url_arg:
        return url_arg
    env_url = os.environ.get("COCOINDEX_STAGING_URL")
    if env_url:
        return env_url
    if port_arg is not None:
        port = port_arg
    else:
        # server.py resolves the listen port from $PORT (default 8080).
        port = int(os.environ.get("PORT", "8080"))
    return f"http://localhost:{port}/stage"


# ──────────────────────────────────────────────────────────────────────────
# Staging
# ──────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class StageOutcome:
    """Result of one `/stage` POST attempt."""

    fixture: FixtureTuple
    ok: bool
    status: int | None  # HTTP status, or None on a transport-level failure.
    detail: str  # response body (on HTTP reply) or the transport error text.


def stage_one(
    fixture: FixtureTuple,
    *,
    stage_url: str,
    repo_root: Path,
    timeout: float,
    http_post=requests.post,
) -> StageOutcome:
    """Read one fixture's bytes and POST them multipart to `/stage`.

    `http_post` is injected (defaults to `requests.post`) so the unit test can
    drive the exit-code semantics with a mocked client — no live sidecar.

    Returns a `StageOutcome` carrying the 2xx/non-2xx verdict, the HTTP status
    (or None on a transport failure), and a diagnostic detail string. A
    transport-level failure (timeout, connection refused) is a NON-ok outcome
    with `status=None`, surfaced just like a 4xx/5xx.
    """
    source = repo_root / fixture.fixture_path
    try:
        file_bytes = source.read_bytes()
    except OSError as exc:
        return StageOutcome(
            fixture=fixture,
            ok=False,
            status=None,
            detail=f"could not read fixture bytes at {source}: {exc!r}",
        )

    filename = os.path.basename(fixture.dest_path)
    try:
        resp = http_post(
            stage_url,
            files={"file": (filename, file_bytes, "application/octet-stream")},
            data={
                "destPath": fixture.dest_path,
                "titlePrefix": fixture.title_prefix,
            },
            timeout=timeout,
        )
    except requests.RequestException as exc:
        # Timeout / connection-refused / any transport error → NON-ok, no status.
        return StageOutcome(
            fixture=fixture,
            ok=False,
            status=None,
            detail=f"transport error POSTing to {stage_url}: {exc!r}",
        )

    status = resp.status_code
    ok = 200 <= status < 300
    # Best-effort body capture for the operator's diagnosis on failure.
    try:
        body = resp.text
    except Exception:  # noqa: BLE001 — body read is diagnostic-only, never fatal
        body = "<unreadable response body>"
    return StageOutcome(fixture=fixture, ok=ok, status=status, detail=body)


def stage_fixture_set(
    fixtures: tuple[FixtureTuple, ...],
    *,
    stage_url: str,
    repo_root: Path,
    timeout: float,
    http_post=requests.post,
) -> list[StageOutcome]:
    """Stage every fixture in the set; return the per-fixture outcomes.

    Stages ALL fixtures (does not short-circuit on the first failure) so the
    operator sees the full failure picture in one run rather than re-running to
    discover the next failure.
    """
    return [
        stage_one(
            fixture,
            stage_url=stage_url,
            repo_root=repo_root,
            timeout=timeout,
            http_post=http_post,
        )
        for fixture in fixtures
    ]


# ──────────────────────────────────────────────────────────────────────────
# Repo-root resolution
# ──────────────────────────────────────────────────────────────────────────


def _repo_root() -> Path:
    """Return the repo checkout root (so fixture paths resolve from the checkout).

    This module lives at `<root>/scripts/cocoindex_pipeline/verify_driver.py`, so
    the root is two parents up. Fixture paths are repo-relative
    (`docs/testing/test-data/**`).
    """
    return Path(__file__).resolve().parents[2]


# ──────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python3 -m scripts.cocoindex_pipeline.verify_driver",
        description=(
            "Stage ID-62 verification fixtures into the cocoindex corpus via "
            "the sidecar's POST /stage route (loopback default). Stage-only: "
            "the POST /walk step is owned by {62.9}'s trigger."
        ),
    )
    parser.add_argument(
        "--fixtures",
        default="templates",
        choices=sorted(FIXTURE_SETS),
        help="Which fixture set to stage (default: templates).",
    )
    parser.add_argument(
        "--url",
        default=None,
        help=(
            "Full /stage endpoint URL (verbatim, must include /stage). "
            "Overrides --port and COCOINDEX_STAGING_URL."
        ),
    )
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help=(
            "Sidecar port for the loopback http://localhost:<port>/stage URL "
            "(default: $PORT, else 8080). Ignored if --url or "
            "COCOINDEX_STAGING_URL is set."
        ),
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=30.0,
        help="Per-POST timeout in seconds (default: 30).",
    )
    return parser


def run(argv: list[str] | None = None, *, http_post=requests.post) -> int:
    """Stage the selected fixture set; return the process exit code.

    Returns 0 iff every `/stage` POST returned 2xx; non-zero otherwise. The
    failing fixture(s) + the `/stage` response status/body are printed to stderr
    so the operator can diagnose without re-running. `http_post` is injected for
    the unit test (defaults to `requests.post`).
    """
    args = _build_parser().parse_args(argv)
    stage_url = resolve_stage_url(url_arg=args.url, port_arg=args.port)
    fixtures = FIXTURE_SETS[args.fixtures]
    repo_root = _repo_root()

    print(
        f"verify_driver: staging {len(fixtures)} fixture(s) from set "
        f"'{args.fixtures}' to {stage_url} (stage-only; /walk is {{62.9}}'s job)",
        file=sys.stderr,
    )

    outcomes = stage_fixture_set(
        fixtures,
        stage_url=stage_url,
        repo_root=repo_root,
        timeout=args.timeout,
        http_post=http_post,
    )

    failures = [o for o in outcomes if not o.ok]
    for outcome in outcomes:
        if outcome.ok:
            print(
                f"  OK   {outcome.fixture.dest_path} "
                f"(HTTP {outcome.status})",
                file=sys.stderr,
            )
        else:
            status_text = (
                f"HTTP {outcome.status}" if outcome.status is not None else "no response"
            )
            print(
                f"  FAIL {outcome.fixture.dest_path} ({status_text})\n"
                f"       source: {outcome.fixture.fixture_path}\n"
                f"       detail: {outcome.detail}",
                file=sys.stderr,
            )

    if failures:
        print(
            f"verify_driver: {len(failures)}/{len(outcomes)} fixture(s) FAILED "
            f"to stage — see above",
            file=sys.stderr,
        )
        return 1

    print(
        f"verify_driver: all {len(outcomes)} fixture(s) staged (2xx)",
        file=sys.stderr,
    )
    return 0


def main() -> None:
    """Module entry point — `python3 -m scripts.cocoindex_pipeline.verify_driver`."""
    sys.exit(run())


if __name__ == "__main__":
    main()

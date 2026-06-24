"""URL-mode verify driver (ID-62 / {62.10}) — host-side URL parameterisation.

The URL parameterisation of the ID-62 verify-driver primitive (Inv-21: ONE
primitive parameterised by (fixture set, assertion set) — this module is NOT
a fork of the file-fixture driver, it is the URL (fixture, assertion) pair):

  - **Fixture step** — a SEEDED LEDGER ROW, not staged bytes: one gate-passed
    `feed_articles` row service-role-inserted into staging Supabase
    (`workspace_id` + `feed_source_id` looked up / seeded alongside,
    `external_url = normalise_url(<proof URL>)`, `title` NOT NULL,
    `passed = true`, `published_at` set). NO `/stage` byte-staging, NO local
    HTML fixture — `/stage` remains file-fixture-only ({75.11} docstring).
  - **Trigger step** — `POST {worker}/walk` with
    `Authorization: Bearer ${CRON_SECRET}` (the existing bl-221 route; no new
    server surface). A 409 (walk already in flight — e.g. the hourly Coolify
    fallback task) is retried until accepted or deadline.
  - **Assertion surfaced via exit code (Inv-23)** — poll for the landed
    `source_documents` row (id = uuid5(NS, "sd:" + normalised URL)) to
    confirm the walk produced the landing row. Row-SHAPE assertions are NOT
    re-implemented here (Inv-22) — the SINGLE row-assertion surface is the
    Vitest landing-set file. ID-112.7 / ID-129.2: HTML extraction is fully
    in-process (Trafilatura); there is no external extractor service to
    round-trip, so the landing poll IS the host-side proof.
  - **Second-walk idempotency leg** — re-`POST /walk` in the SAME invocation
    (retry-on-409 doubles as the walk-1-completed signal: the bl-221
    single-flight lock 409s while walk 1 runs), then wait for the walk-2
    terminal `pipeline_runs` row (webhook-landed; staging compose wires
    `PIPELINE_RUN_WEBHOOK_URL`) so the Vitest leg never races a half-done
    second walk. {75.17}: this leg is ALSO load-bearing for the Vitest §5.4
    backlink assertion — walk 1 ALWAYS defers the
    `feed_articles.reference_item_id` backlink (the in-component write races
    the engine's post-return ri_target flush; structured
    `cocoindex.url_backlink_deferred` log) and it converges on walk 2, so
    `--skip-second-walk` invalidates §5.4, not just the idempotency counts.

WHY THIS FILE LIVES HERE (and not beside the {62.7} stage driver)
-----------------------------------------------------------------
`scripts/cocoindex_pipeline/verify_driver.py` is the FILE-fixture
parameterisation: it runs IN-CONTAINER (the buildpack image packages
`scripts/` only) and its no-Supabase boundary is test-enforced
(`scripts/tests/test_cocoindex_verify_driver.py` asserts the module imports
no Supabase/SQL symbol). The URL parameterisation REQUIRES service-role
Supabase access (seed + landing-row read), so it is a HOST-side tool —
co-located with `live-verify.sh` under `deploy/onprem/verify/`. The stage
driver is deliberately untouched.

Row-shape assertions are NOT re-implemented here (Inv-22): the SINGLE
row-assertion surface for the TECH §5 landing set is
`__tests__/integration/cocoindex/url-landing-set.integration.test.ts`
(live service-role Supabase, reachable from anywhere — Inv-27).

Run (from the repo checkout root — PEP 420 namespace import)::

    COCOINDEX_URL_VERIFY_URL=https://example.com/ \
    COCOINDEX_WORKER_URL=https://<staging-worker> \
    CRON_SECRET=<redacted> \
    NEXT_PUBLIC_SUPABASE_URL=https://<staging-project-ref>.supabase.co \
    SUPABASE_SERVICE_ROLE_KEY=<redacted> \
    python3 -m deploy.onprem.verify.verify_driver

Exit semantics (Inv-23):
  - 0   — seed landed, walk accepted, the sd landing row was observed, and
          (unless `--skip-second-walk`) the second walk reached a
          `completed` pipeline_runs row.
  - 1   — any step failed (the failing step + diagnostic is printed).
  - 2   — configuration error (missing env), printed by name.

HTTP client: `requests` against PostgREST / the worker — no supabase-py
dependency, mirroring the stage driver's requests-only style. The proof URL
defaults to https://example.com/ (IANA-reserved per RFC 2606: content-stable,
purpose-built for examples — politeness + determinism).
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

import requests

from scripts.cocoindex_pipeline.url_normalise import normalise_url

# ──────────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────────

# Mirror of `flow.py::_KH_PIPELINE_DOC_NS` — the fixed namespace for the
# pipeline's deterministic per-document uuid5 PKs. Pinned there "so the value
# is stable across processes and deploys"; re-pinned here (with the same
# literal) because flow.py imports cocoindex and is not host-importable.
_KH_PIPELINE_DOC_NS = uuid.UUID("fbfaf1ff-1ee4-583c-9757-1674465b2ec1")

# Mirror of `flow.py::KH_CANONICAL_PIPELINE_NAME` (Inv-16 rollup rows).
_KH_CANONICAL_PIPELINE_NAME = "kh_canonical_pipeline"

# IANA-reserved example domain (RFC 2606) — content-stable and explicitly
# intended for documentation/testing use, so repeated fetches are polite and
# deterministic. Normalises to itself.
PROOF_URL_DEFAULT = "https://example.com/"

# Deterministic seed values. The feed source is INACTIVE so the TS RSS
# poller never polls it; the title is NOT NULL per the feed_articles schema.
VERIFY_FEED_SOURCE_NAME = "kh-url-landing-set-verify (ID-62.10)"
VERIFY_ARTICLE_TITLE = "KH URL landing-set verify (ID-62.10)"
VERIFY_PUBLISHED_AT = "2026-01-01T00:00:00+00:00"


# ──────────────────────────────────────────────────────────────────────────
# Config / injected dependencies
# ──────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class DriverConfig:
    """Resolved configuration for one URL-mode driver invocation."""

    proof_url: str
    supabase_url: str
    service_role_key: str
    worker_url: str
    cron_secret: str
    timeout: float = 30.0
    sd_poll_deadline: float = 900.0
    sd_poll_interval: float = 10.0
    walk_retry_deadline: float = 900.0
    walk_retry_interval: float = 15.0
    walk2_run_deadline: float = 300.0
    walk2_run_interval: float = 10.0
    second_walk: bool = True


@dataclass(frozen=True)
class Deps:
    """Injectable side-effect surface (mocked by the unit tests)."""

    http_get: Callable[..., Any] = requests.get
    http_post: Callable[..., Any] = requests.post
    http_patch: Callable[..., Any] = requests.patch
    sleep: Callable[[float], None] = time.sleep
    monotonic: Callable[[], float] = time.monotonic


@dataclass(frozen=True)
class SeedOutcome:
    """Result of the fixture (seed) step."""

    ok: bool
    detail: str
    normalised_url: str = ""


# ──────────────────────────────────────────────────────────────────────────
# Derivations
# ──────────────────────────────────────────────────────────────────────────


def sd_document_id(proof_url: str) -> uuid.UUID:
    """The deterministic `source_documents` PK for a proof URL.

    uuid5(_KH_PIPELINE_DOC_NS, "sd:" + normalised URL) — the exact derivation
    `flow.py` mints for the URL landing path (TECH §5).
    """
    return uuid.uuid5(_KH_PIPELINE_DOC_NS, f"sd:{normalise_url(proof_url)}")


def _rest_headers(config: DriverConfig) -> dict[str, str]:
    """Service-role PostgREST headers (apikey + bearer)."""
    return {
        "apikey": config.service_role_key,
        "Authorization": f"Bearer {config.service_role_key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _rest_url(config: DriverConfig, table: str) -> str:
    return f"{config.supabase_url.rstrip('/')}/rest/v1/{table}"


def _log(message: str) -> None:
    print(f"verify_driver[url]: {message}", file=sys.stderr)


def _rows(resp: Any) -> list[dict[str, Any]]:
    """Parse a PostgREST JSON-array response body (empty list on no body)."""
    try:
        body = resp.json()
    except ValueError:
        return []
    return body if isinstance(body, list) else []


# ──────────────────────────────────────────────────────────────────────────
# Step 1 — fixture: seed ONE gate-passed feed_articles row
# ──────────────────────────────────────────────────────────────────────────


def seed_ledger_row(config: DriverConfig, deps: Deps) -> SeedOutcome:
    """Service-role insert (or re-assert) of the gate-passed ledger row.

    Idempotent across driver re-runs: an existing verify row is PATCHed —
    `passed=true` re-asserted and `ingested_at` bumped so the content epoch
    (D-4 memo token) forces a fresh fetch + extraction on the next walk.
    """
    normalised = normalise_url(config.proof_url)
    headers = _rest_headers(config)

    # (1) workspace — reuse any existing staging workspace (NOT NULL FK).
    resp = deps.http_get(
        _rest_url(config, "workspaces"),
        headers=headers,
        params={"select": "id", "limit": "1"},
        timeout=config.timeout,
    )
    workspaces = _rows(resp)
    if resp.status_code != 200 or not workspaces:
        return SeedOutcome(
            ok=False,
            detail=(
                "no workspace row available to anchor the seed "
                f"(GET workspaces -> HTTP {resp.status_code}, "
                f"{len(workspaces)} row(s))"
            ),
        )
    workspace_id = workspaces[0]["id"]

    # (2) feed_source — reuse the verify source if present, else insert an
    #     INACTIVE one (the TS poller must never poll it).
    resp = deps.http_get(
        _rest_url(config, "feed_sources"),
        headers=headers,
        params={
            "select": "id",
            "name": f"eq.{VERIFY_FEED_SOURCE_NAME}",
            "limit": "1",
        },
        timeout=config.timeout,
    )
    sources = _rows(resp)
    if sources:
        feed_source_id = sources[0]["id"]
    else:
        resp = deps.http_post(
            _rest_url(config, "feed_sources"),
            headers=headers,
            json={
                "workspace_id": workspace_id,
                "name": VERIFY_FEED_SOURCE_NAME,
                "url": normalised,
                "source_type": "web",
                "is_active": False,
            },
            timeout=config.timeout,
        )
        created = _rows(resp)
        if resp.status_code not in (200, 201) or not created:
            return SeedOutcome(
                ok=False,
                detail=(
                    f"feed_sources insert failed (HTTP {resp.status_code}): "
                    f"{resp.text[:300]}"
                ),
            )
        feed_source_id = created[0]["id"]

    # (3) feed_articles — the gate-passed ledger row (TECH §5 step 1).
    now_iso = datetime.now(timezone.utc).isoformat()
    resp = deps.http_get(
        _rest_url(config, "feed_articles"),
        headers=headers,
        params={
            "select": "id",
            "external_url": f"eq.{normalised}",
            "feed_source_id": f"eq.{feed_source_id}",
            "limit": "1",
        },
        timeout=config.timeout,
    )
    articles = _rows(resp)
    if articles:
        resp = deps.http_patch(
            _rest_url(config, "feed_articles"),
            headers=headers,
            params={"id": f"eq.{articles[0]['id']}"},
            json={
                "passed": True,
                "published_at": VERIFY_PUBLISHED_AT,
                "ingested_at": now_iso,
            },
            timeout=config.timeout,
        )
        if resp.status_code not in (200, 204):
            return SeedOutcome(
                ok=False,
                detail=(
                    f"feed_articles re-assert PATCH failed "
                    f"(HTTP {resp.status_code}): {resp.text[:300]}"
                ),
            )
        return SeedOutcome(
            ok=True,
            detail=f"re-asserted existing ledger row for {normalised}",
            normalised_url=normalised,
        )

    resp = deps.http_post(
        _rest_url(config, "feed_articles"),
        headers=headers,
        json={
            "workspace_id": workspace_id,
            "feed_source_id": feed_source_id,
            "external_url": normalised,
            "title": VERIFY_ARTICLE_TITLE,
            "passed": True,
            "published_at": VERIFY_PUBLISHED_AT,
            "ingested_at": now_iso,
        },
        timeout=config.timeout,
    )
    if resp.status_code not in (200, 201):
        return SeedOutcome(
            ok=False,
            detail=(
                f"feed_articles insert failed (HTTP {resp.status_code}): "
                f"{resp.text[:300]}"
            ),
        )
    return SeedOutcome(
        ok=True,
        detail=f"seeded gate-passed ledger row for {normalised}",
        normalised_url=normalised,
    )


# ──────────────────────────────────────────────────────────────────────────
# Step 2 — trigger: POST {worker}/walk (retry on 409 single-flight)
# ──────────────────────────────────────────────────────────────────────────


def walk_until_accepted(config: DriverConfig, deps: Deps) -> tuple[bool, str]:
    """POST `/walk` until 202-accepted, retrying ONLY the 409 in-flight case.

    A 409 means the bl-221 single-flight lock is held (another walk —
    possibly the hourly Coolify fallback — is running); any other non-202
    (401/400/503/transport failure) fails fast: retrying cannot fix a bad
    bearer or an unset corpus.
    """
    walk_url = f"{config.worker_url.rstrip('/')}/walk"
    deadline = deps.monotonic() + config.walk_retry_deadline
    while True:
        try:
            resp = deps.http_post(
                walk_url,
                headers={"Authorization": f"Bearer {config.cron_secret}"},
                timeout=config.timeout,
            )
        except requests.RequestException as exc:
            return False, f"transport error POSTing {walk_url}: {exc!r}"
        if resp.status_code == 202:
            return True, f"walk accepted: {resp.text[:200]}"
        if resp.status_code != 409:
            return (
                False,
                f"/walk rejected (HTTP {resp.status_code}): {resp.text[:300]}",
            )
        if deps.monotonic() >= deadline:
            return (
                False,
                f"/walk still 409 (walk in flight) after "
                f"{config.walk_retry_deadline}s",
            )
        deps.sleep(config.walk_retry_interval)


# ──────────────────────────────────────────────────────────────────────────
# Step 3 — poll for the landed source_documents row (the exit-code assertion)
# ──────────────────────────────────────────────────────────────────────────


def poll_landed_sd_row(config: DriverConfig, deps: Deps) -> bool:
    """Poll for the landed sd row at the deterministic uuid5 PK.

    Landing plumbing only — row-SHAPE assertions stay in the Vitest surface
    (Inv-22). Returns True once the row is observed, False on deadline.
    """
    sd_id = sd_document_id(config.proof_url)
    headers = _rest_headers(config)
    deadline = deps.monotonic() + config.sd_poll_deadline
    while True:
        resp = deps.http_get(
            _rest_url(config, "source_documents"),
            headers=headers,
            params={"select": "id", "id": f"eq.{sd_id}"},
            timeout=config.timeout,
        )
        if _rows(resp):
            return True
        if deps.monotonic() >= deadline:
            return False
        deps.sleep(config.sd_poll_interval)


# ──────────────────────────────────────────────────────────────────────────
# Step 4 — second-walk idempotency leg (pipeline_runs terminal wait)
# ──────────────────────────────────────────────────────────────────────────


def wait_for_terminal_pipeline_run(
    config: DriverConfig, deps: Deps, *, since_iso: str
) -> tuple[bool, str]:
    """Wait for a terminal `pipeline_runs` row created at/after `since_iso`.

    The walk-2 rollup row lands via the worker's pipeline-runs webhook
    (`PIPELINE_RUN_WEBHOOK_URL` — wired in the staging compose). `completed`
    → ok; `failed` → non-ok; deadline → non-ok with the webhook dependency
    named so a mis-wired worker is diagnosable without re-running.
    """
    headers = _rest_headers(config)
    deadline = deps.monotonic() + config.walk2_run_deadline
    while True:
        resp = deps.http_get(
            _rest_url(config, "pipeline_runs"),
            headers=headers,
            params={
                "select": "id,status",
                "pipeline_name": f"eq.{_KH_CANONICAL_PIPELINE_NAME}",
                "created_at": f"gte.{since_iso}",
                "order": "created_at.desc",
                "limit": "5",
            },
            timeout=config.timeout,
        )
        for row in _rows(resp):
            status = row.get("status")
            if status == "completed":
                return True, f"second walk completed (pipeline_runs {row['id']})"
            if status == "failed":
                return (
                    False,
                    f"second walk failed (pipeline_runs {row['id']} "
                    f"status=failed)",
                )
        if deps.monotonic() >= deadline:
            return (
                False,
                "no terminal pipeline_runs row observed after "
                f"{config.walk2_run_deadline}s — check the worker's "
                "PIPELINE_RUN_WEBHOOK_URL wiring (rollup rows land via the "
                "webhook) or inspect `docker logs` for "
                "'/walk completed (requestId=…)'",
            )
        deps.sleep(config.walk2_run_interval)


# ──────────────────────────────────────────────────────────────────────────
# Orchestration
# ──────────────────────────────────────────────────────────────────────────


def run_with(config: DriverConfig, deps: Deps) -> int:
    """Drive seed → walk → landing poll → second walk.

    Returns the process exit code (0 pass / 1 fail) — Inv-23: the landing
    verdict IS the exit code; no row-shape assertions are re-implemented
    here (Inv-22 — those are the Vitest landing-set file's job).
    """
    normalised = normalise_url(config.proof_url)
    _log(
        f"URL parameterisation: proof URL {config.proof_url} "
        f"(normalised {normalised}; sd id {sd_document_id(config.proof_url)})"
    )

    seed = seed_ledger_row(config, deps)
    if not seed.ok:
        _log(f"FAIL seed: {seed.detail}")
        return 1
    _log(f"seed: {seed.detail}")

    ok, detail = walk_until_accepted(config, deps)
    if not ok:
        _log(f"FAIL walk 1: {detail}")
        return 1
    _log(f"walk 1: {detail}")

    if not poll_landed_sd_row(config, deps):
        _log(
            "FAIL sd poll: no source_documents row landed within "
            f"{config.sd_poll_deadline}s "
            f"(id {sd_document_id(config.proof_url)})"
        )
        return 1
    _log(f"sd row landed (id {sd_document_id(config.proof_url)})")

    if config.second_walk:
        since_iso = datetime.now(timezone.utc).isoformat()
        ok, detail = walk_until_accepted(config, deps)
        if not ok:
            _log(f"FAIL walk 2 (idempotency leg): {detail}")
            return 1
        _log(f"walk 2 (idempotency leg): {detail}")
        ok, detail = wait_for_terminal_pipeline_run(
            config, deps, since_iso=since_iso
        )
        if not ok:
            _log(f"FAIL walk 2 completion: {detail}")
            return 1
        _log(f"walk 2 completion: {detail}")
    else:
        _log("second walk SKIPPED (--skip-second-walk)")

    _log("URL landing-set drive PASSED — run the Vitest landing-set file next")
    return 0


# ──────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────

_REQUIRED_ENV = (
    ("SUPABASE_SERVICE_ROLE_KEY", "service-role key for the seed + reads"),
    ("COCOINDEX_WORKER_URL", "staging worker base URL (POST /walk target)"),
    ("CRON_SECRET", "bearer for the bl-221 /walk route"),
)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python3 -m deploy.onprem.verify.verify_driver",
        description=(
            "URL-mode verify driver (ID-62 {62.10}): seed ONE gate-passed "
            "feed_articles row, POST /walk, exit-code the sd landing-row "
            "poll, then re-walk for the idempotency leg."
        ),
    )
    parser.add_argument(
        "--proof-url",
        default=None,
        help=(
            "Public proof URL (default: $COCOINDEX_URL_VERIFY_URL, else "
            f"{PROOF_URL_DEFAULT})"
        ),
    )
    parser.add_argument(
        "--skip-second-walk",
        action="store_true",
        help="Skip the second-walk idempotency leg (default: run it).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=30.0,
        help="Per-HTTP-call timeout in seconds (default: 30).",
    )
    parser.add_argument(
        "--sd-poll-deadline",
        type=float,
        default=900.0,
        help="Max seconds to wait for the landed sd row (default: 900).",
    )
    return parser


def run(argv: list[str] | None = None) -> int:
    """CLI entry: resolve env config, then drive `run_with` over live deps."""
    args = _build_parser().parse_args(argv)

    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get(
        "SUPABASE_URL"
    )
    missing = []
    if not supabase_url:
        missing.append(
            ("NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)", "Supabase project URL")
        )
    missing.extend(
        (name, why) for name, why in _REQUIRED_ENV if not os.environ.get(name)
    )
    if missing:
        for name, why in missing:
            _log(f"CONFIG: missing env {name} — {why}")
        return 2

    config = DriverConfig(
        proof_url=(
            args.proof_url
            or os.environ.get("COCOINDEX_URL_VERIFY_URL")
            or PROOF_URL_DEFAULT
        ),
        supabase_url=str(supabase_url),
        service_role_key=os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        worker_url=os.environ["COCOINDEX_WORKER_URL"],
        cron_secret=os.environ["CRON_SECRET"],
        timeout=args.timeout,
        sd_poll_deadline=args.sd_poll_deadline,
        second_walk=not args.skip_second_walk,
    )
    return run_with(config, Deps())


def main() -> None:
    """Module entry — `python3 -m deploy.onprem.verify.verify_driver`."""
    sys.exit(run())


if __name__ == "__main__":
    main()

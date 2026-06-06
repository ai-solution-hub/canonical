"""URL normalisation for dedup — Python port of the TS rule (D-8, ID-75.7).

Ports ``normaliseUrl`` from ``lib/intelligence/content-extractor.ts``
rule-for-rule: lowercase hostname; delete the tracking query params
``utm_source, utm_medium, utm_campaign, utm_term, utm_content, ref, source``;
strip the trailing slash from a non-root path; return the input unchanged on
parse failure.

The TS side serialises through the WHATWG URL API, so this port also mirrors
the WHATWG serialisation behaviours that the shared parity fixture pins down:
a bare host gains a root slash, the scheme is lowercased, and default ports
(http:80 / https:443) are stripped.

The function MUST be idempotent: ``feed_articles.external_url`` is stored
already-normalised by the TS pipeline and the Python side re-applies
``normalise_url`` defensively (BI-2/BI-8).

Parity contract: every case in
``scripts/tests/fixtures/url_normalisation_parity.json`` is asserted against
BOTH this function (``scripts/tests/test_url_normalise.py``) and the TS
original (``__tests__/validation/url-normalisation-parity.test.ts``). Change
both implementations together or the guard breaks on both sides.
"""

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# Mirror of `trackingParams` in lib/intelligence/content-extractor.ts.
TRACKING_PARAMS = frozenset(
    [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "ref",
        "source",
    ]
)

# WHATWG default ports stripped at serialisation by the URL API.
_DEFAULT_PORTS = {"http": 80, "https": 443}


def normalise_url(url: str) -> str:
    """Normalise a URL for dedup — exact rule of TS ``normaliseUrl``.

    Returns the input unchanged when it cannot be parsed as an absolute URL
    (mirroring ``new URL(url)`` throwing in TS).
    """
    try:
        parts = urlsplit(url)
        # `new URL()` throws on relative/scheme-less input; urlsplit does not,
        # so treat a missing scheme or host as the parse-failure branch.
        if not parts.scheme or not parts.netloc:
            return url
        hostname = parts.hostname
        if not hostname:
            return url
        port = parts.port  # raises ValueError on a malformed port
    except ValueError:
        return url

    scheme = parts.scheme.lower()

    # Rebuild netloc with lowercased hostname, preserving userinfo and any
    # non-default port (WHATWG strips http:80 / https:443 at serialisation).
    netloc = ""
    if parts.username:
        netloc += parts.username
        if parts.password:
            netloc += f":{parts.password}"
        netloc += "@"
    netloc += hostname.lower()
    if port is not None and _DEFAULT_PORTS.get(scheme) != port:
        netloc += f":{port}"

    # Delete tracking params, preserving the order of the remaining pairs.
    # urlencode serialises application/x-www-form-urlencoded, matching the
    # WHATWG URLSearchParams serialisation the TS side re-emits.
    pairs = parse_qsl(parts.query, keep_blank_values=True)
    kept = [(key, value) for key, value in pairs if key not in TRACKING_PARAMS]
    query = urlencode(kept)

    # WHATWG serialises a bare host with a root path; then strip the trailing
    # slash from any non-root path.
    path = parts.path or "/"
    if path.endswith("/") and len(path) > 1:
        path = path[:-1]

    return urlunsplit((scheme, netloc, path, query, parts.fragment))

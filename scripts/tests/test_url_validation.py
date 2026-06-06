"""BI-21 (ID-75.7) — SSRF URL-validation tests.

``validate_url`` is a verbatim port of lib/extraction/url-validation.ts:
http/https only; reject loopback hostnames and private/reserved IPv4 ranges.
Each blocked class must be rejected WITH a reason string; representative
public URLs must pass.
"""

import pytest

from scripts.cocoindex_pipeline.url_validation import validate_url

# ──────────────────────────────────────────────────────────────────────────
# Blocked classes — each must be rejected with a non-empty reason string
# ──────────────────────────────────────────────────────────────────────────

NON_HTTP_PROTOCOLS = [
    "ftp://example.com/file.txt",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "gopher://example.com/",
]

LOOPBACK_URLS = [
    "http://localhost/admin",
    "http://localhost:3000/",
    "https://127.0.0.1/secrets",
    "http://0.0.0.0:8080/",
    "http://[::1]/internal",
]

PRIVATE_RANGE_URLS = [
    # 10.0.0.0/8
    "http://10.0.0.1/",
    "http://10.255.255.255/x",
    # 172.16.0.0/12 (172.16 – 172.31)
    "http://172.16.0.1/",
    "http://172.31.255.254/y",
    # 192.168.0.0/16
    "http://192.168.1.1/router",
    # 169.254.0.0/16 (link-local)
    "http://169.254.169.254/latest/meta-data/",
]

INVALID_FORMAT_URLS = [
    "not a url",
    "http://",
]


@pytest.mark.parametrize("url", NON_HTTP_PROTOCOLS)
def test_rejects_non_http_protocols(url: str) -> None:
    valid, reason = validate_url(url)
    assert valid is False
    assert isinstance(reason, str) and reason
    assert "only http and https are allowed" in reason


@pytest.mark.parametrize("url", LOOPBACK_URLS)
def test_rejects_loopback_hostnames(url: str) -> None:
    valid, reason = validate_url(url)
    assert valid is False
    assert isinstance(reason, str) and reason
    assert "localhost or loopback" in reason


@pytest.mark.parametrize("url", PRIVATE_RANGE_URLS)
def test_rejects_private_and_reserved_ipv4_ranges(url: str) -> None:
    valid, reason = validate_url(url)
    assert valid is False
    assert isinstance(reason, str) and reason
    assert "private or reserved IP ranges" in reason


@pytest.mark.parametrize("url", INVALID_FORMAT_URLS)
def test_rejects_unparseable_urls(url: str) -> None:
    valid, reason = validate_url(url)
    assert valid is False
    assert reason == "Invalid URL format"


@pytest.mark.parametrize("url", [None, "", 42])
def test_rejects_missing_or_non_string_input(url: object) -> None:
    valid, reason = validate_url(url)
    assert valid is False
    assert reason == "URL is required"


# ──────────────────────────────────────────────────────────────────────────
# Allowed — representative public URLs pass with no reason
# ──────────────────────────────────────────────────────────────────────────

PUBLIC_URLS = [
    "https://www.gov.uk/contracts-finder",
    "http://example.com/article",
    "https://example.com/path?query=1#frag",
    # Public IPs and near-miss neighbours of blocked ranges
    "https://8.8.8.8/",
    "http://172.15.0.1/",  # just below 172.16.0.0/12
    "http://172.32.0.1/",  # just above 172.16.0.0/12
    "http://192.169.0.1/",  # not 192.168/16
    "http://169.253.0.1/",  # not 169.254/16
    "http://11.0.0.1/",  # not 10/8
]


@pytest.mark.parametrize("url", PUBLIC_URLS)
def test_public_urls_pass(url: str) -> None:
    valid, reason = validate_url(url)
    assert valid is True
    assert reason is None

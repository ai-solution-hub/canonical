"""SSRF protection — validates URLs are safe to fetch (BI-21, ID-75.7).

Verbatim Python port of ``validateUrl`` in ``lib/extraction/url-validation.ts``:
rejects private IP ranges, localhost/loopback hostnames, and non-HTTP
protocols to prevent server-side request forgery attacks.

Returns ``(True, None)`` when the URL is safe, or ``(False, reason)`` when it
must be rejected — the reason strings mirror the TS originals.
"""

from collections.abc import Callable
from urllib.parse import urlsplit


def _is_172_private(ip: str) -> bool:
    """172.16.0.0/12 — second octet 16–31."""
    octets = ip.split(".")
    if octets[0] != "172" or len(octets) < 2:
        return False
    try:
        second = int(octets[1])
    except ValueError:
        return False
    return 16 <= second <= 31


# Private and reserved IPv4 ranges that must be blocked
# (mirror of BLOCKED_IPV4_RANGES in lib/extraction/url-validation.ts).
BLOCKED_IPV4_RANGES: list[Callable[[str], bool]] = [
    # 10.0.0.0/8
    lambda ip: ip.startswith("10."),
    # 172.16.0.0/12
    _is_172_private,
    # 192.168.0.0/16
    lambda ip: ip.startswith("192.168."),
    # 169.254.0.0/16 (link-local)
    lambda ip: ip.startswith("169.254."),
]

# Hostnames that resolve to loopback and must be blocked
# (mirror of BLOCKED_HOSTNAMES in lib/extraction/url-validation.ts).
BLOCKED_HOSTNAMES = frozenset(
    [
        "localhost",
        "127.0.0.1",
        "0.0.0.0",  # noqa: S104 — blocklist entry, not a bind address
        "::1",
        "[::1]",
    ]
)

# WHATWG "special" schemes whose URLs `new URL()` rejects when hostless —
# mirrored so hostless inputs like "http://" hit the same Invalid-format
# branch as the TS parse failure. `file:` is special too but is permitted to
# be hostless (new URL('file:///etc/passwd') parses and then fails the
# protocol check), so it is deliberately absent here.
_SPECIAL_SCHEMES = frozenset(["http", "https", "ws", "wss", "ftp"])


def _is_blocked_ip(hostname: str) -> bool:
    """Check whether a hostname is a loopback or an IPv4 address in a blocked range."""
    # Strip square brackets for IPv6
    clean = hostname.removeprefix("[").removesuffix("]")

    # Check loopback addresses
    if clean in BLOCKED_HOSTNAMES:
        return True

    # Check private IPv4 ranges
    return any(check(clean) for check in BLOCKED_IPV4_RANGES)


def validate_url(url: object) -> tuple[bool, str | None]:
    """Validate a URL for safe fetching.

    Returns ``(True, None)`` if the URL is safe, or ``(False, reason)`` if it
    should be rejected.
    """
    if not url or not isinstance(url, str):
        return (False, "URL is required")

    try:
        parts = urlsplit(url)
        hostname = parts.hostname  # raises ValueError on malformed IPv6
        port = parts.port  # raises ValueError on a malformed port
        del port
    except ValueError:
        return (False, "Invalid URL format")

    scheme = parts.scheme.lower()
    # `new URL()` throws on scheme-less input and on hostless special-scheme
    # URLs (e.g. "http://") — both map to the Invalid-format branch.
    if not scheme or (scheme in _SPECIAL_SCHEMES and not hostname):
        return (False, "Invalid URL format")

    # Must be http:// or https://
    if scheme not in ("http", "https"):
        return (
            False,
            f'Unsupported protocol "{scheme}:" — only http and https are allowed',
        )

    # Check hostname against blocked lists (urlsplit lowercases .hostname and
    # strips IPv6 brackets, matching the TS .toLowerCase() + bracket strip).
    hostname = (hostname or "").lower()

    if hostname in BLOCKED_HOSTNAMES:
        return (
            False,
            "URLs pointing to localhost or loopback addresses are not allowed",
        )

    if _is_blocked_ip(hostname):
        return (
            False,
            "URLs pointing to private or reserved IP ranges are not allowed",
        )

    return (True, None)

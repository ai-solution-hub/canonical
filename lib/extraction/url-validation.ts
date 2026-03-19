/**
 * SSRF protection — validates URLs are safe to fetch.
 *
 * Rejects private IP ranges, localhost, and non-HTTP protocols
 * to prevent server-side request forgery attacks.
 */

/** Private and reserved IPv4 ranges that must be blocked */
const BLOCKED_IPV4_RANGES = [
  // 10.0.0.0/8
  { prefix: '10.', check: (ip: string) => ip.startsWith('10.') },
  // 172.16.0.0/12
  {
    prefix: '172.',
    check: (ip: string) => {
      const parts = ip.split('.');
      if (parts[0] !== '172') return false;
      const second = parseInt(parts[1], 10);
      return second >= 16 && second <= 31;
    },
  },
  // 192.168.0.0/16
  { prefix: '192.168.', check: (ip: string) => ip.startsWith('192.168.') },
  // 169.254.0.0/16 (link-local)
  { prefix: '169.254.', check: (ip: string) => ip.startsWith('169.254.') },
];

/** Hostnames that resolve to loopback and must be blocked */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
]);

/**
 * Check whether a hostname is an IPv4 address in a blocked range.
 */
function isBlockedIp(hostname: string): boolean {
  // Strip square brackets for IPv6
  const clean = hostname.replace(/^\[|\]$/g, '');

  // Check loopback addresses
  if (BLOCKED_HOSTNAMES.has(clean)) return true;

  // Check private IPv4 ranges
  for (const range of BLOCKED_IPV4_RANGES) {
    if (range.check(clean)) return true;
  }

  return false;
}

/**
 * Validate a URL for safe fetching.
 *
 * Returns `{ valid: true }` if the URL is safe, or
 * `{ valid: false, error: "reason" }` if it should be rejected.
 */
export function validateUrl(url: string): { valid: boolean; error?: string } {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL is required' };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Must be http:// or https://
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: `Unsupported protocol "${parsed.protocol}" — only http and https are allowed`,
    };
  }

  // Check hostname against blocked lists
  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return {
      valid: false,
      error: 'URLs pointing to localhost or loopback addresses are not allowed',
    };
  }

  if (isBlockedIp(hostname)) {
    return {
      valid: false,
      error: 'URLs pointing to private or reserved IP ranges are not allowed',
    };
  }

  return { valid: true };
}

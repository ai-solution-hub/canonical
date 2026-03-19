/**
 * URL Validation Tests
 *
 * Tests SSRF protection — ensuring private IPs, localhost,
 * and non-HTTP protocols are rejected.
 */
import { describe, it, expect } from 'vitest';
import { validateUrl } from '@/lib/extraction/url-validation';

describe('validateUrl', () => {
  // ── Valid URLs ──────────────────────────────────────────

  it('accepts valid HTTPS URLs', () => {
    const result = validateUrl('https://example.com/page');
    expect(result).toEqual({ valid: true });
  });

  it('accepts valid HTTP URLs', () => {
    const result = validateUrl('http://example.com/page');
    expect(result).toEqual({ valid: true });
  });

  it('accepts public IP addresses', () => {
    const result = validateUrl('https://8.8.8.8/dns');
    expect(result).toEqual({ valid: true });
  });

  it('accepts URLs with ports', () => {
    const result = validateUrl('https://example.com:8080/api');
    expect(result).toEqual({ valid: true });
  });

  // ── Protocol restrictions ──────────────────────────────

  it('rejects ftp:// protocol', () => {
    const result = validateUrl('ftp://example.com/file.txt');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unsupported protocol');
  });

  it('rejects file:// protocol', () => {
    const result = validateUrl('file:///etc/passwd');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unsupported protocol');
  });

  // ── Loopback addresses ─────────────────────────────────

  it('rejects localhost', () => {
    const result = validateUrl('http://localhost/admin');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('localhost');
  });

  it('rejects 127.0.0.1', () => {
    const result = validateUrl('http://127.0.0.1/admin');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('localhost');
  });

  it('rejects 0.0.0.0', () => {
    const result = validateUrl('http://0.0.0.0/admin');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('localhost');
  });

  it('rejects ::1 (IPv6 loopback)', () => {
    const result = validateUrl('http://[::1]/admin');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('localhost');
  });

  // ── Private IP ranges ──────────────────────────────────

  it('rejects 10.x.x.x range', () => {
    const result = validateUrl('http://10.0.0.1/internal');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('private');
  });

  it('rejects 172.16.x.x range', () => {
    const result = validateUrl('http://172.16.0.1/internal');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('private');
  });

  it('rejects 172.31.x.x (upper bound of /12)', () => {
    const result = validateUrl('http://172.31.255.255/internal');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('private');
  });

  it('accepts 172.32.x.x (outside /12 range)', () => {
    const result = validateUrl('http://172.32.0.1/page');
    expect(result).toEqual({ valid: true });
  });

  it('rejects 192.168.x.x range', () => {
    const result = validateUrl('http://192.168.1.1/router');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('private');
  });

  it('rejects 169.254.x.x (link-local)', () => {
    const result = validateUrl('http://169.254.169.254/metadata');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('private');
  });

  // ── Invalid input ──────────────────────────────────────

  it('rejects malformed URLs', () => {
    const result = validateUrl('not-a-url');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid URL');
  });

  it('rejects empty string', () => {
    const result = validateUrl('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('required');
  });

  it('rejects URL without protocol', () => {
    const result = validateUrl('example.com/page');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid URL');
  });
});

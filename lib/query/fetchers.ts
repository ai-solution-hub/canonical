/**
 * Shared fetch helpers for TanStack Query.
 *
 * Wrap fetch() with standard error handling so individual hooks don't need
 * to repeat the pattern.
 */

/** Fetch JSON from an API route, throwing on non-OK responses. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as Record<string, string>).error ?? `Request failed: ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

/**
 * Standard JSON fetcher for API routes.
 * Throws on non-OK responses so TanStack Query treats them as errors.
 */
export async function apiFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      (body as Record<string, unknown>).error ?? `Request failed: ${res.status}`;
    throw new Error(String(message));
  }
  return res.json();
}

/**
 * POST/PATCH/DELETE fetcher for API routes that require a request body.
 */
export async function apiMutationFetcher<T>(
  url: string,
  options: {
    method?: string;
    body: unknown;
  },
): Promise<T> {
  const res = await fetch(url, {
    method: options.method ?? 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options.body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message =
      (data as Record<string, unknown>).error ?? `Request failed: ${res.status}`;
    throw new Error(String(message));
  }
  return res.json();
}

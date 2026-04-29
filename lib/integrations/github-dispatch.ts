/**
 * GitHub Actions repository_dispatch helper for taxonomy sync.
 *
 * Sends a signed POST to the GitHub API to trigger the `taxonomy-sync`
 * workflow. Per spec P0-TX SS5.2 (Option E):
 *
 * - HTTP 204 = success (GitHub returns 204 No Content on dispatch)
 * - HTTP 4xx = no retry (token/repo/workflow configuration error)
 * - HTTP 5xx or network error = retry ONCE after 2 s
 */

const GITHUB_DISPATCH_URL =
  'https://api.github.com/repos/ai-solution-hub/knowledge-hub/dispatches';

interface DispatchResult {
  ok: boolean;
  status: number;
  error?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptDispatch(
  token: string,
  runId?: string,
): Promise<DispatchResult> {
  const res = await fetch(GITHUB_DISPATCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: 'taxonomy-sync',
      client_payload: { run_id: runId ?? '' },
    }),
  });

  if (res.status === 204) {
    return { ok: true, status: 204 };
  }

  const errorMessages: Record<number, string> = {
    401: 'GitHub token expired or invalid — rotate GITHUB_SYNC_TOKEN',
    403: 'GitHub token lacks required permissions (needs contents:write + actions:read)',
    404: 'Repository not found — check GITHUB_DISPATCH_URL or token repo scope',
    422: 'Workflow not configured — ensure .github/workflows/taxonomy-sync.yml exists',
  };

  const error =
    errorMessages[res.status] ?? `GitHub API returned ${res.status}`;

  return { ok: false, status: res.status, error };
}

/**
 * Dispatch a `taxonomy-sync` repository_dispatch event to GitHub Actions.
 *
 * Reads `GITHUB_SYNC_TOKEN` from `process.env`. Throws if the token is
 * not configured. Retries once on 5xx / network errors after a 2 s delay.
 * Never retries 4xx (configuration errors that require human intervention).
 *
 * @param runId - The `pipeline_runs.id` UUID to forward in `client_payload`
 *   so the workflow callback can update the correct row.
 */
export async function dispatchTaxonomySync(
  runId?: string,
): Promise<DispatchResult> {
  const token = process.env.GITHUB_SYNC_TOKEN;
  if (!token) {
    throw new Error('GITHUB_SYNC_TOKEN not configured');
  }

  try {
    const first = await attemptDispatch(token, runId);

    // 4xx — do not retry; actionable configuration error
    if (!first.ok && first.status < 500) {
      return first;
    }

    // 2xx — success
    if (first.ok) {
      return first;
    }

    // 5xx — retry once after 2 s
    await delay(2_000);
    return await attemptDispatch(token, runId);
  } catch (_err) {
    // Network error on first attempt — retry once after 2 s
    await delay(2_000);
    try {
      return await attemptDispatch(token, runId);
    } catch (retryErr) {
      return {
        ok: false,
        status: 0,
        error: `Network error after retry: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
      };
    }
  }
}

/**
 * Shared error class for AI service layer functions.
 * Allows callers to distinguish domain errors (404, 400) from unexpected failures.
 *
 * `code` carries an optional machine-readable error code (e.g. DIGEST_TOO_MANY_ITEMS).
 * `data` carries an optional structured payload the API route can pass through to
 * the client verbatim without JSON-encoding inside the message string.
 */
export class AIServiceError extends Error {
  readonly code: string | undefined;
  readonly data: Record<string, unknown> | undefined;

  constructor(
    message: string,
    public readonly status: number,
    opts?: { code?: string; data?: Record<string, unknown> },
  ) {
    super(message);
    this.name = 'AIServiceError';
    this.code = opts?.code;
    this.data = opts?.data;
  }
}

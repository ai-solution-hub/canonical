/**
 * Shared error class for AI service layer functions.
 * Allows callers to distinguish domain errors (404, 400) from unexpected failures.
 */
export class AIServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'AIServiceError';
  }
}

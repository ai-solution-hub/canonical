import type { Page } from '@playwright/test';

/**
 * Suppress development overlays that may intercept pointer events.
 * Previously hid CopilotKit Web Inspector — retained for future use.
 */
export async function hideDevOverlays(_page: Page): Promise<void> {
  // No overlays to suppress after CopilotKit removal.
  // Retained as a hook for future dev overlay suppression.
}

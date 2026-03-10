import type { Page } from '@playwright/test';

/**
 * Hide CopilotKit Web Inspector and dev overlays that intercept pointer events.
 *
 * Applies two strategies:
 * 1. addInitScript — injects CSS to hide `cpk-web-inspector` and a MutationObserver
 *    to auto-dismiss CopilotKit banners. Persists across navigations.
 * 2. page.route — stubs ALL requests to `/api/copilotkit/` to prevent 429 rate-limit
 *    and 401 unauthenticated errors from producing blocking banners.
 *
 * Call this before any navigation on the page.
 */
export async function hideDevOverlays(page: Page): Promise<void> {
  // CSS + MutationObserver to hide inspector element and dismiss banners
  await page.addInitScript(() => {
    const css = 'cpk-web-inspector { display: none !important; pointer-events: none !important; }';
    const inject = () => {
      if (document.head) {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
      } else {
        requestAnimationFrame(inject);
      }
    };
    inject();

    // Auto-dismiss CopilotKit error banners and "what's new" toasts
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('button')) {
        if (el.textContent?.trim() === '×') {
          const container = el.parentElement;
          if (container?.textContent?.includes('Runtime info request failed') ||
              container?.textContent?.includes('is now live') ||
              container?.textContent?.includes('Rate limit')) {
            (container as HTMLElement).style.display = 'none';
          }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });

  // Stub ALL CopilotKit API requests to prevent 429/401 banners
  await page.route('**/api/copilotkit/**', (route) =>
    route.fulfill({ status: 200, body: '{}', contentType: 'application/json' }),
  );
}

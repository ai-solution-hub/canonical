/**
 * WAI-ARIA Tabs keyboard navigation handler.
 *
 * Implements the roving tabindex pattern for `role="tablist"` containers:
 * - ArrowRight / ArrowLeft move focus between tabs (wraps at edges)
 * - Home moves to the first tab
 * - End moves to the last tab
 *
 * Attach to the `onKeyDown` of any element with `role="tablist"`.
 */
export function handleTablistKeyDown(
  e: React.KeyboardEvent<HTMLElement>,
): void {
  const tabs = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
  );
  const currentIndex = tabs.findIndex((t) => t === document.activeElement);
  if (currentIndex === -1) return;

  let nextIndex: number | null = null;

  switch (e.key) {
    case 'ArrowRight':
      nextIndex = (currentIndex + 1) % tabs.length;
      break;
    case 'ArrowLeft':
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      break;
    case 'Home':
      nextIndex = 0;
      break;
    case 'End':
      nextIndex = tabs.length - 1;
      break;
  }

  if (nextIndex !== null) {
    e.preventDefault();
    tabs[nextIndex].focus();
  }
}

import { type Page, expect } from '@playwright/test';

/**
 * The sm breakpoint (640px). Below this, the hamburger menu is shown
 * and desktop nav links are hidden.
 */
export const SM_BREAKPOINT = 640;

/**
 * The md breakpoint (768px). Below this, the settings sidebar is
 * rendered as a Sheet drawer instead of a visible aside.
 */
export const MD_BREAKPOINT = 768;

/**
 * Returns true if the current viewport width is below the given breakpoint.
 */
export function isMobileViewport(page: Page, breakpoint = SM_BREAKPOINT): boolean {
  const viewport = page.viewportSize();
  return !!viewport && viewport.width < breakpoint;
}

/**
 * Navigate to a page using the site header navigation.
 * On mobile (< 640px), opens the hamburger menu first.
 * On desktop, clicks the nav link directly.
 */
export async function navigateViaHeader(
  page: Page,
  linkName: string,
): Promise<void> {
  if (isMobileViewport(page)) {
    // Open hamburger menu
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    // Wait for Sheet to animate open
    const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
    await expect(mobileNav).toBeVisible();
    // Click the link inside the mobile nav
    await mobileNav.getByRole('link', { name: linkName }).click();
  } else {
    const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
    await mainNav.getByRole('link', { name: linkName }).click();
  }
}

/**
 * Open and return the settings sidebar navigation element.
 * On mobile (< 768px), opens the settings mobile sidebar Sheet first.
 * On desktop, returns the visible sidebar nav directly.
 */
export async function getSettingsNav(page: Page): Promise<ReturnType<Page['getByRole']>> {
  const desktopNav = page.getByRole('navigation', { name: 'Settings navigation' });

  // Desktop: sidebar nav is already visible
  if (await desktopNav.isVisible({ timeout: 2000 }).catch(() => false)) {
    return desktopNav;
  }

  // Mobile: click the Sheet trigger button (shows current section label)
  const mobileTrigger = page.locator('.md\\:hidden').getByRole('button');
  await mobileTrigger.click();

  // After opening the Sheet, the nav inside it becomes visible
  const sheetNav = page.getByRole('navigation', { name: 'Settings navigation' });
  await expect(sheetNav).toBeVisible({ timeout: 5000 });
  return sheetNav;
}

/**
 * Navigate to a settings section via the sidebar. Works on both
 * desktop and mobile viewports.
 */
export async function navigateToSettingsSection(
  page: Page,
  sectionLabel: string,
): Promise<void> {
  const nav = await getSettingsNav(page);
  await nav.getByText(sectionLabel).click();
}

/**
 * Perform a search from the site header.
 * On mobile, navigates to /search directly (compact search bar is hidden).
 * On desktop, fills the compact search bar in the header and submits.
 */
export async function searchFromHeader(
  page: Page,
  query: string,
): Promise<void> {
  if (isMobileViewport(page)) {
    // Mobile: click search icon to go to /search page
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\/search/);
    // Fill the search input on the search page (Radix Command input has role="combobox")
    const searchInput = page.getByRole('combobox', { name: /search/i });
    await searchInput.fill(query);
    await searchInput.press('Enter');
  } else {
    // Desktop: use the compact search bar in the header (Radix Command input has role="combobox")
    const searchInput = page.locator('header').getByRole('combobox', { name: /search/i });
    await searchInput.fill(query);
    await searchInput.press('Enter');
  }
}

/**
 * Assert that expected navigation links are visible. On mobile, opens the
 * hamburger menu first. On desktop, checks the main nav directly.
 *
 * @returns The nav element containing the links (for further assertions).
 */
export async function getVisibleNavLinks(page: Page): Promise<ReturnType<Page['getByRole']>> {
  if (isMobileViewport(page)) {
    const hamburger = page.getByRole('button', { name: 'Open navigation menu' });
    await hamburger.click();
    const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
    await expect(mobileNav).toBeVisible();
    return mobileNav;
  }

  return page.getByRole('navigation', { name: 'Main navigation' });
}

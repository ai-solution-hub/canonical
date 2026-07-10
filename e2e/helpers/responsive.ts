import { type Page, expect } from '@playwright/test';
import { NAV_ZONES } from '@/components/shell/nav-config';

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
export function isMobileViewport(
  page: Page,
  breakpoint = SM_BREAKPOINT,
): boolean {
  const viewport = page.viewportSize();
  return !!viewport && viewport.width < breakpoint;
}

/**
 * Resolve the NAV_ZONES zone that owns a leaf by its accessible label
 * (single source of truth — no separate label->zone table to drift out
 * of sync with {118.6}'s NAV_ZONES membership).
 */
function findZoneForLabel(label: string) {
  return NAV_ZONES.find((zone) =>
    zone.entries.some((entry) => entry.label === label),
  );
}

/**
 * Navigate to a page using the site header navigation.
 * On mobile (< 640px), opens the hamburger menu first; the mobile drawer
 * still renders plain links (unaffected by the {118.7} desktop disclosure
 * rework).
 * On desktop, the three zones (Applications/Knowledge/Governance) are Radix
 * DropdownMenu disclosures (DR-041 C1): leaves are `role="menuitem"`, not
 * `role="link"`, and only exist in the DOM once their owning zone's trigger
 * is opened (DropdownMenuContent is portalled, so it is queried at the page
 * level rather than scoped to the `<nav>` element). Open the target leaf's
 * zone first, then select the leaf by its accessible name.
 */
export async function navigateViaHeader(
  page: Page,
  linkName: string,
): Promise<void> {
  if (isMobileViewport(page)) {
    const mobileNav = page.getByRole('navigation', {
      name: 'Mobile navigation',
    });
    // Idempotent: the Sheet may already be open (e.g. this is called right
    // after getVisibleNavLinks, which opens it) — a redundant click on the
    // hamburger while the Sheet's modal overlay (z-50) is already up fails
    // Playwright's actionability check against the z-40 header button
    // (test-philosophy.md §7.2). Only open it if it isn't already.
    const alreadyOpen = await mobileNav.isVisible().catch(() => false);
    if (!alreadyOpen) {
      // Open hamburger menu
      await page.getByRole('button', { name: 'Open navigation menu' }).click();
      // Wait for Sheet to animate open
      await expect(mobileNav).toBeVisible();
    }
    // Click the link inside the mobile nav
    await mobileNav.getByRole('link', { name: linkName }).click();
  } else {
    const zone = findZoneForLabel(linkName);
    if (!zone) {
      throw new Error(
        `navigateViaHeader: no NAV_ZONES entry with label "${linkName}"`,
      );
    }
    const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
    await mainNav.getByRole('button', { name: zone.header }).click();
    await page.getByRole('menuitem', { name: linkName }).click();
  }
}

/**
 * Open and return the settings sidebar navigation element.
 * On mobile (< 768px), opens the settings mobile sidebar Sheet first.
 * On desktop, returns the visible sidebar nav directly.
 */
export async function getSettingsNav(
  page: Page,
): Promise<ReturnType<Page['getByRole']>> {
  const desktopNav = page.getByRole('navigation', {
    name: 'Settings navigation',
  });

  // Desktop: sidebar nav is already visible
  if (await desktopNav.isVisible({ timeout: 2000 }).catch(() => false)) {
    return desktopNav;
  }

  // Mobile: click the Sheet trigger button (shows current section label)
  const mobileTrigger = page.locator('.md\\:hidden').getByRole('button');
  await mobileTrigger.click();

  // After opening the Sheet, the nav inside it becomes visible
  const sheetNav = page.getByRole('navigation', {
    name: 'Settings navigation',
  });
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
 * On mobile, the compact search bar is hidden; the header's search icon
 * routes to /browse so users can search/filter there.
 * On desktop, fills the compact search bar in the header and submits.
 */
export async function searchFromHeader(
  page: Page,
  query: string,
): Promise<void> {
  if (isMobileViewport(page)) {
    // Mobile: click search icon to navigate to /browse
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\/browse/);
    // Fill the search input on /browse (Radix Command input has role="combobox")
    const searchInput = page.getByRole('combobox', { name: /search/i });
    await searchInput.fill(query);
    await searchInput.press('Enter');
  } else {
    // Desktop: use the compact search bar in the header (Radix Command input has role="combobox")
    const searchInput = page
      .locator('header')
      .getByRole('combobox', { name: /search/i });
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
export async function getVisibleNavLinks(
  page: Page,
): Promise<ReturnType<Page['getByRole']>> {
  if (isMobileViewport(page)) {
    const hamburger = page.getByRole('button', {
      name: 'Open navigation menu',
    });
    await hamburger.click();
    const mobileNav = page.getByRole('navigation', {
      name: 'Mobile navigation',
    });
    await expect(mobileNav).toBeVisible();
    return mobileNav;
  }

  return page.getByRole('navigation', { name: 'Main navigation' });
}

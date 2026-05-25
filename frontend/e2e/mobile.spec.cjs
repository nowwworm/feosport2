// @ts-check
// Mobile responsiveness smoke tests. Driven by the `mobile` Playwright project
// (iPhone 13 device emulation, 390x844). Verifies that the most critical
// surfaces — auth screen, bottom navigation, leaderboard — render without
// horizontal overflow and that primary tap targets meet iOS minimums.

const { test, expect } = require('@playwright/test');
const { loginAndVisit } = require('./helpers.cjs');

const VIEWPORT_WIDTH = 390; // iPhone 13

async function expectNoHorizontalScroll(page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'documentElement.scrollWidth must fit clientWidth')
    .toBeLessThanOrEqual(clientWidth);
}

test.describe('Mobile responsiveness (iPhone 13)', () => {
  test('login screen has no horizontal overflow', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expectNoHorizontalScroll(page);

    const submit = page.locator('button[type="submit"], button:has-text("Войти"), button:has-text("Вход")').first();
    if (await submit.count()) {
      const box = await submit.boundingBox();
      expect(box?.height || 0, 'login submit button is at least 40px tall').toBeGreaterThanOrEqual(40);
    }
  });

  test('leaderboard renders without horizontal overflow', async ({ page }) => {
    await loginAndVisit(page, '/');
    await expect(page.locator('.leaderboard-page')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('bottom nav fits viewport and stays horizontally scrollable', async ({ page }) => {
    await loginAndVisit(page, '/');
    const nav = page.locator('nav.nav-bar');
    await expect(nav).toBeVisible();

    const navBox = await nav.boundingBox();
    expect(navBox?.width || 0, 'nav width never exceeds viewport').toBeLessThanOrEqual(VIEWPORT_WIDTH + 1);

    // The admin user sees 10 items — total inner width must exceed viewport
    // so the user has to swipe to reach the last items. If it doesn't, items
    // were squashed below the 64px minimum.
    const items = nav.locator('.nav-bar__item');
    const itemCount = await items.count();
    expect(itemCount, 'admin sees all 10 nav items').toBeGreaterThanOrEqual(10);

    const innerScrollWidth = await nav.evaluate((el) => el.scrollWidth);
    expect(innerScrollWidth, 'nav content is wider than viewport — user can scroll').toBeGreaterThan(VIEWPORT_WIDTH);

    // First item meets iOS tap target (44px). Picked the first because it's
    // always rendered and not gated by role.
    const firstItemBox = await items.first().boundingBox();
    expect(firstItemBox?.height || 0).toBeGreaterThanOrEqual(44);
    expect(firstItemBox?.width  || 0).toBeGreaterThanOrEqual(44);
  });

  test('leaderboard row stacks compactly so .best column is hidden on mobile', async ({ page }) => {
    await loginAndVisit(page, '/');
    await expect(page.locator('.leaderboard-page')).toBeVisible();

    // Empty state is acceptable (seed DB has no competitions). When there are
    // rows, verify the secondary "best lap" column is hidden so the row fits.
    const rows = page.locator('.leaderboard-page__row');
    const rowCount = await rows.count();
    if (rowCount > 0) {
      const firstRow = rows.first();
      const rowBox = await firstRow.boundingBox();
      expect(rowBox?.width || 0).toBeLessThanOrEqual(VIEWPORT_WIDTH);
      const bestVisible = await firstRow.locator('.best').isVisible().catch(() => false);
      expect(bestVisible, '.best column should be hidden on iPhone width').toBeFalsy();
    }
  });
});

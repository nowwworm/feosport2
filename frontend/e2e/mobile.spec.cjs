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

  test('bottom nav shows 5 slots: 4 primaries plus Ещё for admin', async ({ page }) => {
    await loginAndVisit(page, '/');
    const nav = page.locator('nav.nav-bar');
    await expect(nav).toBeVisible();

    const navBox = await nav.boundingBox();
    expect(navBox?.width || 0, 'nav width never exceeds viewport').toBeLessThanOrEqual(VIEWPORT_WIDTH + 1);

    // Admin has 10 visible items. With the new pattern the bar collapses to
    // 4 primary + 1 "Ещё" button = 5 slots; the rest live in the drawer.
    const items = nav.locator('.nav-bar__item');
    await expect(items, 'bar has 5 slots: 4 primaries + Ещё').toHaveCount(5);

    const more = nav.locator('.nav-bar__item--more');
    await expect(more, 'Ещё button is rendered when there are extras').toBeVisible();

    // Tap targets meet iOS minimum (44px). The bar must fit inside the
    // viewport with no horizontal scroll — no scrollLeft headroom expected.
    const firstItemBox = await items.first().boundingBox();
    expect(firstItemBox?.height || 0).toBeGreaterThanOrEqual(44);
    expect(firstItemBox?.width  || 0).toBeGreaterThanOrEqual(44);

    const innerScrollWidth = await nav.evaluate((el) => el.scrollWidth);
    expect(innerScrollWidth, 'no horizontal overflow inside nav').toBeLessThanOrEqual(VIEWPORT_WIDTH + 2);
  });

  test('Ещё opens a drawer with the remaining items', async ({ page }) => {
    await loginAndVisit(page, '/');
    const more = page.locator('.nav-bar__item--more');
    await more.click();

    const drawer = page.locator('#nav-more-drawer');
    await expect(drawer).toBeVisible();
    // Admin has 10 items total → 4 in bar, 6 in drawer.
    const drawerItems = drawer.locator('.nav-drawer__item');
    expect(await drawerItems.count(), 'drawer contains 6 secondary items for admin').toBe(6);

    // Backdrop tap dismisses the drawer. The drawer stays in the DOM and
    // animates off-screen via transform; the open/closed state is reflected
    // by the backdrop's data-open attribute, so assert on that.
    await expect(page.locator('.nav-drawer-backdrop'))
      .toHaveAttribute('data-open', 'true');
    await page.locator('.nav-drawer-backdrop').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('.nav-drawer-backdrop'))
      .toHaveAttribute('data-open', 'false');
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

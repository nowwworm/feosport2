// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAndVisit, collectPageErrors } = require('./helpers.cjs');

test.describe('Leaderboard page', () => {
  test('default view renders without console errors', async ({ page }) => {
    const errors = collectPageErrors(page);
    await loginAndVisit(page, '/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.header__title')).toContainText('Таблица');
    // Tabs strip should be present
    await expect(page.getByRole('tab', { name: 'Соревнование' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Этап' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Вылет' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Команды' })).toBeVisible();
    // Live indicator
    await expect(page.locator('.leaderboard-page__status')).toContainText(/Live|Нет соединения/);

    expect(errors).toEqual([]);
  });

  test('kiosk mode hides navigation', async ({ page }) => {
    await loginAndVisit(page, '/?kiosk=1');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.nav-bar')).toHaveCount(0);
    await expect(page.locator('.header')).toHaveCount(0);
    // Still shows live status
    await expect(page.locator('.leaderboard-page__status')).toBeVisible();
  });
});

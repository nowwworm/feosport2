// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAndVisit, collectPageErrors } = require('./helpers.cjs');

test.describe('Judge page', () => {
  test('renders picker, status, controls and preflight', async ({ page }) => {
    const errors = collectPageErrors(page);
    await loginAndVisit(page, '/judge');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.header__title')).toContainText('Судейский пульт');
    // Pickers
    await expect(page.locator('.judge-page__picker')).toBeVisible();
    // Flight controls
    await expect(page.getByRole('button', { name: /Старт/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Финиш/ })).toBeVisible();
    // chief_judge / admin specific
    await expect(page.getByRole('button', { name: /Закрыть/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Перелёт/ })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('opening the reflight modal shows reason picker', async ({ page }) => {
    await loginAndVisit(page, '/judge');
    await page.waitForLoadState('networkidle');

    // Click Перелёт; modal should appear (only enabled if heat not locked).
    const reflightBtn = page.getByRole('button', { name: /Перелёт/ });
    if (await reflightBtn.isEnabled()) {
      await reflightBtn.click();
      await expect(page.locator('.judge-page__modal')).toBeVisible();
      await expect(page.locator('.judge-page__modal').getByText('Запросить перелёт')).toBeVisible();
      await expect(page.locator('.judge-page__modal').getByRole('combobox').first()).toBeVisible();
      await page.getByRole('button', { name: 'Отмена' }).click();
      await expect(page.locator('.judge-page__modal')).toHaveCount(0);
    } else {
      // Heat is locked — that's still a valid render state.
      await expect(page.locator('.judge-page__status-badge--locked')).toBeVisible();
    }
  });
});

// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAndVisit, collectPageErrors } = require('./helpers.cjs');

test.describe('Protocols page', () => {
  test('admin sees generate form and history', async ({ page }) => {
    const errors = collectPageErrors(page);
    await loginAndVisit(page, '/protocols');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.header__title')).toContainText('Протоколы соревнования');
    await expect(page.getByRole('heading', { name: 'Сгенерировать протокол' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'История протоколов' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Создать и подписать/ })).toBeVisible();
    await expect(page.locator('.protocols-page__form select').first()).toContainText('Квалификация симулятора');
    await expect(page.locator('.protocols-page__form select').first()).toContainText('Отчёт о проведении');

    expect(errors).toEqual([]);
  });

  test('switching to final_standings hides stage selector', async ({ page }) => {
    await loginAndVisit(page, '/protocols');
    await page.waitForLoadState('networkidle');

    const form = page.locator('.protocols-page__form');
    const typeSelect = form.locator('select').first();

    // qualification needs a stage → the stage field label appears
    await typeSelect.selectOption('qualification');
    await expect(form.locator('label span', { hasText: 'Этап' })).toBeVisible();

    // final_standings does NOT need a stage → stage label disappears
    await typeSelect.selectOption('final_standings');
    await expect(form.locator('label span', { hasText: 'Этап' })).toHaveCount(0);
  });
});

// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAndVisit, collectPageErrors } = require('./helpers.cjs');

test.describe('Penalties + Protests page', () => {
  test('admin sees both forms (issue penalty + file protest) and both lists', async ({ page }) => {
    const errors = collectPageErrors(page);
    await loginAndVisit(page, '/penalties');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.header__title')).toContainText('Штрафы и протесты');
    await expect(page.getByRole('heading', { name: 'Выписать штраф' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Штрафы' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Протесты' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Подать протест' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('points field appears only for points_deduction type', async ({ page }) => {
    await loginAndVisit(page, '/penalties');
    await page.waitForLoadState('networkidle');

    const issueForm = page.locator('.penalties-page__form').first();
    // By default oral_warning — no points field
    await expect(issueForm.getByText('Баллы (вычитаем)')).toHaveCount(0);

    // Switch to points_deduction
    await issueForm.locator('select').first().selectOption('points_deduction');
    await expect(issueForm.getByText('Баллы (вычитаем)')).toBeVisible();
  });

  test('judge (no penalty-issue rights) sees only the protest form', async ({ page }) => {
    await loginAndVisit(page, '/penalties', {
      email: 'judge@feosport.local',
      password: 'judge123',
    });
    await page.waitForLoadState('networkidle');

    // Issue-penalty form is chief_judge+/admin only; judges see only the protest form
    await expect(page.getByRole('heading', { name: 'Подать протест' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Выписать штраф' })).toHaveCount(0);
  });
});

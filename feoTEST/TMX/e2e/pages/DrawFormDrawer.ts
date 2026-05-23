import { Locator, Page, expect } from '@playwright/test';
import { S } from '../helpers/selectors';

/**
 * Page object for the draw configuration drawer (addDraw).
 *
 * The drawer is rendered inside #tmxDrawer by courthive-components' renderForm.
 * Fields are located by their label text within the drawer — the labels come
 * from i18n but are stable English strings in test environments.
 */
export class DrawFormDrawer {
  readonly drawer: Locator;
  readonly generateButton: Locator;
  readonly cancelButton: Locator;

  constructor(readonly page: Page) {
    this.drawer = page.locator(S.TMX_DRAWER);
    this.generateButton = this.drawer.locator('#generateDraw');
    // Cancel button rendered by courthive-components renderButtons —
    // it's a <button> inside the drawer footer. Use text matching
    // since it has no ID.
    this.cancelButton = this.drawer.locator('button:has-text("Cancel")');
  }

  /* ─── Waiting ──────────────────────────────────────────────────────── */

  /** Wait for the drawer to be open and the form to be rendered.
   *  Playwright's generic `visible` state is true even while the drawer
   *  wrapper is translated off-screen; the component marks the completed
   *  open transition with `is-active is-visible`, so wait for those classes
   *  before touching controls. */
  async waitForOpen(timeout = 15_000): Promise<void> {
    await this.page.locator(`${S.TMX_DRAWER}.is-active.is-visible .drawer__wrapper`).waitFor({
      state: 'visible',
      timeout,
    });
    await this.fieldSelect('Draw Type').waitFor({ state: 'visible', timeout: 5_000 });
  }

  /** Wait for the drawer to close. The component can leave a stale
   *  `is-visible` class behind, but without `is-active` CSS sets
   *  `.drawer` to display:none, which is the actual closed state. */
  async waitForClose(): Promise<void> {
    await expect(this.drawer).not.toHaveClass(/is-active/, { timeout: 10_000 });
  }

  /* ─── Field locators ───────────────────────────────────────────────── */

  /** Locate a .field container by its label text. */
  private fieldContainer(labelText: string): Locator {
    return this.drawer.locator(`.field:has(.label:text-is("${labelText}"))`);
  }

  /** Locate a <select> within a labeled field. */
  fieldSelect(labelText: string): Locator {
    return this.fieldContainer(labelText).locator('select');
  }

  /** Locate a text <input> within a labeled field. */
  fieldInput(labelText: string): Locator {
    return this.fieldContainer(labelText).locator('input.input');
  }

  /** Locate a checkbox <input> by its DOM id. Checkboxes in renderForm
   *  get `id` from item.id — use the tmxConstants value directly. */
  checkbox(id: string): Locator {
    return this.drawer.locator(`#${id}`);
  }

  /* ─── Visibility assertions ────────────────────────────────────────── */

  /** Assert a labeled field is visible. */
  async expectFieldVisible(labelText: string): Promise<void> {
    await expect(this.fieldContainer(labelText)).toBeVisible();
  }

  /** Assert a labeled field is hidden (display:none on the .field div). */
  async expectFieldHidden(labelText: string): Promise<void> {
    await expect(this.fieldContainer(labelText)).toBeHidden();
  }

  /** Assert a checkbox is visible by its DOM id. */
  async expectCheckboxVisible(id: string): Promise<void> {
    await expect(this.checkbox(id).locator('..')).toBeVisible();
  }

  /** Assert a checkbox is hidden by its DOM id. */
  async expectCheckboxHidden(id: string): Promise<void> {
    await expect(this.checkbox(id).locator('..')).toBeHidden();
  }

  /** Open the event-level Add draw drawer with a bounded retry.
   *  The Entries table can still be settling when the button appears; a
   *  click may focus the button before the drawer transition starts. */
  async openFromAddDrawButton(): Promise<void> {
    const button = this.page.getByRole('button', { name: 'Add draw' });
    await expect(button).toBeVisible({ timeout: 10_000 });
    await expect(button).toBeEnabled({ timeout: 10_000 });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await button.click({ force: true });
      try {
        await this.waitForOpen(5_000);
        return;
      } catch (error) {
        if (attempt === 2) throw error;
        await this.page.waitForTimeout(150);
      }
    }
  }

  /* ─── Value getters ────────────────────────────────────────────────── */

  async getSelectValue(labelText: string): Promise<string> {
    return this.fieldSelect(labelText).inputValue();
  }

  async getInputValue(labelText: string): Promise<string> {
    return this.fieldInput(labelText).inputValue();
  }

  /* ─── Actions ──────────────────────────────────────────────────────── */

  /** Select a draw type by its value (e.g. 'ROUND_ROBIN'). */
  async selectDrawType(value: string): Promise<void> {
    const select = this.fieldSelect('Draw Type');
    // Dispatch the same change event without opening Chromium's native
    // select UI; native option picking can bubble through the document
    // click handler and close the drawer mid-assertion.
    await select.evaluate((node, nextValue) => {
      const el = node as HTMLSelectElement;
      el.value = nextValue as string;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    await expect(select).toHaveValue(value);
  }

  /** Set a numeric input value (clears first). */
  async setInputValue(labelText: string, value: string): Promise<void> {
    const input = this.fieldInput(labelText);
    await input.fill(value);
  }

  /** Toggle a checkbox. The actual `<input>` is visually hidden via the
   *  `is-checkradio` CSS pattern. We programmatically click the input
   *  via evaluate since the label/input may be in the drawer's scroll
   *  area and Playwright's scroll-into-view can mis-target the scroll
   *  container.
   *
   *  For qualifyingFirst, the change handler (qualifyingFirstChange)
   *  re-renders draw type options, toggles field visibility, and
   *  re-derives draw size. We wait for the draw type select's options
   *  to change as a signal that the handler completed. */
  async toggleCheckbox(id: string): Promise<void> {
    // Capture the draw type option count before toggle
    const optionCountBefore = await this.fieldSelect('Draw Type')
      .locator('option')
      .count()
      .catch(() => 0);

    // Click the checkbox and wait for the change event handler to
    // complete its DOM mutations. We use a Promise that resolves
    // when the handler finishes by watching for a known DOM change.
    await this.page.evaluate((checkboxId) => {
      return new Promise<void>((resolve) => {
        const input = document.getElementById(checkboxId) as HTMLInputElement;
        if (!input) { resolve(); return; }

        // Listen for the NEXT change event on the input — when the
        // handler is done, the DOM has been mutated.
        const handler = () => {
          input.removeEventListener('change', handler);
          // Use requestAnimationFrame to let any synchronous DOM
          // mutations from the handler flush before resolving
          requestAnimationFrame(() => resolve());
        };
        input.addEventListener('change', handler);
        input.click();
      });
    }, id);
  }

  /** Click the Generate button. It lives in the drawer footer which
   *  is often below the fold. Use evaluate to bypass viewport checks. */
  async clickGenerate(): Promise<void> {
    await this.page.evaluate(() => {
      const btn = document.getElementById('generateDraw') as HTMLButtonElement;
      if (btn) btn.click();
    });
  }

  /** Close the drawer. Tries the overlay backdrop first; falls back
   *  to clicking outside the drawer wrapper if the overlay isn't
   *  rendered (e.g. ATTACH_QUALIFYING mode where the drawer opens
   *  without an overlay). */
  async clickCancel(): Promise<void> {
    // Escape exercises the drawer's public close path without relying on
    // overlay hit testing, which can report visible while display is already
    // being removed during the close transition.
    await this.page.keyboard.press('Escape');
    await this.waitForClose();
  }
}

import { expect, test } from '@playwright/test';
import { insertFoods, loadPouchDB, resetDB } from './playwright-helpers.js';

/**
 * Encode a food object into the base64 ?f= URL param format used by the share feature.
 * @param {object} data
 */
function encodeFoodParam({ name, refLabel, kcal, prot, carbs, fats }) {
  return Buffer.from(JSON.stringify({ n: name, r: refLabel, k: kcal, p: prot, c: carbs, f: fats })).toString('base64');
}

const SALMON = { name: 'Salmon', refLabel: '100 g', kcal: 208, prot: 20, carbs: 0, fats: 13 };

test.describe('Food share feature', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await loadPouchDB(page);
    await page.goto('/');
    await resetDB(page);
    await page.reload();
  });

  test('share button copies a URL with base64-encoded food data to clipboard', async ({ page }) => {
    // Arrange: create a food via UI
    await page.locator('.tab', { hasText: 'Foods' }).click();
    await page.fill('#foodName', SALMON.name);
    await page.fill('#foodRefLabel', SALMON.refLabel);
    await page.fill('#foodKcal', String(SALMON.kcal));
    await page.fill('#foodProt', String(SALMON.prot));
    await page.fill('#foodCarb', String(SALMON.carbs));
    await page.fill('#foodFat', String(SALMON.fats));
    await page.click('#saveFoodBtn');
    await page.getByRole('button', { name: 'Dismiss' }).click();

    // Act: click Share on the food item
    await page.locator('#foodsList .item .share').click();

    // Assert: toast confirms copy
    await expect(page.locator('.toast')).toContainText('Link copied');

    // Assert: clipboard contains a URL with ?f= param
    const url = await page.evaluate(() => navigator.clipboard.readText());
    expect(url).toContain('?f=');

    // Assert: decoded param matches the food's data exactly (short keys)
    const param = new URL(url).searchParams.get('f');
    const decoded = JSON.parse(Buffer.from(param, 'base64').toString('utf8'));
    expect(decoded).toMatchObject({ n: SALMON.name, r: SALMON.refLabel, k: SALMON.kcal, p: SALMON.prot, c: SALMON.carbs, f: SALMON.fats });
  });

  test('opening a share link for a new food prefills the add form', async ({ page }) => {
    // Arrange: build a share URL for a food that does not exist in the DB
    const encoded = encodeFoodParam(SALMON);

    // Act: navigate directly to the app with the share param
    await page.goto(`/?f=${encoded}`);

    // Assert: Foods tab is active
    await expect(page.locator('.tab[data-page="foods"]')).toHaveClass(/active/);

    // Assert: form is in "Add food" mode with all fields prefilled
    await expect(page.locator('#foodFormTitle')).toHaveText('Add food');
    await expect(page.locator('#foodName')).toHaveValue(SALMON.name);
    await expect(page.locator('#foodRefLabel')).toHaveValue(SALMON.refLabel);
    await expect(page.locator('#foodKcal')).toHaveValue(String(SALMON.kcal));
    await expect(page.locator('#foodProt')).toHaveValue(String(SALMON.prot));
    await expect(page.locator('#foodCarb')).toHaveValue(String(SALMON.carbs));
    await expect(page.locator('#foodFat')).toHaveValue(String(SALMON.fats));

    // Assert: ?food= param has been stripped from the address bar
    expect(page.url()).not.toContain('?f=');
  });

  test('opening a share link when food with same name exists opens edit mode', async ({ page }) => {
    // Arrange: insert an existing food with the same name but different macros
    await page.goto('/');
    await resetDB(page);
    await page.reload();
    await insertFoods(page, [
      { name: SALMON.name, refLabel: '1 fillet', kcal: 300, prot: 25, carbs: 0, fats: 18, archived: false, updatedAt: Date.now() },
    ]);

    // Act: navigate with a share link for a food with the same name
    const encoded = encodeFoodParam(SALMON);
    await page.goto(`/?f=${encoded}`);

    // Assert: Foods tab is active
    await expect(page.locator('.tab[data-page="foods"]')).toHaveClass(/active/);

    // Assert: form is in "Edit food" mode (matched by name, loaded existing record)
    await expect(page.locator('#foodFormTitle')).toHaveText('Edit food');
    await expect(page.locator('#foodName')).toHaveValue(SALMON.name);

    // Assert: the form shows the existing food's data (not the shared data)
    await expect(page.locator('#foodRefLabel')).toHaveValue('1 fillet');
    await expect(page.locator('#foodKcal')).toHaveValue('300');

    // Assert: foodId hidden input is populated (confirms edit mode, not add)
    const idValue = await page.locator('#foodId').inputValue();
    expect(idValue).not.toBe('');

    // Assert: ?food= param has been stripped from the address bar
    expect(page.url()).not.toContain('?f=');
  });

  test('malformed share param (valid base64, invalid JSON) does not prefill the form', async ({ page }) => {
    // Arrange: build a param that is valid base64 but decodes to non-JSON text
    // atob succeeds, JSON.parse throws → handler returns early without setting form fields
    const badParam = Buffer.from('hello world').toString('base64');

    // Act: navigate with the bad param (DB is empty, so main.js shows Foods tab)
    await page.goto(`/?f=${badParam}`);

    // Assert: app loaded and Foods form is visible but completely empty (no prefill)
    await expect(page.locator('#foodFormTitle')).toHaveText('Add food');
    await expect(page.locator('#foodName')).toHaveValue('');
    await expect(page.locator('#foodRefLabel')).toHaveValue('');
    await expect(page.locator('#foodKcal')).toHaveValue('');

    // Assert: param is stripped from the address bar even on failure
    expect(page.url()).not.toContain('?f=');
  });
});

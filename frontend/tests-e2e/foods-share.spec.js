import { expect, test } from '@playwright/test';
import { decodeFoodCode, encodeFoodCode } from '../src/food-share-code.js';
import { insertFoods, loadPouchDB, resetDB } from './playwright-helpers.js';

const SALMON = { name: 'Salmon', refLabel: '100 g', kcal: 208, prot: 20, carbs: 0, fats: 13 };

test.describe('Food share feature', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await loadPouchDB(page);
    await page.goto('/');
    await resetDB(page);
    await page.reload();
  });

  test('share button copies a URL with compact base64-encoded food data to clipboard', async ({ page }) => {
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

    // Assert: decoded param round-trips back to the food's data
    const param = new URL(url).searchParams.get('f');
    const decoded = decodeFoodCode(param);
    expect(decoded).not.toBeNull();
    expect(decoded.name).toBe(SALMON.name);
    expect(decoded.refLabel).toBe(SALMON.refLabel);
    expect(Number(decoded.kcal)).toBe(SALMON.kcal);
    expect(Number(decoded.prot)).toBe(SALMON.prot);
    expect(Number(decoded.carbs)).toBe(SALMON.carbs);
    expect(Number(decoded.fats)).toBe(SALMON.fats);
  });

  test('opening a share link for a new food prefills the add form', async ({ page }) => {
    // Arrange: build a share URL for a food that does not exist in the DB
    const encoded = encodeFoodCode(SALMON);

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

    // Assert: ?f= param has been stripped from the address bar
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
    const encoded = encodeFoodCode(SALMON);
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

    // Assert: ?f= param has been stripped from the address bar
    expect(page.url()).not.toContain('?f=');
  });

  test('malformed share param does not prefill the form', async ({ page }) => {
    // Arrange: valid base64 that decodes to something without the right pipe structure
    const badParam = Buffer.from('hello world').toString('base64');

    // Act: navigate with the bad param (DB is empty, so main.js shows Foods tab)
    await page.goto(`/?f=${badParam}`);

    // Assert: app loaded and Foods form is visible but completely empty
    await expect(page.locator('#foodFormTitle')).toHaveText('Add food');
    await expect(page.locator('#foodName')).toHaveValue('');
    await expect(page.locator('#foodRefLabel')).toHaveValue('');
    await expect(page.locator('#foodKcal')).toHaveValue('');

    // Assert: param is stripped from the address bar even on failure
    expect(page.url()).not.toContain('?f=');
  });

  test('import code toggle reveals input, apply prefills add form', async ({ page }) => {
    // Arrange: navigate to foods page with no foods
    await page.locator('.tab', { hasText: 'Foods' }).click();

    // Assert: import area is hidden by default
    await expect(page.locator('#foodImportArea')).toHaveClass(/hidden/);

    // Act: click the toggle button
    await page.click('#foodImportToggle');

    // Assert: import area is now visible
    await expect(page.locator('#foodImportArea')).not.toHaveClass(/hidden/);

    // Act: paste a valid food code and apply
    const code = encodeFoodCode(SALMON);
    await page.fill('[data-testid="foodImportInput"]', code);
    await page.click('[data-testid="foodImportApply"]');

    // Assert: import area collapses
    await expect(page.locator('#foodImportArea')).toHaveClass(/hidden/);

    // Assert: form is prefilled in "Add food" mode
    await expect(page.locator('#foodFormTitle')).toHaveText('Add food');
    await expect(page.locator('#foodName')).toHaveValue(SALMON.name);
    await expect(page.locator('#foodRefLabel')).toHaveValue(SALMON.refLabel);
    await expect(page.locator('#foodKcal')).toHaveValue(String(SALMON.kcal));
    await expect(page.locator('#foodProt')).toHaveValue(String(SALMON.prot));
  });

  test('import code accepts a full share URL and extracts the code from it', async ({ page }) => {
    // Arrange
    await page.locator('.tab', { hasText: 'Foods' }).click();
    await page.click('#foodImportToggle');

    // Act: paste a full URL rather than just the code
    const code = encodeFoodCode(SALMON);
    const fullUrl = `https://example.com/?f=${code}`;
    await page.fill('[data-testid="foodImportInput"]', fullUrl);
    await page.click('[data-testid="foodImportApply"]');

    // Assert: form is prefilled correctly
    await expect(page.locator('#foodFormTitle')).toHaveText('Add food');
    await expect(page.locator('#foodName')).toHaveValue(SALMON.name);
    await expect(page.locator('#foodRefLabel')).toHaveValue(SALMON.refLabel);
    await expect(page.locator('#foodKcal')).toHaveValue(String(SALMON.kcal));
  });

  test('import code with invalid code shows error message', async ({ page }) => {
    // Arrange
    await page.locator('.tab', { hasText: 'Foods' }).click();
    await page.click('#foodImportToggle');

    // Act: submit an invalid code
    await page.fill('[data-testid="foodImportInput"]', 'notavalidcode!!!');
    await page.click('[data-testid="foodImportApply"]');

    // Assert: error message shown, area stays open, form untouched
    await expect(page.locator('#foodImportMsg')).toHaveText('Invalid code.');
    await expect(page.locator('#foodImportArea')).not.toHaveClass(/hidden/);
    await expect(page.locator('#foodName')).toHaveValue('');
  });
});

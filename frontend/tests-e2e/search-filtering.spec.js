import { test, expect } from '@playwright/test';
import { resetDB, loadPouchDB } from './playwright-helpers.js';


test.describe('Foods: combined search + status filter', () => {
  test.beforeEach(async ({ page }) => {
    await loadPouchDB(page);
    await page.goto('/');
    await resetDB(page);
    await page.reload();
    await page.locator('.tab', { hasText: 'Foods' }).click();
  });

  /**
   * @param {import('@playwright/test').Page} page
   * @param {string} name
   * @param {number} kcal
   */
  async function createFood(page, name, kcal) {
    await page.fill('#foodName', name);
    await page.fill('#foodRefLabel', '100 g');
    await page.fill('#foodKcal', String(kcal));
    await page.fill('#foodProt', '5');
    await page.fill('#foodCarb', '10');
    await page.fill('#foodFat', '2');
    await page.click('#saveFoodBtn');
    await expect(page.locator('#foodsList')).toContainText(name);
  }

  test('search term filters correctly within each status independently', async ({ page }) => {
    // Arrange: two foods that share a common word — one active, one that will be archived
    await createFood(page, 'Apple Fresh', 52);
    await createFood(page, 'Apple Dried', 243);

    // Archive "Apple Dried"
    const driedRow = page.locator('#foodsList .item', { hasText: 'Apple Dried' });
    await driedRow.locator('.archive').click();

    // Create a food whose name does not contain "Apple" (active)
    await createFood(page, 'Banana', 89);

    // Act + Assert: search "Apple" with status = active
    // Only "Apple Fresh" should appear; "Apple Dried" is archived; "Banana" doesn't match
    await page.fill('#foodSearch', 'Apple');
    await page.selectOption('#foodStatus', 'active');
    await expect(page.locator('#foodsList')).toContainText('Apple Fresh');
    await expect(page.locator('#foodsList')).not.toContainText('Apple Dried');
    await expect(page.locator('#foodsList')).not.toContainText('Banana');

    // Act + Assert: same search term, switch to archived status
    // Only "Apple Dried" should appear
    await page.selectOption('#foodStatus', 'archived');
    await expect(page.locator('#foodsList')).not.toContainText('Apple Fresh');
    await expect(page.locator('#foodsList')).toContainText('Apple Dried');
    await expect(page.locator('#foodsList')).not.toContainText('Banana');

    // Act + Assert: clear search, stay on archived
    // "Banana" is active, so it should not appear; only "Apple Dried" shows
    await page.fill('#foodSearch', '');
    await expect(page.locator('#foodsList')).not.toContainText('Apple Fresh');
    await expect(page.locator('#foodsList')).toContainText('Apple Dried');
    await expect(page.locator('#foodsList')).not.toContainText('Banana');

    // Act + Assert: clear search, switch back to active
    // "Apple Fresh" and "Banana" should both appear; "Apple Dried" should not
    await page.selectOption('#foodStatus', 'active');
    await expect(page.locator('#foodsList')).toContainText('Apple Fresh');
    await expect(page.locator('#foodsList')).not.toContainText('Apple Dried');
    await expect(page.locator('#foodsList')).toContainText('Banana');
  });
});

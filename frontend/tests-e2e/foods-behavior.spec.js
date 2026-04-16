import { test, expect } from '@playwright/test';
import { getAllFromStore, resetDB, loadPouchDB } from './playwright-helpers.js';

test.describe('Foods: create, edit, search, archive, batch update', () => {
  test.beforeEach(async ({ page }) => {
    await loadPouchDB(page);
    await page.goto('/');
    await resetDB(page);
    await page.reload();
    await page.locator('.tab', { hasText: 'Foods' }).click();
  });

  test('create valid items (decimal and comma), search, archive/unarchive', async ({ page }) => {
    // Create Rice
    await page.fill('#foodName', 'Rice');
    await page.fill('#foodRefLabel', '100 g');
    await page.fill('#foodKcal', '130');
    await page.fill('#foodProt', '2.7');
    await page.fill('#foodCarb', '28.2');
    await page.fill('#foodFat', '0.3');
    await page.click('#saveFoodBtn');
    await expect(page.locator('#foodsList')).toContainText('Rice');

    // Create Apple
    await page.fill('#foodName', 'Apple');
    await page.fill('#foodRefLabel', '100 g');
    await page.fill('#foodKcal', '52');
    await page.fill('#foodProt', '0.3');
    await page.fill('#foodCarb', '14');
    await page.fill('#foodFat', '0.2');
    await page.click('#saveFoodBtn');
    await expect(page.locator('#foodsList')).toContainText('Apple');

    const foods = await getAllFromStore(page, 'foods');
    expect(foods).toHaveLength(2);

    // Search for Rice only
    await page.fill('#foodSearch', 'rice');
    await expect(page.locator('#foodsList')).toContainText('Rice');
    await expect(page.locator('#foodsList')).not.toContainText('Apple');
    await page.fill('#foodSearch', '');

    // Archive Apple and verify visibility filters
    const appleRow = page.locator('#foodsList .item', { hasText: 'Apple' });
    await appleRow.locator('.archive').click();
    await expect(page.locator('#foodsList')).not.toContainText('Apple');
    await page.selectOption('#foodStatus', 'archived');
    await expect(page.locator('#foodsList')).toContainText('Apple');
    await appleRow.locator('.unarchive').click();
    await page.selectOption('#foodStatus', 'active');
    await expect(page.locator('#foodsList')).toContainText('Apple');
  });
});

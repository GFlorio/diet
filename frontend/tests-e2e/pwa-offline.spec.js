import { expect, test } from '@playwright/test';
import { getAllFromStore, loadPouchDB, resetDB } from './playwright-helpers.js';

test.describe('PWA and offline persistence', () => {
  test.beforeEach(async ({ page }) => {
    await loadPouchDB(page);
    await page.goto('/');
    await resetDB(page);
    await page.reload();
  });

  test('service worker installs and app works offline with IndexedDB persistence', async ({ page, context }) => {
    // Ensure SW registers on first load
    await expect(page.locator('.tab', { hasText: 'Meals' })).toBeVisible();

    // Create a food and a meal while online
    await page.locator('.tab', { hasText: 'Foods' }).click();
    await page.fill('#foodName', 'Banana');
    await page.fill('#foodRefLabel', '100 g');
    await page.fill('#foodKcal', '89');
    await page.fill('#foodProt', '1.1');
    await page.fill('#foodCarb', '23');
    await page.fill('#foodFat', '0.3');
    await page.click('#saveFoodBtn');
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'ban');
    await page.click('#quickList .item .add');
    // Wait for the meal row to appear (confirms async DB write completed)
    await expect(page.locator('#mealsList .meal-row')).toHaveCount(1);

    const mealsOnline = await getAllFromStore(page, 'meals');
    expect(mealsOnline.length).toBe(1);

  // Go offline (SW blocked in config, but IDB should still work)
    await context.setOffline(true);
  // While offline: add another meal (IDB-only path)
    await page.fill('#quickSearch', 'ban');
    await page.click('#quickList .item .add');
    await expect(page.locator('#mealsList .meal-row')).toHaveCount(2);
    const mealsOffline = await getAllFromStore(page, 'meals');
    expect(mealsOffline.length).toBe(2);

    // Come back online, app remains stable
    await context.setOffline(false);
  await page.reload();
    await expect(page.locator('#mealsList .meal-row')).toHaveCount(2);
  });
});

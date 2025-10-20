import { test, expect } from '@playwright/test';
import { getAllFromStore, resetDB } from './playwright-helpers.js';

test.describe('Foods page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  await resetDB(page, 'nutri-pwa');
    // Reload after clearing DB so app re-opens and creates stores
    await page.reload();
  });

  test('create a food and verify UI and IndexedDB state', async ({ page }) => {
    // Navigate to Foods tab
    await page.locator('.tab', { hasText: 'Foods' }).click();

    // Fill form
    await page.locator('#foodName').fill('Chicken breast');
    await page.locator('#foodRefLabel').fill('100 g');
    await page.locator('#foodKcal').fill('165');
    await page.locator('#foodProt').fill('31');
    await page.locator('#foodCarb').fill('0');
    await page.locator('#foodFat').fill('3.6');

    // Submit
    await page.locator('#saveFoodBtn').click();

    // Expect form cleared and list updated
    await expect(page.getByText('No foods yet.')).toHaveCount(0);
    await expect(page.locator('#foodsList')).toContainText('Chicken breast');
    await expect(page.locator('#foodsList .item .meta')).toContainText('100 g');

    // Check IndexedDB contents
    const foods = await getAllFromStore(page, 'nutri-pwa', 'foods');
    expect(foods.length).toBe(1);
    expect(foods[0]).toMatchObject({ name: 'Chicken breast', refLabel: '100 g', archived: false });

  // Now edit the food via UI and ensure updatedAt changes and list updates
    await page.locator('#foodsList .item .edit').click();
    // Wait until form is populated with original values before overwriting (race guard)
    await expect(page.locator('#foodProt')).toHaveValue('31');
    await page.fill('#foodProt', '32');
    await page.click('#saveFoodBtn');
    await expect(async () => {
      const updatedFoods = await getAllFromStore(page, 'nutri-pwa', 'foods');
      expect(updatedFoods[0].prot).toBe(32);
    }).toPass();
    await expect(page.locator('#foodsList')).toContainText('P32');
  });
});

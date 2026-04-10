import { test, expect } from '@playwright/test';
import { getAllFromStore, resetDB } from './playwright-helpers.js';

async function createFood(page, f) {
  await page.locator('.tab', { hasText: 'Foods' }).click();
  await page.fill('#foodName', f.name);
  await page.fill('#foodRefLabel', f.refLabel);
  await page.fill('#foodKcal', String(f.kcal));
  await page.fill('#foodProt', String(f.prot));
  await page.fill('#foodCarb', String(f.carbs));
  await page.fill('#foodFat', String(f.fats));
  await page.click('#saveFoodBtn');
}

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
    await expect(page.locator('#foodsList')).toContainText('Prot 32g');
  });

  test('archive food with no meals prompts to delete permanently, and undo restores it', async ({ page }) => {
    // Arrange: create a food (no meals logged)
    await createFood(page, { name: 'Broccoli', refLabel: '100 g', kcal: 35, prot: 2.4, carbs: 7, fats: 0.4 });
    // Dismiss "log a meal now?" toast so it doesn't interfere
    await page.getByRole('button', { name: 'Dismiss' }).click();

    // Act: archive the food
    await page.locator('#foodsList .item .archive').click();

    // Assert: "delete permanently?" toast appears and Delete button is present
    await expect(page.locator('.toast')).toContainText('delete permanently');
    await page.getByRole('button', { name: 'Delete' }).click();

    // Assert: food is removed from IndexedDB
    await expect(async () => {
      const foods = await getAllFromStore(page, 'nutri-pwa', 'foods');
      expect(foods).toHaveLength(0);
    }).toPass();

    // Assert: "deleted" undo toast appears, then undo restores the food
    await expect(page.locator('.toast')).toContainText('deleted');
    await page.getByRole('button', { name: 'Undo' }).click();

    // Assert: food is back in IndexedDB as archived
    await expect(async () => {
      const foods = await getAllFromStore(page, 'nutri-pwa', 'foods');
      expect(foods).toHaveLength(1);
      expect(foods[0]).toMatchObject({ name: 'Broccoli', archived: true });
    }).toPass();
  });

  test('creating a food shows "log a meal now?" toast that navigates to Meals with search prefilled', async ({ page }) => {
    // Act: create a food
    await createFood(page, { name: 'Avocado', refLabel: '100 g', kcal: 160, prot: 2, carbs: 9, fats: 15 });

    // Assert: toast prompting to log a meal appears
    await expect(page.locator('.toast')).toContainText('log a meal now');

    // Act: click the "Add meal" action button in the toast
    await page.getByRole('button', { name: /Add meal/i }).click();

    // Assert: Meals tab is now active and quick-search is prefilled with the food name
    await expect(page.locator('.tab[data-page="meals"]')).toHaveClass(/active/);
    await expect(page.locator('#quickSearch')).toHaveValue('Avocado');
  });

  test('status filter "all" shows both active and archived foods', async ({ page }) => {
    // Arrange: create Mango and archive it, then create Banana (active)
    await createFood(page, { name: 'Mango', refLabel: '100 g', kcal: 60, prot: 0.8, carbs: 15, fats: 0.4 });
    // Dismiss "log a meal" toast before archiving
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await page.locator('#foodsList .item .archive').click();
    // Dismiss "delete permanently?" toast (no meals for Mango)
    await page.getByRole('button', { name: 'Dismiss' }).click();

    await createFood(page, { name: 'Banana', refLabel: '100 g', kcal: 89, prot: 1.1, carbs: 23, fats: 0.3 });
    // Dismiss "log a meal" toast
    await page.getByRole('button', { name: 'Dismiss' }).click();

    // Assert: active filter (default) shows only Banana
    await expect(page.locator('#foodsList')).toContainText('Banana');
    await expect(page.locator('#foodsList')).not.toContainText('Mango');

    // Act: switch to "All" filter
    await page.locator('#foodStatus').selectOption('all');

    // Assert: both foods visible; Mango has the Archived chip
    await expect(page.locator('#foodsList')).toContainText('Banana');
    await expect(page.locator('#foodsList')).toContainText('Mango');
    await expect(page.locator('#foodsList')).toContainText('Archived');
  });
});

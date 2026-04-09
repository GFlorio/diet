import { test, expect } from '@playwright/test';
import { getAllFromStore, resetDB } from './playwright-helpers.js';

const DB_NAME = 'nutri-pwa';

/**
 * Seed `count` food records directly into IndexedDB, bypassing the UI.
 * The DB schema must already exist (call after page.reload() in beforeEach).
 * @param {import('@playwright/test').Page} page
 * @param {number} count
 */
async function seedFoodsDB(page, count) {
  await page.evaluate(async (count) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('nutri-pwa');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(['foods'], 'readwrite');
    const store = tx.objectStore('foods');
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      store.add({
        name: `Bulk Food ${i + 1}`,
        refLabel: '100 g',
        kcal: 100,
        prot: 10,
        carbs: 20,
        fats: 5,
        archived: false,
        updatedAt: now + i,
      });
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }, count);
}

/**
 * Seed one food and `mealCount` meals on `date`, returning the per-meal macro values.
 * @param {import('@playwright/test').Page} page
 * @param {string} date - ISO date string (YYYY-MM-DD)
 * @param {number} mealCount
 */
async function seedMealsDB(page, date, mealCount) {
  return page.evaluate(async ({ date, mealCount }) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('nutri-pwa');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    // Create one food and capture its auto-generated id
    const foodId = await new Promise((resolve, reject) => {
      const tx = db.transaction(['foods'], 'readwrite');
      const req = tx.objectStore('foods').add({
        name: 'Smoke Food',
        refLabel: '100 g',
        kcal: 100,
        prot: 10,
        carbs: 20,
        fats: 5,
        archived: false,
        updatedAt: Date.now(),
      });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    // Seed meals for the given date
    const now = Date.now();
    const snapshot = {
      id: foodId, name: 'Smoke Food', refLabel: '100 g',
      kcal: 100, prot: 10, carbs: 20, fats: 5, updatedAt: now,
    };
    const tx2 = db.transaction(['meals'], 'readwrite');
    const mStore = tx2.objectStore('meals');
    for (let i = 0; i < mealCount; i++) {
      mStore.add({ foodId, foodSnapshot: snapshot, multiplier: 1, date, updatedAt: now + i });
    }
    await new Promise((resolve, reject) => {
      tx2.oncomplete = resolve;
      tx2.onerror = () => reject(tx2.error);
    });

    return { kcalPerMeal: 100, protPerMeal: 10, carbsPerMeal: 20, fatsPerMeal: 5 };
  }, { date, mealCount });
}

test.describe('Cardinality smoke tests: large datasets', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await resetDB(page, DB_NAME);
    await page.reload();
  });

  test('renders 100 foods without crashing or showing an error placeholder', async ({ page }) => {
    // Arrange: seed 100 foods directly into IDB
    await seedFoodsDB(page, 100);

    // Reload so the app initialises with the seeded data
    await page.reload();

    // Act: navigate to the Foods tab
    await page.locator('.tab', { hasText: 'Foods' }).click();

    // Assert: all 100 foods are rendered (no crash, no "No foods yet" fallback)
    await expect(page.locator('#foodsList .item')).toHaveCount(100, { timeout: 15_000 });
    await expect(page.locator('#foodsList')).not.toContainText('No foods yet');

    // Sanity: DB still contains 100 records
    const foods = await getAllFromStore(page, DB_NAME, 'foods');
    expect(foods).toHaveLength(100);
  });

  test('renders 50 meals for one day and shows correct aggregate totals', async ({ page }) => {
    // Arrange: seed 50 meals (multiplier=1, kcal=100 each) for today's date.
    // Use the same UTC-based computation the app uses (utils.isoToday).
    const isoToday = await page.evaluate(() => new Date().toISOString().slice(0, 10));
    const macros = await seedMealsDB(page, isoToday, 50);

    // Reload so app picks up seeded data
    await page.reload();

    // Act: navigate to Meals tab (already on today's date)
    await page.locator('.tab', { hasText: 'Meals' }).click();

    // Assert: 50 meal rows rendered without error
    await expect(page.locator('#mealsList .item')).toHaveCount(50, { timeout: 15_000 });

    // Assert: summary line shows the correct count and kcal total
    const expectedKcal = macros.kcalPerMeal * 50; // 5000
    await expect(page.locator('#mealsInfo')).toContainText('50 meals');
    await expect(page.locator('#mealsInfo')).toContainText(String(expectedKcal));

    // Sanity: DB contains 50 meal records
    const meals = await getAllFromStore(page, DB_NAME, 'meals');
    expect(meals).toHaveLength(50);
  });
});

import { test, expect } from '@playwright/test';
import { getAllFromStore, resetDB, insertFoods, insertMeals } from './playwright-helpers.js';

test.describe('Cardinality smoke tests: large datasets', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await resetDB(page);
    await page.reload();
  });

  test('renders 100 foods without crashing or showing an error placeholder', async ({ page }) => {
    // Arrange: seed 100 foods directly into DB
    const now = Date.now();
    await insertFoods(page, Array.from({ length: 100 }, (_, i) => ({
      name: `Bulk Food ${i + 1}`,
      refLabel: '100 g',
      kcal: 100,
      prot: 10,
      carbs: 20,
      fats: 5,
      archived: false,
      updatedAt: now + i,
    })));

    // Reload so the app initialises with the seeded data
    await page.reload();

    // Act: navigate to the Foods tab
    await page.locator('.tab', { hasText: 'Foods' }).click();

    // Assert: all 100 foods are rendered (no crash, no "No foods yet" fallback)
    await expect(page.locator('#foodsList .item')).toHaveCount(100, { timeout: 15_000 });
    await expect(page.locator('#foodsList')).not.toContainText('No foods yet');

    // Sanity: DB still contains 100 records
    const foods = await getAllFromStore(page, 'foods');
    expect(foods).toHaveLength(100);
  });

  test('renders 50 meals for one day and shows correct aggregate totals', async ({ page }) => {
    // Arrange: seed 50 meals (multiplier=1, kcal=100 each) for today's date
    const isoToday = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    const perMeal = { kcal: 100, prot: 10, carbs: 20, fats: 5 };
    await insertMeals(page, Array.from({ length: 50 }, () => ({ date: isoToday, ...perMeal })));

    // Reload so app picks up seeded data
    await page.reload();

    // Act: navigate to Meals tab (already on today's date)
    await page.locator('.tab', { hasText: 'Meals' }).click();

    // Assert: 50 meal rows rendered without error
    await expect(page.locator('#mealsList .meal-row')).toHaveCount(50, { timeout: 15_000 });

    // Assert: totals card shows the correct kcal sum
    await expect(page.locator('#dayTotals')).toContainText(String(perMeal.kcal * 50));

    // Sanity: DB contains 50 meal records
    const meals = await getAllFromStore(page, 'meals');
    expect(meals).toHaveLength(50);
  });
});

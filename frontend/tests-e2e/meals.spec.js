import { test, expect } from '@playwright/test';
import { getAllFromStore, resetDB } from './playwright-helpers.js';

async function createFood(page, f){
  await page.locator('.tab', { hasText: 'Foods' }).click();
  await page.fill('#foodName', f.name);
  await page.fill('#foodRefLabel', f.refLabel);
  await page.fill('#foodKcal', String(f.kcal));
  await page.fill('#foodProt', String(f.prot));
  await page.fill('#foodCarb', String(f.carbs));
  await page.fill('#foodFat', String(f.fats));
  await page.click('#saveFoodBtn');
}

test.describe('Meals: quick add, edit qty, snapshots and sync', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await resetDB(page, 'nutri-pwa');
    await page.reload();
  });

  test('quick add from search with keyboard enter, adjust qty, delete', async ({ page }) => {
    // Arrange: add two foods
    await createFood(page, { name:'Chicken', refLabel:'100 g', kcal:165, prot:31, carbs:0, fats:3.6 });
    await createFood(page, { name:'Rice', refLabel:'100 g', kcal:130, prot:2.7, carbs:28.2, fats:0.3 });

    // Go to meals
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'chi');
    await page.keyboard.press('Enter'); // adds first

    // Assert: meal list shows one
    await expect(page.locator('#mealsList .item')).toHaveCount(1);
    await expect(page.locator('#mealsInfo')).toContainText('1 meal');
    await expect(page.locator('#mealsList')).toContainText('Chicken');

    // Adjust qty +0.5 twice
    await page.locator('#mealsList .item .qtyPlus').click();
    await page.locator('#mealsList .item .qtyPlus').click();
    await expect(page.locator('#mealsList')).toContainText('×2');

    // -0.5 twice -> should remove at 0
    await page.locator('#mealsList .item .qtyMinus').click();
    await page.locator('#mealsList .item .qtyMinus').click();
    await page.locator('#mealsList .item .qtyMinus').click(); // 2 -> 1.5 -> 1.0 -> 0.5 -> remove next
    await page.locator('#mealsList .item .qtyMinus').click();

    await expect(page.locator('#mealsList .item')).toHaveCount(0);
    await expect(page.locator('#mealsInfo')).toHaveText('No meals yet');
  });

  test('meals snapshot: foods edit does not change existing meals until sync', async ({ page }) => {
    // Arrange: create one food and add meal
    await createFood(page, { name:'Yogurt', refLabel:'170 g', kcal:100, prot:17, carbs:6, fats:0 });
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'yog');
    await page.click('#quickList .item .add');
    await expect(page.locator('#mealsList')).toContainText('Yogurt');
    const mealsBefore = await getAllFromStore(page, 'nutri-pwa', 'meals');
    expect(mealsBefore[0].foodSnapshot.kcal).toBe(100);

    // Act: edit food kcal to 120 and name change
    await page.locator('.tab', { hasText: 'Foods' }).click();
    await page.fill('#foodSearch', 'yog');
    await page.click('#foodsList .item .edit');
  // Wait for original values to load before changing (race guard)
  await expect(page.locator('#foodKcal')).toHaveValue('100');
  await expect(page.locator('#foodName')).toHaveValue('Yogurt');
    await page.fill('#foodKcal', '120');
    await page.fill('#foodName', 'Greek Yogurt');
    await page.click('#saveFoodBtn');

    // Assert: existing meal unchanged in UI and DB
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await expect(page.locator('#mealsList')).toContainText('Yogurt');
    const mealsAfter = await getAllFromStore(page, 'nutri-pwa', 'meals');
    expect(mealsAfter[0].foodSnapshot.kcal).toBe(100);

    // Sync single meal using ⟳ button and wait until snapshot updates in DB
    await page.locator('#mealsList .item .sync').click();
    await expect(async () => {
      const synced = await getAllFromStore(page, 'nutri-pwa', 'meals');
      expect(synced[0].foodSnapshot.kcal).toBe(120);
    }).toPass({ timeout: 15000 });
    const synced = await getAllFromStore(page, 'nutri-pwa', 'meals');
    expect(synced[0].foodSnapshot.kcal).toBe(120);
    await expect(page.locator('#mealsList')).toContainText('Greek Yogurt');
  });

  test('batch update: update all meals of a food from Foods list', async ({ page }) => {
    // Arrange: create food, add meals for 2 days
    await createFood(page, { name:'Oats', refLabel:'50 g', kcal:190, prot:8, carbs:32, fats:3.5 });
    // Add two meals for today
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'oat');
    await page.click('#quickList .item .add');
    await page.click('#quickList .item .add05'); // bumps qty in quick list input
    await page.click('#quickList .item .add');

    // Switch to yesterday and add one meal
    const today = await page.inputValue('#mealDate');
    const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
    const yest = d.toISOString().slice(0,10);
    await page.fill('#mealDate', yest);
    await page.dispatchEvent('#mealDate', 'change');
    await page.fill('#quickSearch', 'oat');
    await page.click('#quickList .item .add');

    // Edit food macros
    await page.locator('.tab', { hasText: 'Foods' }).click();
    await page.fill('#foodSearch', 'oat');
    await page.click('#foodsList .item .edit');
  // Wait for original values to load before changing (race guard)
  await expect(page.locator('#foodProt')).toHaveValue('8');
    await page.fill('#foodProt', '10');
    await page.click('#saveFoodBtn');

    // Batch update via ⟳ Update meals
  const updateBtn = page.locator('#foodsList .item .updateMeals').first();
  // Accept alert immediately when it appears
  const dialogPromise = page.waitForEvent('dialog').then(d => d.accept());
  await updateBtn.click();
  await dialogPromise.catch(() => {});

    // Assert: both days' meals updated snapshots
    await expect(async () => {
      const mealsAll = await getAllFromStore(page, 'nutri-pwa', 'meals');
      expect(mealsAll.length).toBeGreaterThanOrEqual(3);
      expect(mealsAll.every(m => m.foodSnapshot.prot === 10)).toBeTruthy();
    }).toPass({ timeout: 20000 });
  });
});

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

    // -0.5 three times -> 2 -> 1.5 -> 1.0 -> 0.5; qtyMinus blocks at 0 so use del to remove
    await page.locator('#mealsList .item .qtyMinus').click();
    await page.locator('#mealsList .item .qtyMinus').click();
    await page.locator('#mealsList .item .qtyMinus').click();
    await expect(page.locator('#mealsList')).toContainText('×0.5');
    await page.locator('#mealsList .item .del').click();

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

  test('quick-add: qty -1 shows error and creates no meal', async ({ page }) => {
    // Arrange: create a food and open the meals tab
    await createFood(page, { name: 'Chicken', refLabel: '100 g', kcal: 165, prot: 31, carbs: 0, fats: 3.6 });
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'chi');
    await expect(page.locator('#quickList .item')).toHaveCount(1);

    // Act: set qty to -1 (below min) and attempt to add
    await page.locator('#quickList .item .qty').fill('-1');
    await page.locator('#quickList .item .add').click();

    // Assert: qty input is styled as error; no meal was added
    await expect(page.locator('#quickList .item .qty')).toHaveClass(/error/);
    await expect(page.locator('#mealsList .item')).toHaveCount(0);
  });

  test('quick-add: qty 101 shows error and creates no meal', async ({ page }) => {
    // Arrange
    await createFood(page, { name: 'Chicken', refLabel: '100 g', kcal: 165, prot: 31, carbs: 0, fats: 3.6 });
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'chi');
    await expect(page.locator('#quickList .item')).toHaveCount(1);

    // Act: set qty to 101 (above max:100) and attempt to add
    await page.locator('#quickList .item .qty').fill('101');
    await page.locator('#quickList .item .add').click();

    // Assert: qty input is styled as error; no meal was added
    await expect(page.locator('#quickList .item .qty')).toHaveClass(/error/);
    await expect(page.locator('#mealsList .item')).toHaveCount(0);
  });

  test('quick-add: qty 0 should not create a meal', async ({ page }) => {
    // Arrange
    await createFood(page, { name: 'Chicken', refLabel: '100 g', kcal: 165, prot: 31, carbs: 0, fats: 3.6 });
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'chi');
    await expect(page.locator('#quickList .item')).toHaveCount(1);

    // Act: set qty to 0 and attempt to add
    await page.locator('#quickList .item .qty').fill('0');
    await page.locator('#quickList .item .add').click();

    // Assert: qty input shows error and no meal is created
    await expect(page.locator('#quickList .item .qty')).toHaveClass(/error/);
    await expect(page.locator('#mealsList .item')).toHaveCount(0);
  });

  test('"create new" link navigates to Foods tab with search term prefilled', async ({ page }) => {
    // Arrange: create a food so the quick list initially shows results
    await createFood(page, { name: 'Chicken', refLabel: '100 g', kcal: 165, prot: 31, carbs: 0, fats: 3.6 });
    await page.locator('.tab', { hasText: 'Meals' }).click();
    // Confirm quick list starts populated (so the transition to "no results" is detectable)
    await expect(page.locator('#quickList .item')).toHaveCount(1);

    // Act: type a term that matches no food — triggers the "create it" link
    await page.fill('#quickSearch', 'Dragon Fruit XYZ');
    // Wait for the debounced re-render: items disappear, link appears
    await expect(page.locator('#quickNew')).toBeVisible();

    // Act: click "create it"
    await page.locator('#quickNew').click();

    // Assert: Foods tab is now active (navigation happened)
    await expect(page.locator('.tab[data-page="foods"]')).toHaveClass(/active/);
    // Assert: food name field is prefilled with the search term
    await expect(page.locator('#foodName')).toHaveValue('Dragon Fruit XYZ');
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
    // Navigate to yesterday via prevDayBox using ISO date attribute (avoid timezone pitfalls)
    const isoToday = await page.getAttribute('#dayLabel', 'data-iso');
    expect(isoToday).toMatch(/\d{4}-\d{2}-\d{2}/);
    await page.click('#prevDayBox');
    const isoPrev = await page.getAttribute('#dayLabel', 'data-iso');
    expect(isoPrev).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(isoPrev).not.toBe(isoToday);
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
  await updateBtn.click();

    // Assert: both days' meals updated snapshots
    await expect(async () => {
    const mealsAll = await getAllFromStore(page, 'nutri-pwa', 'meals');
      expect(mealsAll.length).toBeGreaterThanOrEqual(3);
      expect(mealsAll.every(m => m.foodSnapshot.prot === 10)).toBeTruthy();
    }).toPass({ timeout: 20000 });
  });
});

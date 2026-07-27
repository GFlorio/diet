import { expect, test } from '@playwright/test';
import { encodeRecipeCode } from '../src/food-share-code.js';
import { getAllFromStore, loadPouchDB, resetDB } from './playwright-helpers.js';

const PORTABLE_RECIPE = {
  id: 'food:portable',
  type: 'recipe',
  name: 'Shared bowl',
  refLabel: '1 bowl',
  archived: false,
  updatedAt: 1,
  kcal: 999,
  prot: 99,
  carbs: 99,
  fats: 99,
  ingredients: [
    { foodId: 'food:portable-rice', multiplier: 1.5 },
    { foodId: 'food:portable-chicken', multiplier: 2 },
  ],
  resolvedIngredients: [
    {
      foodId: 'food:portable-rice',
      multiplier: 1.5,
      food: {
        id: 'food:portable-rice',
        name: 'Rice',
        refLabel: '1 cup',
        kcal: 999,
        prot: 9,
        carbs: 9,
        fats: 9,
        archived: false,
        updatedAt: 1,
      },
      macros: { kcal: 1498.5, prot: 13.5, carbs: 13.5, fats: 13.5 },
    },
    {
      foodId: 'food:portable-chicken',
      multiplier: 2,
      food: {
        id: 'food:portable-chicken',
        name: 'Chicken',
        refLabel: '1 breast',
        kcal: 888,
        prot: 88,
        carbs: 8,
        fats: 8,
        archived: false,
        updatedAt: 1,
      },
      macros: { kcal: 1776, prot: 176, carbs: 16, fats: 16 },
    },
  ],
};

async function createBasicFood(page, food) {
  await page.locator('.tab', { hasText: 'Foods' }).click();
  await page.click('#addFoodBtn');
  await page.fill('#foodName', food.name);
  await page.fill('#foodRefLabel', food.refLabel);
  await page.fill('#foodKcal', String(food.kcal));
  await page.fill('#foodProt', String(food.prot));
  await page.fill('#foodCarb', String(food.carbs));
  await page.fill('#foodFat', String(food.fats));
  await page.click('#saveFoodBtn');
  await expect(page.locator('#foodsList .item', { hasText: food.name })).toBeVisible();
}

async function addRecipeIngredient(page, search, quantity) {
  await page.fill('#recipeIngredientSearch', search);
  const result = page.locator('#recipeIngredientResults .recipe-search-result').filter({
    has: page.locator('strong', { hasText: new RegExp(`^${search}$`, 'i') }),
  });
  await result.click();
  const row = page.locator('#recipeIngredients .recipe-ingredient-row').filter({
    has: page.locator('strong', { hasText: new RegExp(`^${search}$`, 'i') }),
  });
  await row.locator('.ingredient-multiplier').fill(String(quantity));
}

async function createRecipe(page) {
  await page.click('#createRecipeBtn');
  await page.fill('#foodName', 'Chicken rice bowl');
  await page.fill('#foodRefLabel', '1 bowl');
  await addRecipeIngredient(page, 'rice', 1.5);
  await addRecipeIngredient(page, 'chicken', 2);
  await expect(page.locator('#recipeSummary')).toContainText('550 kcal');
  await page.click('#saveFoodBtn');
  await expect(page.locator('#foodsList .item', { hasText: 'Chicken rice bowl' })).toBeVisible();
}

test.describe('Recipes and editable meal quantities', () => {
  test.beforeEach(async ({ page }) => {
    await loadPouchDB(page);
    await page.goto('/');
    await resetDB(page);
    await page.reload();
    await createBasicFood(page, {
      name: 'Rice',
      refLabel: '100 g',
      kcal: 100,
      prot: 2,
      carbs: 20,
      fats: 1,
    });
    await createBasicFood(page, {
      name: 'Chicken',
      refLabel: '100 g',
      kcal: 200,
      prot: 30,
      carbs: 0,
      fats: 5,
    });
  });

  test('creates a reference-only recipe and logs a structural snapshot', async ({ page }) => {
    await createRecipe(page);

    const foods = await getAllFromStore(page, 'foods');
    const recipe = foods.find(food => food.name === 'Chicken rice bowl');
    expect(recipe).toMatchObject({
      type: 'recipe',
      refLabel: '1 bowl',
      ingredients: [
        { multiplier: 1.5 },
        { multiplier: 2 },
      ],
    });
    expect(recipe).not.toHaveProperty('kcal');
    await expect(page.locator('#foodsList .item', { hasText: 'Chicken rice bowl' })).toContainText('Recipe');

    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'chicken rice');
    await page.locator('#quickList .item', { hasText: 'Recipe' }).locator('.add').click();
    await expect(page.locator('#mealsList .meal-row')).toHaveCount(1);

    const [meal] = await getAllFromStore(page, 'meals');
    expect(meal.foodSnapshot).toMatchObject({
      type: 'recipe',
      name: 'Chicken rice bowl',
      ingredients: [
        { multiplier: 1.5, foodSnapshot: { name: 'Rice', kcal: 100 } },
        { multiplier: 2, foodSnapshot: { name: 'Chicken', kcal: 200 } },
      ],
    });
    expect(meal.foodSnapshot).not.toHaveProperty('kcal');

    const row = page.locator('#mealsList .meal-row');
    await expect(row.locator('.del')).not.toBeVisible();
    await expect(row.locator('.meal-disclosure-header')).toHaveAttribute('aria-expanded', 'false');
    await row.locator('.meal-disclosure-header').click();
    await expect(row.locator('.del')).toBeVisible();
    await expect(row.locator('.meal-ingredient-header')).toHaveCount(2);
    await expect(row.locator('.meal-ingredient-header').first()).toContainText(
      '100 g ×1.5 · 150 kcal · Protein 3 g · Carbs 30 g · Fat 1.5 g',
    );
    await expect(row.locator('.meal-ingredient-header').nth(1)).toContainText(
      '100 g ×2 · 400 kcal · Protein 60 g · Carbs 0 g · Fat 10 g',
    );

    await row.locator('.meal-plus').click();
    await expect(row.locator('.meal-save-status')).toContainText('Saved');
    await expect(row).toContainText('1100 kcal');
    const [updatedMeal] = await getAllFromStore(page, 'meals');
    expect(updatedMeal.multiplier).toBe(2);

    await row.locator('.meal-ingredient-header').first().click();
    const ingredientQuantity = row.locator('.meal-ingredient-quantity-input').first();
    await expect(ingredientQuantity).toHaveValue('1.5');
    const firstIngredient = row.locator('.meal-ingredient').first();
    await firstIngredient.locator('.meal-ingredient-plus').click();
    await expect(ingredientQuantity).toHaveValue('2.5');
    await firstIngredient.locator('.meal-ingredient-minus').click();
    await expect(ingredientQuantity).toHaveValue('2');
    await expect(row).not.toContainText('Captured portion');
    await expect(row).not.toContainText('Recipe quantity');
    await expect(row).not.toContainText('Effective quantity');
    await ingredientQuantity.fill('2');
    await ingredientQuantity.press('Enter');
    await expect(row.locator('.meal-ingredient-save-status').first()).toContainText('Saved');
    await expect(row).toContainText('1200 kcal');

    await row.locator('.meal-ingredient-delete').first().click();
    await expect(row.locator('.meal-ingredient-header')).toHaveCount(1);
    await expect(row).toContainText('800 kcal');
    const [ingredientEditedMeal] = await getAllFromStore(page, 'meals');
    expect(ingredientEditedMeal.foodSnapshot.ingredients).toHaveLength(1);
    expect(ingredientEditedMeal.foodSnapshot.ingredients[0].foodSnapshot.name).toBe('Chicken');

    await row.locator('.meal-minus').click();
    await expect(row.locator('.meal-quantity-input')).toHaveValue('1.5');

    const quantityInput = row.locator('.meal-quantity-input');
    await quantityInput.fill('2.5');
    await quantityInput.press('Enter');
    await expect(quantityInput).toHaveValue('2.5');

    await quantityInput.fill('3');
    await row.locator('.meal-panel-label').click();
    await expect(quantityInput).toHaveValue('3');

    await quantityInput.fill('4');
    await quantityInput.press('Escape');
    await expect(quantityInput).toHaveValue('3');
  });

  test('ingredient edit offers and performs direct plus recipe meal sync', async ({ page }) => {
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'rice');
    await page.locator('#quickList .item', { hasText: 'Rice' }).first().locator('.add').click();
    await expect(page.locator('#mealsList .meal-row')).toHaveCount(1);

    await page.locator('.tab', { hasText: 'Foods' }).click();
    await createRecipe(page);
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'chicken rice');
    await page.locator('#quickList .item', { hasText: 'Recipe' }).locator('.add').click();
    await expect(page.locator('#mealsList .meal-row')).toHaveCount(2);

    await page.locator('.tab', { hasText: 'Foods' }).click();
    await page.fill('#foodSearch', 'rice');
    const riceRow = page.locator('#foodsList .item').filter({
      has: page.locator('strong', { hasText: /^Rice$/ }),
    });
    await riceRow.locator('.edit').click();
    await expect(page.locator('#foodKcal')).toHaveValue('100');
    await page.fill('#foodKcal', '120');
    await page.click('#saveFoodBtn');

    await expect(page.locator('.toast').filter({
      hasText: '1 direct meal and 1 recipe meal',
    })).toBeVisible();
    const beforeSync = await getAllFromStore(page, 'meals');
    const directBefore = beforeSync.find(meal => meal.foodSnapshot.type === 'basic');
    const recipeBefore = beforeSync.find(meal => meal.foodSnapshot.type === 'recipe');
    expect(directBefore.foodSnapshot.kcal).toBe(100);
    expect(recipeBefore.foodSnapshot.ingredients[0].foodSnapshot.kcal).toBe(100);

    await page.getByRole('button', { name: /Update meals/i }).click();
    await expect(page.locator('.toast').filter({ hasText: '2 meals updated' })).toBeVisible();
    const afterSync = await getAllFromStore(page, 'meals');
    const directAfter = afterSync.find(meal => meal.foodSnapshot.type === 'basic');
    const recipeAfter = afterSync.find(meal => meal.foodSnapshot.type === 'recipe');
    expect(directAfter.foodSnapshot.kcal).toBe(120);
    expect(recipeAfter.foodSnapshot.ingredients[0].foodSnapshot.kcal).toBe(120);
  });

  test('archiving a referenced ingredient keeps recipes usable and suppresses deletion', async ({ page }) => {
    await createRecipe(page);
    await page.fill('#foodSearch', 'rice');
    const riceRow = page.locator('#foodsList .item').filter({
      has: page.locator('strong', { hasText: /^Rice$/ }),
    });
    await riceRow.locator('.archive').click();

    await expect(page.locator('.toast').filter({ hasText: 'recipe still use' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Delete/ })).toHaveCount(0);
    await page.selectOption('#foodStatus', 'all');
    await page.fill('#foodSearch', 'chicken rice');
    await expect(page.locator('#foodsList')).toContainText('Chicken rice bowl');
  });

  test('recipe link stays unsaved and previews conflicting local matches', async ({ page }) => {
    const code = encodeRecipeCode(PORTABLE_RECIPE);
    await page.goto(`/?r=${code}`);

    await expect(page.locator('.tab[data-page="foods"]')).toHaveClass(/active/);
    await expect(page.locator('#foodName')).toHaveValue('Shared bowl');
    await expect(page.locator('#recipeIngredients .chip', { hasText: 'Local match' })).toHaveCount(2);
    await expect(page.locator('#recipeSummary')).toContainText('550 kcal');
    expect(await getAllFromStore(page, 'foods')).toHaveLength(2);

    await page.click('#saveFoodBtn');
    await expect(page.locator('#foodsList .item', { hasText: 'Shared bowl' })).toBeVisible();
    const foods = await getAllFromStore(page, 'foods');
    expect(foods).toHaveLength(3);
    expect(foods.filter(food => food.type === 'recipe')).toHaveLength(1);
  });

  test('saving a recipe link creates only unmatched ingredients in a clean database', async ({ page }) => {
    await resetDB(page);
    const code = encodeRecipeCode(PORTABLE_RECIPE);
    await page.goto(`/?r=${code}`);

    await expect(page.locator('#recipeIngredients .chip', { hasText: 'New food' })).toHaveCount(2);
    expect(await getAllFromStore(page, 'foods')).toHaveLength(0);
    await page.click('#saveFoodBtn');
    await expect(page.locator('#foodsList .item', { hasText: 'Shared bowl' })).toBeVisible();

    const foods = await getAllFromStore(page, 'foods');
    expect(foods).toHaveLength(3);
    expect(foods.map(food => food.name).sort()).toEqual(['Chicken', 'Rice', 'Shared bowl']);
  });
});

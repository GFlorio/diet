import './setup.js';
import { beforeEach, describe, expect, test } from 'vitest';
import * as db from '../../db.js';
import { Foods } from '../../data-foods.js';
import {
  Meals,
  resolveMealMacros,
  resolveSnapshotMacros,
} from '../../data-meals.js';
import { createFood, resetTestDB } from './helpers.js';

beforeEach(resetTestDB);

/**
 * @param {string} name
 * @param {Array<{foodId: string, multiplier: number}>} ingredients
 */
function createRecipe(name, ingredients) {
  return Foods.create({
    type: 'recipe',
    name,
    refLabel: '1 serving',
    ingredients,
  });
}

/** @param {import('../../db.js').Meal[]} meals @param {string} id */
function findMeal(meals, id) {
  const meal = meals.find(candidate => candidate.id === id);
  if (!meal) { throw new Error(`Missing meal ${id}`); }
  return meal;
}

describe('Recipe food resolution', () => {
  test('persists references only and resolves normalized current totals', async () => {
    const rice = await createFood({
      name: 'Rice',
      kcal: 101,
      prot: 2.34,
      carbs: 20.06,
      fats: 0.15,
    });
    const beans = await createFood({
      name: 'Beans',
      kcal: 89,
      prot: 5.55,
      carbs: 15.03,
      fats: 0.45,
    });

    const recipe = await createRecipe('Rice and beans', [
      { foodId: rice.id, multiplier: 1.25 },
      { foodId: beans.id, multiplier: 0.75 },
    ]);
    const raw = await db.get('foods', recipe.id);

    expect(raw).toMatchObject({
      type: 'recipe',
      name: 'Rice and beans',
      ingredients: [
        { foodId: rice.id, multiplier: 1.25 },
        { foodId: beans.id, multiplier: 0.75 },
      ],
    });
    expect(raw).not.toHaveProperty('kcal');
    expect(raw).not.toHaveProperty('resolvedIngredients');
    expect(recipe).toMatchObject({
      kcal: 193,
      prot: 7.1,
      carbs: 36.3,
      fats: 0.5,
    });

    const listed = await Foods.list({ search: 'beans', type: 'recipe' });
    expect(listed.map(food => food.id)).toEqual([recipe.id]);
    expect((await Foods.byId(recipe.id))?.kcal).toBe(193);
  });

  test('ingredient edits change recipe reads without writing the recipe', async () => {
    const ingredient = await createFood({ name: 'Oats', kcal: 100 });
    const recipe = await createRecipe('Porridge', [
      { foodId: ingredient.id, multiplier: 2 },
    ]);
    const rawBefore = await db.get('foods', recipe.id);

    await Foods.update(ingredient.id, { kcal: 125 });

    const resolved = await Foods.byId(recipe.id);
    const rawAfter = await db.get('foods', recipe.id);
    expect(resolved?.kcal).toBe(250);
    expect(rawAfter).toEqual(rawBefore);
  });

  test('rejects invalid composition and type conversion', async () => {
    const basic = await createFood({ name: 'Basic' });
    const recipe = await createRecipe('Valid recipe', [
      { foodId: basic.id, multiplier: 1 },
    ]);

    await expect(createRecipe('Empty', [])).rejects.toThrow('at least one');
    await expect(createRecipe('Duplicate', [
      { foodId: basic.id, multiplier: 1 },
      { foodId: basic.id, multiplier: 2 },
    ])).rejects.toThrow('unique');
    await expect(createRecipe('Nested', [
      { foodId: recipe.id, multiplier: 1 },
    ])).rejects.toThrow('cannot contain recipes');
    await expect(createRecipe('Missing', [
      { foodId: 'food:missing', multiplier: 1 },
    ])).rejects.toThrow('Missing ingredient');
    await expect(createRecipe('Zero', [
      { foodId: basic.id, multiplier: 0 },
    ])).rejects.toThrow('greater than 0');
    await expect(createRecipe('Too much', [
      { foodId: basic.id, multiplier: 101 },
    ])).rejects.toThrow('at most 100');
    await expect(Foods.update(basic.id, /** @type {any} */ ({
      type: 'recipe',
      ingredients: [{ foodId: basic.id, multiplier: 1 }],
    }))).rejects.toThrow('cannot be changed');
    await expect(Foods.update(recipe.id, /** @type {any} */ ({
      type: 'basic',
      kcal: 1,
    }))).rejects.toThrow('cannot be changed');
  });

  test('archived ingredients resolve but cannot be permanently deleted', async () => {
    const ingredient = await createFood({ name: 'Archived ingredient' });
    const recipe = await createRecipe('Still usable', [
      { foodId: ingredient.id, multiplier: 1 },
    ]);

    await Foods.setArchived(ingredient.id, true);

    expect((await Foods.byId(recipe.id))?.kcal).toBe(ingredient.kcal);
    await expect(Foods.remove(ingredient.id)).rejects.toThrow('still use it');
  });
});

describe('Recipe snapshots and cascading synchronization', () => {
  test('freezes structural snapshots and rebuilds direct and dependent meals', async () => {
    const rice = await createFood({ name: 'Rice', kcal: 100, prot: 2 });
    const chicken = await createFood({ name: 'Chicken', kcal: 200, prot: 30 });
    const other = await createFood({ name: 'Other', kcal: 50 });
    const recipe = await createRecipe('Bowl', [
      { foodId: rice.id, multiplier: 1.5 },
      { foodId: chicken.id, multiplier: 2 },
    ]);
    const directMeal = await Meals.create({ food: rice, multiplier: 1, date: '2024-06-01' });
    const recipeMeal = await Meals.create({ food: recipe, multiplier: 2, date: '2024-06-01' });
    const unrelatedMeal = await Meals.create({ food: other, multiplier: 1, date: '2024-06-01' });

    expect(recipeMeal.foodSnapshot.type).toBe('recipe');
    expect(recipeMeal.foodSnapshot).not.toHaveProperty('kcal');
    if (recipeMeal.foodSnapshot.type !== 'recipe') { throw new Error('Expected recipe snapshot'); }
    expect(recipeMeal.foodSnapshot.ingredients).toHaveLength(2);
    expect(resolveMealMacros(recipeMeal).kcal).toBe(1100);

    await Foods.update(rice.id, { kcal: 110 });
    await Foods.update(chicken.id, { kcal: 250 });

    const frozen = await Meals.listByDate('2024-06-01');
    expect(resolveSnapshotMacros(
      findMeal(frozen, directMeal.id).foodSnapshot,
    ).kcal).toBe(100);
    expect(resolveMealMacros(
      findMeal(frozen, recipeMeal.id),
    ).kcal).toBe(1100);
    expect((await Foods.byId(recipe.id))?.kcal).toBe(665);

    const preview = await Meals.syncSummaryForFood(rice.id);
    expect(preview).toEqual({
      directCount: 1,
      recipeCount: 1,
      totalCount: 2,
      recipeIds: [recipe.id],
    });
    const result = await Meals.syncAllForFood(rice.id);
    expect(result).toEqual(preview);

    const synced = await Meals.listByDate('2024-06-01');
    expect(resolveSnapshotMacros(
      findMeal(synced, directMeal.id).foodSnapshot,
    ).kcal).toBe(110);
    expect(resolveMealMacros(
      findMeal(synced, recipeMeal.id),
    ).kcal).toBe(1330);
    expect(synced.find(meal => meal.id === unrelatedMeal.id)).toEqual(unrelatedMeal);
  });

  test('uses current dependencies, including archived recipes', async () => {
    const ingredient = await createFood({ name: 'Ingredient', kcal: 100 });
    const replacement = await createFood({ name: 'Replacement', kcal: 50 });
    const removedDependency = await createRecipe('Removed dependency', [
      { foodId: ingredient.id, multiplier: 1 },
    ]);
    const newDependency = await createRecipe('New dependency', [
      { foodId: replacement.id, multiplier: 1 },
    ]);
    await Meals.create({ food: removedDependency, multiplier: 1, date: '2024-06-01' });
    await Meals.create({ food: newDependency, multiplier: 1, date: '2024-06-01' });

    await Foods.update(removedDependency.id, {
      ingredients: [{ foodId: replacement.id, multiplier: 1 }],
    });
    await Foods.update(newDependency.id, {
      ingredients: [{ foodId: ingredient.id, multiplier: 2 }],
    });
    await Foods.setArchived(newDependency.id, true);

    const preview = await Meals.syncSummaryForFood(ingredient.id);
    expect(preview.recipeIds).toEqual([newDependency.id]);
    expect(preview.recipeCount).toBe(1);
  });

  test('syncing a recipe targets only its own meals', async () => {
    const ingredient = await createFood({ name: 'Ingredient', kcal: 100 });
    const first = await createRecipe('First', [{ foodId: ingredient.id, multiplier: 1 }]);
    const second = await createRecipe('Second', [{ foodId: ingredient.id, multiplier: 2 }]);
    await Meals.create({ food: first, multiplier: 1, date: '2024-06-01' });
    const secondMeal = await Meals.create({ food: second, multiplier: 1, date: '2024-06-01' });

    await Foods.update(first.id, {
      name: 'First updated',
      ingredients: [{ foodId: ingredient.id, multiplier: 3 }],
    });
    const result = await Meals.syncAllForFood(first.id);

    expect(result).toMatchObject({ directCount: 0, recipeCount: 1, totalCount: 1 });
    const meals = await Meals.listByDate('2024-06-01');
    expect(meals.find(meal => meal.foodId === first.id)?.foodSnapshot.name).toBe('First updated');
    expect(meals.find(meal => meal.id === secondMeal.id)).toEqual(secondMeal);
  });

  test('updates meal quantities without changing date or snapshot', async () => {
    const food = await createFood({ name: 'Food', kcal: 100 });
    const meal = await Meals.create({ food, multiplier: 1, date: '2024-06-01' });
    const updated = await Meals.updateMultiplier(meal.id, 2.5);

    expect(updated).toMatchObject({
      id: meal.id,
      date: meal.date,
      multiplier: 2.5,
      foodSnapshot: meal.foodSnapshot,
    });
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(meal.updatedAt);
    await expect(Meals.updateMultiplier(meal.id, 0)).rejects.toThrow('greater than 0');
  });

  test('customizes ingredient quantities and removes ingredients only from the logged meal', async () => {
    const rice = await createFood({ name: 'Rice', kcal: 100 });
    const chicken = await createFood({ name: 'Chicken', kcal: 200 });
    const recipe = await createRecipe('Bowl', [
      { foodId: rice.id, multiplier: 1.5 },
      { foodId: chicken.id, multiplier: 2 },
    ]);
    const meal = await Meals.create({ food: recipe, multiplier: 2, date: '2024-06-01' });

    const edited = await Meals.updateRecipeIngredientMultiplier(meal.id, 0, 2);
    expect(edited && resolveMealMacros(edited).kcal).toBe(1200);

    const removed = await Meals.removeRecipeIngredient(meal.id, 0);
    expect(removed?.foodSnapshot.type).toBe('recipe');
    if (!removed || removed.foodSnapshot.type !== 'recipe') { throw new Error('Expected recipe meal'); }
    expect(removed.foodSnapshot.ingredients.map(ingredient => ingredient.foodSnapshot.name)).toEqual(['Chicken']);
    expect(resolveMealMacros(removed).kcal).toBe(800);

    const unchangedRecipe = await Foods.byId(recipe.id);
    expect(unchangedRecipe?.type).toBe('recipe');
    if (!unchangedRecipe || unchangedRecipe.type !== 'recipe') { throw new Error('Expected recipe'); }
    expect(unchangedRecipe.ingredients).toHaveLength(2);
    await expect(Meals.removeRecipeIngredient(meal.id, 0)).rejects.toThrow('keep at least one');
    await expect(Meals.updateRecipeIngredientMultiplier(meal.id, 0, 0)).rejects.toThrow('greater than 0');
  });
});

describe('Recipe backup integrity', () => {
  test('exports and imports reference-only recipes and structural snapshots', async () => {
    const ingredient = await createFood({ name: 'Ingredient', kcal: 123 });
    const recipe = await createRecipe('Backup recipe', [
      { foodId: ingredient.id, multiplier: 1.5 },
    ]);
    await Meals.create({ food: recipe, multiplier: 2, date: '2024-06-01' });

    const backup = await db.exportDB();
    const rawRecipe = backup.foods.find(food => food.id === recipe.id);
    const rawMeal = backup.meals.find(meal => meal.foodId === recipe.id);
    expect(backup.version).toBe(2);
    expect(rawRecipe).not.toHaveProperty('kcal');
    expect(rawMeal?.foodSnapshot).not.toHaveProperty('kcal');

    await db.resetDB();
    await db.importDB(backup);

    expect((await Foods.byId(recipe.id))?.kcal).toBe(185);
    const [meal] = await Meals.listByDate('2024-06-01');
    expect(resolveMealMacros(meal).kcal).toBe(370);
  });

  test('rejects unresolved recipe imports before replacing current data', async () => {
    const existing = await createFood({ name: 'Keep me' });
    const invalidBackup = {
      version: 2,
      foods: [{
        id: 'food:recipe',
        type: 'recipe',
        name: 'Broken',
        refLabel: '1 portion',
        ingredients: [{ foodId: 'food:missing', multiplier: 1 }],
        archived: false,
        updatedAt: 1,
      }],
      meals: [],
      goals: [],
    };

    await expect(db.importDB(/** @type {any} */ (invalidBackup))).rejects.toThrow('Invalid ingredient');
    expect(await Foods.byId(existing.id)).toBeDefined();
  });
});

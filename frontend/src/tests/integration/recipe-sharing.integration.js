import './setup.js';
import { beforeEach, describe, expect, test } from 'vitest';
import * as db from '../../db.js';
import { Foods } from '../../data-foods.js';
import { decodeRecipeCode, encodeRecipeCode } from '../../food-share-code.js';
import { createFood, resetTestDB } from './helpers.js';

beforeEach(resetTestDB);

describe('Portable recipe sharing', () => {
  test('round-trips Unicode names and decimal quantities without IDs or totals', async () => {
    const açai = await createFood({
      name: 'Açaí sem açúcar',
      refLabel: '100 g',
      kcal: 70,
      prot: 1.1,
      carbs: 12.3,
      fats: 2.2,
    });
    const recipe = await Foods.create({
      type: 'recipe',
      name: 'Tigela de açaí',
      refLabel: '1 porção',
      ingredients: [{ foodId: açai.id, multiplier: 1.25 }],
    });
    if (recipe.type !== 'recipe') { throw new Error('Expected recipe'); }

    const code = encodeRecipeCode(recipe);
    const decoded = decodeRecipeCode(code);

    expect(decoded).toEqual({
      version: 1,
      type: 'recipe',
      name: 'Tigela de açaí',
      refLabel: '1 porção',
      ingredients: [{
        multiplier: 1.25,
        food: {
          name: 'Açaí sem açúcar',
          refLabel: '100 g',
          kcal: 70,
          prot: 1.1,
          carbs: 12.3,
          fats: 2.2,
        },
      }],
    });
    expect(code).not.toContain(açai.id);
    expect(decoded).not.toHaveProperty('kcal');
  });

  test('prepares without writes and prefers newest active local matches', async () => {
    await createFood({ name: 'Rice', kcal: 100, updatedAt: 1 });
    const newestActive = await createFood({ name: ' rice ', kcal: 200, updatedAt: 3 });
    await createFood({ name: 'RICE', kcal: 300, updatedAt: 9, archived: true });
    const before = await db.getAll('foods');
    const bundle = {
      version: /** @type {const} */ (1),
      type: /** @type {const} */ ('recipe'),
      name: 'Imported bowl',
      refLabel: '1 bowl',
      ingredients: [{
        multiplier: 1,
        food: { name: 'Rice', refLabel: '1 cup', kcal: 999, prot: 9, carbs: 9, fats: 9 },
      }],
    };

    const prepared = await Foods.preparePortableRecipe(bundle);

    expect(prepared.ingredients[0].match?.id).toBe(newestActive.id);
    expect(prepared.ingredients[0].match?.kcal).toBe(200);
    expect(await db.getAll('foods')).toEqual(before);
  });

  test('reuses matches, creates unmatched basics, and edits only same-name recipes', async () => {
    const localRice = await createFood({ name: 'Rice', kcal: 100 });
    const sameNameBasic = await createFood({ name: 'Shared bowl', kcal: 50 });
    const bundle = {
      version: /** @type {const} */ (1),
      type: /** @type {const} */ ('recipe'),
      name: 'Shared bowl',
      refLabel: '1 bowl',
      ingredients: [
        {
          multiplier: 1.5,
          food: { name: 'Rice', refLabel: '1 cup', kcal: 999, prot: 9, carbs: 9, fats: 9 },
        },
        {
          multiplier: 0.75,
          food: { name: 'Tofu', refLabel: '100 g', kcal: 80, prot: 8, carbs: 2, fats: 4 },
        },
      ],
    };

    const firstSave = await Foods.savePortableRecipe(bundle);
    const foodsAfterFirstSave = await Foods.list({ status: 'all' });
    const tofu = foodsAfterFirstSave.find(food => food.name === 'Tofu');
    expect(tofu).toBeDefined();
    expect(firstSave.type).toBe('recipe');
    if (firstSave.type !== 'recipe') { throw new Error('Expected recipe'); }
    expect(firstSave.ingredients[0].foodId).toBe(localRice.id);
    expect(firstSave.ingredients[1].foodId).toBe(tofu?.id);
    expect(foodsAfterFirstSave.find(food => food.id === sameNameBasic.id)?.type).not.toBe('recipe');

    const secondSave = await Foods.savePortableRecipe({
      ...bundle,
      refLabel: '2 bowls',
      ingredients: [bundle.ingredients[0]],
    });
    const recipes = await Foods.list({ status: 'all', type: 'recipe' });
    expect(recipes).toHaveLength(1);
    expect(secondSave.id).toBe(firstSave.id);
    expect(secondSave.refLabel).toBe('2 bowls');
  });
});

import * as db from './db.js';
import { addMacros, normalizeMacros, zeroMacros } from './macro-resolution.js';
import * as $ from './utils.js';

const FUZZY_THRESHOLD = 0.4;
const MAX_INGREDIENT_MULTIPLIER = 100;

/** @param {string} value */
function stripAccents(value) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** @param {string} value @returns {Set<string>} */
function trigrams(value) {
  const padded = ` ${value} `;
  const grams = new Set();
  for (let index = 0; index < padded.length - 2; index++) {
    grams.add(padded.slice(index, index + 3));
  }
  return grams;
}

/** @param {Set<string>} left @param {Set<string>} right */
function trigramSimilarity(left, right) {
  if (left.size === 0 || right.size === 0) { return 0; }
  let shared = 0;
  for (const gram of left) {
    if (right.has(gram)) { shared++; }
  }
  return shared / (left.size + right.size - shared);
}

/**
 * @param {string[]} queryWords
 * @param {string} haystack
 * @param {string[]} haystackWords
 * @returns {0|1|2}
 */
function foodMatchScore(queryWords, haystack, haystackWords) {
  if (queryWords.every(word => haystack.includes(word))) { return 2; }
  const haystackGrams = haystackWords.map(trigrams);
  const allFuzzy = queryWords.every(queryWord => {
    if (haystack.includes(queryWord)) { return true; }
    const queryGrams = trigrams(queryWord);
    return haystackGrams.some(grams => trigramSimilarity(queryGrams, grams) >= FUZZY_THRESHOLD);
  });
  return allFuzzy ? 1 : 0;
}

/**
 * @typedef {import('./db.js').Food} Food
 * @typedef {import('./db.js').FoodRecord} FoodRecord
 * @typedef {import('./db.js').BasicFoodRecord} BasicFoodRecord
 * @typedef {import('./db.js').RecipeFoodRecord} RecipeFoodRecord
 * @typedef {import('./db.js').ResolvedRecipeFood} ResolvedRecipeFood
 * @typedef {import('./db.js').Macros} Macros
 * @typedef {{ name: string, refLabel: string, kcal: number, prot: number,
 *   carbs: number, fats: number, type?: 'basic' }} CreateBasicFoodInput
 * @typedef {{ name: string, refLabel: string, type: 'recipe',
 *   ingredients: Array<{foodId: string, multiplier: number}> }} CreateRecipeFoodInput
 * @typedef {CreateBasicFoodInput} CreateFoodInput
 * @typedef {CreateBasicFoodInput | CreateRecipeFoodInput} FoodCreateInput
 * @typedef {{
 *   version: 1,
 *   type: 'recipe',
 *   name: string,
 *   refLabel: string,
 *   ingredients: Array<{
 *     multiplier: number,
 *     food: {name: string, refLabel: string, kcal: number, prot: number, carbs: number, fats: number}
 *   }>
 * }} PortableRecipe
 */

/** @param {FoodRecord | Food} food */
export function isRecipe(food) {
  return food.type === 'recipe';
}

/** @param {unknown} value @param {string} label */
function assertText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

/** @param {unknown} value */
function assertIngredientMultiplier(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)
    || value <= 0 || value > MAX_INGREDIENT_MULTIPLIER) {
    throw new Error('Ingredient quantity must be greater than 0 and at most 100.');
  }
  return value;
}

/**
 * @param {Pick<CreateRecipeFoodInput, 'name'|'refLabel'|'ingredients'>} input
 * @param {FoodRecord[]} records
 */
function validateRecipeInput(input, records) {
  assertText(input.name, 'Name');
  assertText(input.refLabel, 'Reference portion');
  if (!Array.isArray(input.ingredients) || input.ingredients.length === 0) {
    throw new Error('Recipes require at least one ingredient.');
  }
  const recordsById = new Map(records.map(record => [record.id, record]));
  const seen = new Set();
  for (const ingredient of input.ingredients) {
    const referenced = recordsById.get(ingredient.foodId);
    if (!referenced) { throw new Error(`Missing ingredient reference: ${ingredient.foodId}.`); }
    if (isRecipe(referenced)) { throw new Error('Recipes cannot contain recipes.'); }
    if (seen.has(ingredient.foodId)) { throw new Error('Recipe ingredients must be unique.'); }
    assertIngredientMultiplier(ingredient.multiplier);
    seen.add(ingredient.foodId);
  }
}

/**
 * Resolve every recipe from the supplied collection. No additional reads occur.
 * @param {FoodRecord[]} records
 * @returns {Food[]}
 */
export function resolveFoodRecords(records) {
  const recordsById = new Map(records.map(record => [record.id, record]));
  return records.map(record => {
    if (!isRecipe(record)) { return /** @type {BasicFoodRecord} */ ({ ...record }); }

    validateRecipeInput(record, records);
    const macros = zeroMacros();
    const resolvedIngredients = record.ingredients.map(ingredient => {
      const food = /** @type {BasicFoodRecord} */ (recordsById.get(ingredient.foodId));
      const contribution = {
        kcal: food.kcal * ingredient.multiplier,
        prot: food.prot * ingredient.multiplier,
        carbs: food.carbs * ingredient.multiplier,
        fats: food.fats * ingredient.multiplier,
      };
      addMacros(macros, food, ingredient.multiplier);
      return {
        foodId: ingredient.foodId,
        multiplier: ingredient.multiplier,
        food: { ...food },
        macros: contribution,
      };
    });
    return /** @type {ResolvedRecipeFood} */ ({
      ...record,
      ...normalizeMacros(macros),
      resolvedIngredients,
    });
  });
}

/** @param {string} value */
function normalizedName(value) {
  return value.trim().toLocaleLowerCase();
}

/**
 * Match portable ingredients without writing anything.
 * @param {PortableRecipe} bundle
 * @param {FoodRecord[]} records
 */
function matchPortableIngredients(bundle, records) {
  const basics = records.filter(record => !isRecipe(record));
  return bundle.ingredients.map(ingredient => {
    const matches = basics
      .filter(food => normalizedName(food.name) === normalizedName(ingredient.food.name))
      .sort((left, right) =>
        Number(Boolean(left.archived)) - Number(Boolean(right.archived))
        || right.updatedAt - left.updatedAt
      );
    return { ...ingredient, match: matches[0] ? { ...matches[0] } : null };
  });
}

/** @param {PortableRecipe} bundle */
function validatePortableRecipe(bundle) {
  if (!bundle || bundle.version !== 1 || bundle.type !== 'recipe') {
    throw new Error('Invalid recipe share code.');
  }
  assertText(bundle.name, 'Name');
  assertText(bundle.refLabel, 'Reference portion');
  if (!Array.isArray(bundle.ingredients) || bundle.ingredients.length === 0) {
    throw new Error('Recipes require at least one ingredient.');
  }
  const names = new Set();
  for (const ingredient of bundle.ingredients) {
    assertIngredientMultiplier(ingredient.multiplier);
    const name = normalizedName(assertText(ingredient.food?.name, 'Ingredient name'));
    assertText(ingredient.food?.refLabel, 'Ingredient reference portion');
    for (const field of /** @type {const} */ (['kcal', 'prot', 'carbs', 'fats'])) {
      const value = ingredient.food?.[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid portable ingredient ${field}.`);
      }
    }
    if (names.has(name)) { throw new Error('Recipe ingredients must be unique.'); }
    names.add(name);
  }
}

export const Foods = {
  /**
   * @param {{search?: string, status?: 'active'|'archived'|'all',
   *   type?: 'basic'|'recipe'|'all', scores?: Map<string,number>}=} options
   * @returns {Promise<Food[]>}
   */
  async list({ search = '', status = 'active', type = 'all', scores } = {}) {
    let foods = resolveFoodRecords(await db.getAll('foods'));
    foods.sort((left, right) => {
      const leftScore = scores?.get(left.id) ?? 0;
      const rightScore = scores?.get(right.id) ?? 0;
      return rightScore - leftScore || left.name.localeCompare(right.name);
    });
    if (status === 'active') { foods = foods.filter(food => !food.archived); }
    if (status === 'archived') { foods = foods.filter(food => Boolean(food.archived)); }
    if (type === 'basic') { foods = foods.filter(food => !isRecipe(food)); }
    if (type === 'recipe') { foods = foods.filter(isRecipe); }
    if (!search) { return foods; }

    const normalizedSearch = stripAccents(search.trim().toLowerCase());
    const queryWords = normalizedSearch.split(/\s+/).filter(Boolean);
    const withTiers = foods.map(food => {
      const normalizedFoodName = stripAccents(food.name.trim().toLowerCase());
      const haystack = stripAccents(`${food.name} ${food.refLabel}`.toLowerCase());
      const haystackWords = haystack.split(/\W+/).filter(Boolean);
      const baseScore = foodMatchScore(queryWords, haystack, haystackWords);
      return {
        food,
        tier: baseScore > 0 && normalizedFoodName === normalizedSearch ? 3 : baseScore,
      };
    }).filter(result => result.tier > 0);
    withTiers.sort((left, right) => right.tier - left.tier);
    return withTiers.map(result => result.food);
  },

  /** @returns {Promise<FoodRecord[]>} */
  allRecords() {
    return db.getAll('foods');
  },

  /**
   * @param {FoodCreateInput} input
   * @returns {Promise<Food>}
   */
  async create(input) {
    const timestamp = $.now();
    if (input.type === 'recipe') {
      const records = await db.getAll('foods');
      validateRecipeInput(input, records);
      /** @type {Partial<RecipeFoodRecord>} */
      const recipe = {
        type: 'recipe',
        name: input.name.trim(),
        refLabel: input.refLabel.trim(),
        ingredients: input.ingredients.map(ingredient => ({ ...ingredient })),
        archived: false,
        updatedAt: timestamp,
      };
      recipe.id = await db.put('foods', recipe);
      return /** @type {Food} */ (resolveFoodRecords([...records, /** @type {RecipeFoodRecord} */ (recipe)]).at(-1));
    }

    /** @type {Partial<BasicFoodRecord>} */
    const food = {
      type: 'basic',
      name: input.name.trim(),
      refLabel: input.refLabel.trim(),
      kcal: input.kcal,
      prot: input.prot,
      carbs: input.carbs,
      fats: input.fats,
      archived: false,
      updatedAt: timestamp,
    };
    food.id = await db.put('foods', food);
    return /** @type {BasicFoodRecord} */ (food);
  },

  /**
   * @param {string} id
   * @param {Partial<FoodRecord>} patch
   * @returns {Promise<Food|undefined>}
   */
  async update(id, patch) {
    const current = await db.get('foods', id);
    if (!current) { return; }
    const currentType = isRecipe(current) ? 'recipe' : 'basic';
    if (patch.type && patch.type !== currentType) {
      throw new Error('Food type cannot be changed after creation.');
    }

    if (currentType === 'recipe') {
      if ('kcal' in patch || 'prot' in patch || 'carbs' in patch || 'fats' in patch) {
        throw new Error('Recipe macros are computed from ingredients.');
      }
      const records = await db.getAll('foods');
      const recipePatch = /** @type {Partial<RecipeFoodRecord>} */ (patch);
      const currentRecipe = /** @type {RecipeFoodRecord} */ (current);
      const next = /** @type {RecipeFoodRecord} */ ({
        ...currentRecipe,
        ...recipePatch,
        type: 'recipe',
        ingredients: recipePatch.ingredients
          ? recipePatch.ingredients.map(ingredient => ({ ...ingredient }))
          : currentRecipe.ingredients,
        updatedAt: $.now(),
      });
      validateRecipeInput(next, records);
      await db.put('foods', next);
      return resolveFoodRecords(records.map(record => record.id === id ? next : record))
        .find(food => food.id === id);
    }

    if ('ingredients' in patch) { throw new Error('Foods cannot contain ingredients.'); }
    const next = /** @type {BasicFoodRecord} */ ({
      ...current,
      ...patch,
      type: 'basic',
      updatedAt: $.now(),
    });
    await db.put('foods', next);
    return next;
  },

  /** @param {string} id @param {boolean} archived */
  setArchived(id, archived) {
    return this.update(id, { archived: Boolean(archived) });
  },

  /** @param {string} id @returns {Promise<Food|undefined>} */
  async byId(id) {
    const records = await db.getAll('foods');
    return resolveFoodRecords(records).find(food => food.id === id);
  },

  /** @param {string} id @returns {Promise<RecipeFoodRecord[]>} */
  async referencedBy(id) {
    const records = await db.getAll('foods');
    return /** @type {RecipeFoodRecord[]} */ (records.filter(record =>
      isRecipe(record) && record.ingredients.some(ingredient => ingredient.foodId === id)
    ));
  },

  /** @param {string} id */
  async remove(id) {
    const references = await this.referencedBy(id);
    if (references.length > 0) {
      throw new Error(`Cannot delete this food because ${references.length} recipe${references.length === 1 ? '' : 's'} still use it.`);
    }
    await db.del('foods', id);
  },

  /** @param {FoodRecord} food */
  async restore(food) {
    await db.put('foods', food);
  },

  /**
   * Prepare a portable recipe draft using current local matching rules.
   * @param {PortableRecipe} bundle
   */
  async preparePortableRecipe(bundle) {
    validatePortableRecipe(bundle);
    const records = await db.getAll('foods');
    return { ...bundle, ingredients: matchPortableIngredients(bundle, records) };
  },

  /**
   * Save a prepared portable recipe. Only unmatched basic foods are created.
   * @param {PortableRecipe} bundle
   * @returns {Promise<Food>}
   */
  async savePortableRecipe(bundle) {
    validatePortableRecipe(bundle);
    const records = await db.getAll('foods');
    const matches = matchPortableIngredients(bundle, records);
    /** @type {BasicFoodRecord[]} */
    const created = [];
    try {
      const ingredients = [];
      for (const ingredient of matches) {
        let food = ingredient.match;
        if (!food) {
          food = /** @type {BasicFoodRecord} */ (await this.create({
            type: 'basic',
            ...ingredient.food,
          }));
          created.push(food);
        }
        ingredients.push({ foodId: food.id, multiplier: ingredient.multiplier });
      }

      const currentRecords = await db.getAll('foods');
      validateRecipeInput({ name: bundle.name, refLabel: bundle.refLabel, ingredients }, currentRecords);
      const existing = currentRecords
        .filter(record => isRecipe(record) && normalizedName(record.name) === normalizedName(bundle.name))
        .sort((left, right) => right.updatedAt - left.updatedAt)[0];
      const saved = existing
        ? await this.update(existing.id, {
          name: bundle.name,
          refLabel: bundle.refLabel,
          ingredients,
        })
        : await this.create({
          type: 'recipe',
          name: bundle.name,
          refLabel: bundle.refLabel,
          ingredients,
        });
      if (!saved) { throw new Error('Recipe could not be saved.'); }
      return saved;
    } catch (error) {
      for (const food of created.reverse()) {
        await db.del('foods', food.id);
      }
      throw error;
    }
  },
};

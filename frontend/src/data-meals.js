import * as db from './db.js';
import { isRecipe, resolveFoodRecords } from './data-foods.js';
import { resolveMealMacros, resolveSnapshotMacros } from './macro-resolution.js';
import * as $ from './utils.js';

/**
 * @typedef {import('./db.js').Food} Food
 * @typedef {import('./db.js').Meal} Meal
 * @typedef {import('./db.js').MealSnapshot} MealSnapshot
 * @typedef {import('./db.js').BasicMealSnapshot} BasicMealSnapshot
 * @typedef {{
 *   directCount: number,
 *   recipeCount: number,
 *   totalCount: number,
 *   recipeIds: string[]
 * }} MealSyncResult
 */

/**
 * Build a historical snapshot from a currently resolved food.
 * @param {Food} food
 * @returns {MealSnapshot}
 */
export function snapshotFromFood(food) {
  if (!isRecipe(food)) {
    return {
      type: 'basic',
      id: food.id,
      name: food.name,
      refLabel: food.refLabel,
      kcal: food.kcal,
      prot: food.prot,
      carbs: food.carbs,
      fats: food.fats,
      updatedAt: food.updatedAt,
    };
  }
  return {
    type: 'recipe',
    id: food.id,
    name: food.name,
    refLabel: food.refLabel,
    updatedAt: food.updatedAt,
    ingredients: food.resolvedIngredients.map(ingredient => ({
      multiplier: ingredient.multiplier,
      foodSnapshot: /** @type {BasicMealSnapshot} */ (snapshotFromFood(ingredient.food)),
    })),
  };
}

/**
 * Find the current synchronization target set.
 * @param {string} foodId
 * @param {import('./db.js').FoodRecord[]} foodRecords
 * @param {Meal[]} meals
 * @returns {{foodRecord: import('./db.js').FoodRecord|undefined, dependentRecipeIds: string[], directMeals: Meal[], recipeMeals: Meal[]}}
 */
function syncTargets(foodId, foodRecords, meals) {
  const foodRecord = foodRecords.find(candidate => candidate.id === foodId);
  if (!foodRecord) {
    return { foodRecord: undefined, dependentRecipeIds: [], directMeals: [], recipeMeals: [] };
  }

  const dependentRecipeIds = isRecipe(foodRecord)
    ? [foodRecord.id]
    : foodRecords
      .filter(record => isRecipe(record)
        && record.ingredients.some(ingredient => ingredient.foodId === foodId))
      .map(recipe => recipe.id);
  const dependentIds = new Set(dependentRecipeIds);
  const directMeals = isRecipe(foodRecord)
    ? []
    : meals.filter(meal => meal.foodId === foodId);
  const recipeMeals = meals.filter(meal => dependentIds.has(meal.foodId));
  return { foodRecord, dependentRecipeIds, directMeals, recipeMeals };
}

/** @param {ReturnType<typeof syncTargets>} targets @returns {MealSyncResult} */
function syncResult(targets) {
  return {
    directCount: targets.directMeals.length,
    recipeCount: targets.recipeMeals.length,
    totalCount: targets.directMeals.length + targets.recipeMeals.length,
    recipeIds: [...targets.dependentRecipeIds],
  };
}

export const Meals = {
  /** @param {string} dateISO @returns {Promise<Meal[]>} */
  async listByDate(dateISO) {
    const meals = await db.getAll('meals', { from: dateISO, to: dateISO });
    return meals.sort((left, right) => left.id.localeCompare(right.id));
  },

  /** @param {string} fromISO @param {string} toISO @returns {Promise<Meal[]>} */
  async listRange(fromISO, toISO) {
    const meals = await db.getAll('meals', { from: fromISO, to: toISO });
    return meals.sort((left, right) =>
      left.date.localeCompare(right.date) || left.id.localeCompare(right.id)
    );
  },

  /**
   * @param {string} sinceISO
   * @param {string} todayISO
   * @param {string|null} [currentDateISO]
   */
  async frecencyScores(sinceISO, todayISO, currentDateISO = null) {
    const meals = await db.getAll('meals', { from: sinceISO, to: todayISO });
    const MS_PER_DAY = 86400000;
    const CURRENT_DAY_PENALTY = 0.25;
    const todayMs = Date.parse(todayISO);
    /** @type {Map<string, number>} */
    const scores = new Map();
    const seen = new Set();
    const currentDateFoods = new Set();
    for (const meal of meals) {
      if (meal.date === currentDateISO) {
        currentDateFoods.add(meal.foodId);
        continue;
      }
      const key = `${meal.foodId}:${meal.date}`;
      if (seen.has(key)) { continue; }
      seen.add(key);
      const daysDiff = Math.round((todayMs - Date.parse(meal.date)) / MS_PER_DAY);
      scores.set(meal.foodId, (scores.get(meal.foodId) ?? 0) + 1 / (daysDiff + 1));
    }
    if (currentDateISO !== null) {
      for (const foodId of currentDateFoods) {
        scores.set(foodId, (scores.get(foodId) ?? 0) * CURRENT_DAY_PENALTY);
      }
    }
    return scores;
  },

  /**
   * @param {{food: Food, multiplier: number, date: string}} options
   * @returns {Promise<Meal>}
   */
  async create({ food, multiplier, date }) {
    if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 100) {
      throw new Error('Meal quantity must be greater than 0 and at most 100.');
    }
    const timestamp = $.now();
    /** @type {Partial<Meal>} */
    const meal = {
      foodId: food.id,
      foodSnapshot: snapshotFromFood(food),
      multiplier,
      date,
      updatedAt: timestamp,
    };
    meal.id = await db.put('meals', meal);
    return /** @type {Meal} */ (meal);
  },

  /** @param {string} id */
  async remove(id) {
    await db.del('meals', id);
  },

  /** @param {Meal} meal */
  async restore(meal) {
    await db.put('meals', meal);
  },

  /**
   * Update only a meal's quantity and timestamp.
   * @param {string} id
   * @param {number} multiplier
   * @returns {Promise<Meal|undefined>}
   */
  async updateMultiplier(id, multiplier) {
    if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 100) {
      throw new Error('Meal quantity must be greater than 0 and at most 100.');
    }
    const meal = await db.get('meals', id);
    if (!meal) { return; }
    const next = { ...meal, multiplier, updatedAt: Math.max($.now(), meal.updatedAt + 1) };
    await db.put('meals', next);
    return next;
  },

  /**
   * Customize one ingredient quantity in a logged recipe snapshot.
   * @param {string} id
   * @param {number} ingredientIndex
   * @param {number} multiplier
   * @returns {Promise<Meal|undefined>}
   */
  async updateRecipeIngredientMultiplier(id, ingredientIndex, multiplier) {
    if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 100) {
      throw new Error('Ingredient quantity must be greater than 0 and at most 100.');
    }
    const meal = await db.get('meals', id);
    if (!meal) { return; }
    if (meal.foodSnapshot.type !== 'recipe') {
      throw new Error('Only recipe meals have editable ingredients.');
    }
    if (!Number.isInteger(ingredientIndex)
      || ingredientIndex < 0
      || ingredientIndex >= meal.foodSnapshot.ingredients.length) {
      throw new Error('Recipe ingredient does not exist.');
    }
    const ingredients = meal.foodSnapshot.ingredients.map((ingredient, index) =>
      index === ingredientIndex ? { ...ingredient, multiplier } : ingredient
    );
    const next = {
      ...meal,
      foodSnapshot: { ...meal.foodSnapshot, ingredients },
      updatedAt: Math.max($.now(), meal.updatedAt + 1),
    };
    await db.put('meals', next);
    return next;
  },

  /**
   * Remove one ingredient from a logged recipe snapshot.
   * @param {string} id
   * @param {number} ingredientIndex
   * @returns {Promise<Meal|undefined>}
   */
  async removeRecipeIngredient(id, ingredientIndex) {
    const meal = await db.get('meals', id);
    if (!meal) { return; }
    if (meal.foodSnapshot.type !== 'recipe') {
      throw new Error('Only recipe meals have removable ingredients.');
    }
    if (!Number.isInteger(ingredientIndex)
      || ingredientIndex < 0
      || ingredientIndex >= meal.foodSnapshot.ingredients.length) {
      throw new Error('Recipe ingredient does not exist.');
    }
    if (meal.foodSnapshot.ingredients.length === 1) {
      throw new Error('A recipe meal must keep at least one ingredient.');
    }
    const ingredients = meal.foodSnapshot.ingredients.filter((_, index) => index !== ingredientIndex);
    const next = {
      ...meal,
      foodSnapshot: { ...meal.foodSnapshot, ingredients },
      updatedAt: Math.max($.now(), meal.updatedAt + 1),
    };
    await db.put('meals', next);
    return next;
  },

  /** @param {string} foodId */
  async hasForFood(foodId) {
    const meals = await db.getAll('meals');
    return meals.some(meal => meal.foodId === foodId);
  },

  /**
   * Counts direct and currently dependent recipe meals without writing.
   * @param {string} foodId
   * @returns {Promise<MealSyncResult>}
   */
  async syncSummaryForFood(foodId) {
    const [foodRecords, meals] = await Promise.all([
      db.getAll('foods'),
      db.getAll('meals'),
    ]);
    resolveFoodRecords(foodRecords);
    return syncResult(syncTargets(foodId, foodRecords, meals));
  },

  /**
   * Rebuild direct and dependent recipe snapshots from current definitions.
   * Each current recipe is resolved and snapshotted once.
   * @param {string} foodId
   * @returns {Promise<MealSyncResult>}
   */
  async syncAllForFood(foodId) {
    const [foodRecords, meals] = await Promise.all([
      db.getAll('foods'),
      db.getAll('meals'),
    ]);
    const targets = syncTargets(foodId, foodRecords, meals);
    const result = syncResult(targets);
    if (!targets.foodRecord) { return result; }

    const foodsById = new Map(resolveFoodRecords(foodRecords).map(food => [food.id, food]));
    const snapshotsById = new Map();
    if (targets.directMeals.length > 0) {
      const food = foodsById.get(foodId);
      if (!food) { throw new Error(`Missing synchronization food: ${foodId}.`); }
      snapshotsById.set(foodId, snapshotFromFood(food));
    }
    for (const recipeId of targets.dependentRecipeIds) {
      const recipe = foodsById.get(recipeId);
      if (!recipe || !isRecipe(recipe)) {
        throw new Error(`Missing dependent recipe: ${recipeId}.`);
      }
      snapshotsById.set(recipeId, snapshotFromFood(recipe));
    }

    const targetMeals = [...targets.directMeals, ...targets.recipeMeals];
    if (targetMeals.length === 0) { return result; }
    const timestamp = Math.max(
      $.now(),
      ...targetMeals.map(meal => meal.updatedAt + 1),
    );
    for (const meal of targetMeals) {
      const snapshot = snapshotsById.get(meal.foodId);
      if (!snapshot) { throw new Error(`Missing synchronization snapshot: ${meal.foodId}.`); }
      await db.put('meals', { ...meal, foodSnapshot: snapshot, updatedAt: timestamp });
    }
    return result;
  },
};

export { resolveMealMacros, resolveSnapshotMacros };

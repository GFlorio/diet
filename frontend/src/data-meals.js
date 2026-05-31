import * as db from './db.js';
import * as $ from './utils.js';

/**
 * @typedef {import('./db.js').Food} Food
 * @typedef {import('./db.js').Meal} Meal
 * @typedef {import('./db.js').FoodSnapshot} FoodSnapshot
 */

/**
 * Build a FoodSnapshot from a Food record.
 * @param {Food} food
 * @returns {FoodSnapshot}
 */
function snapshotFromFood(food) {
  return {
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

/**
 * Meals store API
 * @type {{
 *   listByDate: (dateISO: string) => Promise<Meal[]>,
 *   listRange: (fromISO: string, toISO: string) => Promise<Meal[]>,
 *   frecencyScores: (sinceISO: string, todayISO: string, currentDateISO?: string|null) => Promise<Map<string, number>>,
 *   create: (opts: {food: Food, multiplier: number, date: string}) => Promise<Meal>,
 *   remove: (id: string) => Promise<void>,
 *   restore: (meal: Meal) => Promise<void>,
 *   syncAllForFood: (foodId: string) => Promise<number>,
 *   hasForFood: (foodId: string) => Promise<boolean>
 * }}
 */
export const Meals = {
  /**
   * Lists meals by date.
   * @param {string} dateISO
   * @returns {Promise<Meal[]>}
   */
  async listByDate(dateISO) {
    const meals = await db.getAll('meals', { from: dateISO, to: dateISO });
    return meals.sort((leftMeal, rightMeal) => leftMeal.id.localeCompare(rightMeal.id));
  },
  /**
   * Lists meals within an inclusive date range.
   * Uses the by_date index for efficient retrieval.
   * @param {string} fromISO
   * @param {string} toISO
   * @returns {Promise<Meal[]>}
   */
  async listRange(fromISO, toISO) {
    const meals = await db.getAll('meals', { from: fromISO, to: toISO });
    return meals.sort((leftMeal, rightMeal) =>
      leftMeal.date.localeCompare(rightMeal.date) || leftMeal.id.localeCompare(rightMeal.id)
    );
  },
  /**
   * Computes frecency scores for foods based on meal history in [sinceISO, todayISO].
   * Score per (food, day) = 1 / (daysDiff + 1); each food is counted once per day.
   * If currentDateISO is given, its meals are excluded from scoring and any food
   * already eaten on that date has its score multiplied by CURRENT_DAY_PENALTY.
   * @param {string} sinceISO
   * @param {string} todayISO
   * @param {string|null} [currentDateISO]
   * @returns {Promise<Map<string, number>>}
   */
  async frecencyScores(sinceISO, todayISO, currentDateISO = null) {
    const meals = await db.getAll('meals', { from: sinceISO, to: todayISO });
    const MS_PER_DAY = 86400000;
    const CURRENT_DAY_PENALTY = 0.25;
    const todayMs = Date.parse(todayISO);
    /** @type {Map<string, number>} */
    const scores = new Map();
    /** @type {Set<string>} */
    const seen = new Set();
    /** @type {Set<string>} */
    const currentDateFoods = new Set();
    for (const meal of meals) {
      if (meal.date === currentDateISO) {
        currentDateFoods.add(meal.foodId);
        continue;
      }
      const key = `${meal.foodId}:${meal.date}`;
      if (seen.has(key)) { continue };
      seen.add(key);
      const daysDiff = Math.round((todayMs - Date.parse(meal.date)) / MS_PER_DAY);
      const score = 1 / (daysDiff + 1);
      scores.set(meal.foodId, (scores.get(meal.foodId) ?? 0) + score);
    }
    if (currentDateISO !== null) {
      for (const foodId of currentDateFoods) {
        scores.set(foodId, (scores.get(foodId) ?? 0) * CURRENT_DAY_PENALTY);
      }
    }
    return scores;
  },
  /**
   * Creates a new meal entry.
   * @param {{food: Food, multiplier: number, date: string}} opts
   * @returns {Promise<Meal>}
   */
  async create({ food, multiplier, date }) {
    const timestamp = $.now();
    /** @type {Partial<Meal>} */
    const meal = {
      foodId: food.id,
      foodSnapshot: snapshotFromFood(food),
      multiplier,
      date,
      updatedAt: timestamp,
    };
    const id = await db.put('meals', meal);
    meal.id = id;
    return /** @type {Meal} */ (meal);
  },
  /**
   * Removes a meal entry by id.
   * @param {string} id
   * @returns {Promise<void>}
   */
  async remove(id) {
    await db.del('meals', id);
  },
  /**
   * Restores a previously deleted meal (re-inserts with original id).
   * @param {Meal} meal
   * @returns {Promise<void>}
   */
  async restore(meal) {
    await db.put('meals', meal);
  },
  /**
   * Returns true if any meal references the given foodId.
   * @param {string} foodId
   * @returns {Promise<boolean>}
   */
  async hasForFood(foodId) {
    const meals = await db.getWhere('meals', (meal) => meal.foodId === foodId);
    return meals.length > 0;
  },
  /**
   * Syncs all meals for a given foodId to the latest Food snapshot.
   * @param {string} foodId
   * @returns {Promise<number>} Number of meals updated
   */
  async syncAllForFood(foodId) {
    const food = await db.get('foods', foodId);
    if (!food) { return 0; }
    const meals = await db.getWhere('meals', (meal) => meal.foodId === foodId);
    let updatedCount = 0;
    for (const meal of meals) {
      const next = /** @type {Meal} */ ({
        ...meal,
        foodSnapshot: snapshotFromFood(food),
        updatedAt: $.now(),
      });
      await db.put('meals', next);
      updatedCount++;
    }
    return updatedCount;
  },
};

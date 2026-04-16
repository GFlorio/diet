import * as $ from './utils.js';
import * as db from './db.js';

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
 *   frecencyScores: (sinceISO: string, todayISO: string) => Promise<Map<string, number>>,
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
    const xs = await db.getAll('meals', 'by_date', dateISO);
    return xs.sort((a, b) => a.id.localeCompare(b.id));
  },
  /**
   * Lists meals within an inclusive date range.
   * Uses the by_date index for efficient retrieval.
   * @param {string} fromISO
   * @param {string} toISO
   * @returns {Promise<Meal[]>}
   */
  async listRange(fromISO, toISO) {
    const xs = await db.getAll('meals', 'by_date', { from: fromISO, to: toISO });
    return xs.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  },
  /**
   * Computes frecency scores for foods based on meal history in [sinceISO, todayISO].
   * Score for each meal = 1 / (daysDiff + 1); scores are summed per food.
   * @param {string} sinceISO
   * @param {string} todayISO
   * @returns {Promise<Map<string, number>>}
   */
  async frecencyScores(sinceISO, todayISO) {
    const meals = await db.getAll('meals', 'by_date', { from: sinceISO, to: todayISO });
    const MS_PER_DAY = 86400000;
    const todayMs = Date.parse(todayISO);
    /** @type {Map<string, number>} */
    const scores = new Map();
    for (const meal of meals) {
      const daysDiff = Math.round((todayMs - Date.parse(meal.date)) / MS_PER_DAY);
      const score = 1 / (daysDiff + 1);
      scores.set(meal.foodId, (scores.get(meal.foodId) ?? 0) + score);
    }
    return scores;
  },
  /**
   * Creates a new meal entry.
   * @param {{food: Food, multiplier: number, date: string}} opts
   * @returns {Promise<Meal>}
   */
  async create({ food, multiplier, date }) {
    const t = $.now();
    /** @type {Partial<Meal>} */
    const meal = {
      foodId: food.id,
      foodSnapshot: snapshotFromFood(food),
      multiplier,
      date,
      updatedAt: t,
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
    const xs = await db.getAll('meals', 'by_foodId', foodId);
    return xs.length > 0;
  },
  /**
   * Syncs all meals for a given foodId to the latest Food snapshot.
   * @param {string} foodId
   * @returns {Promise<number>} Number of meals updated
   */
  async syncAllForFood(foodId) {
    const food = await db.get('foods', foodId);
    if (!food) { return 0; }
    const meals = await db.getWhere('meals', (m) => m.foodId === foodId);
    let n = 0;
    for (const meal of meals) {
      const next = /** @type {Meal} */ ({
        ...meal,
        foodSnapshot: snapshotFromFood(food),
        updatedAt: $.now(),
      });
      await db.put('meals', next);
      n++;
    }
    return n;
  },
};

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
 *   create: (opts: {food: Food, multiplier: number, date: string}) => Promise<Meal>,
 *   update: (id: number, patch: Partial<Meal>) => Promise<Meal|undefined>,
 *   remove: (id: number) => Promise<void>,
 *   syncMealToFood: (meal: Meal) => Promise<Meal>,
 *   syncAllForFood: (foodId: number) => Promise<number>
 * }}
 */
export const Meals = {
  /**
   * Lists meals by date.
   * @param {string} dateISO
   * @returns {Promise<Meal[]>}
   */
  async listByDate(dateISO) {
    const xs = await db.getAll('meals', 'by_date', IDBKeyRange.only(dateISO));
    return xs.sort((a, b) => a.id - b.id);
  },
  /**
   * Lists meals within an inclusive date range.
   * Uses the by_date index for efficient retrieval.
   * @param {string} fromISO
   * @param {string} toISO
   * @returns {Promise<Meal[]>}
   */
  async listRange(fromISO, toISO) {
    const xs = await db.getAll('meals', 'by_date', IDBKeyRange.bound(fromISO, toISO));
    return xs.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
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
    meal.id = Number(id);
    return /** @type {Meal} */ (meal);
  },
  /**
   * Updates a meal entry by id.
   * @param {number} id
   * @param {Partial<Meal>} patch
   * @returns {Promise<Meal|undefined>}
   */
  async update(id, patch) {
    const cur = await db.get('meals', id);
    if (!cur) { return; }
    const next = /** @type {Meal} */ ({ ...cur, ...patch, updatedAt: $.now() });
    await db.put('meals', next);
    return next;
  },
  /**
   * Removes a meal entry by id.
   * @param {number} id
   * @returns {Promise<void>}
   */
  async remove(id) {
    await db.del('meals', id);
  },
  /**
   * Syncs a single meal's foodSnapshot to match the current Food.
   * @param {Meal} meal
   * @returns {Promise<Meal>}
   */
  async syncMealToFood(meal) {
    const food = await db.get('foods', meal.foodId);
    if (!food) { return meal; }
    const next = /** @type {Meal} */ ({
      ...meal,
      foodSnapshot: snapshotFromFood(food),
      updatedAt: $.now(),
    });
    await db.put('meals', next);
    return next;
  },
  /**
   * Syncs all meals for a given foodId to the latest Food snapshot.
   * @param {number} foodId
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

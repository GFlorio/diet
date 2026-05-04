/**
 * Shared helpers for integration tests.
 */
import { Meals } from '../../data-meals.js';
import * as db from '../../db.js';

let _seq = 0;

/** Reset the in-memory database and sequence counter. */
export async function resetTestDB() {
  _seq = 0;
  await db.resetDB();
}

/**
 * Create a food with sensible defaults.
 * Uses an incrementing sequence to avoid ID collisions from Date.now().
 * @param {Partial<import('../../db.js').Food> & {name: string}} overrides
 */
export async function createFood(overrides) {
  // Foods.create calls db.put which uses Date.now() for IDs.
  // In fast tests, multiple calls within the same ms would collide.
  // We insert directly with a unique id instead.
  const id = `food:${Date.now()}-${++_seq}`;
  const food = /** @type {import('../../db.js').Food} */ ({
    id,
    refLabel: '100g',
    kcal: 200,
    prot: 10,
    carbs: 25,
    fats: 8,
    archived: false,
    updatedAt: Date.now(),
    ...overrides,
  });
  await db.put('foods', food);
  return food;
}

/**
 * Create a meal for a given food/date.
 * Meals use Date.now() for IDs too, so we use the real Meals.create
 * but bump the sequence to help with assertion readability.
 * @param {import('../../db.js').Food} food
 * @param {string} date ISO date
 * @param {number} [multiplier=1]
 */
export async function createMeal(food, date, multiplier = 1) {
  _seq++;
  return await Meals.create({ food, multiplier, date });
}

/**
 * Insert a goal record directly.
 * @param {Partial<import('../../db.js').GoalRecord> & {effectiveFrom: string, kcal: number}} fields
 */
export async function insertGoal(fields) {
  const record = {
    maintenanceKcal: fields.kcal + 200,
    calMode: /** @type {const} */ ('deficit'),
    calMagnitude: 200,
    protPct: 30,
    carbsPct: 40,
    fatPct: 30,
    createdAt: Date.now(),
    ...fields,
  };
  await db.put('goals', record);
}

/**
 * Build a kcalByDay map from meals in a date range (mirrors what the heatmap does).
 * @param {string} fromISO
 * @param {string} toISO
 * @returns {Promise<Record<string, number>>}
 */
export async function buildKcalByDay(fromISO, toISO) {
  const meals = await Meals.listRange(fromISO, toISO);
  /** @type {Record<string, number>} */
  const kcalByDay = {};
  for (const m of meals) {
    kcalByDay[m.date] = (kcalByDay[m.date] ?? 0) + m.foodSnapshot.kcal * m.multiplier;
  }
  return kcalByDay;
}

/**
 * Build per-day macro totals from meals (mirrors what the meals page does).
 * @param {string} fromISO
 * @param {string} toISO
 * @returns {Promise<Record<string, import('../../db.js').Macros>>}
 */
export async function buildMacrosByDay(fromISO, toISO) {
  const meals = await Meals.listRange(fromISO, toISO);
  /** @type {Record<string, import('../../db.js').Macros>} */
  const byDay = {};
  for (const m of meals) {
    if (!byDay[m.date]) { byDay[m.date] = { kcal: 0, prot: 0, carbs: 0, fats: 0 }; }
    byDay[m.date].kcal  += m.foodSnapshot.kcal  * m.multiplier;
    byDay[m.date].prot  += m.foodSnapshot.prot  * m.multiplier;
    byDay[m.date].carbs += m.foodSnapshot.carbs * m.multiplier;
    byDay[m.date].fats  += m.foodSnapshot.fats  * m.multiplier;
  }
  return byDay;
}

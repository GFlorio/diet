import PouchDB from 'pouchdb-browser';
import * as $ from './utils.js';

/**
 * Macro nutrient fields.
 * @typedef {{
 *   kcal: number,
 *   prot: number,
 *   carbs: number,
 *   fats: number
 * }} Macros
 */

/**
 * @typedef {Macros & {
 *   id: string,
 *   type?: 'basic',
 *   name: string,
 *   refLabel: string,
 *   archived?: boolean,
 *   updatedAt: number
 * }} BasicFoodRecord
 */

/**
 * @typedef {{
 *   id: string,
 *   type: 'recipe',
 *   name: string,
 *   refLabel: string,
 *   ingredients: Array<{foodId: string, multiplier: number}>,
 *   archived?: boolean,
 *   updatedAt: number
 * }} RecipeFoodRecord
 */

/** @typedef {BasicFoodRecord | RecipeFoodRecord} FoodRecord */

/**
 * A resolved recipe includes current derived macros and current ingredient
 * records. These fields are returned by the data API and are never persisted.
 * @typedef {RecipeFoodRecord & Macros & {
 *   resolvedIngredients: Array<{
 *     foodId: string,
 *     multiplier: number,
 *     food: BasicFoodRecord,
 *     macros: Macros
 *   }>
 * }} ResolvedRecipeFood
 */

/** @typedef {BasicFoodRecord | ResolvedRecipeFood} Food */

/**
 * Snapshot of a basic food taken at meal creation time.
 * @typedef {Macros & {
 *   id: string,
 *   type?: 'basic',
 *   name: string,
 *   refLabel: string,
 *   updatedAt: number
 * }} BasicMealSnapshot
 */

/**
 * @typedef {{
 *   id: string,
 *   type: 'recipe',
 *   name: string,
 *   refLabel: string,
 *   updatedAt: number,
 *   ingredients: Array<{
 *     multiplier: number,
 *     foodSnapshot: BasicMealSnapshot
 *   }>
 * }} RecipeMealSnapshot
 */

/** @typedef {BasicMealSnapshot | RecipeMealSnapshot} MealSnapshot */
/** @typedef {MealSnapshot} FoodSnapshot */

/**
 * A meal entry.
 * @typedef {{
 *   id: string,
 *   foodId: string,
 *   foodSnapshot: MealSnapshot,
 *   multiplier: number,
 *   date: string,
 *   updatedAt: number
 * }} Meal
 */

/**
 * One snapshot in the goal history log.
 * @typedef {{
 *   id:             string,
 *   effectiveFrom:  string,
 *   kcal:           number,
 *   maintenanceKcal: number,
 *   calMode:        'surplus' | 'deficit',
 *   calMagnitude:   number,
 *   protPct:        number,
 *   carbsPct:       number,
 *   fatPct:         number,
 *   createdAt:      number,
 * }} GoalRecord
 */

/**
 * Maps every store name to its record type.
 * @typedef {{ foods: FoodRecord, meals: Meal, goals: GoalRecord }} StoreMap
 */

/**
 * @typedef {{from: string, to: string}} DateRange
 * Inclusive date range for meal queries.
 */

const DB_NAME = 'diet';
/** @type {PouchDB.Database} */
let db = new PouchDB(DB_NAME);
let idSequence = 0;

let _persistRequested = false;

function requestPersistentStorage() {
  if (_persistRequested || !navigator.storage?.persist) { return; }
  _persistRequested = true;
  navigator.storage.persisted().then((already) => {
    if (!already) { return navigator.storage.persist(); }
    return true;
  }).catch((e) => console.warn('Persistent storage request failed', e));
}


/**
 * @param {'foods'|'meals'|'goals'} store
 * @param {Record<string, unknown>} record
 * @returns {string}
 */
function newId(store, record) {
  if (store === 'foods') {return `food:${record.id ?? $.randomUUID()}`;}
  if (store === 'meals') {
    const timestamp = String(Date.now()).padStart(13, '0');
    const sequence = String(idSequence++).padStart(6, '0');
    return `meal:${record.date}:${record.id ?? `${timestamp}:${sequence}`}`;
  }
  if (store === 'goals') { return `goal:${$.randomUUID()}`; }
  throw new Error(`newId: unknown store ${store}`);
}

/** Strip PouchDB internals, leaving id as a copy of _id. */
function strip(/** @type {any} */ doc) {
  const { _id, _rev, ...rest } = doc;
  return { id: _id, ...rest };
}

/**
 * Gets a record by its string id.
 * @template {keyof StoreMap} S
 * @param {S} _storeName
 * @param {string} key  The full string id (e.g. 'food:123', 'meal:2024-01-15:...')
 * @returns {Promise<StoreMap[S]|undefined>}
 */
export const get = async (_storeName, key) => {
  try {
    return strip(await db.get(String(key)));
  } catch (e) {
    if (/** @type {any} */ (e).status === 404) {return undefined;}
    throw e;
  }
};

/**
 * Inserts or updates a record. Returns the record's string id.
 * @template {keyof StoreMap} S
 * @param {S} storeName
 * @param {Partial<StoreMap[S]>} val
 * @returns {Promise<string>}
 */
export const put = async (storeName, val) => {
  requestPersistentStorage();
  const id = /** @type {any} */ (val).id ?? newId(storeName, /** @type {any} */ (val));
  let _rev;
  try {
    const existing = await db.get(id);
    _rev = existing._rev;
  } catch (e) {
    if (/** @type {any} */ (e).status !== 404) {throw e;}
  }
  await db.put({ _id: id, ...(_rev ? { _rev } : {}), ...val, id });
  return id;
};

/**
 * Deletes a record by its string id.
 * @param {keyof StoreMap} _storeName
 * @param {string} key
 * @returns {Promise<void>}
 */
export const del = async (_storeName, key) => {
  const doc = await db.get(String(key));
  await db.remove(doc);
};

/**
 * Gets all records from a store, optionally filtered by date range.
 * For meals, pass a DateRange to restrict by date; omit for all meals.
 * @template {keyof StoreMap} S
 * @param {S} storeName
 * @param {DateRange=} dateRange
 * @returns {Promise<StoreMap[S][]>}
 */
export const getAll = async (storeName, dateRange) => {
  if (storeName === 'foods') {
    const result = await db.allDocs({ startkey: 'food:', endkey: 'food:\uffff', include_docs: true });
    return /** @type {any} */ (result.rows.map((r) => strip(r.doc)));
  }

  if (storeName === 'goals') {
    const result = await db.allDocs({ startkey: 'goal:', endkey: 'goal:\uffff', include_docs: true });
    return /** @type {any} */ (result.rows.map((r) => strip(r.doc)));
  }

  if (storeName === 'meals') {
    if (!dateRange) {
      const result = await db.allDocs({ startkey: 'meal:', endkey: 'meal:\uffff', include_docs: true });
      return /** @type {any} */ (result.rows.map((r) => strip(r.doc)));
    }
    const result = await db.allDocs({
      startkey: `meal:${dateRange.from}:`,
      endkey: `meal:${dateRange.to}:\uffff`,
      include_docs: true,
    });
    return /** @type {any} */ (result.rows.map((r) => strip(r.doc)));
  }

  throw new Error(`getAll: unsupported store ${storeName}`);
};

/**
 * Gets all records matching a predicate.
 * @template {keyof StoreMap} S
 * @param {S} storeName
 * @param {(val: StoreMap[S]) => boolean} pred
 * @returns {Promise<StoreMap[S][]>}
 */
export const getWhere = async (storeName, pred) => {
  const all = await getAll(storeName);
  return all.filter(pred);
};

/** @returns {Promise<void>} */
export const resetDB = async () => {
  await db.destroy();
  db = new PouchDB(DB_NAME);
  idSequence = 0;
};

/**
 * Exports all data from all stores as a plain serialisable object.
 * @returns {Promise<{version: number, exportedAt: string, foods: FoodRecord[], meals: Meal[], goals: GoalRecord[]}>}
 */
export const exportDB = async () => {
  const [foods, meals, goals] = await Promise.all([
    getAll('foods'),
    getAll('meals'),
    getAll('goals'),
  ]);
  return { version: 2, exportedAt: new Date().toISOString(), foods, meals, goals };
};

/**
 * Replaces the entire database with data from an export file.
 * @param {{ version: number, exportedAt?: string, foods: FoodRecord[], meals: Meal[], goals: GoalRecord[] }} data
 * @returns {Promise<void>}
 */
export const importDB = async (data) => {
  if (!data || (data.version !== 1 && data.version !== 2)
    || !Array.isArray(data.foods) || !Array.isArray(data.meals) || !Array.isArray(data.goals)) {
    throw new Error('Invalid backup file format.');
  }

  const foodsById = new Map(data.foods.map(food => [food.id, food]));
  for (const food of data.foods) {
    if (food.type !== 'recipe') { continue; }
    if ('kcal' in food || 'prot' in food || 'carbs' in food || 'fats' in food || !Array.isArray(food.ingredients)) {
      throw new Error(`Invalid recipe record "${food.name}".`);
    }
    const seen = new Set();
    for (const ingredient of food.ingredients) {
      const referenced = foodsById.get(ingredient.foodId);
      if (!referenced || referenced.type === 'recipe' || seen.has(ingredient.foodId)
        || !Number.isFinite(ingredient.multiplier) || ingredient.multiplier <= 0 || ingredient.multiplier > 100) {
        throw new Error(`Invalid ingredient reference in recipe "${food.name}".`);
      }
      seen.add(ingredient.foodId);
    }
    if (seen.size === 0) { throw new Error(`Recipe "${food.name}" has no ingredients.`); }
  }

  for (const meal of data.meals) {
    const snapshot = meal.foodSnapshot;
    if (!snapshot || snapshot.type !== 'recipe') { continue; }
    if ('kcal' in snapshot || 'prot' in snapshot || 'carbs' in snapshot || 'fats' in snapshot
      || !Array.isArray(snapshot.ingredients) || snapshot.ingredients.length === 0) {
      throw new Error(`Invalid recipe meal snapshot for "${snapshot.name ?? meal.id}".`);
    }
    for (const ingredient of snapshot.ingredients) {
      const nestedSnapshot = /** @type {any} */ (ingredient.foodSnapshot);
      if (!nestedSnapshot || nestedSnapshot.type === 'recipe') {
        throw new Error(`Invalid nested recipe meal snapshot for "${snapshot.name ?? meal.id}".`);
      }
    }
  }

  await resetDB();
  for (const food of data.foods) { await put('foods', food); }
  for (const meal of data.meals) { await put('meals', meal); }
  for (const goal of data.goals) { await put('goals', goal); }
};

// Expose a minimal test API on window (safe for this offline PWA).
/** @type {any} */ (window).__testDB = {
  reset: () => resetDB(),
  getAll: (/** @type {keyof StoreMap} */ store) => getAll(store),
  /**
   * Insert synthetic meal records directly, bypassing the UI.
   * @param {Array<{date:string, kcal:number, prot:number, carbs:number, fats:number, multiplier?:number, foodId?:string}>} meals
   */
  insertMeals: async (meals) => {
    for (const meal of meals) {
      const foodId = meal.foodId ?? 'food:0';
      const foodName = meal.foodId ? (await get('foods', foodId))?.name ?? 'Test Food' : 'Test Food';
      await put('meals', {
        foodId,
        foodSnapshot: { id: foodId, name: foodName, refLabel: '100g',
          kcal: meal.kcal, prot: meal.prot, carbs: meal.carbs, fats: meal.fats, updatedAt: 0 },
        multiplier: meal.multiplier ?? 1,
        date: meal.date,
        updatedAt: 0,
      });
    }
  },
  /**
   * Insert raw food records directly, bypassing the UI.
   * @param {Array<Partial<Food>>} foods
   */
  insertFoods: async (foods) => {
    for (const food of foods) {
      await put('foods', food);
    }
  },
  /**
   * Insert raw goal records directly, bypassing the UI.
   * @param {Array<Partial<GoalRecord>>} goals
   */
  insertGoals: async (goals) => {
    for (const goal of goals) {
      await put('goals', goal);
    }
  },
};

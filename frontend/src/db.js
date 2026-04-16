import PouchDB from 'pouchdb-browser';

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
 * Food object stored/returned by the DB.
 * @typedef {Macros & {
 *   id: string,
 *   name: string,
 *   refLabel: string,
 *   archived?: boolean,
 *   updatedAt: number
 * }} Food
 */

/**
 * Snapshot of a food taken at meal creation time.
 * @typedef {Macros & {
 *   id: string,
 *   name: string,
 *   refLabel: string,
 *   updatedAt: number
 * }} FoodSnapshot
 */

/**
 * A meal entry.
 * @typedef {{
 *   id: string,
 *   foodId: string,
 *   foodSnapshot: FoodSnapshot,
 *   multiplier: number,
 *   date: string,
 *   updatedAt: number
 * }} Meal
 */

/**
 * User nutrition goals (singleton record, id always 'goals:1').
 * @typedef {{
 *   id: string,
 *   kcal: number,
 *   maintenanceKcal: number,
 *   calMode: 'surplus' | 'deficit',
 *   calMagnitude: number,
 *   protPct: number,
 *   carbsPct: number,
 *   fatPct: number,
 *   updatedAt: number
 * }} Goals
 */

/**
 * Maps every store name to its record type.
 * @typedef {{ foods: Food, meals: Meal, goals: Goals }} StoreMap
 */

/**
 * @typedef {{from: string, to: string}} DateRange
 * Inclusive date range for meal queries.
 */

const DB_NAME = 'diet';
/** @type {PouchDB.Database} */
let db = new PouchDB(DB_NAME);

let _persistRequested = false;

function requestPersistentStorage() {
  if (_persistRequested || !navigator.storage?.persist) { return; }
  _persistRequested = true;
  navigator.storage.persisted().then((already) => {
    if (!already) { return navigator.storage.persist(); }
  }).catch((e) => console.warn('Persistent storage request failed', e));
}


/**
 * @param {'foods'|'meals'|'goals'} store
 * @param {Record<string, unknown>} record
 * @returns {string}
 */
function newId(store, record) {
  if (store === 'foods') {return `food:${record.id ?? Date.now()}`;}
  if (store === 'meals') {return `meal:${record.date}:${String(record.id ?? Date.now()).padStart(13, '0')}`;}
  if (store === 'goals') {return 'goals:1';}
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
 * @param {S} storeName
 * @param {string} key  The full string id (e.g. 'food:123', 'meal:2024-01-15:...')
 * @returns {Promise<StoreMap[S]|undefined>}
 */
export const get = async (storeName, key) => {
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
 * @param {keyof StoreMap} storeName
 * @param {string} key
 * @returns {Promise<void>}
 */
export const del = async (storeName, key) => {
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
    try {
      return /** @type {any} */ ([strip(await db.get('goals:1'))]);
    } catch (e) {
      if (/** @type {any} */ (e).status === 404) {return [];}
      throw e;
    }
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
};

// Expose a minimal test API on window (safe for this offline PWA).
/** @type {any} */ (window).__testDB = {
  reset: () => resetDB(),
  getAll: (/** @type {keyof StoreMap} */ store) => getAll(store),
  /**
   * Insert synthetic meal records directly, bypassing the UI.
   * @param {Array<{date:string, kcal:number, prot:number, carbs:number, fats:number, multiplier?:number}>} meals
   */
  insertMeals: async (meals) => {
    for (const m of meals) {
      await put('meals', {
        foodId: 'food:0',
        foodSnapshot: { id: 'food:0', name: 'Test Food', refLabel: '100g',
          kcal: m.kcal, prot: m.prot, carbs: m.carbs, fats: m.fats, updatedAt: 0 },
        multiplier: m.multiplier ?? 1,
        date: m.date,
        updatedAt: 0,
      });
    }
  },
  /**
   * Insert raw food records directly, bypassing the UI.
   * @param {Array<Partial<Food>>} foods
   */
  insertFoods: async (foods) => {
    for (const f of foods) {
      await put('foods', f);
    }
  },
};

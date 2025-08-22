import { now } from './utils.js';

/**
 * @type {IDBDatabase | undefined}
 */
let db;
/** @type {string} */
const DB_NAME = 'nutri-pwa';
/** @type {number} */
const DB_VER = 1;

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
 *   id: number,
 *   name: string,
 *   refLabel: string,
 *   archived?: boolean,
 *   updatedAt: number
 * }} Food
 */

/**
 * Snapshot of a food taken at meal creation time.
 * @typedef {Macros & {
 *   id: number,
 *   name: string,
 *   refLabel: string,
 *   updatedAt: number
 * }} FoodSnapshot
 */

/**
 * A meal entry.
 * @typedef {{
 *   id: number,
 *   foodId: number,
 *   foodSnapshot: FoodSnapshot,
 *   multiplier: number,
 *   date: string,
 *   updatedAt: number
 * }} Meal
 */

/**
 * Opens the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
export const openDB = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, DB_VER);
  req.onupgradeneeded = (e) => {
   /** @type {IDBOpenDBRequest} */
   // @ts-ignore - during upgrade, target is present and is an IDBOpenDBRequest
   const targ = e.target;
   const db = targ && 'result' in targ ? /** @type {IDBOpenDBRequest} */(targ).result : req.result;
    if (!db.objectStoreNames.contains('foods')){
      const s = db.createObjectStore('foods', { keyPath:'id', autoIncrement:true });
      s.createIndex('by_name', 'name', { unique:false });
      s.createIndex('by_archived', 'archived', { unique:false });
      s.createIndex('by_updatedAt', 'updatedAt', { unique:false });
    }
    if (!db.objectStoreNames.contains('meals')){
      const s = db.createObjectStore('meals', { keyPath:'id', autoIncrement:true });
      s.createIndex('by_date', 'date', { unique:false });
      s.createIndex('by_foodId', 'foodId', { unique:false });
      s.createIndex('by_updatedAt', 'updatedAt', { unique:false });
    }
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/**
 * Ensures the database is open and returns the instance.
 * @returns {Promise<IDBDatabase>}
 */
const ensureDB = async () => { if (!db) db = await openDB(); return db; };

/**
 * Wraps a transaction for one or more stores.
 * @param {string[]} stores
 * @param {'readonly'|'readwrite'} mode
 * @param {(tx: IDBTransaction, store: IDBObjectStore|null) => void} fn
 * @returns {Promise<void>}
 */
/**
 * Internal: Wraps a transaction for one or more stores.
 * @template T
 * @param {string[]} stores
 * @param {'readonly'|'readwrite'} mode
 * @param {(tx: IDBTransaction, store: IDBObjectStore|null) => void} fn
 * @returns {Promise<void>}
 */
const txWrap = async (
  stores,
  mode,
  fn
) => new Promise(async (resolve, reject) => {
  const dbi = await ensureDB();
  const tx = dbi.transaction(stores, mode);
  const store = stores.length===1 ? tx.objectStore(stores[0]) : null;
  fn(tx, store);
  tx.oncomplete = () => resolve(undefined);
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

/**
 * Gets all records from a store or index, optionally filtered by query.
 * @param {string} storeName
 * @param {string=} index
 * @param {*} [query]
 * @returns {Promise<any[]>}
 */
/**
 * Internal: Gets all records from a store or index, optionally filtered by query.
 * @template T
 * @param {string} storeName
 * @param {string=} index
 * @param {*} [query]
 * @returns {Promise<T[]>}
 */
const getAll = async (
  storeName,
  index,
  query
) => new Promise(async (resolve, reject) => {
  const dbi = await ensureDB();
  const tx = dbi.transaction([storeName], 'readonly');
  const store = tx.objectStore(storeName);
  const src = index ? store.index(index) : store;
  const req = query ? src.getAll(query) : src.getAll();
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/**
 * Gets all records from a store matching a predicate.
 * @param {string} storeName
 * @param {(val: any) => boolean} pred
 * @returns {Promise<any[]>}
 */
/**
 * Internal: Gets all records from a store matching a predicate.
 * @template T
 * @param {string} storeName
 * @param {(val: T) => boolean} pred
 * @returns {Promise<T[]>}
 */
const getWhere = async (
  storeName,
  pred
) => new Promise(async (resolve, reject) => {
  const dbi = await ensureDB();
  const tx = dbi.transaction([storeName], 'readonly');
  const store = tx.objectStore(storeName);
  const req = store.openCursor();
  /** @type {any[]} */
    const out = [];
  req.onsuccess = () => {
    const cur = req.result; if (!cur){ resolve(out); return; }
    if (pred(cur.value)) out.push(cur.value);
    cur.continue();
  };
  req.onerror = () => reject(req.error);
});

/**
 * Puts a value into a store.
 * @param {string} storeName
 * @param {*} val
 * @returns {Promise<IDBValidKey>} The key/id of the stored value
 */
/**
 * Internal: Puts a value into a store.
 * @param {string} storeName
 * @param {*} val
 * @returns {Promise<IDBValidKey>} The key/id of the stored value
 */
const put = async (
  storeName,
  val
) => new Promise(async (resolve, reject) => {
  const dbi = await ensureDB();
  const tx = dbi.transaction([storeName], 'readwrite');
  const store = tx.objectStore(storeName);
  const req = store.put(val);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/**
 * Deletes a record from a store by key.
 * @param {string} storeName
 * @param {number|string} key
 * @returns {Promise<void>}
 */
/**
 * Internal: Deletes a record from a store by key.
 * @param {string} storeName
 * @param {number|string} key
 * @returns {Promise<void>}
 */
const del = (
  storeName,
  key
) => txWrap([storeName], 'readwrite', (tx, s)=>{ if (s) s.delete(key); });

/**
 * Gets a record from a store by key.
 * @param {string} storeName
 * @param {number|string} key
 * @returns {Promise<any>}
 */
/**
 * Internal: Gets a record from a store by key.
 * @template T
 * @param {string} storeName
 * @param {number|string} key
 * @returns {Promise<T|undefined>}
 */
const get = async (
  storeName,
  key
) => new Promise(async (resolve, reject) => {
  const dbi = await ensureDB();
  const tx = dbi.transaction([storeName], 'readonly');
  const s = tx.objectStore(storeName);
  const req = s.get(key);
  req.onsuccess = () => resolve((req.result ?? undefined));
  req.onerror = () => reject(req.error);
});

/**
 * Input accepted by Foods.create (only prot/carbs/fats fields)
 * @typedef {{ name: string, refLabel: string, kcal: number, prot: number, carbs: number, fats: number }} CreateFoodInput
 */

/**
 * Patch accepted by Foods.update (only prot/carbs/fats fields)
 * @typedef {Partial<Food>} UpdateFoodPatch
 */

/**
 * Foods store API
 * @type {{
 *   list: (opts?: {search?: string, status?: 'active'|'archived'}) => Promise<Food[]>,
 *   create: (food: CreateFoodInput) => Promise<Food>,
 *   update: (id: number, patch: UpdateFoodPatch) => Promise<Food|undefined>,
 *   setArchived: (id: number, archived: boolean) => Promise<Food|undefined>,
 *   byId: (id: number) => Promise<Food|undefined>
 * }}
 */
export const Foods = {
  /**
   * Lists foods, optionally filtered by search and status.
   * @param {{search?: string, status?: 'active'|'archived'}=} opts
   * @returns {Promise<Food[]>}
   */
  async list({ search='', status='active' }={}){
  const all = /** @type {Food[]} */ (await getAll('foods'));
    let xs = all.sort((a,b)=> a.name.localeCompare(b.name));
    if (status==='active') xs = xs.filter(f=>!f.archived);
    if (status==='archived') xs = xs.filter(f=>!!f.archived);
    if (search){
      const q = search.trim().toLowerCase();
      xs = xs.filter(f => (f.name+ ' ' + f.refLabel).toLowerCase().includes(q));
    }
    return xs;
  },
  /**
   * Creates a new food entry.
   * @param {CreateFoodInput} foodIn
   * @returns {Promise<Food>}
   */
  async create(foodIn){
    const { name, refLabel, kcal, prot, carbs, fats } = /** @type {CreateFoodInput} */ (foodIn);
    const t = now();
    /** @type {Partial<Food>} */
    const food = {
      name: name.trim(),
      refLabel: refLabel.trim(),
      kcal: +kcal,
      prot: +prot,
      carbs: +carbs,
      fats: +fats,
      archived: false,
      updatedAt: t,
    };
    const id = await put('foods', food);
    food.id = Number(id);
    return /** @type {Food} */ (food);
  },
  /**
   * Updates a food entry by id.
   * @param {number} id
   * @param {UpdateFoodPatch} patch
   * @returns {Promise<Food|undefined>}
   */
  async update(id, patch){
  const cur = /** @type {Food|undefined} */ (await get('foods', id)); if (!cur) return;
  const next = /** @type {Food} */ ({ ...cur, ...patch, updatedAt: now() });
    await put('foods', next); return next;
  },
  /**
   * Sets archived status for a food entry.
   * @param {number} id
   * @param {boolean} archived
   * @returns {Promise<Food|undefined>}
   */
  async setArchived(id, archived){ return this.update(id, { archived: !!archived }); },
  /**
   * Gets a food entry by id.
   * @param {number} id
   * @returns {Promise<Food|undefined>}
   */
  async byId(id){ const f = await get('foods', id); return /** @type {Food|undefined} */ (f || undefined); },
};

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
  async listByDate(dateISO){
  try {
    const xs = /** @type {Meal[]} */ (await getAll('meals', 'by_date', IDBKeyRange.only(dateISO)));
    return xs.sort((a,b)=>a.id-b.id);
  } catch {
    const all = /** @type {Meal[]} */ (await getAll('meals'));
    return all.filter(m=>m.date===dateISO).sort((a,b)=>a.id-b.id);
  }
  },
  /**
   * Lists meals within an inclusive date range.
   * Uses the by_date index for efficient retrieval.
   * @param {string} fromISO
   * @param {string} toISO
   * @returns {Promise<Meal[]>}
   */
  async listRange(fromISO, toISO){
    // Prefer index query when available
    try {
      const xs = /** @type {Meal[]} */ (await getAll('meals', 'by_date', IDBKeyRange.bound(fromISO, toISO)));
      return xs.sort((a,b)=> a.date.localeCompare(b.date) || a.id-b.id);
    } catch {
      // Fallback: full scan (older browsers or unexpected failures)
      const all = /** @type {Meal[]} */ (await getAll('meals'));
      return all.filter(m=>m.date>=fromISO && m.date<=toISO).sort((a,b)=> a.date.localeCompare(b.date) || a.id-b.id);
    }
  },
  /**
   * Creates a new meal entry.
   * @param {{food: Food, multiplier: number, date: string}} opts
   * @returns {Promise<Meal>}
   */
  async create({ food, multiplier, date }){
    const t = now();
    /** @type {Partial<Meal>} */
    const meal = {
      foodId: food.id,
      foodSnapshot: { id: food.id, name: food.name, refLabel: food.refLabel, kcal: food.kcal, prot: food.prot, carbs: food.carbs, fats: food.fats, updatedAt: food.updatedAt },
      multiplier: +multiplier || 1,
      date,
      updatedAt: t,
    };
    const id = await put('meals', meal);
    meal.id = Number(id);
    return /** @type {Meal} */ (meal);
  },
  /**
   * Updates a meal entry by id.
   * @param {number} id
   * @param {Partial<Meal>} patch
   * @returns {Promise<Meal|undefined>}
   */
  async update(id, patch){
  const cur = /** @type {Meal|undefined} */ (await get('meals', id)); if (!cur) return;
  const next = /** @type {Meal} */ ({ ...cur, ...patch, updatedAt: now() });
  await put('meals', next); return next;
  },
  /**
   * Removes a meal entry by id.
   * @param {number} id
   * @returns {Promise<void>}
   */
  async remove(id){ await del('meals', id); },
  /**
   * Syncs a meal's foodSnapshot to the latest food data.
   * @param {Meal} meal
   * @returns {Promise<Meal>}
   */
  async syncMealToFood(meal){
    const food = await Foods.byId(meal.foodId); if (!food) return meal;
  if ((meal.foodSnapshot?.updatedAt||0) >= food.updatedAt) return meal;
  const updated = await this.update(meal.id, { foodSnapshot: { id: food.id, name: food.name, refLabel: food.refLabel, kcal: food.kcal, prot: food.prot, carbs: food.carbs, fats: food.fats, updatedAt: food.updatedAt } });
  return updated || meal;
  },
  /**
   * Syncs all meals for a foodId to the latest food data.
   * @param {number} foodId
   * @returns {Promise<number>} Number of meals updated
   */
  async syncAllForFood(foodId){
  const all = /** @type {Meal[]} */ (await getWhere('meals', m=>m.foodId===foodId));
    const food = await Foods.byId(foodId); if (!food) return 0;
    let count = 0;
    for (const m of all){
      if ((m.foodSnapshot?.updatedAt||0) < food.updatedAt){ await this.syncMealToFood(m); count++; }
    }
    return count;
  }
};

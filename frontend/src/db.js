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
 * Maps every store name to its record type.
 * @typedef {{ foods: Food, meals: Meal }} StoreMap
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
    const db = targ && 'result' in targ ? /** @type {IDBOpenDBRequest} */ targ.result : req.result;
    if (!db.objectStoreNames.contains('foods')) {
      const s = db.createObjectStore('foods', { keyPath: 'id', autoIncrement: true });
      s.createIndex('by_name', 'name', { unique: false });
      s.createIndex('by_archived', 'archived', { unique: false });
      s.createIndex('by_updatedAt', 'updatedAt', { unique: false });
    }
    if (!db.objectStoreNames.contains('meals')) {
      const s = db.createObjectStore('meals', { keyPath: 'id', autoIncrement: true });
      s.createIndex('by_date', 'date', { unique: false });
      s.createIndex('by_foodId', 'foodId', { unique: false });
      s.createIndex('by_updatedAt', 'updatedAt', { unique: false });
    }
  };
  req.onsuccess = function () {
    resolve(req.result);
  };
  req.onerror = function () {
    reject(req.error);
  };
});

/**
 * Ensures the database is open and returns the instance.
 * @returns {Promise<IDBDatabase>}
 */
export const ensureDB = async () => {
  if (!db) {db = await openDB();}
  return db;
};

/**
 * Internal: Wraps a transaction for one or more stores.
 * @template T
 * @param {string[]} stores
 * @param {'readonly'|'readwrite'} mode
 * @param {(tx: IDBTransaction, store: IDBObjectStore|null) => void} fn
 * @returns {Promise<void>}
 */
export const txWrap = async (stores, mode, fn) => {
  const dbi = await ensureDB();
  return new Promise((resolve, reject) => {
    const tx = dbi.transaction(stores, mode);
    const store = stores.length === 1 ? tx.objectStore(stores[0]) : null;
    fn(tx, store);
    tx.oncomplete = function () {
      resolve(undefined);
    };
    tx.onerror = function () {
      reject(tx.error);
    };
    tx.onabort = function () {
      reject(tx.error);
    };
  });
};

/**
 * Internal: Gets all records from a store or index, optionally filtered by query.
 * @template {keyof StoreMap} S
 * @param {S} storeName
 * @param {string=} index
 * @param {*} [query]
 * @returns {Promise<StoreMap[S][]>}
 */
export const getAll = async (storeName, index, query) => {
  const dbi = await ensureDB();
  return new Promise((resolve, reject) => {
    const tx = dbi.transaction([storeName], 'readonly');
    const store = tx.objectStore(storeName);
    const src = index ? store.index(index) : store;
    const req = query ? src.getAll(query) : src.getAll();
    req.onsuccess = function () {
      resolve(req.result);
    };
    req.onerror = function () {
      reject(req.error);
    };
  });
};

/**
 * Internal: Gets all records from a store matching a predicate.
 * @template {keyof StoreMap} S
 * @param {S} storeName
 * @param {(val: StoreMap[S]) => boolean} pred
 * @returns {Promise<StoreMap[S][]>}
 */
export const getWhere = async (storeName, pred) => {
  const dbi = await ensureDB();
  return new Promise((resolve, reject) => {
    const tx = dbi.transaction([storeName], 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.openCursor();
    /** @type {any[]} */
    const out = [];
    req.onsuccess = function () {
      const cur = req.result;
      if (!cur) {
        resolve(out);
        return;
      }
      if (pred(cur.value)) { out.push(cur.value); }
      cur.continue();
    };
    req.onerror = function () {
      reject(req.error);
    };
  });
};

/**
 * Internal: Puts a value into a store.
 * @template {keyof StoreMap} S
 * @param {S} storeName
 * @param {Partial<StoreMap[S]>} val
 * @returns {Promise<IDBValidKey>} The key/id of the stored value
 */
export const put = async (storeName, val) => {
  const dbi = await ensureDB();
  return new Promise((resolve, reject) => {
    const tx = dbi.transaction([storeName], 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(val);
    req.onsuccess = function () {
      resolve(req.result);
    };
    req.onerror = function () {
      reject(req.error);
    };
  });
};

/**
 * Internal: Deletes a record from a store by key.
 * @param {keyof StoreMap} storeName
 * @param {number|string} key
 * @returns {Promise<void>}
 */
export const del = (storeName, key) => txWrap([storeName], 'readwrite', (tx, s) => {
  if (s) { s.delete(key); }
});

/**
 * Internal: Gets a record from a store by key.
 * @template {keyof StoreMap} S
 * @param {S} storeName
 * @param {number|string} key
 * @returns {Promise<StoreMap[S]|undefined>}
 */
export const get = async (storeName, key) => {
  const dbi = await ensureDB();
  return new Promise((resolve, reject) => {
    const tx = dbi.transaction([storeName], 'readonly');
    const s = tx.objectStore(storeName);
    const req = s.get(key);
    req.onsuccess = function () {
      resolve(req.result ?? undefined);
    };
    req.onerror = function () {
      reject(req.error);
    };
  });
};


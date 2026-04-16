import * as $ from './utils.js';
import * as db from './db.js';

/**
 * @typedef {import('./db.js').Food} Food
 * @typedef {import('./db.js').Macros} Macros
 */

/**
 * Input accepted by Foods.create (only prot/carbs/fats fields)
 * @typedef {{ name: string, refLabel: string,
 *   kcal: number, prot: number, carbs: number, fats: number }} CreateFoodInput
 */

/**
 * Patch accepted by Foods.update (only prot/carbs/fats fields)
 * @typedef {Partial<Food>} UpdateFoodPatch
 */

/**
 * Foods store API
 * @type {{
 *   list: (opts?: {search?: string, status?: 'active'|'archived'|'all', scores?: Map<string,number>}) => Promise<Food[]>,
 *   create: (food: CreateFoodInput) => Promise<Food>,
 *   update: (id: string, patch: UpdateFoodPatch) => Promise<Food|undefined>,
 *   setArchived: (id: string, archived: boolean) => Promise<Food|undefined>,
 *   byId: (id: string) => Promise<Food|undefined>,
 *   remove: (id: string) => Promise<void>,
 *   restore: (food: Food) => Promise<void>
 * }}
 */
export const Foods = {
  /**
   * Lists foods, optionally filtered by search and status.
   * When `scores` is provided (a frecency map of foodId → score), foods are
   * sorted by score descending; ties and unscored foods fall back to alphabetical.
   * @param {{search?: string, status?: 'active'|'archived'|'all', scores?: Map<string,number>}=} opts
   * @returns {Promise<Food[]>}
   */
  async list({ search = '', status = 'active', scores } = {}) {
    const all = await db.getAll('foods');
    let xs = all.sort((a, b) => {
      const sa = scores?.get(a.id) ?? 0;
      const sb = scores?.get(b.id) ?? 0;
      return sb - sa || a.name.localeCompare(b.name);
    });
    if (status === 'active') { xs = xs.filter((f) => !f.archived); }
    if (status === 'archived') { xs = xs.filter((f) => !!f.archived); }
    if (search) {
      const q = search.trim().toLowerCase();
      xs = xs.filter((f) => (f.name + ' ' + f.refLabel).toLowerCase().includes(q));
    }
    return xs;
  },
  /**
   * Creates a new food entry.
   * @param {CreateFoodInput} foodIn
   * @returns {Promise<Food>}
   */
  async create(foodIn) {
    const { name, refLabel, kcal, prot, carbs, fats } = /** @type {CreateFoodInput} */ (foodIn);
    const t = $.now();
    /** @type {Partial<Food>} */
    const food = {
      name: name.trim(),
      refLabel: refLabel.trim(),
      kcal,
      prot,
      carbs,
      fats,
      archived: false,
      updatedAt: t,
    };
    const id = await db.put('foods', food);
    food.id = id;
    return /** @type {Food} */ (food);
  },
  /**
   * Updates a food entry by id.
   * @param {string} id
   * @param {UpdateFoodPatch} patch
   * @returns {Promise<Food|undefined>}
   */
  async update(id, patch) {
    const cur = await db.get('foods', id);
    if (!cur) { return; }
    const next = /** @type {Food} */ ({ ...cur, ...patch, updatedAt: $.now() });
    await db.put('foods', next);
    return next;
  },
  /**
   * Sets archived status for a food entry.
   * @param {string} id
   * @param {boolean} archived
   * @returns {Promise<Food|undefined>}
   */
  async setArchived(id, archived) {
    return this.update(id, { archived: !!archived });
  },
  /**
   * Gets a food entry by id.
   * @param {string} id
   * @returns {Promise<Food|undefined>}
   */
  async byId(id) {
    return db.get('foods', id);
  },
  /**
   * Permanently deletes a food entry by id.
   * @param {string} id
   * @returns {Promise<void>}
   */
  async remove(id) {
    await db.del('foods', id);
  },
  /**
   * Restores a previously deleted food (re-inserts with original id).
   * @param {Food} food
   * @returns {Promise<void>}
   */
  async restore(food) {
    await db.put('foods', food);
  },
};

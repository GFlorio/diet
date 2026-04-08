import { now } from './utils.js';
import { getAll, get, put } from './db.js';

/**
 * @typedef {import('./db.js').Food} Food
 * @typedef {import('./db.js').Macros} Macros
 */

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
  async list({ search = '', status = 'active' } = {}) {
    const all = /** @type {Food[]} */ (await getAll('foods'));
    let xs = all.sort((a, b) => a.name.localeCompare(b.name));
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
    const { name, refLabel, kcal, prot, carbs, fats } = /** @type {CreateFoodInput} */ foodIn;
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
    return /** @type {Food} */ food;
  },
  /**
   * Updates a food entry by id.
   * @param {number} id
   * @param {UpdateFoodPatch} patch
   * @returns {Promise<Food|undefined>}
   */
  async update(id, patch) {
    const cur = /** @type {Food|undefined} */ (await get('foods', id));
  if (!cur) { return; }
    const next = /** @type {Food} */ ({ ...cur, ...patch, updatedAt: now() });
    await put('foods', next);
    return next;
  },
  /**
   * Sets archived status for a food entry.
   * @param {number} id
   * @param {boolean} archived
   * @returns {Promise<Food|undefined>}
   */
  async setArchived(id, archived) {
    return this.update(id, { archived: !!archived });
  },
  /**
   * Gets a food entry by id.
   * @param {number} id
   * @returns {Promise<Food|undefined>}
   */
  async byId(id) {
    const f = await get('foods', id);
    return /** @type {Food|undefined} */ (f || undefined);
  },
};

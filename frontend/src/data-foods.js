import * as db from './db.js';
import * as $ from './utils.js';

/**
 * Minimum Jaccard trigram similarity for a fuzzy word match.
 * Raise to reduce false positives; lower to catch more typos.
 */
const FUZZY_THRESHOLD = 0.4;

/**
 * Returns the set of all 3-char n-grams in a (pre-lowercased) string,
 * padded with a leading and trailing space for better boundary matching.
 * @param {string} str
 * @returns {Set<string>}
 */
function trigrams(str) {
  const padded = ` ${str} `;
  const grams = new Set();
  for (let i = 0; i < padded.length - 2; i++) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/**
 * Jaccard similarity between two trigram sets (0–1).
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number}
 */
function trigramSimilarity(a, b) {
  if (a.size === 0 || b.size === 0) { return 0; }
  let shared = 0;
  for (const gram of a) { if (b.has(gram)) { shared++; } }
  return shared / (a.size + b.size - shared);
}

/**
 * Scores how well a food haystack matches the given query words.
 * - 2: all query words appear as direct substrings (word-order tolerant)
 * - 1: all query words fuzzy-match at least one haystack word via trigrams
 * - 0: no match
 * @param {string[]} queryWords  - lowercased tokens from the search query
 * @param {string}   haystack    - lowercased `name + ' ' + refLabel`
 * @param {string[]} haystackWords - lowercased word tokens from haystack
 * @returns {0|1|2}
 */
function foodMatchScore(queryWords, haystack, haystackWords) {
  if (queryWords.every(word => haystack.includes(word))) { return 2; }
  const haystackGrams = haystackWords.map(trigrams);
  const allFuzzy = queryWords.every(queryWord => {
    if (haystack.includes(queryWord)) { return true; }
    const queryGrams = trigrams(queryWord);
    return haystackGrams.some(haystackGramSet => trigramSimilarity(queryGrams, haystackGramSet) >= FUZZY_THRESHOLD);
  });
  return allFuzzy ? 1 : 0;
}

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
    let foods = all.sort((leftFood, rightFood) => {
      const leftScore = scores?.get(leftFood.id) ?? 0;
      const rightScore = scores?.get(rightFood.id) ?? 0;
      return rightScore - leftScore || leftFood.name.localeCompare(rightFood.name);
    });
    if (status === 'active') { foods = foods.filter((food) => !food.archived); }
    if (status === 'archived') { foods = foods.filter((food) => !!food.archived); }
    if (search) {
      const normalizedSearch = search.trim().toLowerCase();
      const queryWords = normalizedSearch.split(/\s+/).filter(Boolean);
      const withTiers = foods.map(food => {
        const haystack = `${food.name} ${food.refLabel}`.toLowerCase();
        const haystackWords = haystack.split(/\W+/).filter(Boolean);
        return { food, tier: foodMatchScore(queryWords, haystack, haystackWords) };
      }).filter(({ tier }) => tier > 0);
      // Stable sort: tier-2 (direct) before tier-1 (fuzzy); frecency order preserved within each tier.
      withTiers.sort((a, b) => b.tier - a.tier);
      foods = withTiers.map(({ food }) => food);
    }
    return foods;
  },
  /**
   * Creates a new food entry.
   * @param {CreateFoodInput} foodIn
   * @returns {Promise<Food>}
   */
  async create(foodIn) {
    const { name, refLabel, kcal, prot, carbs, fats } = /** @type {CreateFoodInput} */ (foodIn);
    const timestamp = $.now();
    /** @type {Partial<Food>} */
    const food = {
      name: name.trim(),
      refLabel: refLabel.trim(),
      kcal,
      prot,
      carbs,
      fats,
      archived: false,
      updatedAt: timestamp,
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
    const currentFood = await db.get('foods', id);
    if (!currentFood) { return; }
    const nextFood = /** @type {Food} */ ({ ...currentFood, ...patch, updatedAt: $.now() });
    await db.put('foods', nextFood);
    return nextFood;
  },
  /**
   * Sets archived status for a food entry.
   * @param {string} id
   * @param {boolean} archived
   * @returns {Promise<Food|undefined>}
   */
  setArchived(id, archived) {
    return this.update(id, { archived: !!archived });
  },
  /**
   * Gets a food entry by id.
   * @param {string} id
   * @returns {Promise<Food|undefined>}
   */
  byId(id) {
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

/**
 * No-op: kept for call-site compatibility. window.__testDB is exposed by
 * db.js once the app has loaded via page.goto().
 */
export async function loadPouchDB(_page) {}

/**
 * Returns today's date as YYYY-MM-DD in the *local* timezone.
 * Use this instead of new Date().toISOString().slice(0,10), which returns UTC
 * and can be one day ahead/behind in UTC± timezones.
 * @returns {string}
 */
export function localIsoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Destroy and recreate the diet DB. Must be called after page.goto() so the
 * app bundle has run and window.__testDB is available.
 * @param {import('@playwright/test').Page} page
 */
export async function resetDB(page) {
  await page.evaluate(() => window.__testDB.reset());
}

/**
 * Read all records from a logical store. Requires the app to be loaded.
 * @param {import('@playwright/test').Page} page
 * @param {'foods'|'meals'|'goals'} store
 */
export function getAllFromStore(page, store) {
  return page.evaluate((s) => window.__testDB.getAll(s), store);
}

/**
 * Insert synthetic meal records, bypassing the UI. Requires the app to be loaded.
 * @param {import('@playwright/test').Page} page
 * @param {Array<{date:string, kcal:number, prot:number, carbs:number, fats:number, multiplier?:number}>} meals
 */
export async function insertMeals(page, meals) {
  await page.evaluate((m) => window.__testDB.insertMeals(m), meals);
}

/**
 * Insert raw food records, bypassing the UI. Requires the app to be loaded.
 * @param {import('@playwright/test').Page} page
 * @param {Array<Partial<import('../src/db.js').Food>>} foods
 */
export async function insertFoods(page, foods) {
  await page.evaluate((f) => window.__testDB.insertFoods(f), foods);
}

/**
 * Insert raw goal records, bypassing the UI. Requires the app to be loaded.
 * @param {import('@playwright/test').Page} page
 * @param {Array<Partial<import('../src/db.js').GoalRecord>>} goals
 */
export async function insertGoals(page, goals) {
  await page.evaluate((g) => window.__testDB.insertGoals(g), goals);
}

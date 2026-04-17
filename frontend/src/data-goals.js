import { Meals } from './data-meals.js';
import * as db from './db.js';
import * as $ from './utils.js';

/**
 * @typedef {import('./db.js').Goals} Goals
 *
 * @typedef {{
 *   windowDays: number,
 *   dataWarning: boolean,
 *   calories: MacroWindow,
 *   protein:  MacroWindow,
 *   carbs:    MacroWindow,
 *   fat:      MacroWindow,
 * }} WindowVM
 *
 * @typedef {{
 *   avgConsumed: number,
 *   target:      number | null,
 *   status:      'none'|'ok'|'warn'|'bad',
 *   pctOff:      number | null,
 *   idealToday:  number,
 * }} MacroWindow
 */

const GOALS_KEY = 'goals:1';

/**
 * @returns {Promise<Goals|null>}
 */
export async function get() {
  const result = await db.get('goals', GOALS_KEY);
  return result ?? null;
}

/**
 * Upsert the singleton goals record.
 * @param {{ maintenanceKcal: number, calMode: 'surplus'|'deficit', calMagnitude: number, protPct: number, carbsPct: number, fatPct: number }} fields
 */
export async function save(fields) {
  const sign = fields.calMode === 'surplus' ? 1 : -1;
  const kcal = fields.maintenanceKcal + sign * fields.calMagnitude;
  await db.put('goals', { id: GOALS_KEY, ...fields, kcal, updatedAt: $.now() });
}

/** Delete the singleton goals record. */
export async function remove() {
  await db.del('goals', GOALS_KEY);
}

/**
 * Compute status for a consumed value against a target.
 * @param {number} consumed
 * @param {number | null} target
 * @returns {'none'|'ok'|'warn'|'bad'}
 */
export function computeStatus(consumed, target) {
  if (target === null) { return 'none'; }
  if (target === 0) { return consumed === 0 ? 'ok' : 'bad'; }
  const pct = Math.abs(consumed - target) / target;
  if (pct <= 0.05) { return 'ok'; }
  if (pct <= 0.10) { return 'warn'; }
  return 'bad';
}

/**
 * Derive gram targets from goal percentages.
 * @param {Goals} goals
 * @returns {{ protG: number, carbsG: number, fatG: number }}
 */
export function derivedGrams(goals) {
  return {
    protG:  Math.round((goals.kcal * goals.protPct  / 100) / 4),
    carbsG: Math.round((goals.kcal * goals.carbsPct / 100) / 4),
    fatG:   Math.round((goals.kcal * goals.fatPct   / 100) / 9),
  };
}

/**
 * Compute the 7-day sliding window view model.
 * Returns null if goals are not set or no meals exist in the window.
 * @param {string} todayISO
 * @param {Goals | null} goals
 * @returns {Promise<WindowVM | null>}
 */
export async function computeWindowVM(todayISO, goals) {
  if (!goals) { return null; }

  const d = new Date(`${todayISO}T00:00:00`);
  d.setDate(d.getDate() - 6);
  const fromISO = $.toISO(d);

  const meals = await Meals.listRange(fromISO, todayISO);

  /** @type {Record<string, import('./db.js').Macros>} */
  const byDay = {};
  for (const m of meals) {
    if (!byDay[m.date]) { byDay[m.date] = { kcal: 0, prot: 0, carbs: 0, fats: 0 }; }
    byDay[m.date].kcal  += m.foodSnapshot.kcal  * m.multiplier;
    byDay[m.date].prot  += m.foodSnapshot.prot  * m.multiplier;
    byDay[m.date].carbs += m.foodSnapshot.carbs * m.multiplier;
    byDay[m.date].fats  += m.foodSnapshot.fats  * m.multiplier;
  }

  const dayKeys = Object.keys(byDay);
  const windowDays = dayKeys.length;
  if (windowDays === 0) { return null; }

  // Separate today's intake from the previous 6 days.
  // prevSum uses 0 for any prior day with no meals logged.
  const todayMacros = byDay[todayISO] ?? { kcal: 0, prot: 0, carbs: 0, fats: 0 };
  const prevSum = dayKeys
    .filter(k => k !== todayISO)
    .reduce(
      (a, k) => ({
        kcal:  a.kcal  + byDay[k].kcal,
        prot:  a.prot  + byDay[k].prot,
        carbs: a.carbs + byDay[k].carbs,
        fats:  a.fats  + byDay[k].fats,
      }),
      { kcal: 0, prot: 0, carbs: 0, fats: 0 },
    );

  // Average uses only logged days as the denominator (days with no meals are excluded).
  const totalSum = {
    kcal:  prevSum.kcal  + todayMacros.kcal,
    prot:  prevSum.prot  + todayMacros.prot,
    carbs: prevSum.carbs + todayMacros.carbs,
    fats:  prevSum.fats  + todayMacros.fats,
  };
  const avg = {
    kcal:  totalSum.kcal  / windowDays,
    prot:  totalSum.prot  / windowDays,
    carbs: totalSum.carbs / windowDays,
    fats:  totalSum.fats  / windowDays,
  };

  const g = derivedGrams(goals);

  /** @param {number} consumed @param {number} target @returns {number | null} */
  const pctOff = (consumed, target) =>
    target > 0 ? Math.abs(consumed - target) / target : null;

  // How much to eat today to bring the logged-days average back to target,
  // clamped to ±15% of the daily target so the suggestion stays reasonable.
  // If today has no meals yet, eating today adds a new day, so the effective
  // denominator is windowDays + 1 rather than windowDays.
  const CLAMP = 0.15;
  const todayLogged = todayISO in byDay;
  const effectiveDays = todayLogged ? windowDays : windowDays + 1;
  /** @param {number} prevSumVal @param {number} target @returns {number} */
  const idealToday = (prevSumVal, target) => {
    const ideal = effectiveDays * target - prevSumVal;
    return Math.max(target * (1 - CLAMP), Math.min(target * (1 + CLAMP), ideal));
  };

  return {
    windowDays,
    dataWarning: windowDays < 4,
    calories: { avgConsumed: avg.kcal,  target: goals.kcal, status: computeStatus(avg.kcal,  goals.kcal), pctOff: pctOff(avg.kcal,  goals.kcal), idealToday: idealToday(prevSum.kcal,  goals.kcal)  },
    protein:  { avgConsumed: avg.prot,  target: g.protG,    status: computeStatus(avg.prot,  g.protG),    pctOff: pctOff(avg.prot,  g.protG),    idealToday: idealToday(prevSum.prot,  g.protG)    },
    carbs:    { avgConsumed: avg.carbs, target: g.carbsG,   status: computeStatus(avg.carbs, g.carbsG),   pctOff: pctOff(avg.carbs, g.carbsG),   idealToday: idealToday(prevSum.carbs, g.carbsG)   },
    fat:      { avgConsumed: avg.fats,  target: g.fatG,     status: computeStatus(avg.fats,  g.fatG),     pctOff: pctOff(avg.fats,  g.fatG),     idealToday: idealToday(prevSum.fats,  g.fatG)     },
  };
}

import { Meals } from './data-meals.js';
import * as db from './db.js';
import * as $ from './utils.js';

/** % deviation at which status transitions from ok → warn. */
export const STATUS_OK_PCT   = 0.05;
/** % deviation at which status transitions from warn → bad. */
export const STATUS_WARN_PCT = 0.10;

/** Kcal per gram of protein (and carbohydrate). */
export const KCAL_PER_G_PROTEIN = 4;
/** Kcal per gram of carbohydrate. */
export const KCAL_PER_G_CARBS   = 4;
/** Kcal per gram of fat. */
export const KCAL_PER_G_FAT     = 9;

/** Number of days in the sliding average window. */
export const WINDOW_DAYS = 7;
/** Minimum logged days before the data-warning flag is cleared. */
const WINDOW_MIN_DAYS = 4;

/**
 * @typedef {import('./db.js').GoalRecord} GoalRecord
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

/**
 * Returns all goal records sorted by effectiveFrom descending (newest first).
 * @returns {Promise<GoalRecord[]>}
 */
export async function list() {
  const all = /** @type {GoalRecord[]} */ (await db.getAll('goals'));
  return all.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
}

/**
 * Returns the goal record active on the given date, or null if none.
 * @param {string} [dateISO]
 * @returns {Promise<GoalRecord|null>}
 */
export async function getActive(dateISO = $.isoToday()) {
  const all = await list();
  return all.find(r => r.effectiveFrom <= dateISO) ?? null;
}

/**
 * Saves a new goal version effective from today. If a record already exists for today,
 * it is overwritten in place (preserving its id and createdAt).
 * @param {{ maintenanceKcal: number, calMode: 'surplus'|'deficit', calMagnitude: number, protPct: number, carbsPct: number, fatPct: number }} fields
 * @returns {Promise<GoalRecord>}
 */
export async function save(fields) {
  const today   = $.isoToday();
  const all     = /** @type {GoalRecord[]} */ (await db.getAll('goals'));
  const existing = all.find(r => r.effectiveFrom === today);
  const sign    = fields.calMode === 'surplus' ? 1 : -1;
  const kcal    = fields.maintenanceKcal + sign * fields.calMagnitude;
  /** @type {GoalRecord} */
  const record  = {
    id:            existing?.id ?? `goal:${$.randomUUID()}`,
    effectiveFrom: today,
    kcal,
    createdAt:     existing?.createdAt ?? Date.now(),
    ...fields,
  };
  await db.put('goals', record);
  return record;
}

/** Delete the currently active goal record. */
export async function remove() {
  const active = await getActive();
  if (active) {
    await db.del('goals', active.id);
  }
}

/**
 * Updates the effectiveFrom date of a goal record.
 * Throws if another record already has the same effectiveFrom date.
 * @param {string} id
 * @param {string} newDateISO
 * @returns {Promise<void>}
 */
export async function updateEffectiveFrom(id, newDateISO) {
  const all   = /** @type {GoalRecord[]} */ (await db.getAll('goals'));
  const clash = all.find(r => r.id !== id && r.effectiveFrom === newDateISO);
  if (clash) { throw new Error('Another goal already starts on this date'); }
  const record = all.find(r => r.id === id);
  if (!record) { throw new Error('Goal record not found'); }
  await db.put('goals', { ...record, effectiveFrom: newDateISO });
}

/**
 * Deletes a goal record by id.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteRecord(id) {
  await db.del('goals', id);
}

/**
 * Returns the goal active for the given date from a pre-fetched sorted list.
 * Records must be sorted by effectiveFrom descending (newest first).
 * @param {GoalRecord[]} records
 * @param {string} dateISO
 * @returns {GoalRecord|null}
 */
export function goalForDate(records, dateISO) {
  return records.find(r => r.effectiveFrom <= dateISO) ?? null;
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
  if (pct <= STATUS_OK_PCT)   { return 'ok'; }
  if (pct <= STATUS_WARN_PCT) { return 'warn'; }
  return 'bad';
}

/**
 * Derive gram targets from goal percentages.
 * @param {GoalRecord} goals
 * @returns {{ protG: number, carbsG: number, fatG: number }}
 */
export function derivedGrams(goals) {
  return {
    protG:  Math.round((goals.kcal * goals.protPct  / 100) / KCAL_PER_G_PROTEIN),
    carbsG: Math.round((goals.kcal * goals.carbsPct / 100) / KCAL_PER_G_CARBS),
    fatG:   Math.round((goals.kcal * goals.fatPct   / 100) / KCAL_PER_G_FAT),
  };
}

/**
 * Compute the 7-day sliding window view model.
 * Returns null if goals are not set or no meals exist in the window.
 * @param {string} todayISO
 * @param {GoalRecord | null} goals
 * @returns {Promise<WindowVM | null>}
 */
export async function computeWindowVM(todayISO, goals) {
  if (!goals) { return null; }

  const d = $.localDate(todayISO);
  d.setDate(d.getDate() - (WINDOW_DAYS - 1));
  const fromISO = $.toISO(d);

  const meals = await Meals.listRange(fromISO, todayISO);

  /** @type {Record<string, import('./db.js').Macros>} */
  const byDay = {};
  for (const m of meals) {
    if (!byDay[m.date]) { byDay[m.date] = $.zeroMacros(); }
    $.addScaledMacros(byDay[m.date], m.foodSnapshot, m.multiplier);
  }

  const dayKeys = Object.keys(byDay);
  const windowDays = dayKeys.length;
  if (windowDays === 0) { return null; }

  // Separate today's intake from the previous days.
  // prevSum uses 0 for any prior day with no meals logged.
  const todayMacros = byDay[todayISO] ?? $.zeroMacros();
  const prevSum = $.zeroMacros();
  for (const k of dayKeys) {
    if (k !== todayISO) { $.addScaledMacros(prevSum, byDay[k], 1); }
  }

  // Average uses only logged days as the denominator (days with no meals are excluded).
  const totalSum = $.zeroMacros();
  $.addScaledMacros(totalSum, prevSum, 1);
  $.addScaledMacros(totalSum, todayMacros, 1);
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
  const IDEAL_CLAMP = 0.15;
  const todayLogged = todayISO in byDay;
  const effectiveDays = todayLogged ? windowDays : windowDays + 1;
  /** @param {number} prevSumVal @param {number} target @returns {number} */
  const idealToday = (prevSumVal, target) => {
    const ideal = effectiveDays * target - prevSumVal;
    return Math.max(target * (1 - IDEAL_CLAMP), Math.min(target * (1 + IDEAL_CLAMP), ideal));
  };

  return {
    windowDays,
    dataWarning: windowDays < WINDOW_MIN_DAYS,
    calories: { avgConsumed: avg.kcal,  target: goals.kcal, status: computeStatus(avg.kcal,  goals.kcal), pctOff: pctOff(avg.kcal,  goals.kcal), idealToday: idealToday(prevSum.kcal,  goals.kcal)  },
    protein:  { avgConsumed: avg.prot,  target: g.protG,    status: computeStatus(avg.prot,  g.protG),    pctOff: pctOff(avg.prot,  g.protG),    idealToday: idealToday(prevSum.prot,  g.protG)    },
    carbs:    { avgConsumed: avg.carbs, target: g.carbsG,   status: computeStatus(avg.carbs, g.carbsG),   pctOff: pctOff(avg.carbs, g.carbsG),   idealToday: idealToday(prevSum.carbs, g.carbsG)   },
    fat:      { avgConsumed: avg.fats,  target: g.fatG,     status: computeStatus(avg.fats,  g.fatG),     pctOff: pctOff(avg.fats,  g.fatG),     idealToday: idealToday(prevSum.fats,  g.fatG)     },
  };
}

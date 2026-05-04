import { Meals } from './data-meals.js';
import * as db from './db.js';
import * as $ from './utils.js';

/** % deviation at which the 7-day average transitions from ok → warn. */
export const STATUS_OK_PCT   = 0.05;
/** % deviation at which the 7-day average transitions from warn → bad. */
export const STATUS_WARN_PCT = 0.10;
/** ±% of idealToday used as the ok band when data is sparse, and as the
 *  safety-net override that caps status at 'warn' during recovery. */
export const SAFETY_NET_PCT  = 0.10;

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
 *   windowDays:    number,
 *   effectiveDays: number,
 *   calories: MacroWindow,
 *   protein:  MacroWindow,
 *   carbs:    MacroWindow,
 *   fat:      MacroWindow,
 * }} WindowVM
 *
 * @typedef {{
 *   target:     number | null,
 *   status:     'none'|'low'|'ok'|'warn'|'bad',
 *   idealToday: number,
 *   prevSum:    number,
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
 * Compute day status using the rolling-average approach with a safety net.
 *
 * When enough data exists (≥ WINDOW_MIN_DAYS), the status is determined by
 * where the rolling average (prevSum + consumed) / effectiveDays sits relative
 * to the raw goal.  If the result would be 'bad' but the user ate within
 * ±SAFETY_NET_PCT of idealToday, it is capped at 'warn' (the "did your best
 * given the clamp" override).
 *
 * When data is sparse (< WINDOW_MIN_DAYS), the rolling average is unreliable,
 * so status is based on consumed vs idealToday with ±SAFETY_NET_PCT bands.
 *
 * @param {number} consumed
 * @param {number} prevSum     — total consumed on other logged days in the window
 * @param {number} effectiveDays — logged days (including today or +1 if today is empty)
 * @param {number | null} goal — raw daily target
 * @param {number} idealToday  — adjusted daily target (clamped)
 * @returns {'none'|'low'|'ok'|'warn'|'bad'}
 */
export function computeDayStatus(consumed, prevSum, effectiveDays, goal, idealToday) {
  if (goal === null) { return 'none'; }
  if (goal === 0) { return consumed === 0 ? 'ok' : 'bad'; }

  // Sparse data: fall back to idealToday with wider (±10%) bands.
  if (effectiveDays < WINDOW_MIN_DAYS) {
    if (idealToday <= 0) { return consumed === 0 ? 'ok' : 'bad'; }
    const ratio = consumed / idealToday;
    if (ratio < 1 - SAFETY_NET_PCT)                            { return 'low'; }
    if (ratio <= 1 + SAFETY_NET_PCT)                            { return 'ok'; }
    if (ratio <= 1 + SAFETY_NET_PCT + (STATUS_WARN_PCT - STATUS_OK_PCT)) { return 'warn'; }
    return 'bad';
  }

  // Primary: rolling-average position relative to the raw goal.
  const avg   = (prevSum + consumed) / effectiveDays;
  const ratio = avg / goal;
  /** @type {'low'|'ok'|'warn'|'bad'} */
  let status;
  if (ratio < 1 - STATUS_OK_PCT)    { status = 'low'; }
  else if (ratio <= 1 + STATUS_OK_PCT)   { status = 'ok'; }
  else if (ratio <= 1 + STATUS_WARN_PCT) { status = 'warn'; }
  else                                    { status = 'bad'; }

  // Safety net: following idealToday during recovery should never be 'bad'.
  if (status === 'bad' && idealToday > 0) {
    const idealRatio = consumed / idealToday;
    if (idealRatio >= 1 - SAFETY_NET_PCT && idealRatio <= 1 + SAFETY_NET_PCT) {
      status = 'warn';
    }
  }

  return status;
}

/** Clamp factor for idealToday: ±15% of the daily target. */
const IDEAL_CLAMP = 0.15;

/**
 * Compute the adjusted daily target for a given day, based on the 7-day
 * sliding window of consumption. If prior days were under/over, the target
 * shifts to compensate, clamped to ±15% of the raw target.
 *
 * @param {Record<string, number>} kcalByDay — map of ISO date → total kcal
 * @param {string} dateISO — the day to compute the target for
 * @param {number} goalKcal — the raw daily kcal target
 * @returns {number}
 */
export function idealForDay(kcalByDay, dateISO, goalKcal) {
  if (goalKcal <= 0) { return goalKcal; }
  const d = $.localDate(dateISO);
  let prevSum    = 0;
  let loggedDays = 0;
  for (let i = 1; i < WINDOW_DAYS; i++) {
    const prev = new Date(d);
    prev.setDate(d.getDate() - i);
    const prevISO = $.toISO(prev);
    if (prevISO in kcalByDay) {
      prevSum += kcalByDay[prevISO];
      loggedDays++;
    }
  }
  const todayLogged = dateISO in kcalByDay;
  if (todayLogged) { loggedDays++; }
  if (loggedDays === 0) { return goalKcal; }
  const effectiveDays = todayLogged ? loggedDays : loggedDays + 1;
  const ideal = effectiveDays * goalKcal - prevSum;
  return Math.max(goalKcal * (1 - IDEAL_CLAMP), Math.min(goalKcal * (1 + IDEAL_CLAMP), ideal));
}

/**
 * Compute day status for a single day in the kcalByDay map.
 * Convenience wrapper around idealForDay + computeDayStatus for the heatmap.
 * @param {Record<string, number>} kcalByDay
 * @param {string} dateISO
 * @param {number} goalKcal
 * @returns {'none'|'low'|'ok'|'warn'|'bad'}
 */
export function statusForDay(kcalByDay, dateISO, goalKcal) {
  const consumed = kcalByDay[dateISO] ?? 0;
  if (goalKcal <= 0) { return computeDayStatus(consumed, 0, 1, goalKcal, goalKcal); }
  const d = $.localDate(dateISO);
  let prevSum    = 0;
  let loggedDays = 0;
  for (let i = 1; i < WINDOW_DAYS; i++) {
    const prev = new Date(d);
    prev.setDate(d.getDate() - i);
    const prevISO = $.toISO(prev);
    if (prevISO in kcalByDay) {
      prevSum += kcalByDay[prevISO];
      loggedDays++;
    }
  }
  const todayLogged = dateISO in kcalByDay;
  if (todayLogged) { loggedDays++; }
  if (loggedDays === 0) { return computeDayStatus(consumed, 0, 1, goalKcal, goalKcal); }
  const effectiveDays = todayLogged ? loggedDays : loggedDays + 1;
  const ideal = effectiveDays * goalKcal - prevSum;
  const idealToday = Math.max(goalKcal * (1 - IDEAL_CLAMP), Math.min(goalKcal * (1 + IDEAL_CLAMP), ideal));
  return computeDayStatus(consumed, prevSum, effectiveDays, goalKcal, idealToday);
}

/**
 * Compute bar segment widths for rendering a multi-segment progress bar.
 * Returned percentages always sum to ≤ 100 so the bar never overflows.
 * When consumed > target the segments are scaled down proportionally,
 * preserving the visual ratio between base/warn/bad bands.
 *
 * The `status` parameter caps which bands can appear so the bar never
 * shows a severity that contradicts the computed status:
 *   - 'ok'/'low'/'none' → base only (no warn/bad bands)
 *   - 'warn'            → base + warn (bad is folded into warn)
 *   - 'bad'             → base + warn + bad (uncapped)
 *
 * @param {number} consumed
 * @param {number} target
 * @param {'none'|'low'|'ok'|'warn'|'bad'} status
 * @returns {{ basePct: number, warnPct: number, badPct: number }}
 */
export function barSegments(consumed, target, status) {
  if (target <= 0) { return { basePct: 0, warnPct: 0, badPct: 0 }; }
  if (consumed <= target) {
    return { basePct: consumed / target * 100, warnPct: 0, badPct: 0 };
  }

  // Status caps which segments are visible.
  const allowWarn = status === 'warn' || status === 'bad';
  const allowBad  = status === 'bad';

  if (!allowWarn) {
    // Everything is base — consumed exceeds target but status says ok/low.
    return { basePct: 100, warnPct: 0, badPct: 0 };
  }

  // Raw segments relative to target (basePct is always target-sized)
  const warnLimit = target * (1 + STATUS_WARN_PCT);
  const rawWarn   = Math.min(consumed, warnLimit) - target;
  const rawBad    = consumed > warnLimit ? consumed - warnLimit : 0;

  // Fold bad into warn when status is only 'warn'.
  const effectiveWarn = allowBad ? rawWarn : rawWarn + rawBad;
  const effectiveBad  = allowBad ? rawBad  : 0;

  const rawTotal = target + effectiveWarn + effectiveBad; // = consumed
  const scale    = 100 / rawTotal;
  return {
    basePct: target        * scale,
    warnPct: effectiveWarn * scale,
    badPct:  effectiveBad  * scale,
  };
}

/** @typedef {{ status: 'none'|'low'|'ok'|'warn'|'bad', bar: { basePct: number, warnPct: number, badPct: number } }} MacroVisuals */

/**
 * Single source of truth for how a macro value should be colored and how
 * its progress bar should look.  Computes status via the rolling-average /
 * sparse-data logic and derives bar segments that are guaranteed to stay
 * consistent with the status (bar never shows a severity beyond status).
 *
 * @param {number} consumed
 * @param {MacroWindow | null | undefined} macroWin - from computeWindowVM; null/undefined = fallback
 * @param {number} effectiveDays - from WindowVM; ignored when macroWin is null
 * @param {number | null} [fallbackGoal] - raw daily target when macroWin is unavailable
 * @returns {MacroVisuals}
 */
export function macroVisuals(consumed, macroWin, effectiveDays, fallbackGoal = null) {
  /** @type {'none'|'low'|'ok'|'warn'|'bad'} */
  let status;
  let barTarget;

  if (macroWin) {
    status    = computeDayStatus(consumed, macroWin.prevSum, effectiveDays, macroWin.target, macroWin.idealToday);
    barTarget = macroWin.idealToday;
  } else if (fallbackGoal !== null) {
    status    = computeDayStatus(consumed, 0, 1, fallbackGoal, fallbackGoal);
    barTarget = fallbackGoal;
  } else {
    return { status: 'none', bar: { basePct: 0, warnPct: 0, badPct: 0 } };
  }

  return { status, bar: barSegments(consumed, barTarget, status) };
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

  const g = derivedGrams(goals);

  // How much to eat today to bring the logged-days average back to target,
  // clamped to ±15% of the daily target so the suggestion stays reasonable.
  // If today has no meals yet, eating today adds a new day, so the effective
  // denominator is windowDays + 1 rather than windowDays.
  const todayLogged = todayISO in byDay;
  const effectiveDays = todayLogged ? windowDays : windowDays + 1;
  /** @param {number} prevSumVal @param {number} target @returns {number} */
  const idealToday = (prevSumVal, target) => {
    const ideal = effectiveDays * target - prevSumVal;
    return Math.max(target * (1 - IDEAL_CLAMP), Math.min(target * (1 + IDEAL_CLAMP), ideal));
  };

  const calIdeal  = idealToday(prevSum.kcal,  goals.kcal);
  const protIdeal = idealToday(prevSum.prot,  g.protG);
  const carbIdeal = idealToday(prevSum.carbs, g.carbsG);
  const fatIdeal  = idealToday(prevSum.fats,  g.fatG);

  /** @param {number} consumed @param {number} pSum @param {number | null} goal @param {number} ideal */
  const status = (consumed, pSum, goal, ideal) =>
    computeDayStatus(consumed, pSum, effectiveDays, goal, ideal);

  return {
    windowDays,
    effectiveDays,
    calories: { target: goals.kcal, status: status(todayMacros.kcal,  prevSum.kcal,  goals.kcal, calIdeal),  idealToday: calIdeal,  prevSum: prevSum.kcal  },
    protein:  { target: g.protG,    status: status(todayMacros.prot,  prevSum.prot,  g.protG,    protIdeal), idealToday: protIdeal, prevSum: prevSum.prot  },
    carbs:    { target: g.carbsG,   status: status(todayMacros.carbs, prevSum.carbs, g.carbsG,   carbIdeal), idealToday: carbIdeal, prevSum: prevSum.carbs },
    fat:      { target: g.fatG,     status: status(todayMacros.fats,  prevSum.fats,  g.fatG,     fatIdeal),  idealToday: fatIdeal,  prevSum: prevSum.fats  },
  };
}

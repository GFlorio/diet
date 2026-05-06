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

/** Clamp factor for idealToday: ±15% of the daily target. */
const IDEAL_CLAMP = 0.15;

/**
 * Compute day status.
 *
 * Three modes depending on window state:
 *
 * - Sparse (< WINDOW_MIN_DAYS): symmetric ±SAFETY_NET_PCT bands around idealToday.
 *   No reliable history yet, so direction is unknown.
 *
 * - Clamped below (overeating — rawIdeal < goal×0.85): idealToday is a ceiling.
 *   ok band is [ideal×0.9, ideal]; anything above ideal is immediately 'bad'.
 *
 * - Clamped above (undereating — rawIdeal > goal×1.15): idealToday is a floor.
 *   Below ideal is 'low'; ok band is [ideal, ideal×1.1]; then 'warn', then 'bad'.
 *
 * - Dense, unclamped: rolling-average (prevSum + consumed) / effectiveDays vs raw goal.
 *
 * @param {number} consumed
 * @param {number} prevSum       — total consumed on other logged days in the window
 * @param {number} effectiveDays — logged days (including today or +1 if today is empty)
 * @param {number | null} goal   — raw daily target
 * @param {number} idealToday    — adjusted daily target (clamped to ±IDEAL_CLAMP of goal)
 * @returns {'none'|'low'|'ok'|'warn'|'bad'}
 */
export function computeDayStatus(consumed, prevSum, effectiveDays, goal, idealToday) {
  if (goal === null) { return 'none'; }
  if (goal === 0) { return consumed === 0 ? 'ok' : 'bad'; }

  // Sparse: symmetric bands — no directional history yet.
  if (effectiveDays < WINDOW_MIN_DAYS) {
    if (idealToday <= 0) { return consumed === 0 ? 'ok' : 'bad'; }
    const ratio = consumed / idealToday;
    if (ratio < 1 - SAFETY_NET_PCT)                                      { return 'low'; }
    if (ratio <= 1 + SAFETY_NET_PCT)                                      { return 'ok'; }
    if (ratio <= 1 + SAFETY_NET_PCT + (STATUS_WARN_PCT - STATUS_OK_PCT)) { return 'warn'; }
    return 'bad';
  }

  const rawIdeal = effectiveDays * goal - prevSum;

  if (rawIdeal < goal * (1 - IDEAL_CLAMP)) {
    // Clamped below: idealToday is a ceiling — green only extends downward.
    // Ok window is 2×SAFETY_NET_PCT wide, sitting below idealToday.
    if (idealToday <= 0) { return consumed === 0 ? 'ok' : 'bad'; }
    const ratio = consumed / idealToday;
    if (ratio < 1 - 2 * SAFETY_NET_PCT) { return 'low'; }
    if (ratio <= 1)                      { return 'ok'; }
    return 'bad';
  }

  if (rawIdeal > goal * (1 + IDEAL_CLAMP)) {
    // Clamped above: idealToday is a floor — green only extends upward.
    // Ok window is 2×SAFETY_NET_PCT wide, starting at idealToday.
    if (idealToday <= 0) { return consumed === 0 ? 'ok' : 'bad'; }
    const ratio = consumed / idealToday;
    if (ratio < 1)                                                           { return 'low'; }
    if (ratio <= 1 + 2 * SAFETY_NET_PCT)                                     { return 'ok'; }
    if (ratio <= 1 + 2 * SAFETY_NET_PCT + (STATUS_WARN_PCT - STATUS_OK_PCT)) { return 'warn'; }
    return 'bad';
  }

  // Dense, unclamped: rolling-average position relative to the raw goal.
  const avg   = (prevSum + consumed) / effectiveDays;
  const ratio = avg / goal;
  if (ratio < 1 - STATUS_OK_PCT)    { return 'low'; }
  if (ratio <= 1 + STATUS_OK_PCT)   { return 'ok'; }
  if (ratio <= 1 + STATUS_WARN_PCT) { return 'warn'; }
  return 'bad';
}

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
 * `skipWarnZone` removes the warn band entirely: 'bad' status jumps straight
 * from base to bad with no yellow segment. Used for clamped-below days where
 * any amount above idealToday is immediately bad.
 *
 * @param {number} consumed
 * @param {number} target
 * @param {'none'|'low'|'ok'|'warn'|'bad'} status
 * @param {boolean} [skipWarnZone]
 * @returns {{ basePct: number, warnPct: number, badPct: number }}
 */
export function barSegments(consumed, target, status, skipWarnZone = false) {
  if (target <= 0) { return { basePct: 0, warnPct: 0, badPct: 0 }; }
  if (consumed <= target) {
    return { basePct: consumed / target * 100, warnPct: 0, badPct: 0 };
  }

  // Status caps which segments are visible.
  const allowBad  = status === 'bad';
  const allowWarn = !skipWarnZone && (status === 'warn' || status === 'bad');

  if (!allowWarn && !allowBad) {
    // consumed exceeds target but status says ok/low — show full base only.
    return { basePct: 100, warnPct: 0, badPct: 0 };
  }

  if (!allowWarn) {
    // skipWarnZone + bad: everything over target is bad with no yellow band.
    const scale = 100 / consumed;
    return { basePct: target * scale, warnPct: 0, badPct: (consumed - target) * scale };
  }

  // Warn zone present: raw segments relative to target.
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
  let skipWarnZone = false;

  if (macroWin) {
    status    = computeDayStatus(consumed, macroWin.prevSum, effectiveDays, macroWin.target, macroWin.idealToday);
    barTarget = macroWin.idealToday;
    if (macroWin.target !== null && effectiveDays >= WINDOW_MIN_DAYS) {
      const rawIdeal = effectiveDays * macroWin.target - macroWin.prevSum;
      skipWarnZone = rawIdeal < macroWin.target * (1 - IDEAL_CLAMP);
    }
  } else if (fallbackGoal !== null) {
    status    = computeDayStatus(consumed, 0, 1, fallbackGoal, fallbackGoal);
    barTarget = fallbackGoal;
  } else {
    return { status: 'none', bar: { basePct: 0, warnPct: 0, badPct: 0 } };
  }

  return { status, bar: barSegments(consumed, barTarget, status, skipWarnZone) };
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
 * Returns the direction in which the sliding-window idealToday has been clamped by the ±15% limit.
 * Returns false when the window is too sparse or the raw ideal falls within the unclamped range.
 * @param {MacroWindow} macroWin
 * @param {number} effectiveDays
 * @returns {'below' | 'above' | false}
 */
export function isGoalClamped(macroWin, effectiveDays) {
  if (macroWin.target === null || effectiveDays < WINDOW_MIN_DAYS) { return false; }
  const rawIdeal = effectiveDays * macroWin.target - macroWin.prevSum;
  if (rawIdeal < macroWin.target * (1 - IDEAL_CLAMP)) { return 'below'; }
  if (rawIdeal > macroWin.target * (1 + IDEAL_CLAMP)) { return 'above'; }
  return false;
}

/**
 * Assuming the user hits their adjusted idealToday exactly each day, returns the number
 * of future days until the sliding-window ideal is no longer clamped.
 * @param {MacroWindow} macroWin
 * @param {number} effectiveDays
 * @param {'below' | 'above'} direction
 * @returns {number}
 */
export function recoveryDays(macroWin, effectiveDays, direction) {
  if (macroWin.target === null || macroWin.target <= 0) { return 1; }
  const rawIdeal     = effectiveDays * macroWin.target - macroWin.prevSum;
  const boundary     = macroWin.target * (direction === 'below' ? (1 - IDEAL_CLAMP) : (1 + IDEAL_CLAMP));
  const gap          = direction === 'below' ? boundary - rawIdeal : rawIdeal - boundary;
  const dailyStep    = IDEAL_CLAMP * macroWin.target;
  return Math.max(1, Math.ceil(gap / dailyStep));
}

/** @param {number} x @param {number} lo @param {number} hi */
function clampN(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

/**
 * @param {number} kcal
 * @param {{ proteinG: number, carbsG: number, fatG: number }} g
 * @returns {{ protein: number, carbs: number, fat: number }}
 */
function gramsToShares(kcal, g) {
  return {
    protein: (KCAL_PER_G_PROTEIN * g.proteinG) / kcal,
    carbs:   (KCAL_PER_G_CARBS   * g.carbsG)   / kcal,
    fat:     (KCAL_PER_G_FAT     * g.fatG)      / kcal,
  };
}

/**
 * @param {number} kcal
 * @param {{ protein: number, carbs: number, fat: number }} s
 * @returns {{ proteinG: number, carbsG: number, fatG: number }}
 */
function sharesToGrams(kcal, s) {
  return {
    proteinG: (kcal * s.protein) / KCAL_PER_G_PROTEIN,
    carbsG:   (kcal * s.carbs)   / KCAL_PER_G_CARBS,
    fatG:     (kcal * s.fat)     / KCAL_PER_G_FAT,
  };
}

/**
 * Per-macro share-movement allowances based on 7-day adherence ratio.
 * "down"/"up" are fractions of the desired share (applied as multipliers later).
 * @param {'protein'|'carbs'|'fat'} macro
 * @param {number} ratio  prevAvg / dailyGoalG
 * @returns {{ down: number, up: number }}
 */
function directionalAllowance(macro, ratio) {
  if (macro === 'protein') {
    if (ratio < 0.90) { return { down: 0.15, up: 0.00 }; }
    if (ratio < 0.95) { return { down: 0.15, up: 0.03 }; }
    if (ratio <= 1.05) { return { down: 0.15, up: 0.10 }; }
    if (ratio <= 1.10) { return { down: 0.10, up: 0.15 }; }
    return                { down: 0.05, up: 0.15 };
  }
  if (ratio < 0.90) { return { down: 0.15, up: 0.03 }; }
  if (ratio < 0.95) { return { down: 0.15, up: 0.05 }; }
  if (ratio <= 1.05) { return { down: 0.15, up: 0.15 }; }
  if (ratio <= 1.10) { return { down: 0.05, up: 0.15 }; }
  return                { down: 0.03, up: 0.15 };
}

/**
 * Project a candidate macro-share split onto the simplex (p+c+f=1)
 * while respecting per-macro bounds. At most 5 passes (1–2 are typical).
 * @param {{ protein: number, carbs: number, fat: number }} x
 * @param {{ protein: number, carbs: number, fat: number }} lower
 * @param {{ protein: number, carbs: number, fat: number }} upper
 * @returns {{ protein: number, carbs: number, fat: number }}
 */
function projectToSimplex(x, lower, upper) {
  const y = {
    protein: clampN(x.protein, lower.protein, upper.protein),
    carbs:   clampN(x.carbs,   lower.carbs,   upper.carbs),
    fat:     clampN(x.fat,     lower.fat,     upper.fat),
  };
  for (let i = 0; i < 5; i++) {
    const total = y.protein + y.carbs + y.fat;
    const diff  = 1 - total;
    if (Math.abs(diff) < 1e-6) { break; }
    const room = {
      protein: diff > 0 ? upper.protein - y.protein : y.protein - lower.protein,
      carbs:   diff > 0 ? upper.carbs   - y.carbs   : y.carbs   - lower.carbs,
      fat:     diff > 0 ? upper.fat     - y.fat      : y.fat     - lower.fat,
    };
    const totalRoom = room.protein + room.carbs + room.fat;
    if (totalRoom <= 1e-9) { break; }
    y.protein += diff * (room.protein / totalRoom);
    y.carbs   += diff * (room.carbs   / totalRoom);
    y.fat     += diff * (room.fat     / totalRoom);
  }
  return y;
}

/**
 * Compute coherent macro ideal-today values such that
 * 4·protIdeal + 4·carbIdeal + 9·fatIdeal ≈ kcalIdeal.
 *
 * Works in calorie-share space so that each macro's movement is bounded
 * relative to the user's stated split rather than in raw grams.
 * The 15% clamp is encoded in per-macro share bounds; directional
 * constraints based on 7-day adherence tighten one side of each bound.
 *
 * @param {{
 *   kcalIdeal:    number,
 *   goals:        GoalRecord,
 *   derivedG:     { protG: number, carbsG: number, fatG: number },
 *   prevSum:      import('./db.js').Macros,
 *   effectiveDays: number,
 * }} params
 * @returns {{ protIdeal: number, carbIdeal: number, fatIdeal: number }}
 */
function reconcileMacroIdeals({ kcalIdeal, goals, derivedG, prevSum, effectiveDays }) {
  const desired = {
    protein: goals.protPct  / 100,
    carbs:   goals.carbsPct / 100,
    fat:     goals.fatPct   / 100,
  };

  const rawG = {
    proteinG: effectiveDays * derivedG.protG  - prevSum.prot,
    carbsG:   effectiveDays * derivedG.carbsG - prevSum.carbs,
    fatG:     effectiveDays * derivedG.fatG   - prevSum.fats,
  };

  const rawShares = gramsToShares(kcalIdeal, rawG);

  // 7-day adherence ratios: prevAvg / dailyGoal.
  // When there are no prior days (prevDays=0) treat as neutral (1.0).
  const prevDays = effectiveDays - 1;
  const pRatio = prevDays > 0 && derivedG.protG  > 0 ? (prevSum.prot  / prevDays) / derivedG.protG  : 1;
  const cRatio = prevDays > 0 && derivedG.carbsG > 0 ? (prevSum.carbs / prevDays) / derivedG.carbsG : 1;
  const fRatio = prevDays > 0 && derivedG.fatG   > 0 ? (prevSum.fats  / prevDays) / derivedG.fatG   : 1;

  const pAllow = directionalAllowance('protein', pRatio);
  const cAllow = directionalAllowance('carbs',   cRatio);
  const fAllow = directionalAllowance('fat',     fRatio);

  const lower = {
    protein: desired.protein * (1 - pAllow.down),
    carbs:   desired.carbs   * (1 - cAllow.down),
    fat:     desired.fat     * (1 - fAllow.down),
  };
  const upper = {
    protein: desired.protein * (1 + pAllow.up),
    carbs:   desired.carbs   * (1 + cAllow.up),
    fat:     desired.fat     * (1 + fAllow.up),
  };

  // Feasibility: if bounds can't contain sum=1, relax carbs → fat → protein.
  const minPossible = lower.protein + lower.carbs + lower.fat;
  const maxPossible = upper.protein + upper.carbs + upper.fat;
  if (minPossible > 1) {
    const excess    = minPossible - 1;
    const carbRelax = Math.min(excess, lower.carbs);
    lower.carbs    -= carbRelax;
    const rem1      = excess - carbRelax;
    const fatRelax  = Math.min(rem1, lower.fat);
    lower.fat      -= fatRelax;
    lower.protein   = Math.max(0, lower.protein - (rem1 - fatRelax));
  }
  if (maxPossible < 1) {
    upper.carbs += 1 - maxPossible;
  }

  const candidate = {
    protein: clampN(rawShares.protein, lower.protein, upper.protein),
    carbs:   clampN(rawShares.carbs,   lower.carbs,   upper.carbs),
    fat:     clampN(rawShares.fat,     lower.fat,     upper.fat),
  };

  const finalShares = projectToSimplex(candidate, lower, upper);
  const finalG      = sharesToGrams(kcalIdeal, finalShares);

  const protIdeal = Math.round(finalG.proteinG * 10) / 10;
  const carbIdeal = Math.round(finalG.carbsG   * 10) / 10;
  // Always nudge fat to absorb any rounding residual (9 kcal/g means fewest grams moved).
  const residualKcal =
    kcalIdeal
    - KCAL_PER_G_PROTEIN * protIdeal
    - KCAL_PER_G_CARBS   * carbIdeal
    - KCAL_PER_G_FAT     * Math.round(finalG.fatG * 10) / 10;
  const fatIdeal = Math.round((finalG.fatG + residualKcal / KCAL_PER_G_FAT) * 10) / 10;

  return { protIdeal, carbIdeal, fatIdeal };
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

  const calIdeal = idealToday(prevSum.kcal, goals.kcal);
  const { protIdeal, carbIdeal, fatIdeal } = reconcileMacroIdeals({
    kcalIdeal: calIdeal,
    goals,
    derivedG: g,
    prevSum,
    effectiveDays,
  });

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

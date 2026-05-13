import { Meals } from './data-meals.js';
import * as db from './db.js';
import * as $ from './utils.js';

/** % deviation at which the 7-day average transitions from ok → warn. */
export const STATUS_OK_PCT   = 0.05;
/** % deviation at which the 7-day average transitions from warn → bad. */
export const STATUS_WARN_PCT = 0.10;
/** ±% of idealToday used as the ok band when clamped, and as the safety-net
 *  override that caps status at 'warn' during recovery. */
export const SAFETY_NET_PCT  = 0.10;

/** Kcal per gram of protein (and carbohydrate). */
export const KCAL_PER_G_PROTEIN = 4;
/** Kcal per gram of carbohydrate. */
export const KCAL_PER_G_CARBS   = 4;
/** Kcal per gram of fat. */
export const KCAL_PER_G_FAT     = 9;

/**
 * Short signal window: the most recent N calendar days of logged meals feed
 * the short-term error signal. Shrink to react faster; grow to dampen spikes.
 */
export const SHORT_WINDOW   = 7;

/**
 * Long signal window: the exponentially-decayed error is computed over this
 * many calendar days. Longer = more stability; shorter = faster forgetting.
 */
export const LONG_WINDOW    = 28;

/**
 * Half-life for the exponential decay weights in the long error signal.
 * A logged day that is HALF_LIFE_DAYS old gets half the weight of today.
 * Shorter = recency matters more; longer = distant history carries more weight.
 */
export const HALF_LIFE_DAYS = 9;

/** Clamp factor for idealToday: ±15% of the daily target. */
const IDEAL_CLAMP = 0.15;
/** Fraction of IDEAL_CLAMP at which the recovery tooltip becomes visible. */
const CLAMP_TOOLTIP_THRESHOLD = IDEAL_CLAMP * 0.70;

/**
 * Deadband at zero persistence intensity (floors to this many kcal or 2.5% of
 * goal, whichever is larger). Errors smaller than the deadband produce no
 * adjustment. Widen to tolerate more noise; narrow to be more reactive.
 */
const BASE_DEADBAND_KCAL    = 50;   // kcal — absolute floor
const BASE_DEADBAND_PCT     = 0.025; // 2.5% of goal — scales with goal size

/**
 * Deadband at full persistence intensity (shrinks toward this floor when the
 * user has been consistently over/under for many days). Narrower than base so
 * chronic small overages eventually register even if they're below the base band.
 */
const PERSISTENT_DEADBAND_KCAL = 25;    // kcal — absolute floor at full persistence
const PERSISTENT_DEADBAND_PCT  = 0.0125; // 1.25% of goal

/**
 * Same deadband floors for per-macro controllers, which operate in kcal space
 * but on much smaller budgets (e.g. 600 kcal for protein). The calorie-goal
 * floors (50/25 kcal) are too coarse there and would swallow real drift.
 */
const MACRO_BASE_DEADBAND_KCAL       = 10;
const MACRO_PERSISTENT_DEADBAND_KCAL = 5;

/**
 * How many calendar days of logged history the persistence detector looks at.
 * Longer = slower to declare "chronic"; shorter = quicker to fire.
 */
const PERSISTENCE_WINDOW_DAYS = 14;

/**
 * Fraction of PERSISTENCE_WINDOW_DAYS logged days that must be over-target
 * before persistence intensity starts rising above 0.
 * Below this threshold the controller treats drift as noise.
 */
const PERSISTENCE_START = 0.50;

/**
 * Fraction at which persistence intensity reaches 1.0 (fully persistent).
 * Between START and FULL the intensity follows a smooth S-curve (smoothstep).
 */
const PERSISTENCE_FULL  = 0.90;

// ── Mode-dependent gain constants ──────────────────────────────────────────
// gain = lerp(base, persistent, persistenceIntensity)
// A higher gain multiplies the error more aggressively, shrinking today's target
// further. Persistent gain fires only when the detector has declared chronic drift.
//
// Asymmetry is intentional: the app penalises chronic surplus (loss mode) more
// than it penalises chronic deficit, and vice versa for gain mode.

/** Loss mode, user eating over goal — base gain (no persistence detected). */
const LOSS_GAIN_OVER_BASE       = 0.70;
/** Loss mode, user eating over goal — gain at full persistence. */
const LOSS_GAIN_OVER_PERSISTENT = 2.00;
/** Loss mode, user eating under goal — fixed gain regardless of persistence.
 *  Under-eating in a deficit is fine; no need to push the target higher. */
const LOSS_GAIN_UNDER           = 0.25;

/** Maintenance mode base gain (symmetric — same for surplus and deficit). */
const MAINTENANCE_GAIN_BASE       = 0.60;
/** Maintenance mode gain at full persistence. */
const MAINTENANCE_GAIN_PERSISTENT = 1.50;

/** Gain mode, user eating under goal — base gain (no persistence detected). */
const GAIN_GAIN_UNDER_BASE       = 0.70;
/** Gain mode, user eating under goal — gain at full persistence. */
const GAIN_GAIN_UNDER_PERSISTENT = 2.00;
/** Gain mode, user eating over goal — fixed gain regardless of persistence.
 *  Surplus in a bulk is fine; no need to push the target lower. */
const GAIN_GAIN_OVER             = 0.25;

/**
 * Minimum logged days in the last SHORT_WINDOW calendar days required before
 * the controller issues any adjustment. Below this the 7-day signal is too
 * sparse to trust. Also serves as the minimum logged days in the 14-day
 * persistence window before the confidence ramp starts.
 */
export const MIN_LOGGED_7 = 4;

/**
 * Logged days in the persistence window at which controller confidence reaches
 * 1.0 (full strength). Between MIN_LOGGED_7 and this value the controller
 * ramps from CONFIDENCE_MIN_STRENGTH to 1 via a smoothstep curve.
 */
const CONFIDENCE_FULL_DAYS = PERSISTENCE_WINDOW_DAYS; // 14

/**
 * Controller strength when logged days equals exactly MIN_LOGGED_7.
 * Prevents a sudden jump from zero to full at the minimum threshold.
 */
const CONFIDENCE_MIN_STRENGTH = 0.20;

/**
 * Minimum logged days in the 28-day window before the long error signal
 * starts contributing to the blended effectiveError.
 */
const LONG_CONFIDENCE_MIN_DAYS = 7;

/**
 * Logged days in the 28-day window at which the long signal reaches its
 * maximum weight (50%) in the short/long blend.
 */
const LONG_CONFIDENCE_FULL_DAYS = 21;

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
 *   controllerDebug: object,
 * }} WindowVM
 *
 * @typedef {{
 *   target:     number | null,
 *   status:     'none'|'low'|'ok'|'warn'|'bad',
 *   idealToday: number,
 *   prevSum:    number,
 *   adjustment: number,
 *   gramAdj?:   number,
 * }} MacroWindow
 *
 * @typedef {(consumed: number, goal: number | null, idealToday: number, adjustment: number) => 'none'|'low'|'ok'|'warn'|'bad'} StatusFn
 */

/**
 * Returns all goal records sorted by effectiveFrom descending (newest first).
 * @returns {Promise<GoalRecord[]>}
 */
export async function list() {
  const all = /** @type {GoalRecord[]} */ (await db.getAll('goals'));
  return all.sort((leftGoal, rightGoal) => rightGoal.effectiveFrom.localeCompare(leftGoal.effectiveFrom));
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
  const existing = all.find(record => record.effectiveFrom === today);
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
  const clash = all.find(record => record.id !== id && record.effectiveFrom === newDateISO);
  if (clash) { throw new Error('Another goal already starts on this date'); }
  const record = all.find(goalRecord => goalRecord.id === id);
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
  return records.find(record => record.effectiveFrom <= dateISO) ?? null;
}

// ── Pure helper functions ────────────────────────────────────────────────────

/** @param {number} ageDays @param {number} halfLifeDays */
export function expWeight(ageDays, halfLifeDays) {
  return 0.5 ** (ageDays / halfLifeDays);
}

/** @param {number} a @param {number} b @param {number} t */
export function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * Cubic S-curve that maps x in [edge0, edge1] → [0, 1].
 * Returns 0 for x ≤ edge0 and 1 for x ≥ edge1.
 * @param {number} edge0 @param {number} edge1 @param {number} x
 */
export function smoothstep(edge0, edge1, x) {
  const normalized = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return normalized * normalized * (3 - 2 * normalized);
}

/**
 * Data-confidence multiplier [0, 1] for the adaptive controller.
 * Returns 0 when the user has fewer than MIN_LOGGED_7 days in the persistence
 * window (no adjustment issued). Ramps from CONFIDENCE_MIN_STRENGTH to 1.0
 * as days go from MIN_LOGGED_7 to CONFIDENCE_FULL_DAYS via a smoothstep curve,
 * so early data produces small adjustments rather than a binary on/off gate.
 * @param {number} loggedDays14 — logged days in the last PERSISTENCE_WINDOW_DAYS calendar days
 */
export function controllerConfidence(loggedDays14) {
  if (loggedDays14 < MIN_LOGGED_7) { return 0; }
  return CONFIDENCE_MIN_STRENGTH + (1 - CONFIDENCE_MIN_STRENGTH) * smoothstep(MIN_LOGGED_7, CONFIDENCE_FULL_DAYS, loggedDays14);
}

/**
 * Compute the mean error over an array of per-day errors (newest first).
 * Takes up to SHORT_WINDOW entries.
 * @param {number[]} errorsNewestFirst
 */
export function shortError(errorsNewestFirst) {
  const days = errorsNewestFirst.slice(0, SHORT_WINDOW);
  if (days.length === 0) { return 0; }
  return days.reduce((sum, error) => sum + error, 0) / days.length;
}

/**
 * Exponentially-weighted average error over a calendar window.
 * Each entry is weighted by expWeight(ageDays, HALF_LIFE_DAYS).
 * @param {Array<{ageDays: number, error: number}>} days — all logged days in range
 * @param {number} windowDays — calendar-day cutoff (entries with ageDays >= windowDays are ignored)
 * @param {number} halfLife
 */
export function weightedAverageError(days, windowDays, halfLife) {
  const subset = days.filter(day => day.ageDays < windowDays);
  if (subset.length === 0) { return 0; }
  let weightSum = 0;
  let weightedErrorSum = 0;
  for (const day of subset) {
    const weight = expWeight(day.ageDays, halfLife);
    weightSum  += weight;
    weightedErrorSum += weight * day.error;
  }
  return weightSum > 0 ? weightedErrorSum / weightSum : 0;
}

/**
 * Blend short and long errors with dynamic weighting based on long-window
 * data confidence. Long signal weight scales from 0 (no long data) to 50%
 * (full data). When signs disagree and long confidence is meaningful (> 0.5),
 * the long signal gets 75% weight to suppress transient spikes.
 * @param {number} shortErr
 * @param {number} longErr
 * @param {number} longConfidence 0-1;
 */
export function combineErrors(shortErr, longErr, longConfidence) {
  const signDisagree = shortErr !== 0 && longErr !== 0 && Math.sign(shortErr) !== Math.sign(longErr);
  if (longConfidence > 0.5 && signDisagree) {
    return 0.25 * shortErr + 0.75 * longErr;
  }
  const longWeight = 0.50 * longConfidence;
  return (1 - longWeight) * shortErr + longWeight * longErr;
}

/**
 * Fraction of logged days in the persistence window where actual > baseGoal.
 * Ranges 0–1; 1 means every logged day in the window was over goal.
 * @param {Array<{ageDays: number, error: number}>} days
 * @param {number} baseGoalKcal — used only to confirm the threshold (error > 0 means over goal)
 */
export function overPersistence(days, baseGoalKcal) {
  void baseGoalKcal; // threshold is always 0 (over vs under goal)
  const window = days.filter(day => day.ageDays < PERSISTENCE_WINDOW_DAYS);
  if (window.length === 0) { return 0; }
  return window.filter(day => day.error > 0).length / window.length;
}

/**
 * Interpolate between base and persistent deadband using persistence intensity.
 * @param {number} baseGoalKcal
 * @param {number} intensity — 0 (no persistence) to 1 (fully persistent)
 * @param {number} [baseFloor]
 * @param {number} [persistentFloor]
 */
export function adaptiveDeadband(baseGoalKcal, intensity, baseFloor = BASE_DEADBAND_KCAL, persistentFloor = PERSISTENT_DEADBAND_KCAL) {
  const base       = Math.max(baseFloor, BASE_DEADBAND_PCT * baseGoalKcal);
  const persistent = Math.max(persistentFloor, PERSISTENT_DEADBAND_PCT * baseGoalKcal);
  return lerp(base, persistent, intensity);
}

/**
 * Mode-and-direction-dependent gain, interpolated by persistence intensity.
 * @param {'loss'|'maintenance'|'gain'} mode
 * @param {number} effectiveError — positive = surplus, negative = deficit
 * @param {number} intensity — 0–1 persistence intensity
 */
export function adaptiveGain(mode, effectiveError, intensity) {
  const surplus = effectiveError > 0;
  if (mode === 'loss') {
    return surplus
      ? lerp(LOSS_GAIN_OVER_BASE, LOSS_GAIN_OVER_PERSISTENT, intensity)
      : LOSS_GAIN_UNDER;
  }
  if (mode === 'gain') {
    return surplus
      ? GAIN_GAIN_OVER
      : lerp(GAIN_GAIN_UNDER_BASE, GAIN_GAIN_UNDER_PERSISTENT, intensity);
  }
  // maintenance: symmetric
  return lerp(MAINTENANCE_GAIN_BASE, MAINTENANCE_GAIN_PERSISTENT, intensity);
}

/**
 * Stateless adaptive trend controller. Computes today's adjusted kcal target
 * using a blend of 7-day and 28-day error signals with persistence detection.
 *
 * Returns baseGoal unchanged when the completeness gate fires (too few logged
 * days to trust the signal). Never infers under-eating from absent logs.
 *
 * @param {Record<string, number>} kcalByDay — ISO date → total kcal (up to 28 days)
 * @param {string} dateISO — the day to compute for
 * @param {number} baseGoalKcal — raw daily target
 * @param {'loss'|'maintenance'|'gain'} [mode]
 * @returns {{ adjustedGoalKcal: number, adjustment: number, gated?: true, debug: object }}
 */
export function computeKcalAdjustment(kcalByDay, dateISO, baseGoalKcal, mode = 'maintenance', deadbandFloorKcal = BASE_DEADBAND_KCAL, persistentDeadbandFloorKcal = PERSISTENT_DEADBAND_KCAL) {
  if (baseGoalKcal <= 0) {
    return { adjustedGoalKcal: baseGoalKcal, adjustment: 0, debug: { gate: 'zero-goal' } };
  }

  const today = $.localDate(dateISO);

  // Build logged-day array (newest first, including dateISO if logged).
  /** @type {Array<{ageDays: number, error: number}>} */
  const loggedDays = [];
  for (let i = 1; i < LONG_WINDOW; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const iso = $.toISO(date);
    if (iso in kcalByDay) {
      loggedDays.push({ ageDays: i, error: kcalByDay[iso] - baseGoalKcal });
    }
  }

  const loggedDays7  = loggedDays.filter(day => day.ageDays < SHORT_WINDOW).length;
  const loggedDays14 = loggedDays.filter(day => day.ageDays < PERSISTENCE_WINDOW_DAYS).length;
  const loggedDays28 = loggedDays.length;

  // Gate: require at least MIN_LOGGED_7 recent days before issuing any adjustment.
  if (loggedDays7 < MIN_LOGGED_7) {
    return {
      adjustedGoalKcal: Math.round(baseGoalKcal),
      adjustment: 0,
      gated: true,
      debug: { gate: 'sparse', loggedDays7, loggedDays14, loggedDays28 },
    };
  }

  // Confidence ramp: scales adjustment magnitude from 20% at MIN_LOGGED_7 days
  // to 100% at CONFIDENCE_FULL_DAYS. Prevents cold-start jumps and treats
  // early streaks as uncertain rather than fully persistent.
  const confidence = controllerConfidence(loggedDays14);

  const shortErr = shortError(loggedDays.filter(day => day.ageDays < SHORT_WINDOW).map(day => day.error));
  const longErr  = weightedAverageError(loggedDays, LONG_WINDOW, HALF_LIFE_DAYS);

  // Long signal fades in gradually; trust the short signal more until the
  // 28-day window has enough data.
  const longConfidence  = smoothstep(LONG_CONFIDENCE_MIN_DAYS, LONG_CONFIDENCE_FULL_DAYS, loggedDays28);
  const effectiveError  = combineErrors(shortErr, longErr, longConfidence);

  // Shrink rawPersistence toward a neutral 0.5 prior when confidence is low.
  // Prevents a short run of identical days from triggering full chronic-overage mode.
  const rawPersistence      = overPersistence(loggedDays, baseGoalKcal);
  const effectivePersistence = 0.5 + confidence * (rawPersistence - 0.5);
  const persistenceIntensity = smoothstep(PERSISTENCE_START, PERSISTENCE_FULL, effectivePersistence);

  const deadband = adaptiveDeadband(baseGoalKcal, persistenceIntensity, deadbandFloorKcal, persistentDeadbandFloorKcal);

  if (Math.abs(effectiveError) < deadband) {
    return {
      adjustedGoalKcal: Math.round(baseGoalKcal),
      adjustment: 0,
      debug: {
        shortErr, longErr, effectiveError,
        rawPersistence, effectivePersistence, persistenceIntensity,
        deadband, deadbandApplied: true,
        loggedDays7, loggedDays14, loggedDays28, confidence, longConfidence,
      },
    };
  }

  const gain               = adaptiveGain(mode, effectiveError, persistenceIntensity);
  const unclampedAdj       = -gain * effectiveError;
  // Scale the raw adjustment by confidence so early data produces smaller moves.
  const confidenceScaledAdj = unclampedAdj * confidence;
  const maxAdj             = IDEAL_CLAMP * baseGoalKcal;
  const clampedAdj         = Math.max(-maxAdj, Math.min(maxAdj, confidenceScaledAdj));
  const clampApplied       = clampedAdj !== confidenceScaledAdj;

  return {
    adjustedGoalKcal: Math.round(baseGoalKcal + clampedAdj),
    adjustment: clampedAdj,
    debug: {
      shortErr, longErr, effectiveError,
      rawPersistence, effectivePersistence, persistenceIntensity,
      deadband, gain,
      unclampedAdj, confidenceScaledAdj, clampedAdj,
      clampApplied, deadbandApplied: false,
      loggedDays7, loggedDays14, loggedDays28, confidence, longConfidence,
    },
  };
}

/**
 * Compute day status.
 *
 * Three modes depending on the controller's adjustment:
 *
 * - Unclamped (adjustment === 0): symmetric ±STATUS_OK_PCT/STATUS_WARN_PCT bands
 *   around idealToday.
 *
 * - Clamped below (adjustment < 0, over-eating): idealToday is a ceiling.
 *   ok band is [ideal×0.80, ideal]; anything above ideal is immediately 'bad'.
 *
 * - Clamped above (adjustment > 0, under-eating): idealToday is a floor.
 *   Below ideal is 'low'; ok band is [ideal, ideal×1.20]; then 'warn', then 'bad'.
 *
 * @param {number} consumed
 * @param {number | null} goal   — raw daily target
 * @param {number} idealToday    — adjusted daily target (goal + adjustment)
 * @param {number} adjustment    — signed kcal adjustment from the controller
 * @returns {'none'|'low'|'ok'|'warn'|'bad'}
 */
export function computeDayStatus(consumed, goal, idealToday, adjustment, okPct = STATUS_OK_PCT, warnPct = STATUS_WARN_PCT) {
  if (goal === null) { return 'none'; }
  if (goal === 0) { return consumed === 0 ? 'ok' : 'bad'; }

  // Only enter ceiling/floor mode when the adjustment is large enough to be
  // meaningful. Small confidence-ramped adjustments (below the base deadband)
  // should not suppress the warn zone — the user's eating is still within normal
  // noise. This threshold matches isGoalClamped so both agree on "is it clamped".
  const adjustmentDeadband = Math.max(BASE_DEADBAND_KCAL, BASE_DEADBAND_PCT * goal);
  const effectiveAdjustment = Math.abs(adjustment) >= adjustmentDeadband ? adjustment : 0;

  // In clamped mode the band is one-sided. The boundary is `1 ± 2*safetyNetPct`,
  // so setting safetyNetPct = okPct keeps the ok zone the same total width as the
  // normal two-sided ±okPct band.
  const safetyNetPct = okPct;

  if (effectiveAdjustment < 0) {
    // Clamped below: idealToday is a ceiling — green only extends downward.
    if (idealToday <= 0) { return consumed === 0 ? 'ok' : 'bad'; }
    const ratio = consumed / idealToday;
    if (ratio < 1 - 2 * safetyNetPct) { return 'low'; }
    if (ratio <= 1)                    { return 'ok'; }
    return 'bad';
  }

  if (effectiveAdjustment > 0) {
    // Clamped above: idealToday is a floor — green only extends upward.
    if (idealToday <= 0) { return consumed === 0 ? 'ok' : 'bad'; }
    const ratio = consumed / idealToday;
    if (ratio < 1)                                        { return 'low'; }
    if (ratio <= 1 + 2 * safetyNetPct)                    { return 'ok'; }
    if (ratio <= 1 + 2 * safetyNetPct + (warnPct - okPct)) { return 'warn'; }
    return 'bad';
  }

  // Unclamped: compare consumed vs idealToday with standard bands.
  if (idealToday <= 0) { return consumed === 0 ? 'ok' : 'bad'; }
  const ratio = consumed / idealToday;
  if (ratio < 1 - okPct)   { return 'low'; }
  if (ratio <= 1 + okPct)  { return 'ok'; }
  if (ratio <= 1 + warnPct) { return 'warn'; }
  return 'bad';
}

/** Status for a calorie value against its goal (±5 % ok, ±10 % warn).
 * @type {StatusFn} */
export const computeKcalDayStatus = (consumed, goal, idealToday, adjustment) =>
  computeDayStatus(consumed, goal, idealToday, adjustment, STATUS_OK_PCT, STATUS_WARN_PCT);

/** Status for a gram-macro value against its goal (±10 % ok, ±20 % warn — double kcal bands).
 * @type {StatusFn} */
export const computeMacroDayStatus = (consumed, goal, idealToday, adjustment) =>
  computeDayStatus(consumed, goal, idealToday, adjustment, STATUS_OK_PCT * 2, STATUS_WARN_PCT * 2);

/**
 * Compute the adjusted daily kcal target for a given day.
 * Uses 'maintenance' mode (symmetric gain) so past heatmap colors do not
 * retroactively shift based on the user's current mode setting.
 *
 * @param {Record<string, number>} kcalByDay — map of ISO date → total kcal
 * @param {string} dateISO — the day to compute the target for
 * @param {number} goalKcal — the raw daily kcal target
 * @returns {number}
 */
export function idealForDay(kcalByDay, dateISO, goalKcal) {
  if (goalKcal <= 0) { return goalKcal; }
  return computeKcalAdjustment(kcalByDay, dateISO, goalKcal, 'maintenance').adjustedGoalKcal;
}

/**
 * Compute day status for a single day in the kcalByDay map.
 * Convenience wrapper around computeKcalAdjustment + computeDayStatus for the heatmap.
 * Uses 'maintenance' mode so past colors are not affected by current goal settings.
 * @param {Record<string, number>} kcalByDay
 * @param {string} dateISO
 * @param {number} goalKcal
 * @returns {'none'|'low'|'ok'|'warn'|'bad'}
 */
export function statusForDay(kcalByDay, dateISO, goalKcal) {
  const consumed = kcalByDay[dateISO] ?? 0;
  if (goalKcal <= 0) { return computeKcalDayStatus(consumed, goalKcal, goalKcal, 0); }
  const { adjustedGoalKcal, adjustment } = computeKcalAdjustment(kcalByDay, dateISO, goalKcal, 'maintenance');
  return computeKcalDayStatus(consumed, goalKcal, adjustedGoalKcal, adjustment);
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
 * its progress bar should look.  Computes status via the controller-driven
 * adjustment logic and derives bar segments that are guaranteed to stay
 * consistent with the status (bar never shows a severity beyond status).
 *
 * @param {number} consumed
 * @param {MacroWindow | null | undefined} macroWin - from computeWindowVM; null/undefined = fallback
 * @param {number} _effectiveDays - from WindowVM; kept for isGoalClamped/recoveryDays callers
 * @param {number | null} [fallbackGoal] - raw daily target when macroWin is unavailable
 * @param {StatusFn} [statusFn] - defaults to computeMacroDayStatus (wider gram-macro bands)
 * @returns {MacroVisuals}
 */
export function macroVisuals(consumed, macroWin, _effectiveDays, fallbackGoal = null, statusFn = computeMacroDayStatus) {
  /** @type {'none'|'low'|'ok'|'warn'|'bad'} */
  let status;
  let barTarget;
  let skipWarnZone = false;

  if (macroWin) {
    const adjustment = macroWin.adjustment ?? 0;
    status       = statusFn(consumed, macroWin.target, macroWin.idealToday, adjustment);
    barTarget    = macroWin.idealToday;
    // Only suppress the warn zone when the adjustment is large enough to be
    // meaningful (same threshold as computeDayStatus uses for ceiling mode).
    const adjustmentDeadband = Math.max(BASE_DEADBAND_KCAL, BASE_DEADBAND_PCT * (macroWin.target ?? 0));
    skipWarnZone = adjustment < -adjustmentDeadband; // clamped below → ceiling → no warn zone above ideal
  } else if (fallbackGoal !== null) {
    status    = statusFn(consumed, fallbackGoal, fallbackGoal, 0);
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
 * Returns the direction in which the controller has clamped idealToday via ±15%.
 * Returns false when history is too sparse or the adjustment is within the deadband.
 * @param {MacroWindow} macroWin
 * @param {number} effectiveDays
 * @returns {'below' | 'above' | false}
 */
export function isGoalClamped(macroWin, effectiveDays) {
  if (macroWin.target === null || effectiveDays < MIN_LOGGED_7) { return false; }
  if (macroWin.gramAdj !== undefined) {
    // Use the visible idealToday deviation from base target, not the controller's
    // intermediate gramAdj: the reconciler can partially reverse a large gramAdj,
    // so gramAdj alone doesn't reflect what the user actually sees.
    if (macroWin.target === null || macroWin.target <= 0) { return false; }
    const deviation = (macroWin.idealToday - macroWin.target) / macroWin.target;
    const threshold = CLAMP_TOOLTIP_THRESHOLD;
    if (deviation < -threshold) { return 'below'; }
    if (deviation >  threshold) { return 'above'; }
    return false;
  }
  const adjustment = macroWin.adjustment ?? 0;
  const deadband = Math.max(BASE_DEADBAND_KCAL, BASE_DEADBAND_PCT * macroWin.target);
  if (adjustment < -deadband) { return 'below'; }
  if (adjustment >  deadband) { return 'above'; }
  return false;
}

/**
 * Estimates how many days until the controller's adjustment returns to within
 * the deadband, assuming no new meals are logged. Uses the exponential-decay
 * approximation: debt halves every HALF_LIFE_DAYS days.
 * @param {MacroWindow} macroWin
 * @param {number} effectiveDays
 * @param {'below' | 'above'} _direction
 * @returns {number}
 */
export function recoveryDays(macroWin, effectiveDays, _direction) {
  if (macroWin.target === null || macroWin.target <= 0) { return 1; }
  if (effectiveDays < MIN_LOGGED_7) { return 1; }
  if (macroWin.gramAdj !== undefined) {
    const gramDeadband = (CLAMP_TOOLTIP_THRESHOLD) * macroWin.target;
    if (Math.abs(macroWin.gramAdj) <= gramDeadband) { return 0; }
    // Solve for n: |adj| × 0.5^(n/HALF_LIFE) = deadband → n = HALF_LIFE × log2(|adj|/deadband)
    return Math.max(1, Math.ceil(HALF_LIFE_DAYS * Math.log2(Math.abs(macroWin.gramAdj) / gramDeadband)));
  }
  const adjustment = macroWin.adjustment ?? 0;
  const deadband = Math.max(BASE_DEADBAND_KCAL, BASE_DEADBAND_PCT * macroWin.target);
  if (Math.abs(adjustment) <= deadband) { return 0; }
  return Math.max(1, Math.ceil(HALF_LIFE_DAYS * Math.log2(Math.abs(adjustment) / deadband)));
}

/** @param {number} value @param {number} min @param {number} max */
function clampN(value, min, max) { return Math.max(min, Math.min(max, value)); }

/**
 * @param {number} kcal
 * @param {{ proteinG: number, carbsG: number, fatG: number }} grams
 * @returns {{ protein: number, carbs: number, fat: number }}
 */
function gramsToShares(kcal, grams) {
  return {
    protein: (KCAL_PER_G_PROTEIN * grams.proteinG) / kcal,
    carbs:   (KCAL_PER_G_CARBS   * grams.carbsG)   / kcal,
    fat:     (KCAL_PER_G_FAT     * grams.fatG)      / kcal,
  };
}

/**
 * @param {number} kcal
 * @param {{ protein: number, carbs: number, fat: number }} shares
 * @returns {{ proteinG: number, carbsG: number, fatG: number }}
 */
function sharesToGrams(kcal, shares) {
  return {
    proteinG: (kcal * shares.protein) / KCAL_PER_G_PROTEIN,
    carbsG:   (kcal * shares.carbs)   / KCAL_PER_G_CARBS,
    fatG:     (kcal * shares.fat)     / KCAL_PER_G_FAT,
  };
}

/**
 * Per-macro share-movement allowances based on 7-day adherence ratio.
 * "down"/"up" are fractions of the desired share (applied as multipliers later).
 * @param {'protein'|'carbs'|'fat'} macro
 * @param {number} ratio  prevAvg / dailyGoalG
 * @returns {{ down: number, up: number }}
 */
export function directionalAllowance(macro, ratio) {
  if (macro === 'protein') {
    if (ratio < 0.90) { return { down: 0.15, up: 0.15 }; }
    if (ratio < 0.95) { return { down: 0.15, up: 0.10 }; }
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
 * @param {{ protein: number, carbs: number, fat: number }} candidateShares
 * @param {{ protein: number, carbs: number, fat: number }} lower
 * @param {{ protein: number, carbs: number, fat: number }} upper
 * @returns {{ protein: number, carbs: number, fat: number }}
 */
function projectToSimplex(candidateShares, lower, upper) {
  const projected = {
    protein: clampN(candidateShares.protein, lower.protein, upper.protein),
    carbs:   clampN(candidateShares.carbs,   lower.carbs,   upper.carbs),
    fat:     clampN(candidateShares.fat,     lower.fat,     upper.fat),
  };
  for (let i = 0; i < 5; i++) {
    const total = projected.protein + projected.carbs + projected.fat;
    const diff  = 1 - total;
    if (Math.abs(diff) < 1e-6) { break; }
    const room = {
      protein: diff > 0 ? upper.protein - projected.protein : projected.protein - lower.protein,
      carbs:   diff > 0 ? upper.carbs   - projected.carbs   : projected.carbs   - lower.carbs,
      fat:     diff > 0 ? upper.fat     - projected.fat      : projected.fat     - lower.fat,
    };
    const totalRoom = room.protein + room.carbs + room.fat;
    if (totalRoom <= 1e-9) { break; }
    projected.protein += diff * (room.protein / totalRoom);
    projected.carbs   += diff * (room.carbs   / totalRoom);
    projected.fat     += diff * (room.fat     / totalRoom);
  }
  return projected;
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
  // Desired calorie-shares are anchored to the (possibly adjusted) gram goals so
  // the directional-allowance bounds track the controller's target, not the raw
  // percentage split. Shares sum to 1 by construction (normalised by adj total kcal).
  const adjProtKcal  = derivedG.protG  * KCAL_PER_G_PROTEIN;
  const adjCarbsKcal = derivedG.carbsG * KCAL_PER_G_CARBS;
  const adjFatKcal   = derivedG.fatG   * KCAL_PER_G_FAT;
  const adjTotalKcal = adjProtKcal + adjCarbsKcal + adjFatKcal;
  const desired = adjTotalKcal > 0 ? {
    protein: adjProtKcal  / adjTotalKcal,
    carbs:   adjCarbsKcal / adjTotalKcal,
    fat:     adjFatKcal   / adjTotalKcal,
  } : {
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

  // Adherence ratios use the BASE gram goal (from the user's stated percentages)
  // rather than the adjusted derivedG. This ensures the directional-allowance
  // bounds reflect adherence to the long-term plan and are not skewed by the
  // dynamic adjustment (e.g. an adjusted-down fat goal would make the ratio
  // look artificially extreme, triggering the most restrictive down=3% bound).
  const prevDays = effectiveDays - 1;
  const baseProtG  = goals.kcal > 0 ? (goals.kcal * goals.protPct  / 100) / KCAL_PER_G_PROTEIN  : derivedG.protG;
  const baseCarbsG = goals.kcal > 0 ? (goals.kcal * goals.carbsPct / 100) / KCAL_PER_G_CARBS    : derivedG.carbsG;
  const baseFatG   = goals.kcal > 0 ? (goals.kcal * goals.fatPct   / 100) / KCAL_PER_G_FAT      : derivedG.fatG;
  const pRatio = prevDays > 0 && baseProtG  > 0 ? (prevSum.prot  / prevDays) / baseProtG  : 1;
  const cRatio = prevDays > 0 && baseCarbsG > 0 ? (prevSum.carbs / prevDays) / baseCarbsG : 1;
  const fRatio = prevDays > 0 && baseFatG   > 0 ? (prevSum.fats  / prevDays) / baseFatG   : 1;

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

  // Hard cap: ensure idealToday stays within ±IDEAL_CLAMP of the base gram goals,
  // matching the limit the per-macro controller imposes on its own adjustment.
  // The directional-allowance bounds above are ±15% of the desired *share*, which
  // can exceed ±15% of the base *grams* when adjTotalKcal ≠ kcalIdeal.
  if (kcalIdeal > 0) {
    upper.protein = Math.min(upper.protein, (baseProtG  * (1 + IDEAL_CLAMP) * KCAL_PER_G_PROTEIN) / kcalIdeal);
    lower.protein = Math.max(lower.protein, (baseProtG  * (1 - IDEAL_CLAMP) * KCAL_PER_G_PROTEIN) / kcalIdeal);
    upper.carbs   = Math.min(upper.carbs,   (baseCarbsG * (1 + IDEAL_CLAMP) * KCAL_PER_G_CARBS)   / kcalIdeal);
    lower.carbs   = Math.max(lower.carbs,   (baseCarbsG * (1 - IDEAL_CLAMP) * KCAL_PER_G_CARBS)   / kcalIdeal);
    upper.fat     = Math.min(upper.fat,     (baseFatG   * (1 + IDEAL_CLAMP) * KCAL_PER_G_FAT)     / kcalIdeal);
    lower.fat     = Math.max(lower.fat,     (baseFatG   * (1 - IDEAL_CLAMP) * KCAL_PER_G_FAT)     / kcalIdeal);
    // If tightening created an infeasible range for a macro, pin it to its desired share.
    for (const key of /** @type {const} */ (['protein', 'carbs', 'fat'])) {
      if (lower[key] > upper[key]) { lower[key] = upper[key] = desired[key]; }
    }
  }

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
 * Derive the controller mode from a goal record.
 * @param {GoalRecord} goals
 * @returns {'loss'|'maintenance'|'gain'}
 */
function deriveMode(goals) {
  if (goals.calMagnitude === 0) { return 'maintenance'; }
  return goals.calMode === 'deficit' ? 'loss' : 'gain';
}

/**
 * Compute the 28-day sliding window view model.
 * Returns null if goals are not set or no meals exist in the 7-day display window.
 * @param {string} todayISO
 * @param {GoalRecord | null} goals
 * @returns {Promise<WindowVM | null>}
 */
export async function computeWindowVM(todayISO, goals) {
  if (!goals) { return null; }

  // Fetch 28-day range so the kcal controller has enough history.
  const startDate28 = $.localDate(todayISO);
  startDate28.setDate(startDate28.getDate() - (LONG_WINDOW - 1));
  const from28ISO = $.toISO(startDate28);

  const meals = await Meals.listRange(from28ISO, todayISO);

  /** @type {Record<string, import('./db.js').Macros>} */
  const macrosByDay28 = {};
  for (const meal of meals) {
    if (!macrosByDay28[meal.date]) { macrosByDay28[meal.date] = $.zeroMacros(); }
    $.addScaledMacros(macrosByDay28[meal.date], meal.foodSnapshot, meal.multiplier);
  }

  // The 7-day window drives windowDays, effectiveDays, prevSum, and the UI display.
  const startDate7 = $.localDate(todayISO);
  startDate7.setDate(startDate7.getDate() - (SHORT_WINDOW - 1));
  const from7ISO = $.toISO(startDate7);

  /** @type {Record<string, import('./db.js').Macros>} */
  const macrosByDay7 = {};
  for (const [dateISO, macros] of Object.entries(macrosByDay28)) {
    if (dateISO >= from7ISO) { macrosByDay7[dateISO] = macros; }
  }

  const dayKeys7   = Object.keys(macrosByDay7);
  const windowDays = dayKeys7.length;
  if (windowDays === 0) { return null; }

  // Build kcalByDay for the controller from the full 28-day set.
  /** @type {Record<string, number>} */
  const kcalByDay28 = {};
  for (const [dateISO, macros] of Object.entries(macrosByDay28)) { kcalByDay28[dateISO] = macros.kcal; }

  const calMode = deriveMode(goals);
  const { adjustedGoalKcal, adjustment, gated, debug: controllerDebug } = computeKcalAdjustment(
    kcalByDay28, todayISO, goals.kcal, calMode,
  );
  const calIdeal = adjustedGoalKcal;

  // prevSum uses only the 7-day window so macro directional allowances are unchanged.
  const todayMacros = macrosByDay28[todayISO] ?? $.zeroMacros();
  const prevSum     = $.zeroMacros();
  for (const dateISO of dayKeys7) {
    if (dateISO !== todayISO) { $.addScaledMacros(prevSum, macrosByDay7[dateISO], 1); }
  }

  const baseGramGoals = derivedGrams(goals);
  const todayLogged   = todayISO in macrosByDay7;
  const effectiveDays = todayLogged ? windowDays : windowDays + 1;

  // Per-macro adaptive controllers. Each macro's gram history is converted to
  // kcal so the controller's kcal-calibrated deadbands and clamp apply correctly;
  // results are converted back to grams. Protein always uses 'gain' mode to
  // resist chronic under-eating regardless of the calorie goal direction.
  // Carbs and fat follow the calorie mode.
  /** @type {Record<string, number>} */
  const protKcalByDay28  = {};
  /** @type {Record<string, number>} */
  const carbsKcalByDay28 = {};
  /** @type {Record<string, number>} */
  const fatKcalByDay28   = {};
  for (const [dateISO, macros] of Object.entries(macrosByDay28)) {
    protKcalByDay28[dateISO]  = macros.prot  * KCAL_PER_G_PROTEIN;
    carbsKcalByDay28[dateISO] = macros.carbs * KCAL_PER_G_CARBS;
    fatKcalByDay28[dateISO]   = macros.fats  * KCAL_PER_G_FAT;
  }
  const { adjustedGoalKcal: adjProtKcal,  debug: protCtrlDbg  } =
    computeKcalAdjustment(protKcalByDay28,  todayISO, baseGramGoals.protG  * KCAL_PER_G_PROTEIN, 'gain',   MACRO_BASE_DEADBAND_KCAL, MACRO_PERSISTENT_DEADBAND_KCAL);
  const { adjustedGoalKcal: adjCarbsKcal, debug: carbsCtrlDbg } =
    computeKcalAdjustment(carbsKcalByDay28, todayISO, baseGramGoals.carbsG * KCAL_PER_G_CARBS,   calMode,  MACRO_BASE_DEADBAND_KCAL, MACRO_PERSISTENT_DEADBAND_KCAL);
  const { adjustedGoalKcal: adjFatKcal,   debug: fatCtrlDbg   } =
    computeKcalAdjustment(fatKcalByDay28,   todayISO, baseGramGoals.fatG   * KCAL_PER_G_FAT,     calMode,  MACRO_BASE_DEADBAND_KCAL, MACRO_PERSISTENT_DEADBAND_KCAL);
  const adjProtG  = adjProtKcal  / KCAL_PER_G_PROTEIN;
  const adjCarbsG = adjCarbsKcal / KCAL_PER_G_CARBS;
  const adjFatG   = adjFatKcal   / KCAL_PER_G_FAT;

  // When the completeness gate fired, history is too sparse to trust macro signals
  // either — reconcile against a zeroed prevSum so no past eating drifts the ideals,
  // but still run the rounding/coherence step so 4p+4c+9f ≈ kcalIdeal.
  const { protIdeal, carbIdeal, fatIdeal } = reconcileMacroIdeals({
    kcalIdeal: calIdeal,
    goals,
    derivedG: gated ? baseGramGoals : { protG: adjProtG, carbsG: adjCarbsG, fatG: adjFatG },
    prevSum: gated ? $.zeroMacros() : prevSum,
    effectiveDays: gated ? 1 : effectiveDays,
  });

  /** @param {number} consumed @param {number | null} goalVal @param {number} ideal */
  const kcalStatus  = (consumed, goalVal, ideal) => computeKcalDayStatus(consumed, goalVal, ideal, adjustment);
  /** @param {number} consumed @param {number | null} goalVal @param {number} ideal */
  const macroStatus = (consumed, goalVal, ideal) => computeMacroDayStatus(consumed, goalVal, ideal, adjustment);

  return {
    windowDays,
    effectiveDays,
    calories: { target: goals.kcal,          status: kcalStatus(todayMacros.kcal,   goals.kcal,          calIdeal),  idealToday: calIdeal,  prevSum: prevSum.kcal,  adjustment },
    protein:  { target: baseGramGoals.protG,  status: macroStatus(todayMacros.prot,  baseGramGoals.protG,  protIdeal), idealToday: protIdeal, prevSum: prevSum.prot,  adjustment, gramAdj: gated ? 0 : adjProtG  - baseGramGoals.protG  },
    carbs:    { target: baseGramGoals.carbsG, status: macroStatus(todayMacros.carbs, baseGramGoals.carbsG, carbIdeal), idealToday: carbIdeal, prevSum: prevSum.carbs, adjustment, gramAdj: gated ? 0 : adjCarbsG - baseGramGoals.carbsG },
    fat:      { target: baseGramGoals.fatG,   status: macroStatus(todayMacros.fats,  baseGramGoals.fatG,   fatIdeal),  idealToday: fatIdeal,  prevSum: prevSum.fats,  adjustment, gramAdj: gated ? 0 : adjFatG   - baseGramGoals.fatG   },
    controllerDebug: {
      ...controllerDebug, gated: !!gated, mode: calMode,
      macroControllers: {
        protein: { ...protCtrlDbg,  adjGoalG: adjProtG  },
        carbs:   { ...carbsCtrlDbg, adjGoalG: adjCarbsG },
        fat:     { ...fatCtrlDbg,   adjGoalG: adjFatG   },
      },
    },
  };
}

/**
 * Return a multi-line string explaining why a macro's idealToday is what it is.
 * Intended for developer/debug use via a long-press gesture.
 *
 * @param {'calories'|'protein'|'carbs'|'fat'} macroKey
 * @param {WindowVM} wvm
 * @param {GoalRecord} goals
 * @param {string} dateISO
 * @returns {string}
 */
export function explainMacroGoal(macroKey, wvm, goals, dateISO) {
  const macroWin   = wvm[macroKey];
  const dbg        = /** @type {any} */ (wvm.controllerDebug);
  const isCalories = macroKey === 'calories';

  const r   = (/** @type {number} */ n, dp = 1) => n.toFixed(dp);
  const pct = (/** @type {number} */ n) => `${r(n * 100, 1)}%`;

  const lines = [
    `── Macro goal story: ${macroKey.toUpperCase()} on ${dateISO} ──`,
    `Goal record:  kcal=${goals.kcal}  prot=${goals.protPct}%  carbs=${goals.carbsPct}%  fat=${goals.fatPct}%  mode=${dbg.mode}`,
    ``,
    `─ Step 1: Calorie controller ─`,
  ];

  if (dbg.gated) {
    lines.push(`  GATED (too few recent days — need ${MIN_LOGGED_7}, have ${dbg.loggedDays7})`);
    lines.push(`  → kcal ideal = ${goals.kcal} kcal (base goal, no adjustment)`);
  } else {
    lines.push(`  Logged days — 7d: ${dbg.loggedDays7}  14d: ${dbg.loggedDays14}  28d: ${dbg.loggedDays28}`);
    lines.push(`  Confidence (loggedDays14=${dbg.loggedDays14}): ${r(dbg.confidence, 4)}`);
    lines.push(`  Short error (7d mean):  ${r(dbg.shortErr, 1)} kcal`);
    lines.push(`  Long error  (28d EWMA): ${r(dbg.longErr, 1)} kcal  (longConfidence=${r(dbg.longConfidence, 4)})`);
    lines.push(`  Effective error (blended): ${r(dbg.effectiveError, 1)} kcal`);
    lines.push(`  Persistence — raw: ${r(dbg.rawPersistence, 3)}  effective: ${r(dbg.effectivePersistence, 3)}  intensity: ${r(dbg.persistenceIntensity, 4)}`);
    lines.push(`  Deadband: ${r(dbg.deadband, 1)} kcal`);

    if (dbg.deadbandApplied) {
      lines.push(`  |effectiveError| < deadband → NO adjustment`);
      lines.push(`  → kcal ideal = ${goals.kcal} kcal (base goal)`);
    } else {
      lines.push(`  Gain: ${r(dbg.gain, 4)}  unclamped adj: ${r(dbg.unclampedAdj, 1)}  confidence-scaled: ${r(dbg.confidenceScaledAdj, 1)}`);
      if (dbg.clampApplied) {
        lines.push(`  Clamp applied (±${IDEAL_CLAMP * 100}% of goal = ±${r(IDEAL_CLAMP * goals.kcal, 0)} kcal) → clamped adj: ${r(dbg.clampedAdj, 1)}`);
      }
      lines.push(`  → kcal ideal = ${goals.kcal} + ${r(dbg.clampedAdj, 1)} = ${wvm.calories.idealToday} kcal`);
    }
  }

  if (!isCalories) {
    const macroCtrl   = /** @type {any} */ (dbg.macroControllers?.[macroKey]);
    const baseGoalG   = macroWin.target ?? 0;
    const adjGoalG    = macroCtrl?.adjGoalG ?? baseGoalG;
    const reconcGoalG = dbg.gated ? baseGoalG : adjGoalG;
    const kpg         = macroKey === 'fat' ? KCAL_PER_G_FAT : KCAL_PER_G_PROTEIN;

    lines.push(``);
    lines.push(`─ Step 1.5: Per-macro controller (${macroKey}) ─`);
    if (!macroCtrl || dbg.gated) {
      lines.push(`  Skipped — kcal controller gated; base goal used: ${baseGoalG}g`);
    } else if (macroCtrl.gate) {
      lines.push(`  GATED (${macroCtrl.gate}) — base goal used: ${baseGoalG}g`);
      lines.push(`  loggedDays7=${macroCtrl.loggedDays7}  loggedDays14=${macroCtrl.loggedDays14}`);
    } else {
      const modeStr = macroKey === 'protein' ? "'gain' (always, to protect protein)" : `'${dbg.mode}'`;
      lines.push(`  Mode: ${modeStr}`);
      lines.push(`  Logged days — 7d: ${macroCtrl.loggedDays7}  14d: ${macroCtrl.loggedDays14}  28d: ${macroCtrl.loggedDays28}`);
      lines.push(`  Confidence: ${r(macroCtrl.confidence, 4)}`);
      lines.push(`  Short error (7d): ${r(macroCtrl.shortErr / kpg, 2)}g  Long error (28d): ${r(macroCtrl.longErr / kpg, 2)}g  Effective: ${r(macroCtrl.effectiveError / kpg, 2)}g`);
      lines.push(`  Persistence intensity: ${r(macroCtrl.persistenceIntensity, 4)}  Deadband: ${r(macroCtrl.deadband / kpg, 2)}g`);
      if (macroCtrl.deadbandApplied) {
        lines.push(`  |effectiveError| < deadband → NO adjustment`);
      } else {
        lines.push(`  Gain: ${r(macroCtrl.gain, 4)}  adj: ${r(macroCtrl.clampedAdj / kpg, 2)}g${macroCtrl.clampApplied ? ' (clamped)' : ''}`);
      }
      lines.push(`  → adjusted gram goal: ${r(adjGoalG, 1)}g  (base: ${baseGoalG}g)`);
    }

    const prevDays     = wvm.effectiveDays - 1;
    const prevAvg      = prevDays > 0 ? macroWin.prevSum / prevDays : 0;
    // Adherence ratio uses base gram goal (matching the reconciler).
    const ratio        = baseGoalG > 0 && prevDays > 0 ? prevAvg / baseGoalG : 1;
    const allow        = directionalAllowance(macroKey === 'fat' ? 'fat' : macroKey, ratio);
    const desiredPct   = macroKey === 'protein' ? goals.protPct : macroKey === 'carbs' ? goals.carbsPct : goals.fatPct;
    // Desired share is derived from all three adjusted gram goals (matching the reconciler).
    const allCtrl      = /** @type {any} */ (dbg.macroControllers ?? {});
    const adjTKcal     =
      (allCtrl.protein?.adjGoalG ?? goals.kcal * goals.protPct  / 100 / KCAL_PER_G_PROTEIN) * KCAL_PER_G_PROTEIN +
      (allCtrl.carbs?.adjGoalG   ?? goals.kcal * goals.carbsPct / 100 / KCAL_PER_G_CARBS)   * KCAL_PER_G_CARBS   +
      (allCtrl.fat?.adjGoalG     ?? goals.kcal * goals.fatPct   / 100 / KCAL_PER_G_FAT)     * KCAL_PER_G_FAT;
    const desiredShare = adjTKcal > 0 ? (reconcGoalG * kpg) / adjTKcal : desiredPct / 100;
    const rawG         = wvm.effectiveDays * reconcGoalG - macroWin.prevSum;
    const rawShare     = (kpg * rawG) / wvm.calories.idealToday;

    lines.push(``);
    lines.push(`─ Step 2: Macro reconciler (${macroKey}) ─`);
    lines.push(`  effectiveDays: ${wvm.effectiveDays}  (${prevDays} prior logged + ${wvm.effectiveDays - prevDays} today)`);
    lines.push(`  effective gram goal: ${r(reconcGoalG, 1)}g  (base: ${baseGoalG}g = ${desiredPct}% of ${goals.kcal} kcal)`);
    lines.push(`  prevSum (prior ${prevDays}d): ${r(macroWin.prevSum, 1)}g  → prevAvg: ${r(prevAvg, 1)}g/day`);
    lines.push(`  adherence ratio (vs base): ${r(prevAvg, 1)} / ${r(baseGoalG, 1)} = ${r(ratio, 3)}`);
    lines.push(`  directional allowance: down=${pct(allow.down)}  up=${pct(allow.up)}`);
    lines.push(`  rawG: ${wvm.effectiveDays}×${r(reconcGoalG, 1)} − ${r(macroWin.prevSum, 1)} = ${r(rawG, 1)}g  → rawShare: ${pct(rawShare)}`);
    lines.push(`  share bounds: [${pct(desiredShare * (1 - allow.down))}, ${pct(desiredShare * (1 + allow.up))}]  (desired: ${pct(desiredShare)})`);
    lines.push(`  → ideal today: ${macroWin.idealToday}g  (after simplex projection + rounding)`);
  }

  lines.push(``);
  lines.push(`─ Result ─`);
  lines.push(`  target (base goal): ${macroWin.target}${isCalories ? ' kcal' : 'g'}`);
  lines.push(`  idealToday:         ${macroWin.idealToday}${isCalories ? ' kcal' : 'g'}`);
  lines.push(`  prevSum (7d prior):  ${r(macroWin.prevSum, 1)}${isCalories ? ' kcal' : 'g'}`);
  lines.push(`  status: ${macroWin.status}`);

  return lines.join('\n');
}

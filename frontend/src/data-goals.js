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
export const HALF_LIFE_DAYS = 7;

/** Clamp factor for idealToday: ±15% of the daily target. */
const IDEAL_CLAMP = 0.15;

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
const MIN_LOGGED_7 = 4;

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
 * }} WindowVM
 *
 * @typedef {{
 *   target:     number | null,
 *   status:     'none'|'low'|'ok'|'warn'|'bad',
 *   idealToday: number,
 *   prevSum:    number,
 *   adjustment: number,
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
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
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
  return days.reduce((s, e) => s + e, 0) / days.length;
}

/**
 * Exponentially-weighted average error over a calendar window.
 * Each entry is weighted by expWeight(ageDays, HALF_LIFE_DAYS).
 * @param {Array<{ageDays: number, error: number}>} days — all logged days in range
 * @param {number} windowDays — calendar-day cutoff (entries with ageDays >= windowDays are ignored)
 * @param {number} halfLife
 */
export function weightedAverageError(days, windowDays, halfLife) {
  const subset = days.filter(d => d.ageDays < windowDays);
  if (subset.length === 0) { return 0; }
  let sumW = 0, sumWE = 0;
  for (const d of subset) {
    const w = expWeight(d.ageDays, halfLife);
    sumW  += w;
    sumWE += w * d.error;
  }
  return sumW > 0 ? sumWE / sumW : 0;
}

/**
 * Blend short and long errors with dynamic weighting based on long-window
 * data confidence. Long signal weight scales from 0 (no long data) to 50%
 * (full data). When signs disagree and long confidence is meaningful (> 0.5),
 * the long signal gets 75% weight to suppress transient spikes.
 * @param {number} shortErr
 * @param {number} longErr
 * @param {number} [longConfidence] 0-1; defaults to 1 (full weight, backward-compatible)
 */
export function combineErrors(shortErr, longErr, longConfidence = 1) {
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
  const window = days.filter(d => d.ageDays < PERSISTENCE_WINDOW_DAYS);
  if (window.length === 0) { return 0; }
  return window.filter(d => d.error > 0).length / window.length;
}

/**
 * Interpolate between base and persistent deadband using persistence intensity.
 * @param {number} baseGoalKcal
 * @param {number} intensity — 0 (no persistence) to 1 (fully persistent)
 */
export function adaptiveDeadband(baseGoalKcal, intensity) {
  const base       = Math.max(BASE_DEADBAND_KCAL, BASE_DEADBAND_PCT * baseGoalKcal);
  const persistent = Math.max(PERSISTENT_DEADBAND_KCAL, PERSISTENT_DEADBAND_PCT * baseGoalKcal);
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
export function computeKcalAdjustment(kcalByDay, dateISO, baseGoalKcal, mode = 'maintenance') {
  if (baseGoalKcal <= 0) {
    return { adjustedGoalKcal: baseGoalKcal, adjustment: 0, debug: { gate: 'zero-goal' } };
  }

  const today = $.localDate(dateISO);

  // Build logged-day array (newest first, including dateISO if logged).
  /** @type {Array<{ageDays: number, error: number}>} */
  const loggedDays = [];
  for (let i = 0; i < LONG_WINDOW; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const iso = $.toISO(d);
    if (iso in kcalByDay) {
      loggedDays.push({ ageDays: i, error: kcalByDay[iso] - baseGoalKcal });
    }
  }

  const loggedDays7  = loggedDays.filter(d => d.ageDays < SHORT_WINDOW).length;
  const loggedDays14 = loggedDays.filter(d => d.ageDays < PERSISTENCE_WINDOW_DAYS).length;
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

  const shortErr = shortError(loggedDays.filter(d => d.ageDays < SHORT_WINDOW).map(d => d.error));
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

  const deadband = adaptiveDeadband(baseGoalKcal, persistenceIntensity);

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
export function computeDayStatus(consumed, goal, idealToday, adjustment) {
  if (goal === null) { return 'none'; }
  if (goal === 0) { return consumed === 0 ? 'ok' : 'bad'; }

  // Only enter ceiling/floor mode when the adjustment is large enough to be
  // meaningful. Small confidence-ramped adjustments (below the base deadband)
  // should not suppress the warn zone — the user's eating is still within normal
  // noise. This threshold matches isGoalClamped so both agree on "is it clamped".
  const adjDeadband = Math.max(BASE_DEADBAND_KCAL, BASE_DEADBAND_PCT * goal);
  const effectiveAdj = Math.abs(adjustment) >= adjDeadband ? adjustment : 0;

  if (effectiveAdj < 0) {
    // Clamped below: idealToday is a ceiling — green only extends downward.
    if (idealToday <= 0) { return consumed === 0 ? 'ok' : 'bad'; }
    const ratio = consumed / idealToday;
    if (ratio < 1 - 2 * SAFETY_NET_PCT) { return 'low'; }
    if (ratio <= 1)                      { return 'ok'; }
    return 'bad';
  }

  if (effectiveAdj > 0) {
    // Clamped above: idealToday is a floor — green only extends upward.
    if (idealToday <= 0) { return consumed === 0 ? 'ok' : 'bad'; }
    const ratio = consumed / idealToday;
    if (ratio < 1)                                                           { return 'low'; }
    if (ratio <= 1 + 2 * SAFETY_NET_PCT)                                     { return 'ok'; }
    if (ratio <= 1 + 2 * SAFETY_NET_PCT + (STATUS_WARN_PCT - STATUS_OK_PCT)) { return 'warn'; }
    return 'bad';
  }

  // Unclamped: compare consumed vs idealToday with standard bands.
  if (idealToday <= 0) { return consumed === 0 ? 'ok' : 'bad'; }
  const ratio = consumed / idealToday;
  if (ratio < 1 - STATUS_OK_PCT)    { return 'low'; }
  if (ratio <= 1 + STATUS_OK_PCT)   { return 'ok'; }
  if (ratio <= 1 + STATUS_WARN_PCT) { return 'warn'; }
  return 'bad';
}

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
  if (goalKcal <= 0) { return computeDayStatus(consumed, goalKcal, goalKcal, 0); }
  const { adjustedGoalKcal, adjustment } = computeKcalAdjustment(kcalByDay, dateISO, goalKcal, 'maintenance');
  return computeDayStatus(consumed, goalKcal, adjustedGoalKcal, adjustment);
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
 * @returns {MacroVisuals}
 */
export function macroVisuals(consumed, macroWin, _effectiveDays, fallbackGoal = null) {
  /** @type {'none'|'low'|'ok'|'warn'|'bad'} */
  let status;
  let barTarget;
  let skipWarnZone = false;

  if (macroWin) {
    const adj = macroWin.adjustment ?? 0;
    status       = computeDayStatus(consumed, macroWin.target, macroWin.idealToday, adj);
    barTarget    = macroWin.idealToday;
    // Only suppress the warn zone when the adjustment is large enough to be
    // meaningful (same threshold as computeDayStatus uses for ceiling mode).
    const adjDeadband = Math.max(BASE_DEADBAND_KCAL, BASE_DEADBAND_PCT * (macroWin.target ?? 0));
    skipWarnZone = adj < -adjDeadband; // clamped below → ceiling → no warn zone above ideal
  } else if (fallbackGoal !== null) {
    status    = computeDayStatus(consumed, fallbackGoal, fallbackGoal, 0);
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
  const adj      = macroWin.adjustment ?? 0;
  const deadband = Math.max(BASE_DEADBAND_KCAL, BASE_DEADBAND_PCT * (macroWin.target ?? 0));
  if (macroWin.target === null || effectiveDays < MIN_LOGGED_7) { return false; }
  if (adj < -deadband) { return 'below'; }
  if (adj >  deadband) { return 'above'; }
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
  const adj      = macroWin.adjustment ?? 0;
  const deadband = Math.max(BASE_DEADBAND_KCAL, BASE_DEADBAND_PCT * macroWin.target);
  if (Math.abs(adj) <= deadband) { return 0; }
  if (effectiveDays < MIN_LOGGED_7) { return 1; }
  // Solve for n: |adj| × 0.5^(n/HALF_LIFE) = deadband → n = HALF_LIFE × log2(|adj|/deadband)
  return Math.max(1, Math.ceil(HALF_LIFE_DAYS * Math.log2(Math.abs(adj) / deadband)));
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
  const d28 = $.localDate(todayISO);
  d28.setDate(d28.getDate() - (LONG_WINDOW - 1));
  const from28ISO = $.toISO(d28);

  const meals = await Meals.listRange(from28ISO, todayISO);

  /** @type {Record<string, import('./db.js').Macros>} */
  const byDay28 = {};
  for (const m of meals) {
    if (!byDay28[m.date]) { byDay28[m.date] = $.zeroMacros(); }
    $.addScaledMacros(byDay28[m.date], m.foodSnapshot, m.multiplier);
  }

  // The 7-day window drives windowDays, effectiveDays, prevSum, and the UI display.
  const d7 = $.localDate(todayISO);
  d7.setDate(d7.getDate() - (SHORT_WINDOW - 1));
  const from7ISO = $.toISO(d7);

  /** @type {Record<string, import('./db.js').Macros>} */
  const byDay7 = {};
  for (const [k, v] of Object.entries(byDay28)) {
    if (k >= from7ISO) { byDay7[k] = v; }
  }

  const dayKeys7   = Object.keys(byDay7);
  const windowDays = dayKeys7.length;
  if (windowDays === 0) { return null; }

  // Build kcalByDay for the controller from the full 28-day set.
  /** @type {Record<string, number>} */
  const kcalByDay28 = {};
  for (const [k, v] of Object.entries(byDay28)) { kcalByDay28[k] = v.kcal; }

  const { adjustedGoalKcal, adjustment, gated } = computeKcalAdjustment(
    kcalByDay28, todayISO, goals.kcal, deriveMode(goals),
  );
  const calIdeal = adjustedGoalKcal;

  // prevSum uses only the 7-day window so macro directional allowances are unchanged.
  const todayMacros = byDay28[todayISO] ?? $.zeroMacros();
  const prevSum     = $.zeroMacros();
  for (const k of dayKeys7) {
    if (k !== todayISO) { $.addScaledMacros(prevSum, byDay7[k], 1); }
  }

  const g = derivedGrams(goals);
  const todayLogged   = todayISO in byDay7;
  const effectiveDays = todayLogged ? windowDays : windowDays + 1;

  // When the completeness gate fired, history is too sparse to trust macro signals
  // either — reconcile against a zeroed prevSum so no past eating drifts the ideals,
  // but still run the rounding/coherence step so 4p+4c+9f ≈ kcalIdeal.
  const { protIdeal, carbIdeal, fatIdeal } = reconcileMacroIdeals({
    kcalIdeal: calIdeal,
    goals,
    derivedG: g,
    prevSum: gated ? $.zeroMacros() : prevSum,
    effectiveDays: gated ? 1 : effectiveDays,
  });

  /** @param {number} consumed @param {number | null} goalVal @param {number} ideal */
  const statusFn = (consumed, goalVal, ideal) =>
    computeDayStatus(consumed, goalVal, ideal, adjustment);

  return {
    windowDays,
    effectiveDays,
    calories: { target: goals.kcal, status: statusFn(todayMacros.kcal,  goals.kcal, calIdeal),  idealToday: calIdeal,  prevSum: prevSum.kcal,  adjustment },
    protein:  { target: g.protG,    status: statusFn(todayMacros.prot,  g.protG,    protIdeal), idealToday: protIdeal, prevSum: prevSum.prot,  adjustment },
    carbs:    { target: g.carbsG,   status: statusFn(todayMacros.carbs, g.carbsG,   carbIdeal), idealToday: carbIdeal, prevSum: prevSum.carbs, adjustment },
    fat:      { target: g.fatG,     status: statusFn(todayMacros.fats,  g.fatG,     fatIdeal),  idealToday: fatIdeal,  prevSum: prevSum.fats,  adjustment },
  };
}

import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../db.js', () => ({
  get: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  getAll: vi.fn(),
}));

vi.mock('../utils.js', () => ({
  now: vi.fn(() => 1000),
  toISO: vi.fn((d) => d.toISOString().slice(0, 10)),
  isoToday: vi.fn(() => '2024-02-07'),
  randomUUID: vi.fn(() => 'test-uuid'),
  localDate: (/** @type {string} */ iso) => new Date(`${iso}T00:00:00`),
  zeroMacros: () => ({ kcal: 0, prot: 0, carbs: 0, fats: 0 }),
  addScaledMacros: (
    /** @type {{ kcal: number, prot: number, carbs: number, fats: number }} */ acc,
    /** @type {{ kcal: number, prot: number, carbs: number, fats: number }} */ macros,
    /** @type {number} */ multiplier,
  ) => {
    acc.kcal  += macros.kcal  * multiplier;
    acc.prot  += macros.prot  * multiplier;
    acc.carbs += macros.carbs * multiplier;
    acc.fats  += macros.fats  * multiplier;
  },
}));

vi.mock('../data-meals.js', () => ({
  Meals: {
    listRange: vi.fn(),
  },
}));

import {
  adaptiveDeadband,
  adaptiveGain,
  barSegments,
  combineErrors,
  computeDayStatus,
  computeKcalAdjustment,
  computeWindowVM,
  deleteRecord,
  derivedGrams,
  expWeight,
  getActive,
  goalForDate,
  idealForDay,
  isGoalClamped,
  list,
  macroVisuals,
  overPersistence,
  recoveryDays,
  remove,
  save,
  SHORT_WINDOW,
  LONG_WINDOW,
  smoothstep,
  statusForDay,
  updateEffectiveFrom,
  weightedAverageError,
} from '../data-goals.js';
import { Meals } from '../data-meals.js';
import * as db from '../db.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.get).mockResolvedValue(undefined);
  vi.mocked(db.getAll).mockResolvedValue([]);
  vi.mocked(db.put).mockResolvedValue('goal:test');
  vi.mocked(db.del).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------
describe('expWeight', () => {
  test('age 0 → weight 1.0', () => {
    expect(expWeight(0, 7)).toBeCloseTo(1.0);
  });
  test('age = halfLife → weight 0.5', () => {
    expect(expWeight(7, 7)).toBeCloseTo(0.5);
  });
  test('age = 2×halfLife → weight 0.25', () => {
    expect(expWeight(14, 7)).toBeCloseTo(0.25);
  });
});

describe('smoothstep', () => {
  test('at edge0 → 0', () => {
    expect(smoothstep(0.5, 0.9, 0.5)).toBeCloseTo(0);
  });
  test('at edge1 → 1', () => {
    expect(smoothstep(0.5, 0.9, 0.9)).toBeCloseTo(1);
  });
  test('below edge0 → 0', () => {
    expect(smoothstep(0.5, 0.9, 0.3)).toBeCloseTo(0);
  });
  test('above edge1 → 1', () => {
    expect(smoothstep(0.5, 0.9, 1.0)).toBeCloseTo(1);
  });
  test('midpoint ≈ 0.5', () => {
    expect(smoothstep(0.5, 0.9, 0.7)).toBeCloseTo(0.5, 1);
  });
});

describe('weightedAverageError', () => {
  test('uniform errors return that error regardless of window', () => {
    const days = [0, 1, 2, 3, 4, 5, 6].map(ageDays => ({ ageDays, error: 100 }));
    expect(weightedAverageError(days, SHORT_WINDOW, 7)).toBeCloseTo(100);
  });
  test('empty → 0', () => {
    expect(weightedAverageError([], 7, 7)).toBe(0);
  });
  test('older days get less weight: recent +200, old -200 → slightly positive result', () => {
    const days = [
      { ageDays: 0, error: 200 },
      { ageDays: 14, error: -200 },
    ];
    expect(weightedAverageError(days, LONG_WINDOW, 7)).toBeGreaterThan(0);
  });
});

describe('overPersistence', () => {
  test('0/14 logged days over goal → 0', () => {
    const days = Array.from({ length: 14 }, (_, i) => ({ ageDays: i, error: -50 }));
    expect(overPersistence(days, 2000)).toBeCloseTo(0);
  });
  test('14/14 days over goal → 1.0', () => {
    const days = Array.from({ length: 14 }, (_, i) => ({ ageDays: i, error: 50 }));
    expect(overPersistence(days, 2000)).toBeCloseTo(1.0);
  });
  test('7/14 days over goal → 0.5', () => {
    const days = [
      ...Array.from({ length: 7 }, (_, i) => ({ ageDays: i, error: 50 })),
      ...Array.from({ length: 7 }, (_, i) => ({ ageDays: i + 7, error: -50 })),
    ];
    expect(overPersistence(days, 2000)).toBeCloseTo(0.5);
  });
});

describe('adaptiveDeadband', () => {
  test('intensity=0 on 2000 goal → 50 kcal (base deadband)', () => {
    // max(50, 2.5%×2000=50) = 50
    expect(adaptiveDeadband(2000, 0)).toBeCloseTo(50);
  });
  test('intensity=1 on 2000 goal → 25 kcal (persistent deadband)', () => {
    // max(25, 1.25%×2000=25) = 25
    expect(adaptiveDeadband(2000, 1)).toBeCloseTo(25);
  });
  test('intensity=0.5 → lerp between 50 and 25', () => {
    expect(adaptiveDeadband(2000, 0.5)).toBeCloseTo(37.5);
  });
});

describe('adaptiveGain', () => {
  test('loss + surplus + intensity=0 → 0.70', () => {
    expect(adaptiveGain('loss', 100, 0)).toBeCloseTo(0.70);
  });
  test('loss + surplus + intensity=1 → 2.00', () => {
    expect(adaptiveGain('loss', 100, 1)).toBeCloseTo(2.00);
  });
  test('loss + deficit → always 0.25 regardless of intensity', () => {
    expect(adaptiveGain('loss', -100, 0)).toBeCloseTo(0.25);
    expect(adaptiveGain('loss', -100, 1)).toBeCloseTo(0.25);
  });
  test('gain + deficit + intensity=0 → 0.70', () => {
    expect(adaptiveGain('gain', -100, 0)).toBeCloseTo(0.70);
  });
  test('gain + deficit + intensity=1 → 2.00', () => {
    expect(adaptiveGain('gain', -100, 1)).toBeCloseTo(2.00);
  });
  test('gain + surplus → always 0.25', () => {
    expect(adaptiveGain('gain', 100, 0)).toBeCloseTo(0.25);
    expect(adaptiveGain('gain', 100, 1)).toBeCloseTo(0.25);
  });
  test('maintenance + intensity=0 → 0.60', () => {
    expect(adaptiveGain('maintenance', 100, 0)).toBeCloseTo(0.60);
    expect(adaptiveGain('maintenance', -100, 0)).toBeCloseTo(0.60);
  });
  test('maintenance + intensity=1 → 1.50', () => {
    expect(adaptiveGain('maintenance', 100, 1)).toBeCloseTo(1.50);
  });
});

describe('combineErrors', () => {
  test('same sign → equal blend', () => {
    expect(combineErrors(100, 200)).toBeCloseTo(150);
  });
  test('sign disagreement → trust long signal (75% weight)', () => {
    // short=-100, long=+200 → 0.25×(-100) + 0.75×200 = -25+150 = 125
    expect(combineErrors(-100, 200)).toBeCloseTo(125);
  });
  test('either is 0 → no sign disagreement', () => {
    expect(combineErrors(0, 200)).toBeCloseTo(100);
    expect(combineErrors(100, 0)).toBeCloseTo(50);
  });
});

// ---------------------------------------------------------------------------
// computeKcalAdjustment
// ---------------------------------------------------------------------------
describe('computeKcalAdjustment', () => {
  /** Build kcalByDay from a pattern: [oldest…newest] of kcal per day.
   * @param {number[]} kcalPerDay @param {string} [endISO] */
  function buildDays(kcalPerDay, endISO = '2024-02-07') {
    /** @type {Record<string, number>} */
    const map = {};
    const end = new Date(`${endISO}T00:00:00`);
    for (let i = kcalPerDay.length - 1; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(end.getDate() - (kcalPerDay.length - 1 - i));
      map[d.toISOString().slice(0, 10)] = kcalPerDay[i];
    }
    return map;
  }

  test('completeness gate fires with fewer than MIN_LOGGED_7 logged in 7 days', () => {
    // Only 3 logged days in last 7 (< 4 required)
    const map = buildDays([2500, 2500, 2500]);
    const result = computeKcalAdjustment(map, '2024-02-07', 2000, 'maintenance');
    expect(result.adjustment).toBe(0);
    expect(result.adjustedGoalKcal).toBe(2000);
  });

  test('completeness gate fires with fewer than MIN_LOGGED_28 logged in 28 days', () => {
    // 7 days logged in the 7-day window (>= 4) but only 7 total (< 14 required)
    const map = buildDays([2500, 2500, 2500, 2500, 2500, 2500, 2500]);
    const result = computeKcalAdjustment(map, '2024-02-07', 2000, 'maintenance');
    expect(result.adjustment).toBe(0);
  });

  test('deadband: small effectiveError < deadband → adjustment 0', () => {
    // 28 days at goal + 20 kcal — well inside 50 kcal base deadband
    const map = buildDays(Array(28).fill(2020));
    const result = computeKcalAdjustment(map, '2024-02-07', 2000, 'maintenance');
    expect(result.adjustment).toBe(0);
  });

  test('chronic +100/day for 28 days → negative adjustment (lower goal)', () => {
    const map = buildDays(Array(28).fill(2100));
    const result = computeKcalAdjustment(map, '2024-02-07', 2000, 'loss');
    expect(result.adjustment).toBeLessThan(0);
  });

  test('adjustment is clamped to ±15% of base goal', () => {
    // Extreme over-eating: 5000 kcal/day for 28 days on 2000 goal
    const map = buildDays(Array(28).fill(5000));
    const result = computeKcalAdjustment(map, '2024-02-07', 2000, 'loss');
    expect(result.adjustment).toBeGreaterThanOrEqual(-300); // -15% of 2000
    expect(result.adjustment).toBeLessThanOrEqual(0);
    expect(result.adjustedGoalKcal).toBe(1700);
  });

  test('sign disagreement: short<0, long>0 → damped blend, no reversal', () => {
    // Party day 8 days ago (+2000 spike), followed by 7 compensating days at -200.
    // Long signal still sees the party; short signal sees the compensation.
    // Result: no aggressive upward reversal.
    const kcalPerDay = [
      ...Array(14).fill(2000),  // 14 normal days
      4000,                      // party day (now 8 days ago from end of array)
      ...Array(7).fill(1800),   // 7 compensating days (under goal)
    ];
    const map = buildDays(kcalPerDay);
    const result = computeKcalAdjustment(map, '2024-02-07', 2000, 'maintenance');
    // Adjustment should not be strongly positive (no upward reversal spike)
    expect(result.adjustment).toBeLessThan(200);
  });

  test('mode asymmetry: same surplus → loss mode yields larger magnitude than gain mode', () => {
    const map = buildDays(Array(28).fill(2200)); // persistent +200/day
    const lossResult = computeKcalAdjustment(map, '2024-02-07', 2000, 'loss');
    const gainResult = computeKcalAdjustment(map, '2024-02-07', 2000, 'gain');
    // Loss mode penalises surplus more aggressively
    expect(Math.abs(lossResult.adjustment)).toBeGreaterThan(Math.abs(gainResult.adjustment));
  });

  test('noisy alternating ±500/day: long error near zero, small adjustment', () => {
    const kcalPerDay = Array.from({ length: 28 }, (_, i) => i % 2 === 0 ? 2500 : 1500);
    const map = buildDays(kcalPerDay);
    const result = computeKcalAdjustment(map, '2024-02-07', 2000, 'maintenance');
    // Short error roughly 0, long error roughly 0 → deadband applies → 0
    expect(Math.abs(result.adjustment)).toBeLessThan(100);
  });
});

// ---------------------------------------------------------------------------
// computeDayStatus — adjustment-driven branches
// ---------------------------------------------------------------------------
describe('computeDayStatus', () => {
  test('returns none when goal is null', () => {
    expect(computeDayStatus(0,   null, 0, 0)).toBe('none');
    expect(computeDayStatus(500, null, 0, 0)).toBe('none');
  });

  test('returns ok/bad when goal is 0', () => {
    expect(computeDayStatus(0, 0, 0, 0)).toBe('ok');
    expect(computeDayStatus(1, 0, 0, 0)).toBe('bad');
  });

  // Unclamped (adjustment === 0): ±5%/10% bands around idealToday

  test('unclamped: ok when consumed is within ±5% of idealToday', () => {
    expect(computeDayStatus(95,  100, 100, 0)).toBe('ok');  // ratio 0.95
    expect(computeDayStatus(100, 100, 100, 0)).toBe('ok');  // exact
    expect(computeDayStatus(105, 100, 100, 0)).toBe('ok');  // ratio 1.05
  });

  test('unclamped: low when more than 5% under idealToday', () => {
    expect(computeDayStatus(94, 100, 100, 0)).toBe('low');
    expect(computeDayStatus(0,  100, 100, 0)).toBe('low');
  });

  test('unclamped: warn when 5–10% over idealToday', () => {
    expect(computeDayStatus(108, 100, 100, 0)).toBe('warn');
  });

  test('unclamped: bad when more than 10% over idealToday', () => {
    expect(computeDayStatus(111, 100, 100, 0)).toBe('bad');
  });

  // Clamped below (adjustment < 0): idealToday is a ceiling, ok window 20% wide below ideal

  test('clamped below: consuming 0 shows low', () => {
    expect(computeDayStatus(0, 2000, 1700, -300)).toBe('low');
  });

  test('clamped below: bottom of ok window is at idealToday × 0.80', () => {
    expect(computeDayStatus(1360, 2000, 1700, -300)).toBe('ok');   // ratio 0.80
    expect(computeDayStatus(1359, 2000, 1700, -300)).toBe('low');  // just below
  });

  test('clamped below: consuming idealToday exactly shows ok', () => {
    expect(computeDayStatus(1700, 2000, 1700, -300)).toBe('ok');
  });

  test('clamped below: anything above idealToday is instantly bad (no warn zone)', () => {
    expect(computeDayStatus(1701, 2000, 1700, -300)).toBe('bad');
    expect(computeDayStatus(2500, 2000, 1700, -300)).toBe('bad');
  });

  // Clamped above (adjustment > 0): idealToday is a floor, ok window 20% wide above ideal

  test('clamped above: consuming below idealToday shows low', () => {
    expect(computeDayStatus(2200, 2000, 2300, 300)).toBe('low');
  });

  test('clamped above: consuming idealToday exactly shows ok', () => {
    expect(computeDayStatus(2300, 2000, 2300, 300)).toBe('ok');
  });

  test('clamped above: top of ok window is at idealToday × 1.20', () => {
    expect(computeDayStatus(2760, 2000, 2300, 300)).toBe('ok');    // ratio 1.20
    expect(computeDayStatus(2761, 2000, 2300, 300)).toBe('warn');  // just above
  });

  test('clamped above: warn zone above ok band', () => {
    expect(computeDayStatus(2806, 2000, 2300, 300)).toBe('warn');  // ratio ≈ 1.22
  });

  test('clamped above: bad beyond warn zone', () => {
    expect(computeDayStatus(2900, 2000, 2300, 300)).toBe('bad');   // ratio ≈ 1.26
  });
});

// ---------------------------------------------------------------------------
// statusForDay
// ---------------------------------------------------------------------------
describe('statusForDay', () => {
  test('returns ok when day is at goal with sufficient window data', () => {
    // 28 days all at goal → adjustment = 0 → ok
    const kcalByDay = buildFullHistory('2024-02-07', 2000);
    expect(statusForDay(kcalByDay, '2024-02-07', 2000)).toBe('ok');
  });

  test('returns ok when consumed equals goal with no history (sparse gate fires)', () => {
    // 1 day logged → gate fires → adjustment = 0 → unclamped, consumed/idealToday = 1 → ok
    const kcalByDay = { '2024-02-07': 2000 };
    expect(statusForDay(kcalByDay, '2024-02-07', 2000)).toBe('ok');
  });

  test('chronic over-eating with full history → clamped below → ceiling status', () => {
    // 28 days at 2500 (500 over) → adjustment < 0 → clamped below
    const kcalByDay = buildFullHistory('2024-02-07', 2500);
    const status = statusForDay(kcalByDay, '2024-02-07', 2000);
    // today also at 2500; since idealToday < 2000, ratio > 1 → bad
    expect(status).toBe('bad');
  });
});

// ---------------------------------------------------------------------------
// barSegments
// ---------------------------------------------------------------------------
describe('barSegments', () => {
  test('under target: basePct proportional, no warn/bad', () => {
    const s = barSegments(80, 100, 'ok');
    expect(s.basePct).toBe(80);
    expect(s.warnPct).toBe(0);
    expect(s.badPct).toBe(0);
  });

  test('at target: basePct is 100, no warn/bad', () => {
    const s = barSegments(100, 100, 'ok');
    expect(s.basePct).toBe(100);
    expect(s.warnPct).toBe(0);
    expect(s.badPct).toBe(0);
  });

  test('in warn zone: segments normalized to 100%', () => {
    // consumed 108 / target 100 → raw: base=100, warn=8, total=108
    // scaled: base=100/108*100 ≈ 92.6, warn=8/108*100 ≈ 7.4
    const s = barSegments(108, 100, 'warn');
    expect(s.basePct + s.warnPct + s.badPct).toBeCloseTo(100);
    expect(s.basePct).toBeCloseTo(92.59, 1);
    expect(s.warnPct).toBeCloseTo(7.41, 1);
    expect(s.badPct).toBe(0);
  });

  test('in bad zone: all three segments normalized to 100%', () => {
    // consumed 115 / target 100 → raw: base=100, warn=10, bad=5, total=115
    const s = barSegments(115, 100, 'bad');
    expect(s.basePct + s.warnPct + s.badPct).toBeCloseTo(100);
    expect(s.basePct).toBeCloseTo(86.96, 1);
    expect(s.warnPct).toBeCloseTo(8.70, 1);
    expect(s.badPct).toBeCloseTo(4.35, 1);
  });

  test('extreme overshoot: segments still sum to 100%', () => {
    const s = barSegments(300, 100, 'bad');
    expect(s.basePct + s.warnPct + s.badPct).toBeCloseTo(100);
    expect(s.basePct).toBeCloseTo(100 / 3, 1);
  });

  test('zero target returns all zeros', () => {
    const s = barSegments(50, 0, 'ok');
    expect(s.basePct).toBe(0);
    expect(s.warnPct).toBe(0);
    expect(s.badPct).toBe(0);
  });

  test('status ok: over-target consumption shows only base (no warn/bad)', () => {
    const s = barSegments(120, 100, 'ok');
    expect(s.basePct).toBe(100);
    expect(s.warnPct).toBe(0);
    expect(s.badPct).toBe(0);
  });

  test('status warn: bad band folded into warn', () => {
    const s = barSegments(115, 100, 'warn');
    expect(s.basePct + s.warnPct + s.badPct).toBeCloseTo(100);
    expect(s.badPct).toBe(0);
    expect(s.warnPct).toBeGreaterThan(0);
  });

  test('status low: over-target consumption shows only base', () => {
    const s = barSegments(105, 100, 'low');
    expect(s.basePct).toBe(100);
    expect(s.warnPct).toBe(0);
    expect(s.badPct).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// macroVisuals — single source of truth for status + bar
// ---------------------------------------------------------------------------
describe('macroVisuals', () => {
  test('returns none with zero bar when no goal context', () => {
    const v = macroVisuals(100, null, 1);
    expect(v.status).toBe('none');
    expect(v.bar).toEqual({ basePct: 0, warnPct: 0, badPct: 0 });
  });

  test('uses fallbackGoal when macroWin is null', () => {
    const v = macroVisuals(100, null, 1, 100);
    expect(v.status).toBe('ok');
    expect(v.bar.basePct).toBe(100);
  });

  test('uses macroWin when provided (unclamped)', () => {
    /** @type {import('../data-goals.js').MacroWindow} */
    const mw = { target: 100, status: 'ok', idealToday: 100, prevSum: 400, adjustment: 0 };
    const v = macroVisuals(100, mw, 5);
    expect(v.status).toBe('ok');
    expect(v.bar.basePct).toBe(100);
  });

  test('clamped above: bar and status always agree — warn status never produces bad bar', () => {
    // adjustment > 0 → clamped above → idealToday is floor
    // consumed=2806, idealToday=2300 → ratio≈1.22 > 1.20, ≤ 1.25 → 'warn'
    /** @type {import('../data-goals.js').MacroWindow} */
    const mw = { target: 2000, status: 'warn', idealToday: 2300, prevSum: 2400, adjustment: 300 };
    const v = macroVisuals(2806, mw, 4);
    expect(v.status).toBe('warn');
    expect(v.bar.badPct).toBe(0);
  });

  test('unclamped: ok status never produces warn/bad bar', () => {
    /** @type {import('../data-goals.js').MacroWindow} */
    const mw = { target: 2000, status: 'ok', idealToday: 2000, prevSum: 12000, adjustment: 0 };
    // consumed 2100, idealToday 2000 → ratio 1.05 → ok (at boundary)
    const v = macroVisuals(2100, mw, 7);
    expect(v.status).toBe('ok');
    expect(v.bar.warnPct).toBe(0);
    expect(v.bar.badPct).toBe(0);
  });

  test('clamped below: bar has no warn zone — consumed just over idealToday jumps to bad', () => {
    // adjustment < 0 → skipWarnZone = true
    /** @type {import('../data-goals.js').MacroWindow} */
    const mw = { target: 2000, status: 'bad', idealToday: 1700, prevSum: 12500, adjustment: -300 };
    const v = macroVisuals(1800, mw, 6);
    expect(v.status).toBe('bad');
    expect(v.bar.warnPct).toBe(0);
    expect(v.bar.badPct).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// idealForDay
// ---------------------------------------------------------------------------
describe('idealForDay', () => {
  test('returns raw goal when no days are logged', () => {
    expect(idealForDay({}, '2024-02-07', 2000)).toBe(2000);
  });

  test('completeness gate: returns raw goal with insufficient history (< 14 in 28 days)', () => {
    // 7 days logged — fewer than MIN_LOGGED_28 (14) → gate fires
    const kcalByDay = buildFullHistory('2024-02-07', 3000, 7);
    expect(idealForDay(kcalByDay, '2024-02-07', 2000)).toBe(2000);
  });

  test('adjusts goal downward with 28 days of over-eating', () => {
    const kcalByDay = buildFullHistory('2024-02-07', 2500, 28);
    const result = idealForDay(kcalByDay, '2024-02-07', 2000);
    expect(result).toBeLessThan(2000);
    expect(result).toBeGreaterThanOrEqual(1700); // clamped at -15%
  });

  test('extreme over-eating clamps idealToday to goal × 0.85', () => {
    const kcalByDay = buildFullHistory('2024-02-07', 7000, 28);
    expect(idealForDay(kcalByDay, '2024-02-07', 2000)).toBe(1700);
  });

  test('returns goal when history is perfectly on target', () => {
    const kcalByDay = buildFullHistory('2024-02-07', 2000, 28);
    // error = 0 throughout → deadband applies → adjustment = 0
    expect(idealForDay(kcalByDay, '2024-02-07', 2000)).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// isGoalClamped / recoveryDays
// ---------------------------------------------------------------------------
describe('isGoalClamped', () => {
  test('returns false when target is null', () => {
    const mw = /** @type {any} */ ({ target: null, adjustment: -300, prevSum: 0, idealToday: 0, status: 'none' });
    expect(isGoalClamped(mw, 5)).toBe(false);
  });

  test('returns false when effectiveDays < MIN_LOGGED_7', () => {
    const mw = /** @type {import('../data-goals.js').MacroWindow} */ ({ target: 2000, adjustment: -300, prevSum: 0, idealToday: 1700, status: 'bad' });
    expect(isGoalClamped(mw, 3)).toBe(false); // 3 < 4
  });

  test('returns below when adjustment is significantly negative', () => {
    const mw = /** @type {import('../data-goals.js').MacroWindow} */ ({ target: 2000, adjustment: -300, prevSum: 0, idealToday: 1700, status: 'bad' });
    expect(isGoalClamped(mw, 5)).toBe('below');
  });

  test('returns above when adjustment is significantly positive', () => {
    const mw = /** @type {import('../data-goals.js').MacroWindow} */ ({ target: 2000, adjustment: 300, prevSum: 0, idealToday: 2300, status: 'low' });
    expect(isGoalClamped(mw, 5)).toBe('above');
  });

  test('returns false when adjustment is within the deadband', () => {
    // base deadband for 2000 kcal goal = max(50, 2.5%×2000) = 50 kcal
    // adjustment of 20 < 50 → not clamped
    const mw = /** @type {import('../data-goals.js').MacroWindow} */ ({ target: 2000, adjustment: 20, prevSum: 0, idealToday: 2020, status: 'ok' });
    expect(isGoalClamped(mw, 5)).toBe(false);
  });
});

describe('recoveryDays', () => {
  test('returns 0 when adjustment is within deadband', () => {
    const mw = /** @type {import('../data-goals.js').MacroWindow} */ ({ target: 2000, adjustment: 20, prevSum: 0, idealToday: 2020, status: 'ok' });
    expect(recoveryDays(mw, 5, 'above')).toBe(0);
  });

  test('returns 1 when effectiveDays < MIN_LOGGED_7', () => {
    const mw = /** @type {import('../data-goals.js').MacroWindow} */ ({ target: 2000, adjustment: -300, prevSum: 0, idealToday: 1700, status: 'bad' });
    expect(recoveryDays(mw, 3, 'below')).toBe(1);
  });

  test('decay approximation: -300 adjustment on 2000 goal → ~18 days', () => {
    // deadband = 50 kcal; n = 7 × log2(300/50) = 7 × log2(6) ≈ 7 × 2.585 ≈ 18.1 → ceil = 19
    const mw = /** @type {import('../data-goals.js').MacroWindow} */ ({ target: 2000, adjustment: -300, prevSum: 0, idealToday: 1700, status: 'bad' });
    const n = recoveryDays(mw, 5, 'below');
    expect(n).toBeGreaterThanOrEqual(18);
    expect(n).toBeLessThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
// derivedGrams
// ---------------------------------------------------------------------------
describe('derivedGrams', () => {
  test('computes gram targets from percentages', () => {
    const goals = makeGoal('2024-02-07', { kcal: 2000, protPct: 30, carbsPct: 45, fatPct: 25 });
    const g = derivedGrams(goals);
    expect(g.protG).toBe(150);   // 2000 * 0.30 / 4 = 150
    expect(g.carbsG).toBe(225);  // 2000 * 0.45 / 4 = 225
    expect(g.fatG).toBe(56);     // 2000 * 0.25 / 9 ≈ 55.6 → 56
  });

  test('handles zero percentage (target 0 g)', () => {
    const goals = makeGoal('2024-02-07', { kcal: 2000, protPct: 0, carbsPct: 55, fatPct: 45 });
    const g = derivedGrams(goals);
    expect(g.protG).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// goalForDate (pure function)
// ---------------------------------------------------------------------------
describe('goalForDate', () => {
  test('returns null for empty array', () => {
    expect(goalForDate([], '2024-02-07')).toBeNull();
  });

  test('returns null when date is before all records', () => {
    const records = [makeGoal('2024-02-01')];
    expect(goalForDate(records, '2024-01-31')).toBeNull();
  });

  test('returns record when date matches effectiveFrom exactly', () => {
    const r = makeGoal('2024-02-01');
    expect(goalForDate([r], '2024-02-01')).toEqual(r);
  });

  test('returns record when date is after effectiveFrom', () => {
    const r = makeGoal('2024-02-01');
    expect(goalForDate([r], '2024-02-15')).toEqual(r);
  });

  test('returns the more recent record when date is between two records (sorted desc)', () => {
    const older = makeGoal('2024-01-01');
    const newer = makeGoal('2024-02-01');
    expect(goalForDate([newer, older], '2024-02-15')).toEqual(newer);
    expect(goalForDate([newer, older], '2024-01-15')).toEqual(older);
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------
describe('list', () => {
  test('returns empty array when no records exist', async () => {
    vi.mocked(db.getAll).mockResolvedValue([]);
    const result = await list();
    expect(result).toEqual([]);
  });

  test('returns records sorted by effectiveFrom descending', async () => {
    const r1 = makeGoal('2024-01-01');
    const r2 = makeGoal('2024-03-01');
    const r3 = makeGoal('2024-02-01');
    vi.mocked(db.getAll).mockResolvedValue([r1, r3, r2]);
    const result = await list();
    expect(result.map(r => r.effectiveFrom)).toEqual(['2024-03-01', '2024-02-01', '2024-01-01']);
  });
});

// ---------------------------------------------------------------------------
// getActive
// ---------------------------------------------------------------------------
describe('getActive', () => {
  test('returns null when no records exist', async () => {
    vi.mocked(db.getAll).mockResolvedValue([]);
    expect(await getActive('2024-02-07')).toBeNull();
  });

  test('returns null when date is before all records', async () => {
    vi.mocked(db.getAll).mockResolvedValue([makeGoal('2024-02-01')]);
    expect(await getActive('2024-01-31')).toBeNull();
  });

  test('returns record when date matches effectiveFrom exactly', async () => {
    const r = makeGoal('2024-02-01');
    vi.mocked(db.getAll).mockResolvedValue([r]);
    expect(await getActive('2024-02-01')).toEqual(r);
  });

  test('returns most recent record whose effectiveFrom <= date', async () => {
    const older = makeGoal('2024-01-01');
    const newer = makeGoal('2024-02-01');
    vi.mocked(db.getAll).mockResolvedValue([newer, older]);
    expect(await getActive('2024-02-15')).toEqual(newer);
    expect(await getActive('2024-01-15')).toEqual(older);
  });

  test('defaults to today when no dateISO given', async () => {
    const r = makeGoal('2024-02-07');
    vi.mocked(db.getAll).mockResolvedValue([r]);
    expect(await getActive()).toEqual(r); // mocked isoToday returns '2024-02-07'
  });
});

// ---------------------------------------------------------------------------
// save
// ---------------------------------------------------------------------------
describe('save', () => {
  test('creates new record with effectiveFrom: today when no existing record for today', async () => {
    vi.mocked(db.getAll).mockResolvedValue([]);
    const fields = { maintenanceKcal: 2500, calMode: /** @type {'deficit'} */ ('deficit'), calMagnitude: 500, protPct: 30, carbsPct: 45, fatPct: 25 };
    await save(fields);
    expect(db.put).toHaveBeenCalledWith('goals', expect.objectContaining({
      effectiveFrom: '2024-02-07',
      kcal: 2000,
      maintenanceKcal: 2500,
    }));
  });

  test('surplus adds magnitude to maintenance', async () => {
    vi.mocked(db.getAll).mockResolvedValue([]);
    await save({ maintenanceKcal: 2000, calMode: 'surplus', calMagnitude: 300, protPct: 30, carbsPct: 45, fatPct: 25 });
    expect(db.put).toHaveBeenCalledWith('goals', expect.objectContaining({ kcal: 2300 }));
  });

  test('magnitude 0 stores kcal equal to maintenance', async () => {
    vi.mocked(db.getAll).mockResolvedValue([]);
    await save({ maintenanceKcal: 1800, calMode: 'deficit', calMagnitude: 0, protPct: 25, carbsPct: 50, fatPct: 25 });
    expect(db.put).toHaveBeenCalledWith('goals', expect.objectContaining({ kcal: 1800 }));
  });

  test('overwrites same-day record preserving id and createdAt', async () => {
    const existing = makeGoal('2024-02-07', { id: 'goal:abc', createdAt: 999 });
    vi.mocked(db.getAll).mockResolvedValue([existing]);
    await save({ maintenanceKcal: 2500, calMode: 'deficit', calMagnitude: 500, protPct: 30, carbsPct: 45, fatPct: 25 });
    expect(db.put).toHaveBeenCalledWith('goals', expect.objectContaining({
      id: 'goal:abc',
      createdAt: 999,
      effectiveFrom: '2024-02-07',
    }));
  });

  test('creates new record (different id) when existing record has different date', async () => {
    const existing = makeGoal('2024-02-06', { id: 'goal:old' });
    vi.mocked(db.getAll).mockResolvedValue([existing]);
    await save({ maintenanceKcal: 2500, calMode: 'deficit', calMagnitude: 500, protPct: 30, carbsPct: 45, fatPct: 25 });
    const putCall = vi.mocked(db.put).mock.calls[0][1];
    expect(/** @type {any} */ (putCall).id).not.toBe('goal:old');
    expect(/** @type {any} */ (putCall).effectiveFrom).toBe('2024-02-07');
  });
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------
describe('remove', () => {
  test('deletes the currently active record', async () => {
    const r = makeGoal('2024-02-01', { id: 'goal:xyz' });
    vi.mocked(db.getAll).mockResolvedValue([r]);
    await remove();
    expect(db.del).toHaveBeenCalledWith('goals', 'goal:xyz');
  });

  test('does nothing when no active record', async () => {
    vi.mocked(db.getAll).mockResolvedValue([]);
    await remove();
    expect(db.del).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateEffectiveFrom
// ---------------------------------------------------------------------------
describe('updateEffectiveFrom', () => {
  test('updates effectiveFrom for the target record', async () => {
    const r = makeGoal('2024-02-01', { id: 'goal:a' });
    vi.mocked(db.getAll).mockResolvedValue([r]);
    await updateEffectiveFrom('goal:a', '2024-02-10');
    expect(db.put).toHaveBeenCalledWith('goals', { ...r, effectiveFrom: '2024-02-10' });
  });

  test('throws when another record has the same effectiveFrom', async () => {
    const r1 = makeGoal('2024-02-01', { id: 'goal:a' });
    const r2 = makeGoal('2024-03-01', { id: 'goal:b' });
    vi.mocked(db.getAll).mockResolvedValue([r1, r2]);
    await expect(updateEffectiveFrom('goal:a', '2024-03-01')).rejects.toThrow('Another goal already starts on this date');
    expect(db.put).not.toHaveBeenCalled();
  });

  test('throws when record not found', async () => {
    vi.mocked(db.getAll).mockResolvedValue([]);
    await expect(updateEffectiveFrom('goal:nonexistent', '2024-02-10')).rejects.toThrow('Goal record not found');
  });
});

// ---------------------------------------------------------------------------
// deleteRecord
// ---------------------------------------------------------------------------
describe('deleteRecord', () => {
  test('deletes record by id', async () => {
    await deleteRecord('goal:abc');
    expect(db.del).toHaveBeenCalledWith('goals', 'goal:abc');
  });
});

// ---------------------------------------------------------------------------
// computeWindowVM
// ---------------------------------------------------------------------------
describe('computeWindowVM', () => {
  // goals: 2000 kcal, 30% prot → 150 g, 45% carbs → 225 g, 25% fat → 56 g
  const goals = makeGoal('2024-01-01', { kcal: 2000, maintenanceKcal: 2500, calMagnitude: 500, protPct: 30, carbsPct: 45, fatPct: 25 });

  /**
   * Build a meal record for a given date.
   * Defaults are exactly at goal so tests only need to override what matters.
   */
  function makeMeal(/** @type {string} */ date, kcal = 2000, prot = 150, carbs = 225, fats = 56) {
    return {
      id: `meal:${date}:0000000000001`, foodId: 'food:1', multiplier: 1, date, updatedAt: 0,
      foodSnapshot: { id: 'food:1', name: 'X', refLabel: '100g', kcal, prot, carbs, fats, updatedAt: 0 },
    };
  }

  // --- null / empty guards ---------------------------------------------------

  test('returns null when goals is null', async () => {
    const result = await computeWindowVM('2024-02-07', null);
    expect(result).toBeNull();
    expect(Meals.listRange).not.toHaveBeenCalled();
  });

  test('returns null when no meals exist in the 7-day display window', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result).toBeNull();
  });

  // --- date range query (now 28 days) ----------------------------------------

  test('queries the range [todayISO−27, todayISO]', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-07')]);
    await computeWindowVM('2024-02-07', goals);
    expect(Meals.listRange).toHaveBeenCalledWith('2024-01-11', '2024-02-07');
  });

  // --- windowDays (based on 7-day display window) ----------------------------

  test('windowDays is the count of distinct days with meals in the last 7 days', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([
      makeMeal('2024-02-03'),
      makeMeal('2024-02-05'),
      makeMeal('2024-02-07'),
    ]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.windowDays).toBe(3);
  });

  test('multiple meals on the same day count as one day', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([
      makeMeal('2024-02-07', 1000, 75, 112, 28),
      makeMeal('2024-02-07', 1000, 75, 113, 28),
    ]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.windowDays).toBe(1);
  });

  // --- idealToday: controller output -----------------------------------------

  test('adjustment propagated to all MacroWindows', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-07')]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(typeof result?.calories.adjustment).toBe('number');
    expect(result?.calories.adjustment).toBe(result?.protein.adjustment);
    expect(result?.calories.adjustment).toBe(result?.carbs.adjustment);
    expect(result?.calories.adjustment).toBe(result?.fat.adjustment);
  });

  test('two days both at goal: adjustment = 0, idealToday ≈ goal', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([
      makeMeal('2024-02-06'),
      makeMeal('2024-02-07'),
    ]);
    const result = await computeWindowVM('2024-02-07', goals);
    // 2 days of history → gate fires (< 14) → adjustment = 0
    expect(result?.calories.adjustment).toBe(0);
    expect(result?.calories.idealToday).toBeCloseTo(2000);
  });

  test('insufficient history causes gate to fire → adjustment = 0', async () => {
    // Only 7 days → loggedDays28 < 14 → gate fires
    const days = ['2024-02-01','2024-02-02','2024-02-03','2024-02-04','2024-02-05','2024-02-06','2024-02-07'];
    vi.mocked(Meals.listRange).mockResolvedValue(days.map(d => makeMeal(d, 3000)));
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.adjustment).toBe(0);
  });

  // --- macro status checks ---------------------------------------------------

  test('sparse: status ok when today consumed equals goal', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-07')]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.status).toBe('ok');
  });

  test('sparse: status low when consumed is 20% below goal', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-07', 1600)]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.status).toBe('low');
  });

  // --- prevSum preserved for macro reconciliation ----------------------------

  test('prevSum reflects 7-day prior totals (not 28-day)', async () => {
    // Only a 7-day meal in window
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-06', 2500)]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.prevSum).toBe(2500);
  });
});

// ---------------------------------------------------------------------------
// computeWindowVM – macro coherence and green-state invariant
// ---------------------------------------------------------------------------
describe('computeWindowVM – macro coherence', () => {
  // goals: 2000 kcal, 30% prot (150g), 45% carbs (225g), 25% fat (56g)
  const g = makeGoal('2024-01-01', { kcal: 2000, maintenanceKcal: 2500, calMagnitude: 500, protPct: 30, carbsPct: 45, fatPct: 25 });
  const TODAY = '2024-02-07';

  /**
   * Build a calorie-coherent meal (kcal derived from macros).
   * @param {string} date @param {number} prot @param {number} carbs @param {number} fats
   */
  function coherentMeal(date, prot, carbs, fats) {
    const kcal = 4 * prot + 4 * carbs + 9 * fats;
    return {
      id: `meal:${date}`, foodId: 'food:1', multiplier: 1, date, updatedAt: 0,
      foodSnapshot: { id: 'food:1', name: 'X', refLabel: '100g', kcal, prot, carbs, fats, updatedAt: 0 },
    };
  }

  /**
   * Given prior meals, assert that:
   * (a) 4P + 4C + 9F ≈ calIdeal (coherence), and
   * (b) eating exactly the idealToday values produces 'ok' status on all 4 dimensions.
   * @param {ReturnType<typeof coherentMeal>[]} priorMeals
   */
  async function assertGreenState(priorMeals) {
    vi.mocked(Meals.listRange).mockResolvedValue(priorMeals);
    const pre = await computeWindowVM(TODAY, g);
    expect(pre).not.toBeNull();

    const { calories, protein, carbs, fat } = /** @type {NonNullable<typeof pre>} */ (pre);

    // (a) Calorie coherence (within 2 kcal — reconcileMacroIdeals rounds grams).
    const macroKcal = 4 * protein.idealToday + 4 * carbs.idealToday + 9 * fat.idealToday;
    expect(Math.abs(macroKcal - calories.idealToday)).toBeLessThan(2);

    // (b) Eating exactly the ideals produces 'ok' for all 4 dimensions.
    const todayMeal = {
      id: `meal:${TODAY}`, foodId: 'food:1', multiplier: 1, date: TODAY, updatedAt: 0,
      foodSnapshot: {
        id: 'food:1', name: 'X', refLabel: '100g',
        kcal: calories.idealToday,
        prot: protein.idealToday,
        carbs: carbs.idealToday,
        fats: fat.idealToday,
        updatedAt: 0,
      },
    };
    vi.mocked(Meals.listRange).mockResolvedValue([...priorMeals, todayMeal]);
    const post = await computeWindowVM(TODAY, g);
    expect(post?.calories.status).toBe('ok');
    expect(post?.protein.status).toBe('ok');
    expect(post?.carbs.status).toBe('ok');
    expect(post?.fat.status).toBe('ok');
  }

  test('all 6 prior days exactly at goal: ideals = goal, eating them is green', async () => {
    const days = ['2024-02-01','2024-02-02','2024-02-03','2024-02-04','2024-02-05','2024-02-06'];
    await assertGreenState(days.map(d => coherentMeal(d, 150, 225, 56)));
  });

  test('6 prior days at 90% of every macro: ideals at goal (gate fires), eating them is green', async () => {
    // Only 6 prior days → loggedDays28 < 14 → gate fires → adjustment = 0 → ideals = goal grams
    const days = ['2024-02-01','2024-02-02','2024-02-03','2024-02-04','2024-02-05','2024-02-06'];
    await assertGreenState(days.map(d => coherentMeal(d, 135, 202.5, 50.4)));
  });

  test('6 prior days at 110% of every macro: ideals at goal (gate fires), eating them is green', async () => {
    const days = ['2024-02-01','2024-02-02','2024-02-03','2024-02-04','2024-02-05','2024-02-06'];
    await assertGreenState(days.map(d => coherentMeal(d, 165, 247.5, 61.6)));
  });

  test('mixed history: macro imbalance → coherent ideals, eating them is green', async () => {
    const days = ['2024-02-01','2024-02-02','2024-02-03','2024-02-04','2024-02-05','2024-02-06'];
    await assertGreenState(days.map(d => coherentMeal(d, 135, 270, 44.8)));
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a GoalRecord for tests.
 * @param {string} effectiveFrom
 * @param {Partial<import('../db.js').GoalRecord>} [overrides]
 * @returns {import('../db.js').GoalRecord}
 */
function makeGoal(effectiveFrom, overrides = {}) {
  return {
    id:             `goal:${effectiveFrom}`,
    effectiveFrom,
    kcal:           2000,
    maintenanceKcal: 2500,
    calMode:        /** @type {'deficit'} */ ('deficit'),
    calMagnitude:   500,
    protPct:        30,
    carbsPct:       45,
    fatPct:         25,
    createdAt:      0,
    ...overrides,
  };
}

/**
 * Build kcalByDay with N days ending on endISO, all at the given kcal value.
 * @param {string} endISO
 * @param {number} kcal
 * @param {number} [days]
 * @returns {Record<string, number>}
 */
function buildFullHistory(endISO, kcal, days = 28) {
  /** @type {Record<string, number>} */
  const map = {};
  const end = new Date(`${endISO}T00:00:00`);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    map[d.toISOString().slice(0, 10)] = kcal;
  }
  return map;
}

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
  barSegments,
  computeStatus,
  computeWindowVM,
  deleteRecord,
  derivedGrams,
  getActive,
  goalForDate,
  idealForDay,
  list,
  remove,
  save,
  updateEffectiveFrom,
} from '../data-goals.js';
import { Meals } from '../data-meals.js';
import * as db from '../db.js';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no migration needed (no old singleton)
  vi.mocked(db.get).mockResolvedValue(undefined);
  // Default: empty goals store
  vi.mocked(db.getAll).mockResolvedValue([]);
  vi.mocked(db.put).mockResolvedValue('goal:test');
  vi.mocked(db.del).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// computeStatus
// ---------------------------------------------------------------------------
describe('computeStatus', () => {
  test('returns none when target is null', () => {
    expect(computeStatus(0, null)).toBe('none');
    expect(computeStatus(500, null)).toBe('none');
  });

  test('returns ok when target is 0 and consumed is 0', () => {
    expect(computeStatus(0, 0)).toBe('ok');
  });

  test('returns bad when target is 0 and consumed > 0', () => {
    expect(computeStatus(1, 0)).toBe('bad');
    expect(computeStatus(100, 0)).toBe('bad');
  });

  test('returns ok within ±5% of target', () => {
    expect(computeStatus(95, 100)).toBe('ok');   // exactly 5% under (boundary)
    expect(computeStatus(105, 100)).toBe('ok');  // 5% over
    expect(computeStatus(100, 100)).toBe('ok');  // exact
  });

  test('returns low when more than 5% under target', () => {
    expect(computeStatus(94, 100)).toBe('low');  // 6% under
    expect(computeStatus(91, 100)).toBe('low');  // 9% under
    expect(computeStatus(89, 100)).toBe('low');  // 11% under
    expect(computeStatus(0, 100)).toBe('low');   // far under
  });

  test('returns warn between 5% and 10% over target', () => {
    expect(computeStatus(109, 100)).toBe('warn'); // 9% over
  });

  test('returns bad beyond 10% over target', () => {
    expect(computeStatus(111, 100)).toBe('bad'); // 11% over
  });

  test('boundary: exactly 10% over is warn', () => {
    expect(computeStatus(110, 100)).toBe('warn');
  });

  test('boundary: exactly 5% under is ok (not low)', () => {
    // ratio = 0.95, 1 - 0.05 = 0.95, ratio < 0.95 is false → ok
    expect(computeStatus(95, 100)).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// barSegments
// ---------------------------------------------------------------------------
describe('barSegments', () => {
  test('under target: basePct proportional, no warn/bad', () => {
    const s = barSegments(80, 100);
    expect(s.basePct).toBe(80);
    expect(s.warnPct).toBe(0);
    expect(s.badPct).toBe(0);
  });

  test('at target: basePct is 100, no warn/bad', () => {
    const s = barSegments(100, 100);
    expect(s.basePct).toBe(100);
    expect(s.warnPct).toBe(0);
    expect(s.badPct).toBe(0);
  });

  test('in warn zone: segments normalized to 100%', () => {
    // consumed 108 / target 100 → raw: base=100, warn=8, total=108
    // scaled: base=100/108*100 ≈ 92.6, warn=8/108*100 ≈ 7.4
    const s = barSegments(108, 100);
    expect(s.basePct + s.warnPct + s.badPct).toBeCloseTo(100);
    expect(s.basePct).toBeCloseTo(92.59, 1);
    expect(s.warnPct).toBeCloseTo(7.41, 1);
    expect(s.badPct).toBe(0);
  });

  test('in bad zone: all three segments normalized to 100%', () => {
    // consumed 115 / target 100 → raw: base=100, warn=10, bad=5, total=115
    const s = barSegments(115, 100);
    expect(s.basePct + s.warnPct + s.badPct).toBeCloseTo(100);
    expect(s.basePct).toBeCloseTo(86.96, 1);
    expect(s.warnPct).toBeCloseTo(8.70, 1);
    expect(s.badPct).toBeCloseTo(4.35, 1);
  });

  test('extreme overshoot: segments still sum to 100%', () => {
    const s = barSegments(300, 100);
    expect(s.basePct + s.warnPct + s.badPct).toBeCloseTo(100);
    // base portion shrinks as overshoot grows
    expect(s.basePct).toBeCloseTo(100 / 3, 1);
  });

  test('zero target returns all zeros', () => {
    const s = barSegments(50, 0);
    expect(s.basePct).toBe(0);
    expect(s.warnPct).toBe(0);
    expect(s.badPct).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// idealForDay
// ---------------------------------------------------------------------------
describe('idealForDay', () => {
  test('returns raw goal when no prior days are logged', () => {
    expect(idealForDay({}, '2024-02-07', 2000)).toBe(2000);
  });

  test('returns raw goal when only today is logged at goal', () => {
    const kcalByDay = { '2024-02-07': 2000 };
    expect(idealForDay(kcalByDay, '2024-02-07', 2000)).toBeCloseTo(2000);
  });

  test('compensates for under-eating yesterday', () => {
    // Yesterday ate 1000 (1000 under). effectiveDays=2, ideal = 2*2000 - 1000 = 3000
    // Clamped to 2000*1.15 = 2300
    const kcalByDay = { '2024-02-06': 1000, '2024-02-07': 0 };
    expect(idealForDay(kcalByDay, '2024-02-07', 2000)).toBeCloseTo(2300);
  });

  test('compensates for over-eating yesterday', () => {
    // Yesterday ate 3000 (1000 over). effectiveDays=2, ideal = 2*2000 - 3000 = 1000
    // Clamped to 2000*0.85 = 1700
    const kcalByDay = { '2024-02-06': 3000, '2024-02-07': 0 };
    expect(idealForDay(kcalByDay, '2024-02-07', 2000)).toBeCloseTo(1700);
  });

  test('mild under-eating is not clamped', () => {
    // Yesterday ate 1900 (100 under). effectiveDays=2, ideal = 2*2000 - 1900 = 2100
    // Within ±15% (1700–2300), not clamped
    const kcalByDay = { '2024-02-06': 1900, '2024-02-07': 0 };
    expect(idealForDay(kcalByDay, '2024-02-07', 2000)).toBeCloseTo(2100);
  });

  test('only considers the 7-day window', () => {
    // Day 8 days ago should be ignored
    const kcalByDay = { '2024-01-30': 500, '2024-02-06': 2000, '2024-02-07': 0 };
    // Only 02-06 counts as prev. effectiveDays=2, ideal = 2*2000 - 2000 = 2000
    expect(idealForDay(kcalByDay, '2024-02-07', 2000)).toBeCloseTo(2000);
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
    // list() sorts desc, so newer first
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

  test('returns null when no meals exist in window', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result).toBeNull();
  });

  // --- date range query ------------------------------------------------------

  test('queries the range [todayISO−6, todayISO]', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-07')]);
    await computeWindowVM('2024-02-07', goals);
    expect(Meals.listRange).toHaveBeenCalledWith('2024-02-01', '2024-02-07');
  });

  // --- windowDays / dataWarning ---------------------------------------------

  test('windowDays is the count of distinct days that have meals', async () => {
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

  test('dataWarning is true when fewer than 4 days have meals', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([
      makeMeal('2024-02-05'),
      makeMeal('2024-02-06'),
      makeMeal('2024-02-07'),
    ]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.dataWarning).toBe(true);
  });

  test('dataWarning is false when 4 or more days have meals', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([
      makeMeal('2024-02-04'),
      makeMeal('2024-02-05'),
      makeMeal('2024-02-06'),
      makeMeal('2024-02-07'),
    ]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.dataWarning).toBe(false);
  });

  // --- average (logged-days denominator) ------------------------------------

  test('avg uses logged-days as denominator, not calendar days', async () => {
    // Only 2 of the 7 calendar days have meals, both exactly at goal → avg = goal
    vi.mocked(Meals.listRange).mockResolvedValue([
      makeMeal('2024-02-04'),
      makeMeal('2024-02-07'),
    ]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.avgConsumed).toBeCloseTo(2000);
    expect(result?.calories.status).toBe('ok');
  });

  test('avg sums multiple meals on the same day before dividing', async () => {
    // Two meals totalling 2000 kcal on today only → avg = 2000/1 = 2000
    vi.mocked(Meals.listRange).mockResolvedValue([
      makeMeal('2024-02-07', 1000, 75, 112, 28),
      makeMeal('2024-02-07', 1000, 75, 113, 28),
    ]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.avgConsumed).toBeCloseTo(2000);
    expect(result?.calories.idealToday).toBeCloseTo(2000);
  });

  test('avg across two days both at goal is still goal', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([
      makeMeal('2024-02-06'),
      makeMeal('2024-02-07'),
    ]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.windowDays).toBe(2);
    expect(result?.calories.avgConsumed).toBeCloseTo(2000);
    expect(result?.calories.status).toBe('ok');
    expect(result?.calories.idealToday).toBeCloseTo(2000);
  });

  test('full 7-day window all at goal: avg = goal, idealToday = goal', async () => {
    const days = ['2024-02-01','2024-02-02','2024-02-03','2024-02-04','2024-02-05','2024-02-06','2024-02-07'];
    vi.mocked(Meals.listRange).mockResolvedValue(days.map(d => makeMeal(d)));
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.windowDays).toBe(7);
    expect(result?.dataWarning).toBe(false);
    expect(result?.calories.avgConsumed).toBeCloseTo(2000);
    expect(result?.calories.status).toBe('ok');
    expect(result?.calories.idealToday).toBeCloseTo(2000);
  });

  // --- status ---------------------------------------------------------------

  test('status is ok when avg is exactly at goal', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-07')]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.status).toBe('ok');
  });

  test('status is ok when avg is 5% under goal', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-07', 1900)]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.status).toBe('ok');
  });

  test('status is low when avg is 8% below goal', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-07', 1840)]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.status).toBe('low');
  });

  test('status is low when avg is 20% below goal', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-07', 1600)]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.status).toBe('low');
  });

  test('status is bad when today is 15% above adjusted goal', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-07', 2300)]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.status).toBe('bad');
  });

  test('status is ok when today tracks idealToday despite bad prior day', async () => {
    // Yesterday was severely under-goal (1000 kcal vs 2000 target).
    // idealToday is clamped to 2000×1.15 = 2300.
    // Today the user eats 2300 → status should be 'ok' (tracking the adjusted target),
    // even though the 2-day average (1650) is far below the raw goal.
    vi.mocked(Meals.listRange).mockResolvedValue([
      makeMeal('2024-02-06', 1000),
      makeMeal('2024-02-07', 2300),
    ]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.idealToday).toBeCloseTo(2300);
    expect(result?.calories.status).toBe('ok');
  });

  // --- idealToday / effectiveDays -------------------------------------------

  test('idealToday = goal when today is logged at goal (effectiveDays = windowDays)', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-07')]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.idealToday).toBeCloseTo(2000);
  });

  test('idealToday = goal when only prev days logged at goal (effectiveDays = windowDays + 1)', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-06')]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.idealToday).toBeCloseTo(2000);
  });

  test('idealToday is clamped to goal×1.15 when far below cumulative target', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-06', 200)]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.idealToday).toBeCloseTo(2300);
  });

  test('idealToday is clamped to goal×0.85 when far above cumulative target', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-06', 5000)]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.idealToday).toBeCloseTo(1700);
  });

  test('idealToday for today-logged vs today-empty stays the same when prev is at goal', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([
      makeMeal('2024-02-06'),
      makeMeal('2024-02-07'),
    ]);
    const withToday = await computeWindowVM('2024-02-07', goals);

    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-06')]);
    const withoutToday = await computeWindowVM('2024-02-07', goals);

    expect(withToday?.calories.idealToday).toBeCloseTo(withoutToday?.calories.idealToday ?? 0);
  });

  // --- macro averages and idealToday ----------------------------------------

  test('computes protein/carbs/fat averages and status independently', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-07', 2000, 150, 241, 56)]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.protein.avgConsumed).toBeCloseTo(150, 0);
    expect(result?.protein.status).toBe('ok');
    expect(result?.carbs.avgConsumed).toBeCloseTo(241, 0);
    expect(result?.carbs.status).toBe('warn');
    expect(result?.fat.avgConsumed).toBeCloseTo(56, 0);
    expect(result?.fat.status).toBe('ok');
  });

  test('macro idealToday tracks each macro target independently', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-06')]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.protein.idealToday).toBeCloseTo(150);
    expect(result?.carbs.idealToday).toBeCloseTo(225);
    expect(result?.fat.idealToday).toBeCloseTo(56);
  });

  test('macro idealToday is clamped independently per macro', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-06', 2000, 150, 225, 200)]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.fat.idealToday).toBeCloseTo(56 * 0.85, 0);
    expect(result?.protein.idealToday).toBeCloseTo(150);
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

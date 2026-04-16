import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  get: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

vi.mock('../utils.js', () => ({
  now: vi.fn(() => 1000),
  toISO: vi.fn((d) => d.toISOString().slice(0, 10)),
}));

vi.mock('../data-meals.js', () => ({
  Meals: {
    listRange: vi.fn(),
  },
}));

import { get, save, remove, computeStatus, derivedGrams, computeWindowVM } from '../data-goals.js';
import * as db from '../db.js';
import { Meals } from '../data-meals.js';

beforeEach(() => {
  vi.clearAllMocks();
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

  test('returns ok within 5% deviation (both sides)', () => {
    expect(computeStatus(95, 100)).toBe('ok');   // 5% under
    expect(computeStatus(105, 100)).toBe('ok');  // 5% over
    expect(computeStatus(100, 100)).toBe('ok');  // exact
  });

  test('returns warn between 5% and 10% deviation', () => {
    expect(computeStatus(91, 100)).toBe('warn');  // 9% under
    expect(computeStatus(109, 100)).toBe('warn'); // 9% over
  });

  test('returns bad beyond 10% deviation', () => {
    expect(computeStatus(89, 100)).toBe('bad');  // 11% under
    expect(computeStatus(111, 100)).toBe('bad'); // 11% over
    expect(computeStatus(0, 100)).toBe('bad');
  });

  test('boundary: exactly 10% off is warn', () => {
    expect(computeStatus(90, 100)).toBe('warn');
    expect(computeStatus(110, 100)).toBe('warn');
  });
});

// ---------------------------------------------------------------------------
// derivedGrams
// ---------------------------------------------------------------------------
describe('derivedGrams', () => {
  test('computes gram targets from percentages', () => {
    const goals = { id: 'goals:1', kcal: 2000, maintenanceKcal: 2500, calMode: /** @type {'deficit'} */ ('deficit'), calMagnitude: 500, protPct: 30, carbsPct: 45, fatPct: 25, updatedAt: 0 };
    const g = derivedGrams(goals);
    expect(g.protG).toBe(150);   // 2000 * 0.30 / 4 = 150
    expect(g.carbsG).toBe(225);  // 2000 * 0.45 / 4 = 225
    expect(g.fatG).toBe(56);     // 2000 * 0.25 / 9 ≈ 55.6 → 56
  });

  test('handles zero percentage (target 0 g)', () => {
    const goals = { id: 'goals:1', kcal: 2000, maintenanceKcal: 2000, calMode: /** @type {'deficit'} */ ('deficit'), calMagnitude: 0, protPct: 0, carbsPct: 55, fatPct: 45, updatedAt: 0 };
    const g = derivedGrams(goals);
    expect(g.protG).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// get / save / remove
// ---------------------------------------------------------------------------
describe('get', () => {
  test('returns Goals when record exists', async () => {
    const record = /** @type {import('../db.js').Goals} */ ({ id: 'goals:1', kcal: 2000, maintenanceKcal: 2500, calMode: 'deficit', calMagnitude: 500, protPct: 30, carbsPct: 45, fatPct: 25, updatedAt: 1 });
    vi.mocked(db.get).mockResolvedValue(record);
    const result = await get();
    expect(result).toEqual(record);
    expect(db.get).toHaveBeenCalledWith('goals', 'goals:1');
  });

  test('returns null when no record exists', async () => {
    vi.mocked(db.get).mockResolvedValue(undefined);
    const result = await get();
    expect(result).toBeNull();
  });
});

describe('save', () => {
  test('computes kcal from maintenance minus deficit and stores all fields', async () => {
    vi.mocked(db.put).mockResolvedValue('goals:1');
    await save({ maintenanceKcal: 2500, calMode: 'deficit', calMagnitude: 500, protPct: 30, carbsPct: 45, fatPct: 25 });
    expect(db.put).toHaveBeenCalledWith('goals', {
      id: 'goals:1',
      maintenanceKcal: 2500,
      calMode: 'deficit',
      calMagnitude: 500,
      kcal: 2000,
      protPct: 30,
      carbsPct: 45,
      fatPct: 25,
      updatedAt: 1000,
    });
  });

  test('surplus adds magnitude to maintenance', async () => {
    vi.mocked(db.put).mockResolvedValue('goals:1');
    await save({ maintenanceKcal: 2000, calMode: 'surplus', calMagnitude: 300, protPct: 30, carbsPct: 45, fatPct: 25 });
    expect(db.put).toHaveBeenCalledWith('goals', expect.objectContaining({ kcal: 2300 }));
  });

  test('magnitude 0 stores kcal equal to maintenance', async () => {
    vi.mocked(db.put).mockResolvedValue('goals:1');
    await save({ maintenanceKcal: 1800, calMode: 'deficit', calMagnitude: 0, protPct: 25, carbsPct: 50, fatPct: 25 });
    expect(db.put).toHaveBeenCalledWith('goals', expect.objectContaining({ kcal: 1800 }));
  });
});

describe('remove', () => {
  test('deletes the singleton record by key 1', async () => {
    vi.mocked(db.del).mockResolvedValue(undefined);
    await remove();
    expect(db.del).toHaveBeenCalledWith('goals', 'goals:1');
  });
});

// ---------------------------------------------------------------------------
// computeWindowVM
// ---------------------------------------------------------------------------
describe('computeWindowVM', () => {
  // goals: 2000 kcal, 30% prot → 150 g, 45% carbs → 225 g, 25% fat → 56 g
  const goals = { id: 'goals:1', kcal: 2000, maintenanceKcal: 2500, calMode: /** @type {'deficit'} */ ('deficit'), calMagnitude: 500, protPct: 30, carbsPct: 45, fatPct: 25, updatedAt: 0 };

  /**
   * Build a meal record for a given date.
   * Defaults are exactly at goal so tests only need to override what matters.
   */
  function makeMeal(/** @type {string} */ date, kcal = 2000, prot = 150, carbs = 225, fats = 56) {
    return {
      id: 'meal:' + date + ':0000000000001', foodId: 'food:1', multiplier: 1, date, updatedAt: 0,
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
    // effectiveDays = 7 (today logged), prevSum = 6×2000 = 12000
    // idealToday = 7×2000 − 12000 = 2000
    expect(result?.calories.idealToday).toBeCloseTo(2000);
  });

  // --- status ---------------------------------------------------------------

  test('status is ok when avg is exactly at goal', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-07')]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.status).toBe('ok');
  });

  test('status is ok when avg is 5% under goal', async () => {
    // 5% under 2000 = 1900
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-07', 1900)]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.status).toBe('ok');
  });

  test('status is warn when avg is 8% below goal', async () => {
    // 8% under 2000 = 1840
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-07', 1840)]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.status).toBe('warn');
  });

  test('status is bad when avg is 20% below goal', async () => {
    // 20% under 2000 = 1600
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-07', 1600)]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.status).toBe('bad');
  });

  test('status is bad when avg is 15% above goal', async () => {
    // 15% over 2000 = 2300
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-07', 2300)]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.status).toBe('bad');
  });

  // --- idealToday / effectiveDays -------------------------------------------

  test('idealToday = goal when today is logged at goal (effectiveDays = windowDays)', async () => {
    // Only today logged at goal → effectiveDays = 1, prevSum = 0 → ideal = 1×2000−0 = 2000
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-07')]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.idealToday).toBeCloseTo(2000);
  });

  test('idealToday = goal when only prev days logged at goal (effectiveDays = windowDays + 1)', async () => {
    // 1 prev day at goal → effectiveDays = 2, prevSum = 2000 → ideal = 2×2000−2000 = 2000
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-06')]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.idealToday).toBeCloseTo(2000);
  });

  test('idealToday is clamped to goal×1.15 when far below cumulative target', async () => {
    // 1 prev day at 200 kcal → effectiveDays = 2
    // ideal = 2×2000−200 = 3800, clamped to 2000×1.15 = 2300
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-06', 200)]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.idealToday).toBeCloseTo(2300);
  });

  test('idealToday is clamped to goal×0.85 when far above cumulative target', async () => {
    // 1 prev day at 5000 kcal → effectiveDays = 2
    // ideal = 2×2000−5000 = −1000, clamped to 2000×0.85 = 1700
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-06', 5000)]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.calories.idealToday).toBeCloseTo(1700);
  });

  test('idealToday for today-logged vs today-empty stays the same when prev is at goal', async () => {
    // today logged at goal (effectiveDays = 2, prevSum = 2000): ideal = 2×2000−2000 = 2000
    vi.mocked(Meals.listRange).mockResolvedValue([
      makeMeal('2024-02-06'),
      makeMeal('2024-02-07'),
    ]);
    const withToday = await computeWindowVM('2024-02-07', goals);

    // today not logged (effectiveDays = 2, prevSum = 2000): ideal = 2×2000−2000 = 2000
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-06')]);
    const withoutToday = await computeWindowVM('2024-02-07', goals);

    expect(withToday?.calories.idealToday).toBeCloseTo(withoutToday?.calories.idealToday ?? 0);
  });

  // --- macro averages and idealToday ----------------------------------------

  test('computes protein/carbs/fat averages and status independently', async () => {
    // Protein at goal (150g) → ok
    // Carbs 7% over goal (241g vs 225g) → warn
    // Fat at goal (56g) → ok
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
    // 1 prev day at goal for all macros → effectiveDays = 2
    // Each macro: ideal = 2×target − target = target
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-06')]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.protein.idealToday).toBeCloseTo(150);
    expect(result?.carbs.idealToday).toBeCloseTo(225);
    expect(result?.fat.idealToday).toBeCloseTo(56);
  });

  test('macro idealToday is clamped independently per macro', async () => {
    // Fat way over (200g vs 56g goal) → fat ideal = 2×56−200 = −88, clamped to 56×0.85 ≈ 48
    // Protein at goal → protein ideal = 2×150−150 = 150 (no clamp)
    vi.mocked(Meals.listRange).mockResolvedValue([makeMeal('2024-02-06', 2000, 150, 225, 200)]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.fat.idealToday).toBeCloseTo(56 * 0.85, 0);
    expect(result?.protein.idealToday).toBeCloseTo(150);
  });
});

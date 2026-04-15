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
    const goals = { id: /** @type {1} */ (1), kcal: 2000, maintenanceKcal: 2500, calMode: /** @type {'deficit'} */ ('deficit'), calMagnitude: 500, protPct: 30, carbsPct: 45, fatPct: 25, updatedAt: 0 };
    const g = derivedGrams(goals);
    expect(g.protG).toBe(150);   // 2000 * 0.30 / 4 = 150
    expect(g.carbsG).toBe(225);  // 2000 * 0.45 / 4 = 225
    expect(g.fatG).toBe(56);     // 2000 * 0.25 / 9 ≈ 55.6 → 56
  });

  test('handles zero percentage (target 0 g)', () => {
    const goals = { id: /** @type {1} */ (1), kcal: 2000, maintenanceKcal: 2000, calMode: /** @type {'deficit'} */ ('deficit'), calMagnitude: 0, protPct: 0, carbsPct: 55, fatPct: 45, updatedAt: 0 };
    const g = derivedGrams(goals);
    expect(g.protG).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// get / save / remove
// ---------------------------------------------------------------------------
describe('get', () => {
  test('returns Goals when record exists', async () => {
    const record = /** @type {import('../db.js').Goals} */ ({ id: 1, kcal: 2000, maintenanceKcal: 2500, calMode: 'deficit', calMagnitude: 500, protPct: 30, carbsPct: 45, fatPct: 25, updatedAt: 1 });
    vi.mocked(db.get).mockResolvedValue(record);
    const result = await get();
    expect(result).toEqual(record);
    expect(db.get).toHaveBeenCalledWith('goals', 1);
  });

  test('returns null when no record exists', async () => {
    vi.mocked(db.get).mockResolvedValue(undefined);
    const result = await get();
    expect(result).toBeNull();
  });
});

describe('save', () => {
  test('computes kcal from maintenance minus deficit and stores all fields', async () => {
    vi.mocked(db.put).mockResolvedValue(1);
    await save({ maintenanceKcal: 2500, calMode: 'deficit', calMagnitude: 500, protPct: 30, carbsPct: 45, fatPct: 25 });
    expect(db.put).toHaveBeenCalledWith('goals', {
      id: 1,
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
    vi.mocked(db.put).mockResolvedValue(1);
    await save({ maintenanceKcal: 2000, calMode: 'surplus', calMagnitude: 300, protPct: 30, carbsPct: 45, fatPct: 25 });
    expect(db.put).toHaveBeenCalledWith('goals', expect.objectContaining({ kcal: 2300 }));
  });

  test('magnitude 0 stores kcal equal to maintenance', async () => {
    vi.mocked(db.put).mockResolvedValue(1);
    await save({ maintenanceKcal: 1800, calMode: 'deficit', calMagnitude: 0, protPct: 25, carbsPct: 50, fatPct: 25 });
    expect(db.put).toHaveBeenCalledWith('goals', expect.objectContaining({ kcal: 1800 }));
  });
});

describe('remove', () => {
  test('deletes the singleton record by key 1', async () => {
    vi.mocked(db.del).mockResolvedValue(undefined);
    await remove();
    expect(db.del).toHaveBeenCalledWith('goals', 1);
  });
});

// ---------------------------------------------------------------------------
// computeWindowVM
// ---------------------------------------------------------------------------
describe('computeWindowVM', () => {
  const goals = { id: /** @type {1} */ (1), kcal: 2000, maintenanceKcal: 2500, calMode: /** @type {'deficit'} */ ('deficit'), calMagnitude: 500, protPct: 30, carbsPct: 45, fatPct: 25, updatedAt: 0 };

  /** @param {string} date */
  function makeMeal(date, kcal = 1000, prot = 50, carbs = 100, fats = 30) {
    return {
      id: 1, foodId: 1, multiplier: 1, date, updatedAt: 0,
      foodSnapshot: { id: 1, name: 'X', refLabel: '100g', kcal, prot, carbs, fats, updatedAt: 0 },
    };
  }

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

  test('computes average over days with meals', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([
      makeMeal('2024-02-06', 2000, 150, 225, 56),
      makeMeal('2024-02-07', 2000, 150, 225, 56),
    ]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result).not.toBeNull();
    expect(result?.windowDays).toBe(2);
    expect(result?.calories.avgConsumed).toBeCloseTo(2000);
    expect(result?.calories.status).toBe('ok');
  });

  test('dataWarning is true when fewer than 4 days have meals', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([
      makeMeal('2024-02-05'),
      makeMeal('2024-02-06'),
      makeMeal('2024-02-07'),
    ]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.windowDays).toBe(3);
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
    expect(result?.windowDays).toBe(4);
    expect(result?.dataWarning).toBe(false);
  });

  test('multiple meals on the same day are summed, not double-counted', async () => {
    vi.mocked(Meals.listRange).mockResolvedValue([
      makeMeal('2024-02-07', 1000, 75, 112, 28),
      makeMeal('2024-02-07', 1000, 75, 113, 28),
    ]);
    const result = await computeWindowVM('2024-02-07', goals);
    expect(result?.windowDays).toBe(1);  // only 1 day
    expect(result?.calories.avgConsumed).toBeCloseTo(2000); // 1000 + 1000
  });
});

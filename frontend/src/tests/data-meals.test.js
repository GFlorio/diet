import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../db.js', () => ({
  getAll: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  getWhere: vi.fn(),
}));

vi.mock('../utils.js', () => ({
  now: vi.fn(() => 999),
}));

import { Meals, resolveSnapshotMacros } from '../data-meals.js';
import * as db from '../db.js';

/** @returns {import('../db.js').Food} */
function makeFood(overrides = {}) {
  return {
    id: 'food:1',
    name: 'Rice',
    refLabel: '100g',
    kcal: 130,
    prot: 2.4,
    carbs: 28,
    fats: 0.3,
    archived: false,
    updatedAt: 1,
    ...overrides,
  };
}

/** @returns {import('../db.js').Meal} */
function makeMeal(overrides = {}) {
  return {
    id: 'meal:2024-02-01:0000000000001',
    foodId: 'food:1',
    foodSnapshot: { id: 'food:1', name: 'Rice', refLabel: '100g', kcal: 130, prot: 2.4, carbs: 28, fats: 0.3, updatedAt: 1 },
    multiplier: 1,
    date: '2024-02-01',
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Meals.syncAllForFood', () => {
  test('returns 0 when the food does not exist', async () => {
    vi.mocked(db.getAll).mockResolvedValue([]);
    const result = await Meals.syncAllForFood('food:999');
    expect(result.totalCount).toBe(0);
  });

  test('returns 0 when the food exists but has no associated meals', async () => {
    vi.mocked(db.getAll).mockImplementation(async store => store === 'foods' ? [makeFood()] : []);
    const result = await Meals.syncAllForFood('food:1');
    expect(result.totalCount).toBe(0);
    expect(db.put).not.toHaveBeenCalled();
  });

  test('syncs each meal and returns the count', async () => {
    const food = makeFood({ name: 'Brown Rice' });
    const meals = [
      makeMeal({ id: 'meal:2024-02-01:0000000000001' }),
      makeMeal({ id: 'meal:2024-02-01:0000000000002' }),
    ];
    vi.mocked(db.getAll).mockImplementation(async store => store === 'foods' ? [food] : meals);
    vi.mocked(db.put).mockResolvedValue('meal:2024-02-01:0000000000001');
    const result = await Meals.syncAllForFood('food:1');
    expect(result.totalCount).toBe(2);
    expect(db.put).toHaveBeenCalledTimes(2);
  });

  test('updates each meal snapshot to the current food state', async () => {
    const updatedFood = makeFood({ name: 'Brown Rice', kcal: 216 });
    const meals = [makeMeal({ id: 'meal:2024-02-01:0000000000001' })];
    vi.mocked(db.getAll).mockImplementation(async store => store === 'foods' ? [updatedFood] : meals);
    vi.mocked(db.put).mockResolvedValue('meal:2024-02-01:0000000000001');
    await Meals.syncAllForFood('food:1');
    const savedMeal = /** @type {import('../db.js').Meal} */ (vi.mocked(db.put).mock.calls[0][1]);
    expect(savedMeal.foodSnapshot.name).toBe('Brown Rice');
    expect(resolveSnapshotMacros(savedMeal.foodSnapshot).kcal).toBe(216);
  });
});

import { describe, test, expect, vi, beforeEach } from 'vitest';

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

import { Meals } from '../data-meals.js';
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
    vi.mocked(db.get).mockResolvedValue(undefined);
    const result = await Meals.syncAllForFood('food:999');
    expect(result).toBe(0);
    expect(db.getWhere).not.toHaveBeenCalled();
  });

  test('returns 0 when the food exists but has no associated meals', async () => {
    vi.mocked(db.get).mockResolvedValue(makeFood());
    vi.mocked(db.getWhere).mockResolvedValue([]);
    const result = await Meals.syncAllForFood('food:1');
    expect(result).toBe(0);
    expect(db.put).not.toHaveBeenCalled();
  });

  test('syncs each meal and returns the count', async () => {
    vi.mocked(db.get).mockResolvedValue(makeFood({ name: 'Brown Rice' }));
    vi.mocked(db.getWhere).mockResolvedValue([
      makeMeal({ id: 'meal:2024-02-01:0000000000001' }),
      makeMeal({ id: 'meal:2024-02-01:0000000000002' }),
    ]);
    vi.mocked(db.put).mockResolvedValue('meal:2024-02-01:0000000000001');
    const result = await Meals.syncAllForFood('food:1');
    expect(result).toBe(2);
    expect(db.put).toHaveBeenCalledTimes(2);
  });

  test('updates each meal snapshot to the current food state', async () => {
    const updatedFood = makeFood({ name: 'Brown Rice', kcal: 216 });
    vi.mocked(db.get).mockResolvedValue(updatedFood);
    vi.mocked(db.getWhere).mockResolvedValue([makeMeal({ id: 'meal:2024-02-01:0000000000001' })]);
    vi.mocked(db.put).mockResolvedValue('meal:2024-02-01:0000000000001');
    await Meals.syncAllForFood('food:1');
    const savedMeal = /** @type {import('../db.js').Meal} */ (vi.mocked(db.put).mock.calls[0][1]);
    expect(savedMeal.foodSnapshot.name).toBe('Brown Rice');
    expect(savedMeal.foodSnapshot.kcal).toBe(216);
  });
});


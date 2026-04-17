import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../db.js', () => ({
  getAll: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
}));

// utils.js has DOM dependencies; mock only what data-foods.js uses
vi.mock('../utils.js', () => ({
  now: vi.fn(() => 999),
}));

import { Foods } from '../data-foods.js';
import * as db from '../db.js';

/** @returns {import('../db.js').Food} */
function makeFood(overrides = {}) {
  return {
    id: 'food:1',
    name: 'Apple',
    refLabel: '100g',
    kcal: 52,
    prot: 0.3,
    carbs: 14,
    fats: 0.2,
    archived: false,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Foods.list — combined search and status filter', () => {
  test('returns only active foods matching search', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      makeFood({ id: 'food:1', name: 'Apple', archived: false }),
      makeFood({ id: 'food:2', name: 'Apple Juice', archived: true }),
      makeFood({ id: 'food:3', name: 'Banana', archived: false }),
    ]);
    const result = await Foods.list({ search: 'apple', status: 'active' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('food:1');
  });

  test('returns only archived foods matching search', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      makeFood({ id: 'food:1', name: 'Apple', archived: false }),
      makeFood({ id: 'food:2', name: 'Apple Juice', archived: true }),
      makeFood({ id: 'food:3', name: 'Banana Chips', archived: true }),
    ]);
    const result = await Foods.list({ search: 'apple', status: 'archived' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('food:2');
  });

  test('returns all foods when no search term and status is active', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      makeFood({ id: 'food:1', name: 'Apple', archived: false }),
      makeFood({ id: 'food:2', name: 'Banana', archived: true }),
    ]);
    const result = await Foods.list({ status: 'active' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('food:1');
  });
});

describe('Foods.list — search behavior', () => {
  test('matches refLabel substring', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      makeFood({ id: 'food:1', name: 'Apple', refLabel: '100g', archived: false }),
      makeFood({ id: 'food:2', name: 'Banana', refLabel: '1 cup', archived: false }),
    ]);
    const result = await Foods.list({ search: 'cup', status: 'active' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('food:2');
  });

  test('is case-insensitive', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      makeFood({ id: 'food:1', name: 'Apple', archived: false }),
      makeFood({ id: 'food:2', name: 'Banana', archived: false }),
    ]);
    const result = await Foods.list({ search: 'APPLE', status: 'active' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('food:1');
  });

  test('trims whitespace from search term', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      makeFood({ id: 'food:1', name: 'Apple', archived: false }),
    ]);
    const result = await Foods.list({ search: '  apple  ', status: 'active' });
    expect(result).toHaveLength(1);
  });
});

describe('Foods.list — frecency scoring', () => {
  test('orders foods by score descending when scores map is provided', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      makeFood({ id: 'food:1', name: 'Apple', archived: false }),
      makeFood({ id: 'food:2', name: 'Banana', archived: false }),
      makeFood({ id: 'food:3', name: 'Carrot', archived: false }),
    ]);
    const scores = new Map([['food:1', 0.5], ['food:3', 2.0]]);
    const result = await Foods.list({ status: 'active', scores });
    // Carrot (2.0) > Apple (0.5) > Banana (0.0)
    expect(result.map(f => f.id)).toEqual(['food:3', 'food:1', 'food:2']);
  });

  test('falls back to alphabetical for foods with equal scores', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      makeFood({ id: 'food:1', name: 'Zucchini', archived: false }),
      makeFood({ id: 'food:2', name: 'Apple', archived: false }),
    ]);
    const result = await Foods.list({ status: 'active', scores: new Map() });
    expect(result.map(f => f.id)).toEqual(['food:2', 'food:1']);
  });

  test('applies frecency ordering before search filter', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      makeFood({ id: 'food:1', name: 'Chicken breast', archived: false }),
      makeFood({ id: 'food:2', name: 'Chicken thigh', archived: false }),
    ]);
    const scores = new Map([['food:2', 5.0], ['food:1', 1.0]]);
    const result = await Foods.list({ search: 'chicken', status: 'active', scores });
    // Thigh (5.0) before breast (1.0)
    expect(result.map(f => f.id)).toEqual(['food:2', 'food:1']);
  });

  test('behaves as alphabetical when no scores provided', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      makeFood({ id: 'food:1', name: 'Zucchini', archived: false }),
      makeFood({ id: 'food:2', name: 'Apple', archived: false }),
    ]);
    const result = await Foods.list({ status: 'active' });
    expect(result.map(f => f.id)).toEqual(['food:2', 'food:1']);
  });
});

describe('Foods.byId', () => {
  test('returns undefined when food does not exist', async () => {
    vi.mocked(db.get).mockResolvedValue(undefined);
    const result = await Foods.byId('food:999');
    expect(result).toBeUndefined();
  });

  test('returns the food when found', async () => {
    const food = makeFood({ id: 'food:5' });
    vi.mocked(db.get).mockResolvedValue(food);
    const result = await Foods.byId('food:5');
    expect(result).toEqual(food);
  });
});

describe('Foods.update', () => {
  test('returns undefined when food does not exist', async () => {
    vi.mocked(db.get).mockResolvedValue(undefined);
    const result = await Foods.update('food:999', { name: 'New Name' });
    expect(result).toBeUndefined();
    expect(db.put).not.toHaveBeenCalled();
  });

  test('merges patch onto existing food and returns it', async () => {
    const food = makeFood({ id: 'food:1', name: 'Apple' });
    vi.mocked(db.get).mockResolvedValue(food);
    vi.mocked(db.put).mockResolvedValue('food:1');
    const result = await Foods.update('food:1', { name: 'Green Apple' });
    expect(result?.name).toBe('Green Apple');
    expect(result?.id).toBe('food:1');
    expect(result?.refLabel).toBe('100g'); // unchanged fields preserved
    expect(db.put).toHaveBeenCalledOnce();
  });
});

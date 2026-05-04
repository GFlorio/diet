/**
 * Integration tests for the Meals data layer.
 * Snapshot immutability, sync, date queries, and ID ordering.
 */
import './setup.js';
import { beforeEach, describe, expect, test } from 'vitest';
import { Foods } from '../../data-foods.js';
import { Meals } from '../../data-meals.js';
import { resetTestDB, createFood, createMeal } from './helpers.js';

beforeEach(resetTestDB);

// ---------------------------------------------------------------------------
// Snapshot immutability
// ---------------------------------------------------------------------------
describe('Snapshot immutability', () => {
  test('meal snapshot is frozen at creation time', async () => {
    const food = await createFood({ name: 'Rice', kcal: 130 });
    await createMeal(food, '2024-06-01');

    // Update the food
    await Foods.update(food.id, { name: 'Brown Rice', kcal: 216 });

    // Meal snapshot unchanged
    const meals = await Meals.listByDate('2024-06-01');
    expect(meals[0].foodSnapshot.name).toBe('Rice');
    expect(meals[0].foodSnapshot.kcal).toBe(130);
  });

  test('multiple meals created from same food have independent snapshots', async () => {
    const food = await createFood({ name: 'Oats', kcal: 150 });
    await createMeal(food, '2024-06-01');

    await Foods.update(food.id, { kcal: 180 });
    const updatedFood = /** @type {import('../../db.js').Food} */ (await Foods.byId(food.id));
    await createMeal(updatedFood, '2024-06-02');

    const day1 = await Meals.listByDate('2024-06-01');
    const day2 = await Meals.listByDate('2024-06-02');
    expect(day1[0].foodSnapshot.kcal).toBe(150);
    expect(day2[0].foodSnapshot.kcal).toBe(180);
  });
});

// ---------------------------------------------------------------------------
// Snapshot sync (syncAllForFood)
// ---------------------------------------------------------------------------
describe('syncAllForFood', () => {
  test('updates all meals for a food to its current snapshot', async () => {
    const food = await createFood({ name: 'Chicken', kcal: 200 });
    await createMeal(food, '2024-06-01');
    await createMeal(food, '2024-06-02');
    await createMeal(food, '2024-06-03');

    await Foods.update(food.id, { name: 'Grilled Chicken', kcal: 250 });
    const count = await Meals.syncAllForFood(food.id);
    expect(count).toBe(3);

    for (const date of ['2024-06-01', '2024-06-02', '2024-06-03']) {
      const meals = await Meals.listByDate(date);
      expect(meals[0].foodSnapshot.name).toBe('Grilled Chicken');
      expect(meals[0].foodSnapshot.kcal).toBe(250);
    }
  });

  test('does not affect meals for other foods', async () => {
    const chicken = await createFood({ name: 'Chicken', kcal: 200 });
    const rice = await createFood({ name: 'Rice', kcal: 130 });
    await createMeal(chicken, '2024-06-01');
    await createMeal(rice, '2024-06-01');

    await Foods.update(chicken.id, { kcal: 999 });
    await Meals.syncAllForFood(chicken.id);

    const meals = await Meals.listByDate('2024-06-01');
    const riceMeal = meals.find(m => m.foodId === rice.id);
    expect(riceMeal?.foodSnapshot.kcal).toBe(130); // untouched
  });

  test('returns 0 for non-existent food', async () => {
    expect(await Meals.syncAllForFood('food:nonexistent')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Date queries
// ---------------------------------------------------------------------------
describe('Date queries', () => {
  test('listByDate returns only meals for the given date', async () => {
    const food = await createFood({ name: 'Apple' });
    await createMeal(food, '2024-06-01');
    await createMeal(food, '2024-06-02');
    await createMeal(food, '2024-06-03');

    const day2 = await Meals.listByDate('2024-06-02');
    expect(day2).toHaveLength(1);
    expect(day2[0].date).toBe('2024-06-02');
  });

  test('listRange is inclusive on both ends', async () => {
    const food = await createFood({ name: 'Banana' });
    await createMeal(food, '2024-06-01');
    await createMeal(food, '2024-06-03');
    await createMeal(food, '2024-06-05');

    const range = await Meals.listRange('2024-06-01', '2024-06-03');
    expect(range).toHaveLength(2);
    expect(range.map(m => m.date)).toEqual(['2024-06-01', '2024-06-03']);
  });

  test('meals are sorted chronologically within listRange', async () => {
    const food = await createFood({ name: 'Egg' });
    await createMeal(food, '2024-06-03');
    await createMeal(food, '2024-06-01');
    await createMeal(food, '2024-06-02');

    const range = await Meals.listRange('2024-06-01', '2024-06-03');
    expect(range.map(m => m.date)).toEqual(['2024-06-01', '2024-06-02', '2024-06-03']);
  });

  test('listByDate returns empty for a date with no meals', async () => {
    expect(await Meals.listByDate('2024-06-15')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ID generation and ordering
// ---------------------------------------------------------------------------
describe('ID generation', () => {
  test('meal IDs contain the date', async () => {
    const food = await createFood({ name: 'Test' });
    const meal = await createMeal(food, '2024-06-15');
    expect(meal.id).toContain('meal:2024-06-15:');
  });

  test('multiple meals on same date get distinct IDs', async () => {
    const food = await createFood({ name: 'Test' });
    const m1 = await createMeal(food, '2024-06-01');
    await new Promise(r => setTimeout(r, 2));
    const m2 = await createMeal(food, '2024-06-01');
    expect(m1.id).not.toBe(m2.id);
  });

  test('listByDate preserves insertion order via ID sort', async () => {
    const food = await createFood({ name: 'Test' });
    const m1 = await createMeal(food, '2024-06-01');
    // Small delay to ensure different Date.now() values for IDs
    await new Promise(r => setTimeout(r, 2));
    const m2 = await createMeal(food, '2024-06-01');
    expect(m1.id).not.toBe(m2.id);
    const meals = await Meals.listByDate('2024-06-01');
    expect(meals).toHaveLength(2);
    expect(meals[0].id).toBe(m1.id);
    expect(meals[1].id).toBe(m2.id);
  });
});

// ---------------------------------------------------------------------------
// Frecency scoring
// ---------------------------------------------------------------------------
describe('Frecency scoring', () => {
  test('recent meals produce higher scores', async () => {
    const food = await createFood({ name: 'Yogurt' });
    await createMeal(food, '2024-06-10');  // today
    await createMeal(food, '2024-06-05');  // 5 days ago

    const scores = await Meals.frecencyScores('2024-03-12', '2024-06-10');
    const score = scores.get(food.id) ?? 0;
    // score = 1/(0+1) + 1/(5+1) = 1 + 0.1667 ≈ 1.167
    expect(score).toBeCloseTo(1 + 1 / 6, 3);
  });

  test('different foods get independent scores', async () => {
    const a = await createFood({ name: 'A' });
    const b = await createFood({ name: 'B' });
    await createMeal(a, '2024-06-10');
    await createMeal(a, '2024-06-10');
    await createMeal(b, '2024-06-05');

    const scores = await Meals.frecencyScores('2024-03-12', '2024-06-10');
    expect((scores.get(a.id) ?? 0)).toBeGreaterThan((scores.get(b.id) ?? 0));
  });

  test('meals outside the window are excluded', async () => {
    const food = await createFood({ name: 'Old' });
    await createMeal(food, '2024-01-01');

    const scores = await Meals.frecencyScores('2024-06-01', '2024-06-10');
    expect(scores.get(food.id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Meal removal and restore
// ---------------------------------------------------------------------------
describe('Meal remove and restore', () => {
  test('removed meal disappears from queries', async () => {
    const food = await createFood({ name: 'Toast' });
    const meal = await createMeal(food, '2024-06-01');
    await Meals.remove(meal.id);
    expect(await Meals.listByDate('2024-06-01')).toHaveLength(0);
  });

  test('restored meal reappears', async () => {
    const food = await createFood({ name: 'Toast' });
    const meal = await createMeal(food, '2024-06-01');
    await Meals.remove(meal.id);
    await Meals.restore(meal);
    expect(await Meals.listByDate('2024-06-01')).toHaveLength(1);
  });
});

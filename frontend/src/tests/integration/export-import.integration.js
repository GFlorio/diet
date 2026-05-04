/**
 * Integration tests for export/import round-trip.
 */
import './setup.js';
import { beforeEach, describe, expect, test } from 'vitest';
import * as db from '../../db.js';
import { Foods } from '../../data-foods.js';
import { Meals } from '../../data-meals.js';
import * as Goals from '../../data-goals.js';
import { resetTestDB, createFood, createMeal, insertGoal } from './helpers.js';

beforeEach(resetTestDB);

describe('Export/Import round-trip', () => {
  test('export and re-import preserves all records', async () => {
    // Arrange
    const food1 = await createFood({ name: 'Apple', kcal: 52, prot: 0.3, carbs: 14, fats: 0.2 });
    const food2 = await createFood({ name: 'Rice', kcal: 130, prot: 2.4, carbs: 28, fats: 0.3 });
    await createMeal(food1, '2024-06-01');
    await new Promise(r => setTimeout(r, 2));
    await createMeal(food2, '2024-06-01', 2);
    await createMeal(food1, '2024-06-02');
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    await insertGoal({ effectiveFrom: '2024-06-01', kcal: 1800, protPct: 25, carbsPct: 45, fatPct: 30 });

    // Act — export
    const backup = await db.exportDB();

    // Verify export structure
    expect(backup.version).toBe(1);
    expect(typeof backup.exportedAt).toBe('string');
    expect(backup.foods).toHaveLength(2);
    expect(backup.meals).toHaveLength(3);
    expect(backup.goals).toHaveLength(2);

    // Act — reset and re-import
    await db.resetDB();
    expect(await Foods.list({ status: 'all' })).toHaveLength(0);
    await db.importDB(backup);

    // Assert — all data restored
    const foods = await Foods.list({ status: 'all' });
    expect(foods).toHaveLength(2);
    expect(foods.map(f => f.name).sort()).toEqual(['Apple', 'Rice']);

    const meals = await Meals.listRange('2024-06-01', '2024-06-02');
    expect(meals).toHaveLength(3);

    const goals = await Goals.list();
    expect(goals).toHaveLength(2);
    expect(goals.map(g => g.kcal).sort()).toEqual([1800, 2000]);
  });

  test('import replaces pre-existing data', async () => {
    // Arrange — existing data that should be wiped
    await createFood({ name: 'OldFood' });
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 9999 });

    const backup = {
      version: 1,
      exportedAt: '2024-01-01T00:00:00.000Z',
      foods: [{ id: 'food:imported', name: 'Imported', refLabel: '100g', kcal: 100, prot: 5, carbs: 10, fats: 3, archived: false, updatedAt: 1 }],
      meals: [],
      goals: [],
    };

    await db.importDB(backup);

    const foods = await Foods.list({ status: 'all' });
    expect(foods).toHaveLength(1);
    expect(foods[0].name).toBe('Imported');

    expect(await Goals.list()).toHaveLength(0);
  });

  test('import rejects invalid format', async () => {
    await expect(db.importDB(/** @type {any} */ (null))).rejects.toThrow('Invalid backup');
    await expect(db.importDB(/** @type {any} */ ({ version: 2, foods: [], meals: [], goals: [] }))).rejects.toThrow('Invalid backup');
    await expect(db.importDB(/** @type {any} */ ({ version: 1, foods: 'bad', meals: [], goals: [] }))).rejects.toThrow('Invalid backup');
  });

  test('meal snapshots survive round-trip intact', async () => {
    const food = await createFood({ name: 'Chicken', kcal: 200, prot: 30, carbs: 0, fats: 8 });
    await createMeal(food, '2024-06-01');
    // Update food after creating meal
    await Foods.update(food.id, { kcal: 250 });

    const backup = await db.exportDB();
    await db.resetDB();
    await db.importDB(backup);

    const meals = await Meals.listByDate('2024-06-01');
    // Snapshot should still have original values
    expect(meals[0].foodSnapshot.kcal).toBe(200);
    expect(meals[0].foodSnapshot.prot).toBe(30);
  });

  test('archived food status survives round-trip', async () => {
    const food = await createFood({ name: 'Old' });
    await Foods.setArchived(food.id, true);

    const backup = await db.exportDB();
    await db.resetDB();
    await db.importDB(backup);

    const active = await Foods.list({ status: 'active' });
    const all = await Foods.list({ status: 'all' });
    expect(active).toHaveLength(0);
    expect(all).toHaveLength(1);
    expect(all[0].archived).toBe(true);
  });
});

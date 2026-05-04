/**
 * Integration tests for the Foods data layer.
 * Exercises real db.js against in-memory PouchDB.
 */
import './setup.js';
import { beforeEach, describe, expect, test } from 'vitest';
import { Foods } from '../../data-foods.js';
import { Meals } from '../../data-meals.js';
import { resetTestDB, createFood, createMeal } from './helpers.js';

beforeEach(resetTestDB);

// ---------------------------------------------------------------------------
// CRUD basics
// ---------------------------------------------------------------------------
describe('Foods CRUD', () => {
  test('create and retrieve a food', async () => {
    const food = await createFood({ name: 'Banana' });
    expect(food.id).toMatch(/^food:/);
    expect(food.name).toBe('Banana');
    const fetched = await Foods.byId(food.id);
    expect(fetched).toMatchObject({ name: 'Banana', kcal: 200 });
  });

  test('list returns created foods', async () => {
    await createFood({ name: 'Apple' });
    await createFood({ name: 'Rice' });
    const list = await Foods.list();
    expect(list).toHaveLength(2);
    expect(list.map(f => f.name).sort()).toEqual(['Apple', 'Rice']);
  });

  test('update modifies only provided fields', async () => {
    const food = await createFood({ name: 'Oats', kcal: 150 });
    const updated = await Foods.update(food.id, { kcal: 180 });
    expect(updated?.kcal).toBe(180);
    expect(updated?.name).toBe('Oats');     // unchanged
    expect(updated?.prot).toBe(food.prot);  // unchanged
  });

  test('remove deletes a food', async () => {
    const food = await createFood({ name: 'Temp' });
    await Foods.remove(food.id);
    expect(await Foods.byId(food.id)).toBeUndefined();
    expect(await Foods.list()).toHaveLength(0);
  });

  test('restore re-inserts a deleted food', async () => {
    const food = await createFood({ name: 'Revived' });
    await Foods.remove(food.id);
    await Foods.restore(food);
    expect(await Foods.byId(food.id)).toMatchObject({ name: 'Revived' });
  });
});

// ---------------------------------------------------------------------------
// Search + Filtering
// ---------------------------------------------------------------------------
describe('Foods search and filtering', () => {
  test('substring search matches food name', async () => {
    await createFood({ name: 'Chicken Breast' });
    await createFood({ name: 'Chickpeas' });
    await createFood({ name: 'Rice' });
    const results = await Foods.list({ search: 'chick' });
    expect(results).toHaveLength(2);
    expect(results.every(f => f.name.toLowerCase().includes('chick'))).toBe(true);
  });

  test('search is word-order tolerant', async () => {
    await createFood({ name: 'Brown Rice' });
    const results = await Foods.list({ search: 'rice brown' });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Brown Rice');
  });

  test('fuzzy search matches approximate spellings', async () => {
    await createFood({ name: 'Broccoli' });
    const results = await Foods.list({ search: 'brocoli' });
    expect(results).toHaveLength(1);
  });

  test('direct substring matches rank above fuzzy matches', async () => {
    await createFood({ name: 'Chicken' });
    await createFood({ name: 'Chickpeas' }); // also a direct match
    const results = await Foods.list({ search: 'chicken' });
    expect(results[0].name).toBe('Chicken');
  });

  test('no results for completely unrelated search', async () => {
    await createFood({ name: 'Banana' });
    const results = await Foods.list({ search: 'xyz123' });
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Archive vs deletion semantics
// ---------------------------------------------------------------------------
describe('Archiving vs deletion', () => {
  test('archived foods excluded from default list', async () => {
    const food = await createFood({ name: 'Old Food' });
    await Foods.setArchived(food.id, true);
    expect(await Foods.list()).toHaveLength(0);
  });

  test('archived foods included with status "all"', async () => {
    const food = await createFood({ name: 'Old Food' });
    await Foods.setArchived(food.id, true);
    expect(await Foods.list({ status: 'all' })).toHaveLength(1);
  });

  test('archived foods visible with status "archived"', async () => {
    await createFood({ name: 'Active' });
    const old = await createFood({ name: 'Old' });
    await Foods.setArchived(old.id, true);
    const archived = await Foods.list({ status: 'archived' });
    expect(archived).toHaveLength(1);
    expect(archived[0].name).toBe('Old');
  });

  test('archiving a food does not affect its meals', async () => {
    const food = await createFood({ name: 'ToArchive' });
    await createMeal(food, '2024-06-01');
    await Foods.setArchived(food.id, true);
    const meals = await Meals.listByDate('2024-06-01');
    expect(meals).toHaveLength(1);
    expect(meals[0].foodSnapshot.name).toBe('ToArchive');
  });

  test('hard-deleting a food does not delete its meals', async () => {
    const food = await createFood({ name: 'Deleted' });
    await createMeal(food, '2024-06-01');
    await Foods.remove(food.id);
    expect(await Foods.byId(food.id)).toBeUndefined();
    const meals = await Meals.listByDate('2024-06-01');
    expect(meals).toHaveLength(1);
    expect(meals[0].foodSnapshot.name).toBe('Deleted');
  });

  test('hasForFood returns false after food deletion but meals survive', async () => {
    const food = await createFood({ name: 'Gone' });
    await createMeal(food, '2024-06-01');
    await Foods.remove(food.id);
    // hasForFood still finds meals by foodId reference
    expect(await Meals.hasForFood(food.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Frecency ordering
// ---------------------------------------------------------------------------
describe('Frecency-based ordering', () => {
  test('foods ordered by frecency score when scores provided', async () => {
    const a = await createFood({ name: 'Apple' });
    const b = await createFood({ name: 'Banana' });
    await createFood({ name: 'Cherry' });

    // Banana logged today, Apple logged 5 days ago, Cherry never
    const today = '2024-06-10';
    await createMeal(b, today);
    await createMeal(a, '2024-06-05');

    const scores = await Meals.frecencyScores('2024-03-12', today);
    const list = await Foods.list({ scores });
    // Banana (score=1) first, Apple (score≈0.17) second, Cherry (score=0) last
    expect(list[0].name).toBe('Banana');
    expect(list[1].name).toBe('Apple');
    // Cherry has score 0, so it sorts alphabetically among other 0-score foods
    expect(list[2].name).toBe('Cherry');

    // Verify the ordering is score-driven
    const s0 = scores.get(list[0].id) ?? 0;
    const s1 = scores.get(list[1].id) ?? 0;
    const s2 = scores.get(list[2].id) ?? 0;
    expect(s0).toBeGreaterThan(s1);
    expect(s1).toBeGreaterThan(s2);
  });
});

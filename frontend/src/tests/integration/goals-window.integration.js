/**
 * Integration tests for the 7-day sliding window computation.
 * These mirror the E2E goals-window.spec.js tests but run in-memory.
 */
import './setup.js';
import { beforeEach, describe, expect, test } from 'vitest';
import * as Goals from '../../data-goals.js';
import { resetTestDB, createFood, createMeal, insertGoal } from './helpers.js';

beforeEach(resetTestDB);

/** @param {string} date @param {number} kcal @param {number} [prot] @param {number} [carbs] @param {number} [fats] */
async function seedDay(date, kcal, prot = 0, carbs = 0, fats = 0) {
  const food = await createFood({ name: `Food-${date}`, kcal, prot, carbs, fats });
  await createMeal(food, date);
}

// ---------------------------------------------------------------------------
// computeWindowVM
// ---------------------------------------------------------------------------
describe('computeWindowVM', () => {
  test('returns null when no goals are set', async () => {
    expect(await Goals.computeWindowVM('2024-06-10', null)).toBeNull();
  });

  test('returns null when no meals exist in window', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    const goal = await Goals.getActive('2024-06-10');
    expect(await Goals.computeWindowVM('2024-06-10', goal)).toBeNull();
  });

  test('single day of meals produces a window', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    const goal = await Goals.getActive('2024-06-10');
    await seedDay('2024-06-10', 1800, 120, 180, 60);

    const vm = await Goals.computeWindowVM('2024-06-10', goal);
    expect(vm).not.toBeNull();
    expect(vm?.windowDays).toBe(1);
    expect(vm?.effectiveDays).toBe(1);
    expect(vm?.calories.target).toBe(2000);
  });

  test('effectiveDays counts only logged days', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    const goal = await Goals.getActive('2024-06-10');
    // Log 3 of the last 7 days, including today
    await seedDay('2024-06-04', 2000);
    await seedDay('2024-06-07', 2000);
    await seedDay('2024-06-10', 2000);

    const vm = await Goals.computeWindowVM('2024-06-10', goal);
    expect(vm?.windowDays).toBe(3);
    expect(vm?.effectiveDays).toBe(3);
  });

  test('effectiveDays is +1 when today has no meals', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    const goal = await Goals.getActive('2024-06-10');
    await seedDay('2024-06-05', 2000);
    await seedDay('2024-06-07', 2200);

    const vm = await Goals.computeWindowVM('2024-06-10', goal);
    expect(vm?.windowDays).toBe(2);
    expect(vm?.effectiveDays).toBe(3); // 2 past days + today (not yet logged)
  });

  test('meals outside 7-day window are excluded', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    const goal = await Goals.getActive('2024-06-10');
    await seedDay('2024-06-03', 3000); // 7 days ago — outside window
    await seedDay('2024-06-04', 2000); // 6 days ago — inside

    const vm = await Goals.computeWindowVM('2024-06-10', goal);
    expect(vm?.windowDays).toBe(1); // only 2024-06-04
    expect(vm?.calories.prevSum).toBe(2000);
  });

  test('idealToday compensates for prior over-eating', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    const goal = await Goals.getActive('2024-06-10');
    // Eat 2500 on each of 3 prior days (500 over per day)
    await seedDay('2024-06-07', 2500);
    await seedDay('2024-06-08', 2500);
    await seedDay('2024-06-09', 2500);

    const vm = await Goals.computeWindowVM('2024-06-10', goal);
    // effectiveDays = 3+1 = 4; ideal = 4*2000 - 7500 = 500; clamped to min 2000*0.85 = 1700
    expect(vm?.calories.idealToday).toBe(1700);
  });

  test('idealToday compensates for prior under-eating', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    const goal = await Goals.getActive('2024-06-10');
    // Eat 1500 on each of 3 prior days (500 under per day)
    await seedDay('2024-06-07', 1500);
    await seedDay('2024-06-08', 1500);
    await seedDay('2024-06-09', 1500);

    const vm = await Goals.computeWindowVM('2024-06-10', goal);
    // effectiveDays = 4; ideal = 4*2000 - 4500 = 3500; clamped to max 2000*1.15 = 2300
    expect(vm?.calories.idealToday).toBe(2300);
  });

  test('idealToday clamp range is ±15%', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    const goal = await Goals.getActive('2024-06-10');
    // On-target: ideal should be close to 2000
    await seedDay('2024-06-07', 2000);
    await seedDay('2024-06-08', 2000);
    await seedDay('2024-06-09', 2000);

    const vm = await Goals.computeWindowVM('2024-06-10', goal);
    expect(vm?.calories.idealToday).toBe(2000);
  });

  test('macro windows compute for protein, carbs, fat', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    const goal = await Goals.getActive('2024-06-10');
    const g = Goals.derivedGrams(/** @type {import('../../db.js').GoalRecord} */ (goal));

    await seedDay('2024-06-10', 2000, g.protG, g.carbsG, g.fatG);

    const vm = await Goals.computeWindowVM('2024-06-10', goal);
    expect(vm?.protein.target).toBe(g.protG);
    expect(vm?.carbs.target).toBe(g.carbsG);
    expect(vm?.fat.target).toBe(g.fatG);
  });
});

// ---------------------------------------------------------------------------
// Status computation through computeWindowVM
// ---------------------------------------------------------------------------
describe('Window status computation', () => {
  test('on-target eating yields ok status', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    const goal = await Goals.getActive('2024-06-10');
    await seedDay('2024-06-10', 2000);

    const vm = await Goals.computeWindowVM('2024-06-10', goal);
    expect(vm?.calories.status).toBe('ok');
  });

  test('under-eating yields low status with sparse data', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    const goal = await Goals.getActive('2024-06-10');
    await seedDay('2024-06-10', 1500); // 75% of target — well under

    const vm = await Goals.computeWindowVM('2024-06-10', goal);
    expect(vm?.calories.status).toBe('low');
  });

  test('significant over-eating yields bad status', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    const goal = await Goals.getActive('2024-06-10');
    // With 4+ days (sufficient data), average > 110% of target → bad
    await seedDay('2024-06-07', 2500);
    await seedDay('2024-06-08', 2500);
    await seedDay('2024-06-09', 2500);
    await seedDay('2024-06-10', 2500);

    const vm = await Goals.computeWindowVM('2024-06-10', goal);
    expect(vm?.calories.status).toBe('bad');
  });

  test('moderate over-eating yields warn status', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    const goal = await Goals.getActive('2024-06-10');
    // avg just over 105% → warn
    await seedDay('2024-06-07', 2100);
    await seedDay('2024-06-08', 2100);
    await seedDay('2024-06-09', 2100);
    await seedDay('2024-06-10', 2150);

    const vm = await Goals.computeWindowVM('2024-06-10', goal);
    expect(vm?.calories.status).toBe('warn');
  });

  test('clamped window: eating idealToday exactly shows ok', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    const goal = await Goals.getActive('2024-06-10');
    // Heavy over-eating on prior days — idealToday clamped to 0.85*2000=1700
    await seedDay('2024-06-07', 3000);
    await seedDay('2024-06-08', 3000);
    await seedDay('2024-06-09', 3000);
    // Today eats exactly idealToday → clamped path, ratio=1.0 → ok
    await seedDay('2024-06-10', 1700);

    const vm = await Goals.computeWindowVM('2024-06-10', goal);
    expect(vm?.calories.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// statusForDay (heatmap computation)
// ---------------------------------------------------------------------------
describe('statusForDay', () => {
  test('on-target day returns ok', () => {
    const kcalByDay = { '2024-06-10': 2000 };
    expect(Goals.statusForDay(kcalByDay, '2024-06-10', 2000)).toBe('ok');
  });

  test('under-eating returns low', () => {
    const kcalByDay = { '2024-06-10': 1500 };
    expect(Goals.statusForDay(kcalByDay, '2024-06-10', 2000)).toBe('low');
  });

  test('over-eating with history returns appropriate status', () => {
    const kcalByDay = {
      '2024-06-04': 2500,
      '2024-06-05': 2500,
      '2024-06-06': 2500,
      '2024-06-07': 2500,
      '2024-06-08': 2500,
      '2024-06-09': 2500,
      '2024-06-10': 2500,
    };
    expect(Goals.statusForDay(kcalByDay, '2024-06-10', 2000)).toBe('bad');
  });

  test('no entry for date returns appropriate status', () => {
    // With only prior data, computing for a day with no meals
    const kcalByDay = { '2024-06-09': 2000 };
    const status = Goals.statusForDay(kcalByDay, '2024-06-10', 2000);
    // Consumed is 0, but ideal is ~2000, so consumed/ideal ≈ 0 → low
    expect(status).toBe('low');
  });
});

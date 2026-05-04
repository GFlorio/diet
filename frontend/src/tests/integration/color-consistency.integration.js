/**
 * Integration tests ensuring color/status consistency across the three UI
 * surfaces that display meal status:
 *
 *   1. Macro cards (meals page hero + per-macro cards) — via macroVisuals()
 *   2. Quick-add food cards (prospective macro contribution) — via macroVisuals()
 *   3. Heatmap cells (goals page) — via statusForDay()
 *
 * All three ultimately call computeDayStatus(). These tests verify that
 * identical data produces identical statuses regardless of entry point.
 */
import './setup.js';
import { beforeEach, describe, expect, test } from 'vitest';
import * as Goals from '../../data-goals.js';
import { Meals } from '../../data-meals.js';
import { resetTestDB, createFood, createMeal, insertGoal, buildKcalByDay } from './helpers.js';

beforeEach(resetTestDB);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the calorie status as the meals page would (via computeWindowVM + macroVisuals).
 * @param {string} todayISO
 * @returns {Promise<string>}
 */
async function mealPageCalStatus(todayISO) {
  const goal = await Goals.getActive(todayISO);
  if (!goal) { return 'none'; }
  const wvm = await Goals.computeWindowVM(todayISO, goal);
  if (!wvm) { return 'none'; }
  const todayMeals = await Meals.listByDate(todayISO);
  let consumed = 0;
  for (const m of todayMeals) { consumed += m.foodSnapshot.kcal * m.multiplier; }
  return Goals.macroVisuals(consumed, wvm.calories, wvm.effectiveDays).status;
}

/**
 * Compute the calorie status as the heatmap would (via statusForDay).
 * @param {string} dateISO
 * @returns {Promise<string>}
 */
async function heatmapCalStatus(dateISO) {
  const goal = await Goals.getActive(dateISO);
  if (!goal) { return 'none'; }
  // Build kcalByDay over the full 7-day window so statusForDay has context
  const d = new Date(`${dateISO}T00:00:00`);
  d.setDate(d.getDate() - 6);
  const fromISO = d.toISOString().slice(0, 10);
  const kcalByDay = await buildKcalByDay(fromISO, dateISO);
  return Goals.statusForDay(kcalByDay, dateISO, goal.kcal);
}

/**
 * Compute the calorie status as the quick-add card would (prospective total).
 * @param {string} todayISO
 * @param {number} addedKcal additional kcal from the prospective food
 * @returns {Promise<string>}
 */
async function quickAddCalStatus(todayISO, addedKcal) {
  const goal = await Goals.getActive(todayISO);
  if (!goal) { return 'none'; }
  const wvm = await Goals.computeWindowVM(todayISO, goal);
  const todayMeals = await Meals.listByDate(todayISO);
  let consumed = 0;
  for (const m of todayMeals) { consumed += m.foodSnapshot.kcal * m.multiplier; }
  const prospective = consumed + addedKcal;
  const ed = wvm?.effectiveDays ?? 1;
  return Goals.macroVisuals(prospective, wvm?.calories ?? null, ed, goal.kcal).status;
}

// ---------------------------------------------------------------------------
// Core consistency: macro cards vs heatmap for kcal
// ---------------------------------------------------------------------------
describe('Macro cards vs heatmap calorie status consistency', () => {
  test('both report ok when eating on target', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    await seedDay('2024-06-10', 2000);

    const macro = await mealPageCalStatus('2024-06-10');
    const heatmap = await heatmapCalStatus('2024-06-10');
    expect(macro).toBe('ok');
    expect(heatmap).toBe('ok');
    expect(macro).toBe(heatmap);
  });

  test('both report low when significantly under target', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    await seedDay('2024-06-10', 1200);

    const macro = await mealPageCalStatus('2024-06-10');
    const heatmap = await heatmapCalStatus('2024-06-10');
    expect(macro).toBe('low');
    expect(heatmap).toBe('low');
  });

  test('both report bad when consistently over-eating', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    for (let i = 4; i <= 10; i++) {
      await seedDay(`2024-06-${String(i).padStart(2, '0')}`, 2500);
    }

    const macro = await mealPageCalStatus('2024-06-10');
    const heatmap = await heatmapCalStatus('2024-06-10');
    expect(macro).toBe('bad');
    expect(heatmap).toBe('bad');
  });

  test('both agree on warn with moderate over-eating', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    await seedDay('2024-06-07', 2100);
    await seedDay('2024-06-08', 2100);
    await seedDay('2024-06-09', 2100);
    await seedDay('2024-06-10', 2150);

    const macro = await mealPageCalStatus('2024-06-10');
    const heatmap = await heatmapCalStatus('2024-06-10');
    expect(macro).toBe(heatmap);
  });

  test('both agree with sparse data (1-3 logged days)', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    await seedDay('2024-06-09', 2000);
    await seedDay('2024-06-10', 2000);

    const macro = await mealPageCalStatus('2024-06-10');
    const heatmap = await heatmapCalStatus('2024-06-10');
    expect(macro).toBe(heatmap);
  });

  test('both agree when only today has meals', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    await seedDay('2024-06-10', 2000);

    const macro = await mealPageCalStatus('2024-06-10');
    const heatmap = await heatmapCalStatus('2024-06-10');
    expect(macro).toBe(heatmap);
  });

  test('both agree when prior days were under and today is over', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    await seedDay('2024-06-07', 1500);
    await seedDay('2024-06-08', 1500);
    await seedDay('2024-06-09', 1500);
    await seedDay('2024-06-10', 2300); // ideal is ~2300 due to compensation

    const macro = await mealPageCalStatus('2024-06-10');
    const heatmap = await heatmapCalStatus('2024-06-10');
    expect(macro).toBe(heatmap);
  });

  test('clamped window shows ok in both paths when eating idealToday', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    // Heavy over-eating on prior days — idealToday clamped to 0.85*2000=1700
    await seedDay('2024-06-07', 3000);
    await seedDay('2024-06-08', 3000);
    await seedDay('2024-06-09', 3000);
    // Today eats exactly idealToday → clamped path → ok in both rendering paths
    await seedDay('2024-06-10', 1700);

    const macro = await mealPageCalStatus('2024-06-10');
    const heatmap = await heatmapCalStatus('2024-06-10');
    expect(macro).toBe('ok');
    expect(heatmap).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Quick-add card consistency
// ---------------------------------------------------------------------------
describe('Quick-add card vs macro card consistency', () => {
  test('quick-add with 0 extra matches current macro card status', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    await seedDay('2024-06-10', 1800);

    const macro = await mealPageCalStatus('2024-06-10');
    const quickAdd = await quickAddCalStatus('2024-06-10', 0);
    expect(quickAdd).toBe(macro);
  });

  test('quick-add shows worse status when food would push over threshold', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    await seedDay('2024-06-10', 1900); // Just under target

    const before = await quickAddCalStatus('2024-06-10', 0);
    const after = await quickAddCalStatus('2024-06-10', 500); // 2400 total — 20% over

    expect(before).toBe('ok');
    // 2400/2000 = 1.20, well past the sparse-data ok band (±10%)
    expect(['warn', 'bad']).toContain(after);
  });

  test('quick-add shows lower severity than threshold when food keeps under', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    await seedDay('2024-06-10', 1700);

    const status = await quickAddCalStatus('2024-06-10', 200); // 1900 total — ok
    expect(status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Multi-macro consistency: all macros go through macroVisuals
// ---------------------------------------------------------------------------
describe('Per-macro status consistency', () => {
  test('all macros report ok when on target', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    const goal = /** @type {import('../../db.js').GoalRecord} */ (await Goals.getActive('2024-06-10'));
    const g = Goals.derivedGrams(goal);

    // Eat exactly on target for all macros
    await seedDay('2024-06-10', 2000, g.protG, g.carbsG, g.fatG);

    const wvm = await Goals.computeWindowVM('2024-06-10', goal);
    const ed = wvm?.effectiveDays ?? 1;

    const calVis  = Goals.macroVisuals(2000, wvm?.calories, ed);
    const protVis = Goals.macroVisuals(g.protG, wvm?.protein, ed);
    const carbVis = Goals.macroVisuals(g.carbsG, wvm?.carbs, ed);
    const fatVis  = Goals.macroVisuals(g.fatG, wvm?.fat, ed);

    expect(calVis.status).toBe('ok');
    expect(protVis.status).toBe('ok');
    expect(carbVis.status).toBe('ok');
    expect(fatVis.status).toBe('ok');
  });

  test('bar segments are consistent with status', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    const goal = /** @type {import('../../db.js').GoalRecord} */ (await Goals.getActive('2024-06-10'));

    // Over-eat just calories
    await seedDay('2024-06-10', 2500, 100, 150, 50);

    const wvm = await Goals.computeWindowVM('2024-06-10', goal);
    const ed = wvm?.effectiveDays ?? 1;
    const calVis = Goals.macroVisuals(2500, wvm?.calories, ed);

    // When status is ok or low, bar should have no warn/bad segments
    if (calVis.status === 'ok' || calVis.status === 'low') {
      expect(calVis.bar.warnPct).toBe(0);
      expect(calVis.bar.badPct).toBe(0);
    }
    // When status is warn, bar should have no bad segment
    if (calVis.status === 'warn') {
      expect(calVis.bar.badPct).toBe(0);
      expect(calVis.bar.warnPct).toBeGreaterThan(0);
    }
    // Bar segments should sum to <= 100
    expect(calVis.bar.basePct + calVis.bar.warnPct + calVis.bar.badPct).toBeLessThanOrEqual(100 + 0.001);
  });

  test('macroVisuals without WindowVM uses fallback goal', () => {
    const vis = Goals.macroVisuals(2000, null, 1, 2000);
    expect(vis.status).toBe('ok');
    expect(vis.bar.basePct).toBeCloseTo(100, 0);
  });

  test('macroVisuals without WindowVM or fallback returns none', () => {
    const vis = Goals.macroVisuals(1500, null, 1);
    expect(vis.status).toBe('none');
    expect(vis.bar.basePct).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Heatmap + macro cards over multiple days
// ---------------------------------------------------------------------------
describe('Multi-day consistency', () => {
  test('heatmap status for each day matches what macro cards would show', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });

    // Seed a full week with varying consumption
    const days = [
      { date: '2024-06-04', kcal: 1800 },
      { date: '2024-06-05', kcal: 2000 },
      { date: '2024-06-06', kcal: 2200 },
      { date: '2024-06-07', kcal: 1600 },
      { date: '2024-06-08', kcal: 2100 },
      { date: '2024-06-09', kcal: 2400 },
      { date: '2024-06-10', kcal: 1900 },
    ];
    for (const { date, kcal } of days) {
      await seedDay(date, kcal);
    }

    // For each day, verify heatmap and meal-page views agree
    for (const { date } of days) {
      const macro = await mealPageCalStatus(date);
      const heatmap = await heatmapCalStatus(date);
      expect(macro).toBe(heatmap);
    }
  });

  test('heatmap uses correct goal for each date', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    await insertGoal({ effectiveFrom: '2024-07-01', kcal: 1800, protPct: 25, carbsPct: 45, fatPct: 30 });

    // Well separated dates so they don't share a 7-day window
    await seedDay('2024-06-15', 2000); // old goal: 2000 → ok
    await seedDay('2024-07-15', 1800); // new goal: 1800 → ok

    const hJun = await heatmapCalStatus('2024-06-15');
    expect(hJun).toBe('ok');

    const hJul = await heatmapCalStatus('2024-07-15');
    expect(hJul).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// barSegments boundary conditions
// ---------------------------------------------------------------------------
describe('barSegments boundary conditions', () => {
  test('consumed exactly at target: 100% base, no warn/bad', () => {
    const bar = Goals.barSegments(2000, 2000, 'ok');
    expect(bar.basePct).toBeCloseTo(100, 1);
    expect(bar.warnPct).toBe(0);
    expect(bar.badPct).toBe(0);
  });

  test('consumed at 0: all segments are 0', () => {
    const bar = Goals.barSegments(0, 2000, 'ok');
    expect(bar.basePct).toBe(0);
    expect(bar.warnPct).toBe(0);
    expect(bar.badPct).toBe(0);
  });

  test('consumed over target with ok status: bar is capped at 100% base', () => {
    const bar = Goals.barSegments(2200, 2000, 'ok');
    expect(bar.basePct).toBe(100);
    expect(bar.warnPct).toBe(0);
    expect(bar.badPct).toBe(0);
  });

  test('consumed over target with warn status: base + warn, no bad', () => {
    const bar = Goals.barSegments(2200, 2000, 'warn');
    expect(bar.basePct).toBeGreaterThan(0);
    expect(bar.warnPct).toBeGreaterThan(0);
    expect(bar.badPct).toBe(0);
    expect(bar.basePct + bar.warnPct).toBeCloseTo(100, 1);
  });

  test('consumed over target with bad status: base + warn + bad', () => {
    const bar = Goals.barSegments(2500, 2000, 'bad');
    expect(bar.basePct).toBeGreaterThan(0);
    expect(bar.warnPct).toBeGreaterThan(0);
    expect(bar.badPct).toBeGreaterThan(0);
    expect(bar.basePct + bar.warnPct + bar.badPct).toBeCloseTo(100, 1);
  });

  test('zero target returns all zeros', () => {
    const bar = Goals.barSegments(500, 0, 'bad');
    expect(bar).toEqual({ basePct: 0, warnPct: 0, badPct: 0 });
  });
});

// ---------------------------------------------------------------------------
// Helper: seed a day
// ---------------------------------------------------------------------------
/** @param {string} date @param {number} kcal @param {number} [prot] @param {number} [carbs] @param {number} [fats] */
async function seedDay(date, kcal, prot = 0, carbs = 0, fats = 0) {
  const food = await createFood({ name: `Food-${date}`, kcal, prot, carbs, fats });
  await createMeal(food, date);
}

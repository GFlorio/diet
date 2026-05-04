/**
 * Integration tests for the Goals data layer.
 * Effective date resolution, save/overwrite, window computation.
 */
import './setup.js';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as Goals from '../../data-goals.js';
import { resetTestDB, insertGoal } from './helpers.js';

beforeEach(resetTestDB);

// ---------------------------------------------------------------------------
// Goal effective date resolution
// ---------------------------------------------------------------------------
describe('Goal effective date resolution', () => {
  test('getActive returns goal effective on or before given date', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000 });
    await insertGoal({ effectiveFrom: '2024-06-01', kcal: 1800 });

    const jan = await Goals.getActive('2024-03-15');
    expect(jan?.kcal).toBe(2000);

    const jun = await Goals.getActive('2024-06-15');
    expect(jun?.kcal).toBe(1800);

    const exact = await Goals.getActive('2024-06-01');
    expect(exact?.kcal).toBe(1800);
  });

  test('getActive returns null when no goal covers the date', async () => {
    await insertGoal({ effectiveFrom: '2024-06-01', kcal: 2000 });
    expect(await Goals.getActive('2024-05-31')).toBeNull();
  });

  test('goalForDate works with pre-sorted list', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000 });
    await insertGoal({ effectiveFrom: '2024-06-01', kcal: 1800 });
    const all = await Goals.list();

    expect(Goals.goalForDate(all, '2024-03-15')?.kcal).toBe(2000);
    expect(Goals.goalForDate(all, '2024-06-15')?.kcal).toBe(1800);
    expect(Goals.goalForDate(all, '2023-12-31')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Goal save and overwrite
// ---------------------------------------------------------------------------
describe('Goal save', () => {
  test('save creates a goal for today', async () => {
    vi.spyOn(await import('../../utils.js'), 'isoToday').mockReturnValue('2024-06-10');
    const goal = await Goals.save({
      maintenanceKcal: 2200,
      calMode: 'deficit',
      calMagnitude: 200,
      protPct: 30,
      carbsPct: 40,
      fatPct: 30,
    });
    expect(goal.kcal).toBe(2000);
    expect(goal.effectiveFrom).toBe('2024-06-10');
    vi.restoreAllMocks();
  });

  test('save overwrites same-day goal (no duplicates)', async () => {
    vi.spyOn(await import('../../utils.js'), 'isoToday').mockReturnValue('2024-06-10');
    await Goals.save({
      maintenanceKcal: 2200, calMode: 'deficit', calMagnitude: 200,
      protPct: 30, carbsPct: 40, fatPct: 30,
    });
    await Goals.save({
      maintenanceKcal: 2500, calMode: 'surplus', calMagnitude: 300,
      protPct: 25, carbsPct: 45, fatPct: 30,
    });
    const all = await Goals.list();
    const todayGoals = all.filter(g => g.effectiveFrom === '2024-06-10');
    expect(todayGoals).toHaveLength(1);
    expect(todayGoals[0].kcal).toBe(2800);
    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// updateEffectiveFrom
// ---------------------------------------------------------------------------
describe('updateEffectiveFrom', () => {
  test('updates the date of an existing goal', async () => {
    await insertGoal({ effectiveFrom: '2024-06-01', kcal: 2000 });
    const all = await Goals.list();
    await Goals.updateEffectiveFrom(all[0].id, '2024-07-01');
    const updated = await Goals.list();
    expect(updated[0].effectiveFrom).toBe('2024-07-01');
  });

  test('rejects duplicate effectiveFrom dates', async () => {
    await insertGoal({ effectiveFrom: '2024-06-01', kcal: 2000 });
    await insertGoal({ effectiveFrom: '2024-07-01', kcal: 1800 });
    const all = await Goals.list();
    const june = all.find(g => g.effectiveFrom === '2024-06-01');
    await expect(Goals.updateEffectiveFrom(june?.id ?? '', '2024-07-01'))
      .rejects.toThrow('Another goal already starts on this date');
  });
});

// ---------------------------------------------------------------------------
// Derived gram targets
// ---------------------------------------------------------------------------
describe('derivedGrams', () => {
  test('converts goal percentages to gram targets', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000, protPct: 30, carbsPct: 40, fatPct: 30 });
    const goal = /** @type {import('../../db.js').GoalRecord} */ (await Goals.getActive('2024-06-01'));
    const g = Goals.derivedGrams(goal);
    // 2000 * 0.30 / 4 = 150g protein
    expect(g.protG).toBe(150);
    // 2000 * 0.40 / 4 = 200g carbs
    expect(g.carbsG).toBe(200);
    // 2000 * 0.30 / 9 ≈ 67g fat
    expect(g.fatG).toBe(67);
  });
});

// ---------------------------------------------------------------------------
// Goal deletion
// ---------------------------------------------------------------------------
describe('Goal deletion', () => {
  test('deleteRecord removes a specific goal', async () => {
    await insertGoal({ effectiveFrom: '2024-01-01', kcal: 2000 });
    await insertGoal({ effectiveFrom: '2024-06-01', kcal: 1800 });
    const all = await Goals.list();
    await Goals.deleteRecord(all[0].id);
    expect(await Goals.list()).toHaveLength(1);
  });
});

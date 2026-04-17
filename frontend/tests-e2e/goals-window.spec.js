import { expect, test } from '@playwright/test';
import { insertMeals, loadPouchDB, resetDB } from './playwright-helpers.js';

// --- shared fixtures --------------------------------------------------------

const GOALS = { kcal: 2000, prot: 30, carbs: 45, fat: 25 };
// Macro values that correspond exactly to goal (2000 kcal, 30/45/25 split)
const AT_GOAL = { kcal: 2000, prot: 150, carbs: 225, fats: 56 };
const CHICKEN = { name: 'Chicken', refLabel: '100 g', kcal: 165, prot: 31, carbs: 0, fats: 3.6 };

/**
 * ISO date string offset from today.
 * isoOffset(0) = today, isoOffset(-1) = yesterday, isoOffset(1) = tomorrow.
 * @param {number} n
 */
function isoOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** @param {import('@playwright/test').Page} page */
async function createFood(page, f) {
  await page.locator('.tab', { hasText: 'Foods' }).click();
  await page.fill('#foodName', f.name);
  await page.fill('#foodRefLabel', f.refLabel);
  await page.fill('#foodKcal', String(f.kcal));
  await page.fill('#foodProt', String(f.prot));
  await page.fill('#foodCarb', String(f.carbs));
  await page.fill('#foodFat', String(f.fats));
  await page.click('#saveFoodBtn');
}

/** @param {import('@playwright/test').Page} page */
async function setGoals(page, { kcal, prot, carbs }) {
  await page.locator('.tab', { hasText: 'Goals' }).click();
  await page.click('[data-testid="goalsEditBtn"]');
  await page.fill('[data-testid="goalsMaintenanceKcal"]', String(kcal));
  await page.locator('[data-testid="goalsMagnitude"]').evaluate(el => {
    /** @type {HTMLInputElement} */ (el).value = '0';
    el.dispatchEvent(new CustomEvent('stepper-set'));
  });
  await page.locator('[data-testid="goalsProtPct"]').evaluate((el, v) => {
    /** @type {HTMLInputElement} */ (el).value = String(v);
    el.dispatchEvent(new CustomEvent('stepper-set'));
  }, prot);
  await page.locator('[data-testid="goalsCarbsPct"]').evaluate((el, v) => {
    /** @type {HTMLInputElement} */ (el).value = String(v);
    el.dispatchEvent(new CustomEvent('stepper-set'));
  }, carbs);
  await page.click('[data-testid="goalsSaveBtn"]');
}

// ---------------------------------------------------------------------------

test.describe('Goals: 7-day window — date navigation and meal history', () => {
  test.beforeEach(async ({ page }) => {
    await loadPouchDB(page);
    await page.goto('/');
    await resetDB(page);
    await page.reload();
  });

  // --- basic window activation -----------------------------------------------

  test('window VM activates after meals are logged on a past day', async ({ page }) => {
    // Arrange
    await setGoals(page, GOALS);
    await insertMeals(page, [{ date: isoOffset(-1), ...AT_GOAL }]);

    // Act: navigate to Meals tab (today)
    await page.locator('.tab', { hasText: 'Meals' }).click();

    // Assert: hero switches to avg mode because yesterday has data
    await expect(page.locator('.summary-hero-value .unit')).toHaveText('kcal avg');
    await expect(page.locator('.summary-hero-subtext').first()).toContainText('1/7 days logged');
  });

  test('windowDays increments as meals are added to distinct days', async ({ page }) => {
    // Arrange: two prev days with meals
    await setGoals(page, GOALS);
    await insertMeals(page, [
      { date: isoOffset(-2), ...AT_GOAL },
      { date: isoOffset(-1), ...AT_GOAL },
    ]);

    await page.locator('.tab', { hasText: 'Meals' }).click();

    // Assert: two logged days in window
    await expect(page.locator('.summary-hero-subtext').first()).toContainText('2/7 days logged');
  });

  test('multiple meals on the same day count as one day in the window', async ({ page }) => {
    // Arrange: two insertions for the same past day
    await setGoals(page, GOALS);
    await insertMeals(page, [
      { date: isoOffset(-1), kcal: 1000, prot: 75, carbs: 112, fats: 28 },
      { date: isoOffset(-1), kcal: 1000, prot: 75, carbs: 113, fats: 28 },
    ]);

    await page.locator('.tab', { hasText: 'Meals' }).click();

    // Two meals → still only 1 day
    await expect(page.locator('.summary-hero-subtext').first()).toContainText('1/7 days logged');
  });

  // --- window boundary -------------------------------------------------------

  test('meal logged exactly 6 days ago is included in the window', async ({ page }) => {
    // T−6 is the start of today's [T−6, T] window
    await setGoals(page, GOALS);
    await insertMeals(page, [{ date: isoOffset(-6), ...AT_GOAL }]);

    await page.locator('.tab', { hasText: 'Meals' }).click();

    await expect(page.locator('.summary-hero-value .unit')).toHaveText('kcal avg');
    await expect(page.locator('.summary-hero-subtext').first()).toContainText('1/7 days logged');
  });

  test('meal logged 7 days ago is excluded from today\'s window', async ({ page }) => {
    // T−7 is outside today's [T−6, T] window
    await setGoals(page, GOALS);
    await insertMeals(page, [{ date: isoOffset(-7), ...AT_GOAL }]);

    await page.locator('.tab', { hasText: 'Meals' }).click();

    // No meals in window → fallback goals mode, not avg mode
    await expect(page.locator('.summary-hero-value .unit')).toHaveText('kcal');
    await expect(page.locator('.summary-hero-subtext')).not.toContainText('/7 days logged');
  });

  // --- window anchor = curDate (bug fix) -------------------------------------

  test('window is recomputed relative to the currently viewed date, not real today', async ({ page }) => {
    // T−7 is outside today's window but inside yesterday's window [T−7, T−1].
    await setGoals(page, GOALS);
    await insertMeals(page, [
      { date: isoOffset(-7), ...AT_GOAL },
      { date: isoOffset(-1), ...AT_GOAL },
    ]);

    // Viewing today: window is [T−6, T] → only T−1 is in range → 1 day
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await expect(page.locator('.summary-hero-subtext').first()).toContainText('1/7 days logged');

    // Navigate to yesterday: window becomes [T−7, T−1] → both T−1 and T−7 in range → 2 days
    await page.click('#prevDayBox');
    await expect(page.locator('.summary-hero-subtext').first()).toContainText('2/7 days logged');
  });

  test('meal on a future date is included in that date\'s own window', async ({ page }) => {
    // When viewing tomorrow the window is [T−5, T+1], so tomorrow's own meal is included.
    await createFood(page, CHICKEN);
    await setGoals(page, GOALS);

    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.click('#nextDayBox'); // go to tomorrow
    await page.fill('#quickSearch', 'chi');
    await page.click('#quickList .item .add');

    // Tomorrow's meal is todayMacros in tomorrow's window → avg mode active
    await expect(page.locator('.summary-hero-value .unit')).toHaveText('kcal avg');
    await expect(page.locator('.summary-hero-subtext').first()).toContainText('1/7 days logged');
  });

  test('future meal does not appear in today\'s window', async ({ page }) => {
    // After adding tomorrow's meal, navigating back to today should show no window data.
    await createFood(page, CHICKEN);
    await setGoals(page, GOALS);

    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.click('#nextDayBox');
    await page.fill('#quickSearch', 'chi');
    await page.click('#quickList .item .add');
    await page.click('#prevDayBox'); // back to today

    // Tomorrow is outside today's [T−6, T] window → no window VM
    await expect(page.locator('.summary-hero-value .unit')).toHaveText('kcal');
    await expect(page.locator('.summary-hero-subtext')).not.toContainText('/7 days logged');
  });

  // --- add / remove meals across dates ---------------------------------------

  test('adding meals to past days via navigation updates the window count', async ({ page }) => {
    await createFood(page, CHICKEN);
    await setGoals(page, GOALS);

    await page.locator('.tab', { hasText: 'Meals' }).click();

    // Add a meal 2 days ago
    await page.click('#prevDayBox');
    await page.click('#prevDayBox');
    await page.fill('#quickSearch', 'chi');
    await page.click('#quickList .item .add');

    // Add a meal yesterday
    await page.click('#nextDayBox');
    await page.fill('#quickSearch', 'chi');
    await page.click('#quickList .item .add');

    // Navigate back to today: 2 past days have meals → 2/7 days logged
    await page.click('#nextDayBox');
    await expect(page.locator('.summary-hero-subtext').first()).toContainText('2/7 days logged');
  });

  test('deleting today\'s last meal keeps idealToday stable', async ({ page }) => {
    // Arrange: 1 prev day at goal so effectiveDays = 2 both before and after deletion.
    await createFood(page, CHICKEN);
    await setGoals(page, GOALS);
    await insertMeals(page, [{ date: isoOffset(-1), ...AT_GOAL }]);

    await page.locator('.tab', { hasText: 'Meals' }).click();

    // Add a Chicken meal today (165 kcal)
    await page.fill('#quickSearch', 'chi');
    await page.click('#quickList .item .add');

    // Before deletion: idealToday = 2×2000−2000 = 2000; consumed = 165 → delta = 1835
    const deltaLine = page.locator('.summary-hero-subtext').nth(1);
    await expect(deltaLine).toContainText('kcal left');

    // Delete today's meal
    await page.locator('#mealsList .meal-row .del').click();

    // After deletion: effectiveDays = 1+1 = 2, prevSum = 2000, idealToday = 2000; consumed = 0
    // The bug would have set effectiveDays = windowDays (1) → ideal = 1×2000−2000 = 0 → clamped to 1700
    await expect(deltaLine).toContainText('2000 kcal left');
    // Window count drops to 1 (only prev day now)
    await expect(page.locator('.summary-hero-subtext').first()).toContainText('1/7 days logged');
  });

  test('undoing a meal deletion restores window state', async ({ page }) => {
    await createFood(page, CHICKEN);
    await setGoals(page, GOALS);

    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'chi');
    await page.click('#quickList .item .add');

    // Delete, then undo
    await page.locator('#mealsList .meal-row .del').click();
    await expect(page.locator('#mealsList .meal-row')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();

    // Meal is restored → window re-activates with today logged
    await expect(page.locator('#mealsList .meal-row')).toHaveCount(1);
    await expect(page.locator('.summary-hero-value .unit')).toHaveText('kcal avg');
    await expect(page.locator('.summary-hero-subtext').first()).toContainText('1/7 days logged');
  });

  // --- idealToday guidance --------------------------------------------------

  test('hero shows kcal-left guidance toward idealToday when meals exist', async ({ page }) => {
    await createFood(page, CHICKEN);
    await setGoals(page, GOALS);

    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'chi');
    await page.click('#quickList .item .add');

    // With 1 day logged (today), effectiveDays = 1, prevSum = 0, idealToday = 2000
    // consumed = 165 → delta = 2000 − 165 = 1835 kcal left
    await expect(page.locator('.summary-hero-subtext').nth(1)).toContainText('1835 kcal left');
  });

  test('hero shows kcal-over guidance when consumed exceeds idealToday', async ({ page }) => {
    await setGoals(page, GOALS);
    // Insert one prev day way below goal so today's idealToday is clamped to max (2300)
    await insertMeals(page, [{ date: isoOffset(-1), kcal: 200, prot: 15, carbs: 22, fats: 6 }]);
    // Insert today at 2500 kcal (> idealToday of 2300)
    await insertMeals(page, [{ date: isoOffset(0), kcal: 2500, prot: 150, carbs: 225, fats: 56 }]);

    await page.locator('.tab', { hasText: 'Meals' }).click();

    // consumed 2500 > idealToday 2300 → over guidance
    await expect(page.locator('.summary-hero-subtext').nth(1)).toContainText('kcal over');
  });
});

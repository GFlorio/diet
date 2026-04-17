import { expect, test } from '@playwright/test';
import { insertGoals, insertMeals, loadPouchDB, localIsoToday, resetDB } from './playwright-helpers.js';

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
async function setGoals(page, { kcal, prot, carbs, fat: _fat }) {
  await page.locator('.tab', { hasText: 'Goals' }).click();
  await page.click('[data-testid="goalsEditBtn"]');
  const maintenanceKcal = kcal; // treat kcal as maintenance, use 0 magnitude
  await page.fill('[data-testid="goalsMaintenanceKcal"]', String(maintenanceKcal));
  // Set magnitude to 0 so target = maintenance
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="goalsMagnitude"]');
    el.value = '0';
    el.dispatchEvent(new Event('stepper-set'));
  });
  await page.evaluate((p) => {
    const el = document.querySelector('[data-testid="goalsProtPct"]');
    el.value = String(p);
    el.dispatchEvent(new Event('stepper-set'));
  }, prot);
  await page.evaluate((c) => {
    const el = document.querySelector('[data-testid="goalsCarbsPct"]');
    el.value = String(c);
    el.dispatchEvent(new Event('stepper-set'));
  }, carbs);
  await page.click('[data-testid="goalsSaveBtn"]');
}

const RICE = { name: 'Rice', refLabel: '100g', kcal: 130, prot: 2.4, carbs: 28, fats: 0.3 };

test.describe('Goals page: heatmap', () => {
  test.beforeEach(async ({ page }) => {
    await loadPouchDB(page);
    await page.goto('/');
    await resetDB(page);
    await page.reload();
  });

  test('heatmap card is visible on the goals page', async ({ page }) => {
    // Act
    await page.locator('.tab', { hasText: 'Goals' }).click();

    // Assert
    await expect(page.locator('[data-testid="heatmapCard"]')).toBeVisible();
  });

  test('heatmap shows a note to set targets when no goals are set', async ({ page }) => {
    // Act
    await page.locator('.tab', { hasText: 'Goals' }).click();

    // Assert: informational note about setting goals
    await expect(page.locator('[data-testid="heatmapCard"]')).toContainText('Set daily targets');
  });

  test('heatmap does not show the targets note once goals are set', async ({ page }) => {
    // Arrange
    await setGoals(page, { kcal: 2000, prot: 30, carbs: 45, fat: 25 });

    // Assert
    await expect(page.locator('[data-testid="heatmapCard"]')).not.toContainText('Set daily targets');
  });

  test("today's cell is empty when no meals logged", async ({ page }) => {
    // Arrange
    await setGoals(page, { kcal: 2000, prot: 30, carbs: 45, fat: 25 });
    const isoToday = localIsoToday();

    // Act
    await page.locator('.tab', { hasText: 'Goals' }).click();

    // Assert: today's cell has "empty" status (no meals logged)
    await expect(page.locator(`.cal-day[data-iso="${isoToday}"]`)).toHaveClass(/cal-day-empty/);
  });

  test("today's cell shows adherence status after logging a meal", async ({ page }) => {
    // Arrange: set goals well above what rice provides so status is 'bad'
    await createFood(page, RICE);
    await setGoals(page, { kcal: 2000, prot: 30, carbs: 45, fat: 25 });
    const isoToday = localIsoToday();

    // Act: log a meal and navigate to goals
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'ric');
    await page.click('#quickList .item .add');
    await page.locator('.tab', { hasText: 'Goals' }).click();

    // Assert: today's cell is no longer empty — has some adherence status
    const todayCell = page.locator(`.cal-day[data-iso="${isoToday}"]`);
    await expect(todayCell).not.toHaveClass(/cal-day-empty/);
    await expect(todayCell).not.toHaveClass(/cal-day-future/);
  });

  test("clicking today's cell shows a tooltip with kcal info", async ({ page }) => {
    // Arrange
    await createFood(page, RICE);
    await setGoals(page, { kcal: 2000, prot: 30, carbs: 45, fat: 25 });
    const isoToday = localIsoToday();

    // Act: log a meal, navigate to goals, hover today's cell (desktop shows tooltip on hover)
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'ric');
    await page.click('#quickList .item .add');
    await page.locator('.tab', { hasText: 'Goals' }).click();
    await page.locator(`.cal-day[data-iso="${isoToday}"]`).hover();

    // Assert: tooltip is visible and contains kcal
    const tooltip = page.locator('#calTooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('kcal');
  });
});

test.describe('Goals page: history panel', () => {
  test.beforeEach(async ({ page }) => {
    await loadPouchDB(page);
    await page.goto('/');
    await resetDB(page);
    await page.reload();
  });

  test('history button is visible after setting goals', async ({ page }) => {
    // Arrange
    await setGoals(page, { kcal: 2000, prot: 30, carbs: 45, fat: 25 });

    // Assert
    await page.locator('.tab', { hasText: 'Goals' }).click();
    await expect(page.locator('[data-testid="goalHistoryBtn"]')).toBeVisible();
  });

  test('history button is not visible when no goals are set', async ({ page }) => {
    // Act
    await page.locator('.tab', { hasText: 'Goals' }).click();

    // Assert
    await expect(page.locator('[data-testid="goalHistoryBtn"]')).not.toBeVisible();
  });

  test('history panel opens when clock button is clicked', async ({ page }) => {
    // Arrange
    await setGoals(page, { kcal: 2000, prot: 30, carbs: 45, fat: 25 });

    // Act
    await page.locator('.tab', { hasText: 'Goals' }).click();
    await page.click('[data-testid="goalHistoryBtn"]');

    // Assert: panel is open with history list visible
    await expect(page.locator('[data-testid="goalHistoryList"]')).toBeVisible();
    await expect(page.locator('#goalHistoryPanel')).toBeVisible();
  });

  test('history panel shows active badge on the current goal', async ({ page }) => {
    // Arrange
    await setGoals(page, { kcal: 2000, prot: 30, carbs: 45, fat: 25 });

    // Act
    await page.locator('.tab', { hasText: 'Goals' }).click();
    await page.click('[data-testid="goalHistoryBtn"]');

    // Assert
    await expect(page.locator('.goal-history-badge')).toContainText('Active');
  });

  test('history panel closes when X button is clicked', async ({ page }) => {
    // Arrange
    await setGoals(page, { kcal: 2000, prot: 30, carbs: 45, fat: 25 });
    await page.locator('.tab', { hasText: 'Goals' }).click();
    await page.click('[data-testid="goalHistoryBtn"]');
    await expect(page.locator('#goalHistoryPanel')).toBeVisible();

    // Act
    await page.locator('.goal-history-close').click();

    // Assert
    await expect(page.locator('#goalHistoryPanel')).not.toBeVisible();
  });

  test('delete non-last record removes it from the panel', async ({ page }) => {
    // Arrange: seed two goal records via DB
    const isoToday = localIsoToday();
    const lastMonth = `${isoToday.slice(0, 7)}-01`;
    const olderDate = lastMonth < isoToday ? lastMonth : '2024-01-01';
    await insertGoals(page, [
      { id: 'goal:newer', effectiveFrom: isoToday, kcal: 2000, maintenanceKcal: 2000, calMode: 'deficit', calMagnitude: 0, protPct: 30, carbsPct: 45, fatPct: 25, createdAt: 2000 },
      { id: 'goal:older', effectiveFrom: olderDate, kcal: 1800, maintenanceKcal: 1800, calMode: 'deficit', calMagnitude: 0, protPct: 30, carbsPct: 45, fatPct: 25, createdAt: 1000 },
    ]);
    await page.reload();
    await page.locator('.tab', { hasText: 'Goals' }).click();
    await page.click('[data-testid="goalHistoryBtn"]');

    // Act: delete the older record (second delete button)
    const deleteButtons = page.locator('.goal-history-delete');
    await deleteButtons.nth(1).click();

    // Assert: only one record remains
    await expect(page.locator('.goal-history-row')).toHaveCount(1);
  });

  test('deleting last record shows inline confirmation', async ({ page }) => {
    // Arrange: exactly one goal record
    const isoToday = localIsoToday();
    await insertGoals(page, [
      { id: 'goal:only', effectiveFrom: isoToday, kcal: 2000, maintenanceKcal: 2000, calMode: 'deficit', calMagnitude: 0, protPct: 30, carbsPct: 45, fatPct: 25, createdAt: 1000 },
    ]);
    await page.reload();
    await page.locator('.tab', { hasText: 'Goals' }).click();
    await page.click('[data-testid="goalHistoryBtn"]');

    // Act: click delete on the only record
    await page.locator('.goal-history-delete').click();

    // Assert: inline confirmation appears, panel still open
    await expect(page.locator('.goal-history-confirm')).toBeVisible();
    await expect(page.locator('#goalHistoryPanel')).toBeVisible();
  });

  test('confirming delete of last record closes panel and shows no-goals state', async ({ page }) => {
    // Arrange
    const isoToday = localIsoToday();
    await insertGoals(page, [
      { id: 'goal:only', effectiveFrom: isoToday, kcal: 2000, maintenanceKcal: 2000, calMode: 'deficit', calMagnitude: 0, protPct: 30, carbsPct: 45, fatPct: 25, createdAt: 1000 },
    ]);
    await page.reload();
    await page.locator('.tab', { hasText: 'Goals' }).click();
    await page.click('[data-testid="goalHistoryBtn"]');
    await page.locator('.goal-history-delete').click();

    // Act: confirm deletion
    await page.locator('.goal-history-confirm button').click();

    // Assert: panel closes, goals card shows no-goals state
    await expect(page.locator('#goalHistoryPanel')).not.toBeVisible();
    await expect(page.locator('[data-testid="goalsCard"]')).toContainText('No daily targets');
  });

  test('heatmap cells use the goal active on their date, not the current goal', async ({ page }) => {
    // Arrange: two goals — older with 1800 kcal, newer with 2200 kcal
    // Seed meals: one in the older period (130 kcal → bad vs 1800, also bad vs 2200)
    // and one in the newer period (1800 kcal → ok vs 1800, bad vs 2200)
    const isoToday = localIsoToday();
    // older period: 30 days ago
    const olderDate = new Date(isoToday);
    olderDate.setDate(olderDate.getDate() - 30);
    const olderISO = olderDate.toISOString().slice(0, 10);
    // newer goal started 15 days ago
    const newerGoalDate = new Date(isoToday);
    newerGoalDate.setDate(newerGoalDate.getDate() - 15);
    const newerGoalISO = newerGoalDate.toISOString().slice(0, 10);

    await insertGoals(page, [
      { id: 'goal:older', effectiveFrom: olderISO, kcal: 1800, maintenanceKcal: 1800, calMode: 'deficit', calMagnitude: 0, protPct: 30, carbsPct: 45, fatPct: 25, createdAt: 1000 },
      { id: 'goal:newer', effectiveFrom: newerGoalISO, kcal: 2200, maintenanceKcal: 2200, calMode: 'deficit', calMagnitude: 0, protPct: 30, carbsPct: 45, fatPct: 25, createdAt: 2000 },
    ]);
    // Meal in older period: 1800 kcal (ok vs 1800, bad vs 2200)
    await insertMeals(page, [{ date: olderISO, kcal: 1800, prot: 135, carbs: 202, fats: 50 }]);

    await page.reload();
    await page.locator('.tab', { hasText: 'Goals' }).click();

    // Assert: the older cell is 'ok' (evaluated against 1800 kcal goal, not 2200)
    const olderCell = page.locator(`.cal-day[data-iso="${olderISO}"]`);
    await expect(olderCell).toHaveClass(/cal-day-ok/);
  });
});

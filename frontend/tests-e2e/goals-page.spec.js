import { test, expect } from '@playwright/test';
import { resetDB } from './playwright-helpers.js';

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
async function setGoals(page, { kcal, prot, carbs, fat }) {
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
    await page.goto('/');
    await resetDB(page, 'nutri-pwa');
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
    const isoToday = new Date().toISOString().slice(0, 10);

    // Act
    await page.locator('.tab', { hasText: 'Goals' }).click();

    // Assert: today's cell has "empty" status (no meals logged)
    await expect(page.locator(`.cal-day[data-iso="${isoToday}"]`)).toHaveClass(/cal-day-empty/);
  });

  test("today's cell shows adherence status after logging a meal", async ({ page }) => {
    // Arrange: set goals well above what rice provides so status is 'bad'
    await createFood(page, RICE);
    await setGoals(page, { kcal: 2000, prot: 30, carbs: 45, fat: 25 });
    const isoToday = new Date().toISOString().slice(0, 10);

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
    const isoToday = new Date().toISOString().slice(0, 10);

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

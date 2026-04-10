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

const RICE = { name: 'Rice', refLabel: '100g', kcal: 130, prot: 2.4, carbs: 28, fats: 0.3 };

test.describe('Report: date range filtering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await resetDB(page, 'nutri-pwa');
    await page.reload();
  });

  test('shows one data row for a day with meals in range', async ({ page }) => {
    // Arrange: add one meal for today
    await createFood(page, RICE);
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'ric');
    await page.click('#quickList .item .add');

    // Act: open report and refresh (default range is last 7 days, covers today)
    await page.locator('.tab', { hasText: 'Report' }).click();
    await page.click('#repRefresh');

    // Assert: header row + one data row for today
    const rows = page.locator('#repTable .item.rep-row');
    await expect(rows).toHaveCount(2);
    const isoToday = new Date().toISOString().slice(0, 10);
    await expect(page.locator('#repTable')).toContainText(isoToday);
  });

  test('shows one row per day when meals span multiple days', async ({ page }) => {
    // Arrange: add a meal today and one yesterday
    await createFood(page, RICE);
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'ric');
    await page.click('#quickList .item .add');
    await page.click('#prevDayBox');
    await page.fill('#quickSearch', 'ric');
    await page.click('#quickList .item .add');

    // Act
    await page.locator('.tab', { hasText: 'Report' }).click();
    await page.click('#repRefresh');

    // Assert: header + today + yesterday = 3 rows
    const rows = page.locator('#repTable .item.rep-row');
    await expect(rows).toHaveCount(3);
  });

  test('shows error toast when date range is invalid (from > to)', async ({ page }) => {
    // Act: submit a reversed range
    await page.locator('.tab', { hasText: 'Report' }).click();
    await page.fill('#repFrom', '2024-03-01');
    await page.fill('#repTo', '2024-01-01');
    await page.click('#repRefresh');

    // Assert: error toast appears
    await expect(page.locator('.toast.error')).toBeVisible();
    await expect(page.locator('.toast.error')).toContainText('Invalid range');
  });

  test('shows empty state when no meals fall within the selected range', async ({ page }) => {
    // Arrange: add a meal for today
    await createFood(page, RICE);
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'ric');
    await page.click('#quickList .item .add');

    // Act: narrow the range to a past window that excludes today
    await page.locator('.tab', { hasText: 'Report' }).click();
    await page.fill('#repFrom', '2020-01-01');
    await page.fill('#repTo', '2020-01-07');
    await page.click('#repRefresh');

    // Assert
    await expect(page.locator('#repTable')).toContainText('No meals in range');
  });
});

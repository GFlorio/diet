import { expect, test } from '@playwright/test';
import { getAllFromStore, insertFoods, insertGoals, insertMeals, resetDB } from './playwright-helpers.js';

const FOOD = { id: 'food:1', name: 'Chicken', refLabel: '100 g', kcal: 165, prot: 31, carbs: 0, fats: 3.6, archived: false, updatedAt: 1 };
const MEAL = { id: 'meal:2024-01-15:0000000000001', foodId: 'food:1', foodSnapshot: { id: 'food:1', name: 'Chicken', refLabel: '100 g', kcal: 165, prot: 31, carbs: 0, fats: 3.6, updatedAt: 1 }, multiplier: 1, date: '2024-01-15', updatedAt: 1 };
const GOAL = { id: 'goal:abc', effectiveFrom: '2024-01-01', kcal: 2000, maintenanceKcal: 2200, calMode: 'deficit', calMagnitude: 200, protPct: 30, carbsPct: 40, fatPct: 30, createdAt: 1 };

async function openSettings(page) {
  await page.locator('#configBtn').click();
  await expect(page.locator('#configModal')).toBeVisible();
}

test.describe('Export / Import database', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await resetDB(page);
    await page.reload();
  });

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------
  test('export downloads a JSON file with all stores and correct structure', async ({ page }) => {
    // Arrange — seed one record in each store
    await insertFoods(page, [FOOD]);
    await insertMeals(page, [MEAL]);
    await insertGoals(page, [GOAL]);

    // Act — open settings and click Export
    await openSettings(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#exportDBBtn').click(),
    ]);

    // Assert — filename contains today's date
    expect(download.suggestedFilename()).toMatch(/^diet-backup-\d{4}-\d{2}-\d{2}\.json$/);

    // Assert — file content is valid JSON with correct shape
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) { chunks.push(chunk); }
    const json = JSON.parse(Buffer.concat(chunks).toString());

    expect(json.version).toBe(1);
    expect(typeof json.exportedAt).toBe('string');
    expect(json.foods).toHaveLength(1);
    expect(json.foods[0]).toMatchObject({ id: 'food:1', name: 'Chicken' });
    expect(json.meals).toHaveLength(1);
    expect(json.meals[0]).toMatchObject({ date: '2024-01-15', multiplier: 1 });
    expect(json.goals).toHaveLength(1);
    expect(json.goals[0]).toMatchObject({ id: 'goal:abc' });
  });

  test('export of empty database contains empty arrays', async ({ page }) => {
    // Act
    await openSettings(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#exportDBBtn').click(),
    ]);

    // Assert
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) { chunks.push(chunk); }
    const json = JSON.parse(Buffer.concat(chunks).toString());

    expect(json.version).toBe(1);
    expect(json.foods).toEqual([]);
    expect(json.meals).toEqual([]);
    expect(json.goals).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Import
  // -------------------------------------------------------------------------
  test('import replaces existing data with backup file contents', async ({ page }) => {
    // Arrange — seed data that should be wiped
    await insertFoods(page, [FOOD]);

    const backup = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      foods: [
        { id: 'food:99', name: 'Import Food', refLabel: '100 g', kcal: 200, prot: 10, carbs: 30, fats: 5, archived: false, updatedAt: 2 },
      ],
      meals: [],
      goals: [],
    });

    // Act — set up navigation listener before triggering the import so we
    // catch the window.location.reload() that fires after confirmation.
    await openSettings(page);
    const navPromise = page.waitForNavigation({ waitUntil: 'networkidle' });
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#importDBFile').setInputFiles(
      { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) },
    );
    await navPromise;

    // Assert — old food gone, imported food present
    const foods = await getAllFromStore(page, 'foods');
    expect(foods).toHaveLength(1);
    expect(foods[0]).toMatchObject({ id: 'food:99', name: 'Import Food' });
  });

  test('import cancelled by user leaves database unchanged', async ({ page }) => {
    // Arrange
    await insertFoods(page, [FOOD]);

    const backup = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), foods: [], meals: [], goals: [] });

    // Act — dismiss the confirmation dialog
    await openSettings(page);
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.locator('#importDBFile').setInputFiles(
      { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) },
    );

    // Give the app a moment to not reload
    await page.waitForTimeout(300);

    // Assert — data unchanged
    const foods = await getAllFromStore(page, 'foods');
    expect(foods).toHaveLength(1);
    expect(foods[0].id).toBe('food:1');
  });

  test('import of invalid JSON shows alert and leaves database unchanged', async ({ page }) => {
    // Arrange
    await insertFoods(page, [FOOD]);

    // Act — upload malformed JSON; app should alert and not reload
    await openSettings(page);
    const [alertMessage] = await Promise.all([
      page.waitForEvent('dialog').then((dialog) => {
        const msg = dialog.message();
        dialog.accept();
        return msg;
      }),
      page.locator('#importDBFile').setInputFiles(
        { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('not json at all') },
      ),
    ]);

    expect(alertMessage).toContain('valid diet backup');

    // Assert — data unchanged
    const foods = await getAllFromStore(page, 'foods');
    expect(foods).toHaveLength(1);
  });
});

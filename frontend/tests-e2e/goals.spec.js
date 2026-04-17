import { expect, test } from '@playwright/test';
import { getAllFromStore, loadPouchDB, resetDB } from './playwright-helpers.js';

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

/**
 * Set goals via the stepper form: maintenance = kcal, magnitude = 0 (so target = maintenance).
 * Sets prot first (carbs/fat auto-adjust proportionally), then carbs (fat auto-adjusts).
 * Uses 'stepper-set' custom events on hidden state inputs for precise programmatic control.
 */
async function setGoals(page, { kcal, prot, carbs, fat: _fat }) {
  await page.locator('.tab', { hasText: 'Goals' }).click();
  await page.click('[data-testid="goalsEditBtn"]');
  await page.fill('[data-testid="goalsMaintenanceKcal"]', String(kcal));
  // Set magnitude to 0 so target = maintenance
  await page.locator('[data-testid="goalsMagnitude"]').evaluate(el => {
    /** @type {HTMLInputElement} */ (el).value = '0';
    el.dispatchEvent(new CustomEvent('stepper-set'));
  });
  // Set protein (carbs/fat auto-adjust proportionally)
  await page.locator('[data-testid="goalsProtPct"]').evaluate((el, v) => {
    /** @type {HTMLInputElement} */ (el).value = String(v);
    el.dispatchEvent(new CustomEvent('stepper-set'));
  }, prot);
  // Set carbs (fat auto-adjusts to remainder)
  await page.locator('[data-testid="goalsCarbsPct"]').evaluate((el, v) => {
    /** @type {HTMLInputElement} */ (el).value = String(v);
    el.dispatchEvent(new CustomEvent('stepper-set'));
  }, carbs);
  await page.click('[data-testid="goalsSaveBtn"]');
}

const CHICKEN = { name: 'Chicken', refLabel: '100 g', kcal: 165, prot: 31, carbs: 0, fats: 3.6 };

test.describe('Goals: settings UI', () => {
  test.beforeEach(async ({ page }) => {
    await loadPouchDB(page);
    await page.goto('/');
    await resetDB(page);
    await page.reload();
  });

  test('shows "no targets" prompt when no goals are set', async ({ page }) => {
    // Arrange / Act
    await page.locator('.tab', { hasText: 'Goals' }).click();

    // Assert
    await expect(page.locator('[data-testid="goalsCard"]')).toContainText('No daily targets set yet');
    await expect(page.locator('[data-testid="goalsEditBtn"]')).toContainText('Set daily targets');
  });

  test('can set goals and see them displayed', async ({ page }) => {
    // Act
    await setGoals(page, { kcal: 2000, prot: 30, carbs: 45, fat: 25 });

    // Assert: display mode shows values
    await expect(page.locator('[data-testid="goalsCard"]')).toContainText('2000 kcal');
    await expect(page.locator('[data-testid="goalsCard"]')).toContainText('30%');
    await expect(page.locator('[data-testid="goalsCard"]')).toContainText('45%');
    await expect(page.locator('[data-testid="goalsCard"]')).toContainText('25%');
    // Derived grams should appear
    await expect(page.locator('[data-testid="goalsCard"]')).toContainText('150 g'); // protein
  });

  test('saves goals to IndexedDB', async ({ page }) => {
    // Act
    await setGoals(page, { kcal: 1800, prot: 25, carbs: 50, fat: 25 });
    // Wait for save to complete (edit form closes and view re-renders)
    await expect(page.locator('[data-testid="goalsSaveBtn"]')).not.toBeVisible();

    // Assert: check DB
    const records = await getAllFromStore(page, 'goals');
    expect(records).toHaveLength(1);
    expect(records[0].id).toMatch(/^goal:/);
    expect(records[0].kcal).toBe(1800);
    expect(records[0].maintenanceKcal).toBe(1800);
    expect(records[0].calMode).toBe('deficit');
    expect(records[0].calMagnitude).toBe(0);
    expect(records[0].protPct).toBe(25);
    expect(records[0].carbsPct).toBe(50);
    expect(records[0].fatPct).toBe(25);
  });

  test('Save is disabled when maintenance calories is empty', async ({ page }) => {
    // Arrange
    await page.locator('.tab', { hasText: 'Goals' }).click();
    await page.click('[data-testid="goalsEditBtn"]');

    // Assert: no maintenance filled → save disabled
    await expect(page.locator('[data-testid="goalsSaveBtn"]')).toBeDisabled();
  });

  test('Save is enabled once valid maintenance calories is entered', async ({ page }) => {
    // Arrange
    await page.locator('.tab', { hasText: 'Goals' }).click();
    await page.click('[data-testid="goalsEditBtn"]');

    // Act
    await page.fill('[data-testid="goalsMaintenanceKcal"]', '2000');

    // Assert
    await expect(page.locator('[data-testid="goalsSaveBtn"]')).not.toBeDisabled();
  });

  test('macro split bar always sums to 100%', async ({ page }) => {
    // Arrange
    await page.locator('.tab', { hasText: 'Goals' }).click();
    await page.click('[data-testid="goalsEditBtn"]');

    // Act: set protein to 35% via stepper-set (carbs/fat auto-adjust proportionally)
    await page.locator('[data-testid="goalsProtPct"]').evaluate(el => {
      /** @type {HTMLInputElement} */ (el).value = '35';
      el.dispatchEvent(new CustomEvent('stepper-set'));
    });

    // Assert: prot + carbs + fat = 100 (read from hidden state inputs)
    const prot  = await page.locator('[data-testid="goalsProtPct"]').inputValue();
    const carbs = await page.locator('[data-testid="goalsCarbsPct"]').inputValue();
    const fat   = await page.locator('[data-testid="goalsFatPct"]').inputValue();
    expect(Number(prot) + Number(carbs) + Number(fat)).toBe(100);
  });

  test('can remove goals', async ({ page }) => {
    // Arrange: set goals first
    await setGoals(page, { kcal: 2000, prot: 30, carbs: 45, fat: 25 });

    // Act: edit and remove
    await page.click('[data-testid="goalsEditBtn"]');
    await page.click('[data-testid="goalsRemoveBtn"]');

    // Assert: back to empty state
    await expect(page.locator('[data-testid="goalsCard"]')).toContainText('No daily targets set yet');
    const records = await getAllFromStore(page, 'goals');
    expect(records).toHaveLength(0);
  });

  test('cancel restores display mode without saving', async ({ page }) => {
    // Arrange: set goals
    await setGoals(page, { kcal: 2000, prot: 30, carbs: 45, fat: 25 });

    // Act: open edit form, change maintenance, then cancel
    await page.click('[data-testid="goalsEditBtn"]');
    await page.fill('[data-testid="goalsMaintenanceKcal"]', '9999');
    await page.click('[data-testid="goalsCancelBtn"]');

    // Assert: original values still shown
    await expect(page.locator('[data-testid="goalsCard"]')).toContainText('2000 kcal');
    await expect(page.locator('[data-testid="goalsCard"]')).not.toContainText('9999 kcal');
  });
});

test.describe('Goals: daily status on Meals page', () => {
  test.beforeEach(async ({ page }) => {
    await loadPouchDB(page);
    await page.goto('/');
    await resetDB(page);
    await page.reload();
  });

  test('macro cards show no status classes when no goals are set', async ({ page }) => {
    // Arrange: add a food and log a meal
    await createFood(page, CHICKEN);
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'chi');
    await page.click('#quickList .item .add');

    // Assert: macro cards have no status tinting
    await expect(page.locator('.macro-card.macro-protein')).not.toHaveClass(/status-ok|status-warn|status-bad/);
  });

  test('macro cards show status when goals are set', async ({ page }) => {
    // Arrange: set goals that match one serving of chicken
    await createFood(page, CHICKEN);
    // Goals: 2000 kcal, protein 30% → 150g target, but chicken has 31g prot
    await setGoals(page, { kcal: 2000, prot: 30, carbs: 45, fat: 25 });

    // Act: navigate to meals and add chicken
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'chi');
    await page.click('#quickList .item .add');

    // Assert: protein card shows a status class (any of ok/warn/bad)
    const protCard = page.locator('.macro-card.macro-protein');
    const cls = await protCard.getAttribute('class');
    expect(cls).toMatch(/status-ok|status-warn|status-bad/);
  });

  test('hero progress bar is visible when goals are set', async ({ page }) => {
    // Arrange
    await createFood(page, CHICKEN);
    await setGoals(page, { kcal: 2000, prot: 30, carbs: 45, fat: 25 });

    // Act
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'chi');
    await page.click('#quickList .item .add');

    // Assert: hero bar is rendered and has a fill > 0
    await expect(page.locator('.summary-hero-bar')).toBeVisible();
    await expect(page.locator('.summary-hero-bar-fill')).toBeVisible();
  });

  test('hero progress bar is absent when no goals are set', async ({ page }) => {
    // Arrange
    await createFood(page, CHICKEN);
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'chi');
    await page.click('#quickList .item .add');

    // Assert
    await expect(page.locator('.summary-hero-bar')).toHaveCount(0);
  });
});

test.describe('Goals: impact preview in quick-add list', () => {
  test.beforeEach(async ({ page }) => {
    await loadPouchDB(page);
    await page.goto('/');
    await resetDB(page);
    await page.reload();
  });

  test('shows macro contribution line for every food result', async ({ page }) => {
    // Arrange
    await createFood(page, CHICKEN);
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'chi');

    // Assert: macro line always present with kcal contribution
    await expect(page.locator('.food-card-macros').first()).toContainText('+165 kcal');
  });

  test('shows macro line without status colors when no goals are set', async ({ page }) => {
    // Arrange: no goals
    await createFood(page, CHICKEN);
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'chi');

    // Assert: no status color spans without goals
    await expect(page.locator('.food-card-macros .status-ok, .food-card-macros .status-warn, .food-card-macros .status-bad')).toHaveCount(0);
  });

  test('shows status-colored macros when goals are set', async ({ page }) => {
    // Arrange
    await createFood(page, CHICKEN);
    await setGoals(page, { kcal: 2000, prot: 30, carbs: 45, fat: 25 });

    // Act
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'chi');

    // Assert: kcal contribution colored ok (165 kcal << 2000 goal)
    await expect(page.locator('.food-card-macros .status-ok').first()).toContainText('+165 kcal');
  });
});

test.describe('Goals: 7-day window', () => {
  test.beforeEach(async ({ page }) => {
    await loadPouchDB(page);
    await page.goto('/');
    await resetDB(page);
    await page.reload();
  });

  test('hero shows plain today kcal when no goals set', async ({ page }) => {
    // Arrange
    await page.locator('.tab', { hasText: 'Meals' }).click();

    // Assert: hero unit is "kcal" (not "kcal avg"), no status label present
    await expect(page.locator('.summary-hero-value .unit')).toHaveText('kcal');
    await expect(page.locator('.summary-hero-subtext')).toHaveCount(0);
  });

  test('hero shows 7-day avg and delta after goals are set and a meal is logged', async ({ page }) => {
    // Arrange: create food, set goals, log a meal
    await createFood(page, CHICKEN);
    await setGoals(page, { kcal: 2000, prot: 30, carbs: 45, fat: 25 });
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'chi');
    await page.click('#quickList .item .add');

    // Assert: hero shows avg label and a status line
    await expect(page.locator('.summary-hero-value .unit')).toHaveText('kcal avg');

    // Assert: second subtext line shows today's delta guidance
    const deltaLine = page.locator('.summary-hero-subtext').nth(1);
    await expect(deltaLine).toContainText(/kcal (left|over)/);
  });

  test('macro cards show avg value and delta after goals are set and a meal is logged', async ({ page }) => {
    // Arrange
    await createFood(page, CHICKEN);
    await setGoals(page, { kcal: 2000, prot: 30, carbs: 45, fat: 25 });
    await page.locator('.tab', { hasText: 'Meals' }).click();
    await page.fill('#quickSearch', 'chi');
    await page.click('#quickList .item .add');

    // Assert: macro cards show "g avg" unit and per-macro delta subtext
    const proteinCard = page.locator('.macro-protein');
    await expect(proteinCard.locator('.macro-value .unit')).toHaveText('g avg');
    await expect(proteinCard.locator('.macro-subtext')).toContainText(/g (left|over)/);
  });

});

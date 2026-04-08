import { test, expect } from '@playwright/test';
import { getAllFromStore, resetDB } from './playwright-helpers.js';

const DB_NAME = 'nutri-pwa';

test.describe('Food form validation UI', () => {
	test.beforeEach(async ({ page }) => {
		// Arrange: open app with a clean IndexedDB state
		await page.goto('/');
		await resetDB(page, DB_NAME);
		await page.reload();
		await page.locator('.tab', { hasText: 'Foods' }).click();
	});

		/**
		 * Fill the food form with default valid values, allowing overrides per test case.
		 * @param {import('@playwright/test').Page} page
		 * @param {Partial<Record<'name'|'refLabel'|'kcal'|'prot'|'carbs'|'fats', string>>} overrides
		 */
		async function fillFoodForm(page, overrides = {}) {
		const defaults = {
			name: 'Chicken breast',
			refLabel: '100 g',
			kcal: '165',
			prot: '31',
			carbs: '0',
			fats: '3.6',
		};
		const values = { ...defaults, ...overrides };
		await page.locator('#foodName').fill(values.name ?? '');
		await page.locator('#foodRefLabel').fill(values.refLabel ?? '');
		await page.locator('#foodKcal').fill(values.kcal ?? '');
		await page.locator('#foodProt').fill(values.prot ?? '');
		await page.locator('#foodCarb').fill(values.carbs ?? '');
		await page.locator('#foodFat').fill(values.fats ?? '');
	}

		/** Disable built-in browser validation so we can assert app-side validation feedback */
		async function disableNativeValidation(page) {
			await page.locator('#foodForm').evaluate((form) => {
				form.setAttribute('novalidate', 'true');
			});
		}

	test('shows inline validation when name is missing', async ({ page }) => {
		// Arrange: fill everything except the required name field
		await disableNativeValidation(page);
		await fillFoodForm(page, { name: '   ' });

		// Act: attempt to submit the form
		await page.locator('#saveFoodBtn').click();

		// Assert: inline error message + field highlight are shown
		await expect(page.locator('#foodFormMsg')).toHaveText(/Invalid fields/i);
		await expect(page.locator('#foodName')).toHaveClass(/error/);

		// Assert: other fields retain their values (form not cleared)
		await expect(page.locator('#foodRefLabel')).toHaveValue('100 g');
		await expect(page.locator('#foodKcal')).toHaveValue('165');
		await expect(page.locator('#foodProt')).toHaveValue('31');

		// Assert: nothing persisted in IndexedDB after failed validation
		const foods = await getAllFromStore(page, DB_NAME, 'foods');
		expect(foods).toHaveLength(0);
	});

	test('rejects negative numbers in macro inputs', async ({ page }) => {
		// Arrange: valid fields except negative kcal
		await disableNativeValidation(page);
		await fillFoodForm(page, { kcal: '-50' });

		// Act
		await page.locator('#saveFoodBtn').click();

		// Assert: error message and kcal input styled as error
		await expect(page.locator('#foodFormMsg')).toHaveText(/Invalid fields/i);
		await expect(page.locator('#foodKcal')).toHaveClass(/error/);
		await expect(page.locator('#foodKcal')).toHaveValue('-50');

		const foods = await getAllFromStore(page, DB_NAME, 'foods');
		expect(foods).toHaveLength(0);
	});

	test('rejects out-of-range macro values', async ({ page }) => {
		// Arrange: enter values above allowed maxima
		await disableNativeValidation(page);
		await fillFoodForm(page, { kcal: '6000', prot: '1500' });

		// Act
		await page.locator('#saveFoodBtn').click();

		// Assert: error message shown and offending fields highlighted
		await expect(page.locator('#foodFormMsg')).toHaveText(/Invalid fields/i);
		await expect(page.locator('#foodKcal')).toHaveClass(/error/);
		await expect(page.locator('#foodProt')).toHaveClass(/error/);

		// Assert: values remain so users can correct them
		await expect(page.locator('#foodKcal')).toHaveValue('6000');
		await expect(page.locator('#foodProt')).toHaveValue('1500');

		const foods = await getAllFromStore(page, DB_NAME, 'foods');
		expect(foods).toHaveLength(0);
	});
});

import { test, expect } from '@playwright/test';
import { getAllFromStore, resetDB, loadPouchDB } from './playwright-helpers.js';


test.describe('Food form validation UI', () => {
	test.beforeEach(async ({ page }) => {
		// Arrange: open app with a clean IndexedDB state
		await loadPouchDB(page);
		await page.goto('/');
		await resetDB(page);
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
		const foods = await getAllFromStore(page, 'foods');
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

		const foods = await getAllFromStore(page, 'foods');
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

		const foods = await getAllFromStore(page, 'foods');
		expect(foods).toHaveLength(0);
	});

	test('rejects name with characters outside the allowed pattern', async ({ page }) => {
		// Arrange: name contains characters not in /^[\p{L}\p{N}\s'\-_.()]+$/u
		await disableNativeValidation(page);
		await fillFoodForm(page, { name: 'Bad@Name!' });

		// Act
		await page.locator('#saveFoodBtn').click();

		// Assert: name field flagged, nothing saved
		await expect(page.locator('#foodFormMsg')).toHaveText(/Invalid fields/i);
		await expect(page.locator('#foodName')).toHaveClass(/error/);
		const foods = await getAllFromStore(page, 'foods');
		expect(foods).toHaveLength(0);
	});

	test('accepts name with unicode letters and parentheses', async ({ page }) => {
		// Arrange: name uses characters that are explicitly allowed by the pattern
		await fillFoodForm(page, { name: 'Café (raw)' });

		// Act
		await page.locator('#saveFoodBtn').click();

		// Assert: food created successfully
		await expect(page.locator('#foodsList')).toContainText('Café (raw)');
		const foods = await getAllFromStore(page, 'foods');
		expect(foods).toHaveLength(1);
		expect(foods[0].name).toBe('Café (raw)');
	});

	test('accepts name at exactly 120 characters (boundary)', async ({ page }) => {
		// Arrange: 120 chars is the configured maxLen
		const name = 'a'.repeat(120);
		await fillFoodForm(page, { name });

		// Act
		await page.locator('#saveFoodBtn').click();
		// Wait for the async save to complete — form resets to empty on success
		await expect(page.locator('#foodName')).toHaveValue('');

		// Assert: food saved — boundary value is valid
		const foods = await getAllFromStore(page, 'foods');
		expect(foods).toHaveLength(1);
		expect(foods[0].name).toBe(name);
	});

	test('rejects name at 121 characters (one over boundary)', async ({ page }) => {
		// Arrange: 121 chars exceeds maxLen:120
		await disableNativeValidation(page);
		const name = 'a'.repeat(121);
		await fillFoodForm(page, { name });

		// Act
		await page.locator('#saveFoodBtn').click();

		// Assert: name field flagged, nothing saved
		await expect(page.locator('#foodFormMsg')).toHaveText(/Invalid fields/i);
		await expect(page.locator('#foodName')).toHaveClass(/error/);
		const foods = await getAllFromStore(page, 'foods');
		expect(foods).toHaveLength(0);
	});

	test('live debounce: error class applied ~400ms after invalid input, cleared on correction', async ({ page }) => {
		// Arrange: fill all fields with valid values so the only failure is the one we introduce
		await fillFoodForm(page);

		// Act: overwrite kcal with an invalid value (triggers the 400ms debounce)
		await page.fill('#foodKcal', '-999');

		// Assert: error not shown immediately (debounce has not fired yet)
		// Reading the class synchronously via evaluate avoids Playwright's auto-retry
		const hasErrorImmediately = await page.locator('#foodKcal').evaluate(
			el => el.classList.contains('error')
		);
		expect(hasErrorImmediately).toBe(false);

		// Assert: error class eventually appears once the debounce fires (≤400ms + render tick)
		await expect(page.locator('#foodKcal')).toHaveClass(/error/);

		// Act: correct the value — should clear the error after the next debounce cycle
		await page.fill('#foodKcal', '200');
		await expect(page.locator('#foodKcal')).not.toHaveClass(/error/);
	});
});

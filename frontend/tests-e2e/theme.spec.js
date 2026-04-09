import { test, expect } from '@playwright/test';

test.describe('Theme: cycling, persistence, and fallback', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Clear any stored theme so tests start from the default auto state
    await page.evaluate(() => localStorage.removeItem('theme'));
    await page.reload();
  });

  test('theme button cycles auto → light → dark → auto', async ({ page }) => {
    // Arrange: no stored theme → default is 'auto'
    const initial = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(initial).toBe('auto');

    // Act + Assert: first click → light
    await page.click('#themeBtn');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('#themeBtn')).toContainText('☀️');

    // Act + Assert: second click → dark
    await page.click('#themeBtn');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#themeBtn')).toContainText('🌙');

    // Act + Assert: third click → back to auto
    await page.click('#themeBtn');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'auto');
    await expect(page.locator('#themeBtn')).toContainText('🌓');
  });

  test('selected theme persists across page reload via localStorage', async ({ page }) => {
    // Arrange: cycle to 'dark'
    await page.click('#themeBtn'); // auto → light
    await page.click('#themeBtn'); // light → dark
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Act: reload the page (localStorage persists, DB is not involved)
    await page.reload();

    // Assert: theme is restored from localStorage
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#themeBtn')).toContainText('🌙');
  });

  test('invalid localStorage value falls back to auto', async ({ page }) => {
    // Arrange: manually corrupt the stored theme
    await page.evaluate(() => localStorage.setItem('theme', 'invalid_value'));

    // Act: reload so setupTheme() runs with the corrupted value
    await page.reload();

    // Assert: getStoredTheme() rejects unknown values and defaults to 'auto'
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'auto');
    await expect(page.locator('#themeBtn')).toContainText('🌓');
  });
});

import { test, expect } from '@playwright/test';

test.describe('Theme: selection, persistence, and fallback', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Clear any stored theme so tests start from the default auto state
    await page.evaluate(() => localStorage.removeItem('theme'));
    await page.reload();
  });

  async function openSettings(page) {
    await page.click('#configBtn');
    await page.waitForSelector('#configModal[open]');
  }

  test('theme buttons set the correct data-theme attribute', async ({ page }) => {
    // Arrange: no stored theme → default is 'auto'
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'auto');

    // Act + Assert: open settings and select light
    await openSettings(page);
    await page.click('.config-theme-btn[data-theme="light"]');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Act + Assert: select dark
    await page.click('.config-theme-btn[data-theme="dark"]');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Act + Assert: select auto
    await page.click('.config-theme-btn[data-theme="auto"]');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'auto');
  });

  test('selected theme persists across page reload via localStorage', async ({ page }) => {
    // Arrange: select dark via settings
    await openSettings(page);
    await page.click('.config-theme-btn[data-theme="dark"]');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Act: reload the page (localStorage persists)
    await page.reload();

    // Assert: dark theme is restored
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    // Assert: the dark button is shown as active in settings
    await openSettings(page);
    await expect(page.locator('.config-theme-btn[data-theme="dark"]')).toHaveClass(/active/);
  });

  test('invalid localStorage value falls back to auto', async ({ page }) => {
    // Arrange: manually corrupt the stored theme
    await page.evaluate(() => localStorage.setItem('theme', 'invalid_value'));

    // Act: reload so setupConfigModal() runs with the corrupted value
    await page.reload();

    // Assert: getStoredTheme() rejects unknown values and defaults to 'auto'
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'auto');
    await openSettings(page);
    await expect(page.locator('.config-theme-btn[data-theme="auto"]')).toHaveClass(/active/);
  });
});

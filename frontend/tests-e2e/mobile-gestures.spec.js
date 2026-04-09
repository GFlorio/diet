import { test, expect } from '@playwright/test';
import { resetDB } from './playwright-helpers.js';

// Enable touch emulation so Touch/TouchEvent constructors behave as in a real mobile context
test.use({ hasTouch: true });

const DB_NAME = 'nutri-pwa';

/**
 * Dispatch synthetic touchstart + touchend on document.body to simulate a swipe.
 * @param {import('@playwright/test').Page} page
 * @param {{ startX: number, startY: number, dx: number, dy: number, numTouches?: number }} opts
 */
async function simulateSwipe(page, { startX, startY, dx, dy, numTouches = 1 }) {
  await page.evaluate(({ startX, startY, dx, dy, numTouches }) => {
    const endX = startX + dx;
    const endY = startY + dy;

    const startTouches = Array.from({ length: numTouches }, (_, i) =>
      new Touch({ identifier: i + 1, target: document.body, clientX: startX + i * 5, clientY: startY })
    );

    document.body.dispatchEvent(new TouchEvent('touchstart', {
      bubbles: true,
      cancelable: true,
      touches: startTouches,
      changedTouches: [startTouches[0]],
    }));

    const endTouch = new Touch({ identifier: 1, target: document.body, clientX: endX, clientY: endY });
    document.body.dispatchEvent(new TouchEvent('touchend', {
      bubbles: true,
      cancelable: true,
      touches: [],
      changedTouches: [endTouch],
    }));
  }, { startX, startY, dx, dy, numTouches });
}

/** Returns the bounding box of the meals sub-header, used to derive swipe start positions. */
async function getSubHeaderBox(page) {
  const box = await page.locator('#mealsSubHeader').boundingBox();
  if (!box) { throw new Error('mealsSubHeader not found'); }
  return box;
}

test.describe('Swipe gestures: date navigation thresholds', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await resetDB(page, DB_NAME);
    await page.reload();
    await page.locator('.tab', { hasText: 'Meals' }).click();
  });

  test('swipe left with dx=49 (below threshold) does NOT navigate', async ({ page }) => {
    // Arrange
    const beforeISO = await page.locator('#dayLabel').getAttribute('data-iso');
    const box = await getSubHeaderBox(page);
    const startX = 200;
    const startY = box.y + box.height + 50; // below the date bar

    // Act: horizontal swipe of exactly 49px — below SWIPE_MIN_X=50
    await simulateSwipe(page, { startX, startY, dx: -49, dy: 0 });

    // Assert: date unchanged
    const afterISO = await page.locator('#dayLabel').getAttribute('data-iso');
    expect(afterISO).toBe(beforeISO);
  });

  test('swipe left with dx=50 (at threshold) navigates to next day', async ({ page }) => {
    // Arrange
    const beforeISO = await page.locator('#dayLabel').getAttribute('data-iso');
    const box = await getSubHeaderBox(page);
    const startX = 200;
    const startY = box.y + box.height + 50;

    // Act: swipe exactly at SWIPE_MIN_X=50 to the left → next day
    await simulateSwipe(page, { startX, startY, dx: -50, dy: 0 });

    // Assert: date advanced by one day
    await expect(page.locator('#dayLabel')).not.toHaveAttribute('data-iso', beforeISO ?? '');
    const afterISO = await page.locator('#dayLabel').getAttribute('data-iso');
    const diff = new Date(afterISO + 'T00:00:00').getTime()
      - new Date(beforeISO + 'T00:00:00').getTime();
    expect(diff).toBe(86_400_000); // exactly 1 day forward
  });

  test('swipe right with dx=50 (at threshold) navigates to previous day', async ({ page }) => {
    // Arrange
    const beforeISO = await page.locator('#dayLabel').getAttribute('data-iso');
    const box = await getSubHeaderBox(page);
    const startX = 200;
    const startY = box.y + box.height + 50;

    // Act: positive dx → shiftDate(-1) → previous day
    await simulateSwipe(page, { startX, startY, dx: 50, dy: 0 });

    // Assert: date moved back by one day
    await expect(page.locator('#dayLabel')).not.toHaveAttribute('data-iso', beforeISO ?? '');
    const afterISO = await page.locator('#dayLabel').getAttribute('data-iso');
    const diff = new Date(afterISO + 'T00:00:00').getTime()
      - new Date(beforeISO + 'T00:00:00').getTime();
    expect(diff).toBe(-86_400_000); // one day back
  });

  test('swipe with dy=41 (above vertical limit) does NOT navigate', async ({ page }) => {
    // Arrange
    const beforeISO = await page.locator('#dayLabel').getAttribute('data-iso');
    const box = await getSubHeaderBox(page);
    const startX = 200;
    const startY = box.y + box.height + 50;

    // Act: sufficient horizontal (100) but dy=41 exceeds SWIPE_MAX_Y=40
    await simulateSwipe(page, { startX, startY, dx: -100, dy: 41 });

    // Assert: date unchanged
    const afterISO = await page.locator('#dayLabel').getAttribute('data-iso');
    expect(afterISO).toBe(beforeISO);
  });

  test('swipe with dy=40 (at vertical limit) navigates', async ({ page }) => {
    // Arrange
    const beforeISO = await page.locator('#dayLabel').getAttribute('data-iso');
    const box = await getSubHeaderBox(page);
    const startX = 200;
    const startY = box.y + box.height + 50;

    // Act: dx=-100, dy=40 exactly hits SWIPE_MAX_Y limit → should navigate
    await simulateSwipe(page, { startX, startY, dx: -100, dy: 40 });

    // Assert: date changed
    await expect(page.locator('#dayLabel')).not.toHaveAttribute('data-iso', beforeISO ?? '');
  });

  test('multi-touch (2 fingers) is ignored — no navigation', async ({ page }) => {
    // Arrange
    const beforeISO = await page.locator('#dayLabel').getAttribute('data-iso');
    const box = await getSubHeaderBox(page);
    const startX = 200;
    const startY = box.y + box.height + 50;

    // Act: dispatch touchstart with 2 touches — handler returns early for e.touches.length !== 1
    await simulateSwipe(page, { startX, startY, dx: -150, dy: 0, numTouches: 2 });

    // Assert: no navigation
    const afterISO = await page.locator('#dayLabel').getAttribute('data-iso');
    expect(afterISO).toBe(beforeISO);
  });

  test('touch starting within the date bar does NOT navigate', async ({ page }) => {
    // Arrange
    const beforeISO = await page.locator('#dayLabel').getAttribute('data-iso');
    const box = await getSubHeaderBox(page);
    // Start inside (not below) the sub-header — startTargetBelowBar becomes false
    const startX = 200;
    const startY = box.y + Math.floor(box.height / 2);

    // Act: otherwise-valid swipe starting inside the date bar
    await simulateSwipe(page, { startX, startY, dx: -150, dy: 0 });

    // Assert: no navigation because guard condition (startTargetBelowBar) rejects it
    const afterISO = await page.locator('#dayLabel').getAttribute('data-iso');
    expect(afterISO).toBe(beforeISO);
  });
});

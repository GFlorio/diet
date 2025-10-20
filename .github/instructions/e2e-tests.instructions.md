---
applyTo: "frontend/tests-e2e/**"
---

# End-to-end testing instructions (Playwright)

These instructions apply to all E2E tests in `frontend/tests-e2e/**` and are tailored for a PWA that persists data in IndexedDB. The goal is a thorough, maintainable, and stable suite.

## Goals

- Verify critical user journeys end-to-end in real browsers (Chromium/Firefox).
- Ensure correct persistence in IndexedDB across reloads and offline usage.
- Keep tests isolated, deterministic, accessible, and resilient to UI changes.

## Core scenarios to always cover

1) Validation
- Accept valid patterns (e.g., decimals with commas “1,5”, and dots “1.5” if supported); reject invalid patterns.
- Trim whitespace; reject empty or negative values where not allowed; enforce ranges and required fields.
- Duplicate names: allow or prevent as per product rules; assert message and focus behavior.

2) Cardinality “0, 1, many”
- 0: Empty states render helpful guidance, actions disabled/enabled correctly.
- 1: Minimal list behaves correctly (edit/delete/search still sane).
- Many: Large lists perform and paginate/scroll/filter as expected.

## PWA and Offline

- Service worker install/activation on first load; subsequent loads served from cache when offline.
- Full happy-flow offline (create/edit foods and meals) persists to IndexedDB and survives reload while offline.
- When going back online, app remains stable (no duplicate work, no crashes). If sync exists, verify deduplication/status.

## Data and state management (IndexedDB)

- Isolate tests: delete the database before each test.
  - Use `resetDB(page, dbName)` from `./playwright-helpers.js` (run in `beforeEach`).
- Verify persistence by reloading and reading IndexedDB.
  - Use `getAllFromStore(page, dbName, store)` to assert stored entities.

## Selectors and interaction

- Prefer stable `data-testid` attributes over text or CSS structure.
- Use keyboard interactions for accessibility-critical flows; ensure focus moves correctly.
- Avoid brittle timing: prefer `expect(locator).toHaveText/Value/Count`, `toBeVisible`, `toBeEnabled`.

## Cross-browser and viewport

- Run on Chromium and Firefox; include a mobile-ish viewport.
- If a test is desktop-only or mobile-only, annotate or guard accordingly.

## Accessibility checks

- Keyboard-only navigation works for core flows.
- Mobile-only inputs work as intended (like swipe gestures).
- Labels are associated; error messages are announced or focus lands on the invalid field.
- Focus order is logical; visible focus indicators are present.

## Error handling and resilience

- Simulate failures (if applicable): slow resources, 404/500, and verify error messages + recovery actions.
- Ensure partial failure does not corrupt IndexedDB data.

## Security hygiene

- Inputs are safely rendered (no reflected XSS); special characters and unicode behave correctly.
- Reject unexpected script tags in user inputs; encoded output where rendered.

## Test structure and naming

- Use Arrange / Act / Assert comments to keep flow clear.
- Keep fixtures/helpers in this folder; prefer small reusable utilities.

## CI and local execution

- Prefer running via the workspace tasks:
  - Unit tests (Vitest)
  - E2E tests (Playwright)
  - Tests: all (unit then e2e)

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code
in this repository.

## Commands

Prefer `mise` tasks over raw npm scripts:

```bash
mise run dev           # Start Vite dev server
mise run build         # Build for production
mise run lint          # Biome linter
mise run lint-fix      # Biome linter with auto-fix
mise run typecheck     # TypeScript type check via JSDoc (no emit)
mise run full-lint     # Biome + TypeScript (prefer this)
mise run test-unit     # Vitest unit tests (one-shot)
mise run test-unit-watch  # Vitest in watch mode
mise run test-unit-file src/tests/foo.test.js  # single unit test file
mise run e2e           # Playwright E2E tests (headless)
mise run e2e-ui        # Playwright with interactive UI
mise run e2e-file tests-e2e/foo.spec.js        # single E2E test file
mise run test          # Unit + E2E sequentially
```

## Architecture

Offline-first meal-logging PWA. No backend — all data lives in IndexedDB.

**Layered structure:**
```
UI layer        frontend/src/ui/     (foods.js, meal.js, report.js, ui.js)
Data API        frontend/src/        (data-foods.js, data-meals.js, data.js)
DB layer        frontend/src/db.js   (IndexedDB wrapper)
```

**Key modules:**
- `db.js` — low-level IndexedDB transactions. All exported functions use `async/await`
  for the outer `ensureDB()` call; the inner IDB callback is still wrapped in
  `new Promise` (unavoidable). Do not reintroduce `.then()` chains.
- `data-foods.js` / `data-meals.js` — CRUD APIs consumed by UI
- `validation-core.js` — validation framework (assert, collectFields, validateAndCollect)
- `validation-schemas.js` — declarative rules for Food and Meal fields
- `utils.js` — DOM helpers (`$.sel`, `$.id`, `$.arr`, `$.html`, `$.input`),
  formatters (`$.fmtNum`, `$.esc`), page router (`$.showPage`)
- `pwa.js` — Service Worker registration and offline/update flow

**Meal snapshots:** When a meal is created, food macros are snapshotted into
`foodSnapshot`. Later edits to the food do not affect existing meals.

**Import conventions:**
```js
import * as $ from '../utils.js';
import * as v from '../validation.js';
import * as db from './db.js';
```

## Testing

**Unit tests** (Vitest + jsdom): `frontend/src/tests/`

**E2E tests** (Playwright, Chromium): `frontend/tests-e2e/`
- Call `resetDB(page, dbName)` in `beforeEach` to isolate tests
- Use `getAllFromStore(page, dbName, store)` to assert IndexedDB state
- Prefer `data-testid` selectors
- Structure tests with Arrange / Act / Assert comments
- Cover validation (decimals, ranges), cardinality (0/1/many), and PWA/offline flows

## Code Style

- ES2023+ syntax; JSDoc with TypeScript-style typedefs for complex types
- No type coercion, no implicit conversions
- Assert assumptions early; raise exceptions at boundaries
- Named constants — no magic numbers
- Minimal nesting; no "just in case" fallbacks unless asked
- No silent catch blocks — do not swallow errors with empty or fallback-only catch clauses; let them propagate so failures are visible. The only exception is truly optional background operations (e.g. SW update checks), which should log via `console.warn`.
- Do not change code outside the scope of the current task without asking first

/**
 * Integration-test setup: replaces pouchdb-browser with pouchdb-browser + memory adapter.
 *
 * This lets the real data layer (db.js → data-foods.js / data-meals.js / data-goals.js)
 * run against an in-memory PouchDB — no browser, no IndexedDB, no mocked db module.
 *
 * vi.mock is hoisted, so we cannot reference top-level imports inside the factory.
 * Instead we use inline dynamic imports inside the factory function.
 */
import { vi } from 'vitest';

vi.mock('pouchdb-browser', async () => {
  const { default: RealPouchDB } = await import('pouchdb-browser');
  const { default: memoryAdapter } = await import('pouchdb-adapter-memory');
  RealPouchDB.plugin(memoryAdapter);

  /** @param {string} name */
  function MemPouchDB(name) {
    return new RealPouchDB(name, { adapter: 'memory' });
  }
  Object.setPrototypeOf(MemPouchDB, RealPouchDB);
  Object.setPrototypeOf(MemPouchDB.prototype, RealPouchDB.prototype);
  return { default: MemPouchDB };
});

// Stub browser APIs not available in Node/jsdom.
if (!globalThis.navigator?.storage) {
  Object.defineProperty(globalThis.navigator, 'storage', {
    value: { persist: () => Promise.resolve(true), persisted: () => Promise.resolve(true) },
    writable: true,
  });
}

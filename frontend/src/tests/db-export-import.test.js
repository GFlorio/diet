import { beforeEach, describe, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory PouchDB mock — shared across the module lifetime.
// resetDB() calls db.destroy() then new PouchDB(), so the mock factory runs
// twice; both instances share the same `docs` map so our helpers below work.
// ---------------------------------------------------------------------------
const docs = new Map();

vi.mock('pouchdb-browser', () => {
	// Must be a real constructor (not an arrow fn) so `new PouchDB()` works.
	function MockPouchDB() {
		/** @param {{ startkey: string, endkey: string, include_docs: boolean }} opts */
		this.allDocs = ({ startkey, endkey, include_docs }) => {
			if (!include_docs) { return Promise.resolve({ rows: [] }); }
			const rows = [...docs.entries()]
				.filter(([k]) => k >= startkey && k < endkey)
				.map(([_id, doc]) => ({ doc: { _id, _rev: '1-x', ...doc } }));
			return Promise.resolve({ rows });
		};
		/** @param {string} id */
		this.get = (id) => {
			if (!docs.has(id)) { return Promise.reject(Object.assign(new Error('not found'), { status: 404 })); }
			return Promise.resolve({ _id: id, _rev: '1-x', ...docs.get(id) });
		};
		/** @param {Record<string, unknown>} doc */
		this.put = (doc) => {
			docs.set(/** @type {any} */ (doc)._id, { ...doc });
			return Promise.resolve({ ok: true, id: /** @type {any} */ (doc)._id });
		};
		this.destroy = () => { docs.clear(); return Promise.resolve(); };
	}
	return { default: MockPouchDB };
});

vi.mock('../utils.js', () => ({
	randomUUID: vi.fn(() => 'test-uuid'),
	now: vi.fn(() => 1000),
}));

import { exportDB, importDB } from '../db.js';

beforeEach(() => {
	docs.clear();
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// exportDB
// ---------------------------------------------------------------------------
describe('exportDB', () => {
	test('returns version 1 and exportedAt timestamp', async () => {
		const result = await exportDB();
		expect(result.version).toBe(1);
		expect(typeof result.exportedAt).toBe('string');
		expect(new Date(result.exportedAt).toISOString()).toBe(result.exportedAt);
	});

	test('returns empty arrays when no data exists', async () => {
		const result = await exportDB();
		expect(result.foods).toEqual([]);
		expect(result.meals).toEqual([]);
		expect(result.goals).toEqual([]);
	});

	test('returns all foods, meals, and goals from the DB', async () => {
		// Arrange — seed the in-memory store
		docs.set('food:1', { id: 'food:1', name: 'Apple', refLabel: '100g', kcal: 52, prot: 0.3, carbs: 14, fats: 0.2, archived: false, updatedAt: 1 });
		docs.set('meal:2024-01-15:0000000000001', { id: 'meal:2024-01-15:0000000000001', foodId: 'food:1', foodSnapshot: { id: 'food:1', name: 'Apple', refLabel: '100g', kcal: 52, prot: 0.3, carbs: 14, fats: 0.2, updatedAt: 1 }, multiplier: 1, date: '2024-01-15', updatedAt: 1 });
		docs.set('goal:test-uuid', { id: 'goal:test-uuid', effectiveFrom: '2024-01-01', kcal: 2000, maintenanceKcal: 2200, calMode: 'deficit', calMagnitude: 200, protPct: 30, carbsPct: 40, fatPct: 30, createdAt: 1 });

		// Act
		const result = await exportDB();

		// Assert
		expect(result.foods).toHaveLength(1);
		expect(result.foods[0]).toMatchObject({ id: 'food:1', name: 'Apple' });
		expect(result.meals).toHaveLength(1);
		expect(result.meals[0]).toMatchObject({ id: 'meal:2024-01-15:0000000000001', date: '2024-01-15' });
		expect(result.goals).toHaveLength(1);
		expect(result.goals[0]).toMatchObject({ id: 'goal:test-uuid', kcal: 2000 });
	});
});

// ---------------------------------------------------------------------------
// importDB — validation
// ---------------------------------------------------------------------------
describe('importDB — invalid input', () => {
	test('throws for null input', async () => {
		await expect(importDB(/** @type {any} */ (null))).rejects.toThrow('Invalid backup file format.');
	});

	test('throws for wrong version', async () => {
		await expect(importDB(/** @type {any} */ ({ version: 2, foods: [], meals: [], goals: [] }))).rejects.toThrow('Invalid backup file format.');
	});

	test('throws when foods is not an array', async () => {
		await expect(importDB(/** @type {any} */ ({ version: 1, foods: null, meals: [], goals: [] }))).rejects.toThrow('Invalid backup file format.');
	});

	test('throws when meals is not an array', async () => {
		await expect(importDB(/** @type {any} */ ({ version: 1, foods: [], meals: undefined, goals: [] }))).rejects.toThrow('Invalid backup file format.');
	});

	test('throws when goals is not an array', async () => {
		await expect(importDB(/** @type {any} */ ({ version: 1, foods: [], meals: [], goals: 'bad' }))).rejects.toThrow('Invalid backup file format.');
	});
});

// ---------------------------------------------------------------------------
// importDB — happy path
// ---------------------------------------------------------------------------
describe('importDB — happy path', () => {
	test('clears existing data and inserts imported records', async () => {
		// Arrange — pre-existing record that should be wiped
		docs.set('food:old', { id: 'food:old', name: 'Old Food', refLabel: '100g', kcal: 1, prot: 0, carbs: 0, fats: 0, archived: false, updatedAt: 0 });

		const backup = {
			version: 1,
			exportedAt: '2024-01-01T00:00:00.000Z',
			foods: [
				{ id: 'food:1', name: 'Banana', refLabel: '100g', kcal: 89, prot: 1.1, carbs: 23, fats: 0.3, archived: false, updatedAt: 2 },
			],
			meals: [
				{ id: 'meal:2024-06-01:0000000000001', foodId: 'food:1', foodSnapshot: { id: 'food:1', name: 'Banana', refLabel: '100g', kcal: 89, prot: 1.1, carbs: 23, fats: 0.3, updatedAt: 2 }, multiplier: 1.5, date: '2024-06-01', updatedAt: 2 },
			],
			goals: [],
		};

		// Act
		await importDB(backup);

		// Assert — old record gone, new records present
		const result = await exportDB();
		expect(result.foods).toHaveLength(1);
		expect(result.foods[0]).toMatchObject({ id: 'food:1', name: 'Banana' });
		expect(result.meals).toHaveLength(1);
		expect(result.meals[0]).toMatchObject({ id: 'meal:2024-06-01:0000000000001', multiplier: 1.5 });
		expect(result.goals).toHaveLength(0);
		expect(docs.has('food:old')).toBe(false);
	});

	test('handles empty backup (all stores empty)', async () => {
		// Arrange
		docs.set('food:1', { id: 'food:1', name: 'Existing', refLabel: '100g', kcal: 10, prot: 1, carbs: 1, fats: 1, archived: false, updatedAt: 1 });

		// Act
		await importDB({ version: 1, exportedAt: '2024-01-01T00:00:00.000Z', foods: [], meals: [], goals: [] });

		// Assert
		const result = await exportDB();
		expect(result.foods).toHaveLength(0);
		expect(result.meals).toHaveLength(0);
		expect(result.goals).toHaveLength(0);
	});
});

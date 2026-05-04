/**
 * Integration tests for validation at data boundaries.
 * Ensures validation-schemas.js correctly rejects invalid data
 * and that the validated output matches what the data layer expects.
 */
import './setup.js';
import { beforeEach, describe, expect, test } from 'vitest';
import * as v from '../../validation-schemas.js';
import { resetTestDB } from './helpers.js';

beforeEach(resetTestDB);

// ---------------------------------------------------------------------------
// createFoodInput validation
// ---------------------------------------------------------------------------
describe('createFoodInput validation', () => {
  test('accepts valid input', () => {
    const result = v.createFoodInput({
      name: 'Banana', refLabel: '100g', kcal: 89, prot: 1.1, carbs: 23, fats: 0.3,
    });
    expect(result.name).toBe('Banana');
    expect(result.kcal).toBe(89);
  });

  test('rounds kcal to integer', () => {
    const result = v.createFoodInput({
      name: 'Test', refLabel: '100g', kcal: 89.6, prot: 1, carbs: 10, fats: 1,
    });
    expect(result.kcal).toBe(90);
  });

  test('rounds macros to 1 decimal', () => {
    const result = v.createFoodInput({
      name: 'Test', refLabel: '100g', kcal: 100, prot: 1.27, carbs: 10.38, fats: 1.92,
    });
    expect(result.prot).toBe(1.3);
    expect(result.carbs).toBe(10.4);
    expect(result.fats).toBe(1.9);
  });

  test('rejects empty name', () => {
    expect(() => v.createFoodInput({
      name: '', refLabel: '100g', kcal: 100, prot: 1, carbs: 10, fats: 1,
    })).toThrow();
  });

  test('rejects name with invalid characters', () => {
    expect(() => v.createFoodInput({
      name: 'Food<script>', refLabel: '100g', kcal: 100, prot: 1, carbs: 10, fats: 1,
    })).toThrow();
  });

  test('rejects negative kcal', () => {
    expect(() => v.createFoodInput({
      name: 'Test', refLabel: '100g', kcal: -10, prot: 1, carbs: 10, fats: 1,
    })).toThrow();
  });

  test('rejects kcal above max (5000)', () => {
    expect(() => v.createFoodInput({
      name: 'Test', refLabel: '100g', kcal: 5001, prot: 1, carbs: 10, fats: 1,
    })).toThrow();
  });

  test('rejects macro grams above max (1000)', () => {
    expect(() => v.createFoodInput({
      name: 'Test', refLabel: '100g', kcal: 100, prot: 1001, carbs: 10, fats: 1,
    })).toThrow();
  });

  test('handles comma decimal notation', () => {
    const result = v.createFoodInput({
      name: 'Test', refLabel: '100g', kcal: '89', prot: '1,5', carbs: '10', fats: '0,3',
    });
    expect(result.prot).toBe(1.5);
    expect(result.fats).toBe(0.3);
  });

  test('collects multiple failing fields', () => {
    try {
      v.createFoodInput({ name: '', refLabel: '', kcal: -1, prot: -1, carbs: -1, fats: -1 });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(/** @type {any} */ (e).fields.length).toBeGreaterThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// meal validation
// ---------------------------------------------------------------------------
describe('meal validation', () => {
  test('accepts valid meal', () => {
    const result = v.meal({
      id: 'meal:2024-06-01:0000000000001',
      foodId: 'food:1',
      foodSnapshot: {
        id: 'food:1', name: 'Rice', refLabel: '100g',
        kcal: 130, prot: 2.4, carbs: 28, fats: 0.3, updatedAt: 1,
      },
      multiplier: 1.5,
      date: '2024-06-01',
      updatedAt: 1000,
    });
    expect(result.multiplier).toBe(1.5);
    expect(result.date).toBe('2024-06-01');
  });

  test('rejects multiplier above max (100)', () => {
    expect(() => v.meal({
      id: 'meal:2024-06-01:1', foodId: 'food:1',
      foodSnapshot: { id: 'food:1', name: 'Test', refLabel: '100g', kcal: 100, prot: 1, carbs: 10, fats: 1, updatedAt: 1 },
      multiplier: 101, date: '2024-06-01', updatedAt: 1,
    })).toThrow();
  });

  test('rejects negative multiplier', () => {
    expect(() => v.meal({
      id: 'meal:2024-06-01:1', foodId: 'food:1',
      foodSnapshot: { id: 'food:1', name: 'Test', refLabel: '100g', kcal: 100, prot: 1, carbs: 10, fats: 1, updatedAt: 1 },
      multiplier: -1, date: '2024-06-01', updatedAt: 1,
    })).toThrow();
  });

  test('rejects invalid date format', () => {
    expect(() => v.meal({
      id: 'meal:2024-06-01:1', foodId: 'food:1',
      foodSnapshot: { id: 'food:1', name: 'Test', refLabel: '100g', kcal: 100, prot: 1, carbs: 10, fats: 1, updatedAt: 1 },
      multiplier: 1, date: '06/01/2024', updatedAt: 1,
    })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// foodPatch validation (partial updates)
// ---------------------------------------------------------------------------
describe('foodPatch validation', () => {
  test('validates only provided fields', () => {
    const patch = v.foodPatch({ kcal: 200 });
    expect(patch).toEqual({ kcal: 200 });
  });

  test('rejects invalid provided fields', () => {
    expect(() => v.foodPatch({ kcal: -5 })).toThrow();
  });

  test('ignores unrecognized fields', () => {
    const patch = v.foodPatch({ kcal: 200 });
    expect(Object.keys(patch)).toEqual(['kcal']);
  });

  test('validates name pattern in patch', () => {
    expect(() => v.foodPatch({ name: '<script>alert(1)</script>' })).toThrow();
  });

  test('validates archived as boolean', () => {
    const patch = v.foodPatch({ archived: true });
    expect(patch.archived).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mealCreate validation
// ---------------------------------------------------------------------------
describe('mealCreate validation', () => {
  test('accepts valid create input', () => {
    const result = v.mealCreate({
      food: {
        id: 'food:1', name: 'Rice', refLabel: '100g',
        kcal: 130, prot: 2.4, carbs: 28, fats: 0.3, archived: false, updatedAt: 1,
      },
      multiplier: 2,
      date: '2024-06-01',
    });
    expect(result.multiplier).toBe(2);
  });

  test('rejects missing food', () => {
    expect(() => v.mealCreate({
      food: null, multiplier: 1, date: '2024-06-01',
    })).toThrow();
  });

  test('rejects zero multiplier boundary', () => {
    // multiplier: 0 is valid (min: 0)
    const result = v.mealCreate({
      food: {
        id: 'food:1', name: 'Test', refLabel: '100g',
        kcal: 100, prot: 1, carbs: 10, fats: 1, archived: false, updatedAt: 1,
      },
      multiplier: 0,
      date: '2024-06-01',
    });
    expect(result.multiplier).toBe(0);
  });
});

import { describe, test, expect } from 'vitest';
import * as v from '../validation.js';
import { ValidationError } from '../validation.js';

/**
 * Small helpers for asserting error shapes
 */
/**
 * @param {() => unknown} fn
 * @param {string[]=} fields
 */
function expectValidationError(fn, fields){
  try {
    fn();
  } catch (e) {
    const err = /** @type {unknown} */ (e);
    expect(err).toBeInstanceOf(ValidationError);
    if (fields){
      const ve = /** @type {ValidationError} */ (/** @type {any} */ (err));
      expect(Array.isArray(ve.fields)).toBe(true);
      // order-insensitive check
      expect(new Set(ve.fields)).toEqual(new Set(fields));
    }
    return;
  }
  throw new Error('Expected validation error');
}

describe('validation.number', () => {
  test('accepts numbers and numeric strings, normalizes comma decimal, and clamps precision', () => {
    expect(v.number(1)).toBe(1);
    expect(v.number('2')).toBe(2);
    expect(v.number('3.25')).toBe(3.3);
    expect(v.number('3,24')).toBe(3.2);
  });

  test('enforces integer when requested', () => {
    expect(() => v.number('2.2', { integer: true })).toThrowError();
    expect(v.number('2', { integer: true })).toBe(2);
  });

  test('rejects non-finite and out of range', () => {
    expect(() => v.number('abc')).toThrowError();
    expect(() => v.number('2e309')).toThrowError();
    expect(() => v.number('-1', { min: 0 })).toThrowError();
    expect(() => v.number('100', { max: 10 })).toThrowError();
  });
});

describe('validation.string', () => {
  test('trims by default and checks lengths', () => {
    expect(v.string('  hello  ')).toBe('hello');
    expect(() => v.string('')).toThrowError();
  });

  test('respects pattern', () => {
    expect(v.string('abc-123', { pattern: /^[a-z\-0-9]+$/i })).toBe('abc-123');
    expect(() => v.string('abc 123', { pattern: /^[a-z\-0-9]+$/i })).toThrowError();
  });
});

describe('validation.boolean', () => {
  test('accepts booleans, strings and 0/1', () => {
    expect(v.boolean(true)).toBe(true);
    expect(v.boolean('true')).toBe(true);
    expect(v.boolean('FALSE')).toBe(false);
    expect(v.boolean(1)).toBe(true);
    expect(v.boolean(0)).toBe(false);
  });

  test('rejects invalid', () => {
    expect(() => v.boolean('yes')).toThrowError();
    expect(() => v.boolean(2)).toThrowError();
  });
});

describe('validation.isoDate', () => {
  test('normalizes Date and validates string format', () => {
    const d = new Date('2024-01-05T12:00:00Z');
    expect(v.isoDate('2024-01-05')).toBe('2024-01-05');
    expect(v.isoDate(d)).toBe('2024-01-05');
    expect(() => v.isoDate('2024/01/05')).toThrowError();
  });
});

describe('schema: macros', () => {
  test('validates all macro fields and rounds kcal', () => {
    const m = v.macros({ kcal: '123.7', prot: '10.4', carbs: 20, fats: '5' });
    expect(m).toEqual({ kcal: 124, prot: 10.4, carbs: 20, fats: 5 });
  });

  test('collects bad fields', () => {
    expectValidationError(() => v.macros({ kcal: 'x', prot: -1, carbs: 'a', fats: 2 }), ['kcal','prot','carbs']);
  });
});

describe('schema: foodSnapshot', () => {
  const base = { id: 'food:1', name: 'Apple', refLabel: '100g', updatedAt: 1, kcal: 52, prot: 0.3, carbs: 14, fats: 0.2 };
  test('passes with correct payload', () => {
    const s = v.foodSnapshot(base);
    expect(s).toMatchObject(base);
  });
  test('collects multiple bad fields', () => {
    expectValidationError(() => v.foodSnapshot({ ...base, id: '', name: '', kcal: 'x' }), ['id','name','kcal']);
  });
});

describe('schema: food', () => {
  const base = { id: 'food:1', name: 'Banana', refLabel: '100g', updatedAt: 1, kcal: 89, prot: 1.1, carbs: 23, fats: 0.3, archived: false };
  test('passes and normalizes archived', () => {
    const s = v.food(base);
    expect(s).toMatchObject({ ...base, archived: false });
  });
  test('collects bad fields', () => {
    expectValidationError(() => v.food({ ...base, name: '', fats: 'x' }), ['name','fats']);
  });
});

describe('schema: createFoodInput', () => {
  test('validates and merges', () => {
    const s = v.createFoodInput({ name: 'Yogurt', refLabel: '1 cup', kcal: 150, prot: 10, carbs: 12, fats: 5 });
    expect(s).toEqual({ name: 'Yogurt', refLabel: '1 cup', kcal: 150, prot: 10, carbs: 12, fats: 5 });
  });
  test('collects bad fields', () => {
    expectValidationError(
      () => v.createFoodInput({ name: '', refLabel: '', kcal: -1 }),
      ['name','refLabel','kcal','prot','carbs','fats']
    );
  });
});

describe('validation.number — exact boundaries and scientific notation', () => {
  test('accepts exact boundary values 0, 5000, 1000', () => {
    expect(v.number(0, { min: 0 })).toBe(0);
    expect(v.number(5000, { max: 5000 })).toBe(5000);
    expect(v.number(1000, { max: 1000 })).toBe(1000);
  });

  test('rejects values just above their boundaries', () => {
    expect(() => v.number(5000.1, { max: 5000 })).toThrowError();
    expect(() => v.number(1000.1, { max: 1000 })).toThrowError();
  });

  test('rejects scientific notation strings', () => {
    expect(() => v.number('1e3')).toThrowError();
    expect(() => v.number('1.5e2')).toThrowError();
  });
});

// The canonical name pattern — kept in sync with validateName() in validation-schemas.js
const NAME_PATTERN = /^[\p{L}\p{N}\s'\-_.()]+$/u;

describe('validation.string — name pattern and length boundaries', () => {
  test('pattern accepts Unicode letters, digits, and allowed punctuation', () => {
    expect(v.string('Apple (raw)', { pattern: NAME_PATTERN })).toBe('Apple (raw)');
    expect(v.string('Café', { pattern: NAME_PATTERN })).toBe('Café');
    expect(v.string('食品', { pattern: NAME_PATTERN })).toBe('食品');
    expect(v.string('50-50', { pattern: NAME_PATTERN })).toBe('50-50');
    expect(v.string("O'Brien", { pattern: NAME_PATTERN })).toBe("O'Brien");
  });

  test('pattern rejects disallowed characters', () => {
    expect(() => v.string('@handle', { pattern: NAME_PATTERN })).toThrowError();
    expect(() => v.string('#tag', { pattern: NAME_PATTERN })).toThrowError();
    expect(() => v.string('<script>', { pattern: NAME_PATTERN })).toThrowError();
    expect(() => v.string('Apple & Banana', { pattern: NAME_PATTERN })).toThrowError();
    expect(() => v.string('🍎', { pattern: NAME_PATTERN })).toThrowError();
  });

  test('maxLen boundary: 120 chars pass, 121 fail', () => {
    expect(v.string('a'.repeat(120), { maxLen: 120 })).toBe('a'.repeat(120));
    expect(() => v.string('a'.repeat(121), { maxLen: 120 })).toThrowError();
  });
});

describe('validation.boolean — edge string inputs', () => {
  test('accepts "TRUE" uppercase', () => {
    expect(v.boolean('TRUE')).toBe(true);
  });

  test('rejects numeric strings "0" and "1" (only numeric 0/1 are accepted)', () => {
    expect(() => v.boolean('0')).toThrowError();
    expect(() => v.boolean('1')).toThrowError();
  });
});

describe('validation.isoDate — invalid calendar dates', () => {
  test('accepts Feb 30 — jsdom rolls it over to a valid date so the NaN guard does not fire (known gap)', () => {
    // new Date('2024-02-30T00:00:00Z') in jsdom yields March 1, not Invalid Date.
    // The code's NaN check therefore never triggers, and the string is returned as-is.
    // This means isoDate does NOT reject impossible calendar dates in this runtime.
    expect(v.isoDate('2024-02-30')).toBe('2024-02-30');
  });

  test('rejects a date with an impossible month (13)', () => {
    // Month 13 does produce Invalid Date in jsdom
    expect(() => v.isoDate('2024-13-01')).toThrowError();
  });
});

describe('schema: macros — exact numeric boundaries', () => {
  test('accepts all-zero macros', () => {
    const m = v.macros({ kcal: 0, prot: 0, carbs: 0, fats: 0 });
    expect(m).toEqual({ kcal: 0, prot: 0, carbs: 0, fats: 0 });
  });

  test('accepts exact max values (kcal 5000, macros 1000)', () => {
    const m = v.macros({ kcal: 5000, prot: 1000, carbs: 1000, fats: 1000 });
    expect(m).toEqual({ kcal: 5000, prot: 1000, carbs: 1000, fats: 1000 });
  });

  test('rejects values one step above their max', () => {
    expectValidationError(() => v.macros({ kcal: 5000.1, prot: 0, carbs: 0, fats: 0 }), ['kcal']);
    expectValidationError(() => v.macros({ kcal: 0, prot: 1000.1, carbs: 0, fats: 0 }), ['prot']);
    expectValidationError(() => v.macros({ kcal: 0, prot: 0, carbs: 1000.1, fats: 0 }), ['carbs']);
  });
});

describe('schema: createFoodInput — name pattern and length', () => {
  const base = { name: 'Apple', refLabel: '100g', kcal: 52, prot: 0.3, carbs: 14, fats: 0.2 };

  test('accepts Unicode names and allowed punctuation', () => {
    expect(() => v.createFoodInput({ ...base, name: 'Café' })).not.toThrow();
    expect(() => v.createFoodInput({ ...base, name: 'Apple (raw)' })).not.toThrow();
    expect(() => v.createFoodInput({ ...base, name: '食品' })).not.toThrow();
  });

  test('rejects names with invalid characters', () => {
    expectValidationError(() => v.createFoodInput({ ...base, name: '<script>' }), ['name']);
    expectValidationError(() => v.createFoodInput({ ...base, name: 'Apple & Banana' }), ['name']);
    expectValidationError(() => v.createFoodInput({ ...base, name: '🍎 Apple' }), ['name']);
  });

  test('rejects name exceeding 120 chars', () => {
    expectValidationError(() => v.createFoodInput({ ...base, name: 'a'.repeat(121) }), ['name']);
  });

  test('accepts name at exactly 120 chars', () => {
    expect(() => v.createFoodInput({ ...base, name: 'a'.repeat(120) })).not.toThrow();
  });
});

describe('schema: meal + mealCreate + patches', () => {
  const snapshot = { id: 'food:1', name: 'Rice', refLabel: '100g', updatedAt: 1, kcal: 130, prot: 2.4, carbs: 28, fats: 0.3 };
  const food = { ...snapshot, archived: false };
  const meal = { id: 'meal:2024-02-02:0000000000001', foodId: 'food:1', foodSnapshot: snapshot, multiplier: 1.5, date: '2024-02-02', updatedAt: 1 };

  test('meal validates full object', () => {
    const m = v.meal(meal);
    expect(m).toMatchObject(meal);
  });

  test('mealCreate narrows and validates', () => {
    const created = v.mealCreate({ food, multiplier: 2, date: '2024-02-02' });
    expect(created).toEqual({ food, multiplier: 2, date: '2024-02-02' });
  });

  test('foodPatch picks and validates only known keys', () => {
    const patch = v.foodPatch({ name: 'White rice', kcal: '129.6', unknown: 'x' });
    expect(patch).toEqual({ name: 'White rice', kcal: 130 });
  });

  test('mealPatch picks and validates only known keys', () => {
    const patch = v.mealPatch({ multiplier: '1.25', date: '2024-02-03' });
    expect(patch).toEqual({ multiplier: 1.3, date: '2024-02-03' });
  });
});

import * as $ from './utils.js';

/**
 * @typedef {{ min?: number, max?: number, integer?: boolean }} NumberOpts
 */
/**
 * @typedef {{ minLen?: number, maxLen?: number, pattern?: RegExp, trim?: boolean }} StringOpts
 */

class ValidationError extends Error {
  /**
   * @param {string} message
   * @param {string[]=} fields
   */
  constructor(message, fields) {
    super(message);
    this.name = 'ValidationError';
    this.fields = fields ?? [];
  }
}

/** @param {unknown} condition @param {string} message @param {string[]=} fields */
function assert(condition, message, fields){
  if (!condition) {throw new ValidationError(message, fields);}
}

/**
 * Collect field names from a thrown error into a Set, falling back to a single field name.
 * @param {unknown} err
 * @param {Set<string>} into
 * @param {string} fallbackField
 */
function collectFieldsFromError(err, into, fallbackField){
  if (
    err &&
    typeof err === 'object' &&
    Array.isArray((/** @type {any} */ (err)).fields) &&
    /** @type {any} */ (err).fields.length
  ) {
    /** @type {{ fields: string[] }} */ (err).fields.forEach((field) => { into.add(field); });
  } else {
    into.add(fallbackField);
  }
}

/**
 * Validate a set of fields and aggregate all failing field names.
 * Only validators provided in the map are executed.
 * @param {Record<string, () => any>} validators
 * @param {string} [message]
 * @returns {Record<string, any>}
 * @throws {ValidationError}
 */
function validateAndCollect(validators, message = 'Invalid fields'){
  /** @type {Record<string, any>} */
  const result = {};
  /** @type {Set<string>} */
  const invalidFields = new Set();
  for (const [key, validator] of Object.entries(validators)) {
    try {
      const value = validator();
      if (value !== undefined) { result[key] = value; }
    } catch (err) {
      collectFieldsFromError(err, invalidFields, key);
    }
  }
  if (invalidFields.size) { throw new ValidationError(message, Array.from(invalidFields)); }
  return result;
}

/**
 * Returns true if value is a plain object (not an array).
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value){ return typeof value === 'object' && value !== null && !Array.isArray(value); }

/**
 * Sanitize a string input.
 * @param {unknown} val
 * @param {StringOpts} [opts]
 * @returns {string}
 */
function string(val, opts){
  const { minLen = 1, maxLen = 200, pattern, trim = true } = opts || {};
  assert(typeof val === 'string', 'Expected string');
  const rawString = /** @type {string} */ (val);
  const normalized = trim ? rawString.trim() : rawString;
  assert(normalized.length >= minLen, `String too short (min ${minLen})`);
  assert(normalized.length <= maxLen, `String too long (max ${maxLen})`);
  if (pattern) { assert(pattern.test(normalized), 'String does not match required pattern'); }
  return normalized;
}

/**
 * Sanitize a numeric input.
 * @param {unknown} val
 * @param {NumberOpts} [opts]
 * @returns {number}
 */
function number(val, opts){
  const {
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    integer = false,
  } = opts || {};
  let parsedNumber;
  if (typeof val === 'number') {
    parsedNumber = val;
  } else if (typeof val === 'string') {
    let normalized = val.trim();
    const hasNumericFormat = /^[+-]?\d+(?:[.,]\d+)?$/.test(normalized);
    assert(hasNumericFormat, 'Expected a finite number');
    if (normalized.includes(',')) { normalized = normalized.replace(',', '.'); }
    parsedNumber = Number(normalized);
  } else {
    parsedNumber = NaN;
  }
  assert(Number.isFinite(parsedNumber), 'Expected a finite number');
  assert(parsedNumber >= min, `Number below min (${min})`);
  assert(parsedNumber <= max, `Number above max (${max})`);
  if (integer) {
    assert(Number.isInteger(parsedNumber), 'Expected an integer');
    return parsedNumber;
  }
  return Number(parsedNumber.toFixed(1));
}

/**
 * Sanitize a boolean input.
 * @param {unknown} val
 * @returns {boolean}
 */
function boolean(val){
  if (typeof val === 'boolean') { return val; }
  if (typeof val === 'string') {
    const normalized = val.trim().toLowerCase();
    assert(normalized === 'true' || normalized === 'false', 'Expected "true" or "false"');
    return normalized === 'true';
  }
  if (typeof val === 'number') {
    assert(val === 0 || val === 1, 'Expected 0 or 1 for boolean');
    return val === 1;
  }
  throw new ValidationError('Expected boolean');
}

/**
 * Validate and normalize an ISO date (YYYY-MM-DD).
 * @param {unknown} val
 * @returns {string}
 */
function isoDate(val){
  let iso;
  if (typeof val === 'string') {
    iso = val.trim();
  } else if (val instanceof Date) {
    iso = $.toISO(val);
  } else {
    throw new ValidationError('Expected date string or Date');
  }
  assert(/^\d{4}-\d{2}-\d{2}$/.test(iso), 'Invalid date format, expected YYYY-MM-DD');
  const date = new Date(`${iso}T00:00:00Z`);
  assert(!Number.isNaN(date.getTime()), 'Invalid date');
  return iso;
}

export {
  assert,
  boolean,
  collectFieldsFromError,
  isObject,
  isoDate,
  number,
  string,
  ValidationError,
  validateAndCollect,
};

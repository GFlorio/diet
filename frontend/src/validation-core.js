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

/** @param {unknown} cond @param {string} msg @param {string[]=} fields */
function assert(cond, msg, fields){
    if (!cond) {throw new ValidationError(msg, fields);}
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
            Array.isArray(/** @type {any} */ err).fields &&
            /** @type {any} */ err.fields.length
        ) { /** @type {{ fields: string[] }} */ (err).fields.forEach((f) => into.add(f)); } else { into.add(fallbackField); }
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
        const bad = new Set();
            for (const [key, fn] of Object.entries(validators)) {
                try {
                    const value = fn();
                    if (value !== undefined) { result[key] = value; }
                } catch (err) {
                    collectFieldsFromError(err, bad, key);
                }
            }
            if (bad.size) { throw new ValidationError(message, Array.from(bad)); }
            return result;
}

/**
 * Returns true if value is a plain object (prototype is Object.prototype or null).
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObject(v){ return typeof v === 'object' && v !== null; }
// ...existing code...
/**
 * Sanitize a string input.
 * @param {unknown} val
 * @param {StringOpts} [opts]
 * @returns {string}
 */
function string(val, opts){
        const { minLen = 1, maxLen = 200, pattern, trim = true } = opts || {};
        assert(typeof val === 'string', 'Expected string');
        const s = /** @type {string} */ val;
        const out = trim ? s.trim() : s;
        assert(out.length >= minLen, `String too short (min ${minLen})`);
        assert(out.length <= maxLen, `String too long (max ${maxLen})`);
        if (pattern) { assert(pattern.test(out), 'String does not match required pattern'); }
        return out;
}

/**
 * Sanitize a numeric input.
 * @param {unknown} val
 * @param {NumberOpts} [opts]
 * @returns {number}
 */
function number(val, opts){
        const { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, integer = false } = opts || {};
        let n;
        if (typeof val === 'number') {
            n = val;
        } else if (typeof val === 'string') {
            let s = val.trim();
            const ok = /^[+-]?\d+(?:[.,]\d+)?$/.test(s);
            assert(ok, 'Expected a finite number');
            if (s.includes(',')) { s = s.replace(',', '.'); }
            n = Number(s);
        } else {
            n = NaN;
        }
        assert(Number.isFinite(n), 'Expected a finite number');
        assert(n >= min, `Number below min (${min})`);
        assert(n <= max, `Number above max (${max})`);
        if (integer) {
            assert(Number.isInteger(n), 'Expected an integer');
            return n;
        }
        return Number(n.toFixed(1));
}

/**
 * Sanitize a boolean input.
 * @param {unknown} val
 * @returns {boolean}
 */
function boolean(val){
        if (typeof val === 'boolean') { return val; }
        if (typeof val === 'string') {
            const s = val.trim().toLowerCase();
            assert(s === 'true' || s === 'false', 'Expected "true" or "false"');
            return s === 'true';
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
        const m = /^\d{4}-\d{2}-\d{2}$/.test(iso);
        assert(m, 'Invalid date format, expected YYYY-MM-DD');
        const d = new Date(iso + 'T00:00:00Z');
        assert(!Number.isNaN(d.getTime()), 'Invalid date');
        return iso;
}

export {
    ValidationError,
    assert,
    collectFieldsFromError,
    validateAndCollect,
    isObject,
    string,
    number,
    boolean,
    isoDate,
};

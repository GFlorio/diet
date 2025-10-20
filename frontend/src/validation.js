import * as $ from './utils.js';

/**
 * @typedef {{ min?: number, max?: number, integer?: boolean }} NumberOpts
 */
/**
 * @typedef {{ minLen?: number, maxLen?: number, pattern?: RegExp, trim?: boolean }} StringOpts
 */

/**
 * Asserts a condition or throws a TypeError with the given message.
 * @param {unknown} cond
 * @param {string} msg
 */
class ValidationError extends Error {
	/**
	 * @param {string} message
	 * @param {string[]=} fields
	 */
	constructor(message, fields){
		super(message);
		this.name = 'ValidationError';
		// Optional list of related field names for object-level validations
		this.fields = fields ?? [];
	}
}

/** @param {unknown} cond @param {string} msg @param {string[]=} fields */
function assert(cond, msg, fields){ if (!cond) throw new ValidationError(msg, fields); }

/**
 * Collect field names from a thrown error into a Set, falling back to a single field name.
 * @param {unknown} err
 * @param {Set<string>} into
 * @param {string} fallbackField
 */
function collectFieldsFromError(err, into, fallbackField){
	if (err && typeof err === 'object' && Array.isArray(/** @type {any} */(err).fields) && /** @type {any} */(err).fields.length){
		/** @type {{ fields: string[] }} */(err).fields.forEach(f => into.add(f));
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
	const bad = new Set();
	for (const [key, fn] of Object.entries(validators)){
		try {
			const value = fn();
			if (value !== undefined) result[key] = value;
		} catch (err) {
			collectFieldsFromError(err, bad, key);
		}
	}
	if (bad.size) throw new ValidationError(message, Array.from(bad));
	return result;
}

/**
 * Returns true if value is a plain object (prototype is Object.prototype or null).
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObject(v){ return typeof v === 'object' && v !== null; }

/**
 * Sanitize a string input.
 * @param {unknown} val
 * @param {StringOpts} [opts]
 * @returns {string}
 */
export function string(val, opts){
	const { minLen = 1, maxLen = 200, pattern, trim = true } = (opts||{});
	assert(typeof val === 'string', 'Expected string');
	const s = /** @type {string} */ (val);
	let out = trim ? s.trim() : s;
	assert(out.length >= minLen, `String too short (min ${minLen})`);
	assert(out.length <= maxLen, `String too long (max ${maxLen})`);
	if (pattern) assert(pattern.test(out), 'String does not match required pattern');
	return out;
}

/**
 * Sanitize a numeric input.
 * Accepts number or numeric string. Throws on NaN, out-of-range, or non-integer when required.
 * @param {unknown} val
 * @param {NumberOpts} [opts]
 * @returns {number}
 */
export function number(val, opts){
	const { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, integer = false } = (opts||{});
	let n;
	if (typeof val === 'number') n = val;
	else if (typeof val === 'string'){
		let s = val.trim();
		// Accept only plain integer or a single decimal separator (dot or comma)
		const ok = /^[+-]?\d+(?:[.,]\d+)?$/.test(s);
		assert(ok, 'Expected a finite number');
		if (s.includes(',')) s = s.replace(',', '.');
		n = Number(s);
	} else n = NaN;
	assert(Number.isFinite(n), 'Expected a finite number');
	assert(n >= min, `Number below min (${min})`);
	assert(n <= max, `Number above max (${max})`);
	if (integer) {
		assert(Number.isInteger(n), 'Expected an integer');
		return n;
	}
	// Hardcode to 1 decimal place for fractional values
	return Number(n.toFixed(1));
}

/**
 * Sanitize a boolean input.
 * Accepts boolean, 'true'/'false' (case-insensitive), 1/0.
 * @param {unknown} val
 * @returns {boolean}
 */
export function boolean(val){
	if (typeof val === 'boolean') return val;
	if (typeof val === 'string'){
		const s = val.trim().toLowerCase();
		assert(s==='true' || s==='false', 'Expected "true" or "false"');
		return s==='true';
	}
	if (typeof val === 'number'){
		assert(val===0 || val===1, 'Expected 0 or 1 for boolean');
		return val===1;
	}
	throw new ValidationError('Expected boolean');
}

/**
 * Validate and normalize an ISO date (YYYY-MM-DD).
 * Accepts string or Date; returns string in YYYY-MM-DD.
 * @param {unknown} val
 * @returns {string}
 */
export function isoDate(val){
	let iso;
	if (typeof val === 'string') iso = val.trim();
	else if (val instanceof Date) iso = $.toISO(val);
	else throw new ValidationError('Expected date string or Date');
	const m = /^\d{4}-\d{2}-\d{2}$/.test(iso);
	assert(m, 'Invalid date format, expected YYYY-MM-DD');
	const d = new Date(iso + 'T00:00:00Z');
	assert(!Number.isNaN(d.getTime()), 'Invalid date');
	return iso;
}

// ----- Schema validators (based on data.js typedefs) -----

/**
 * @typedef {import('./data.js').Food} Food
 * @typedef {import('./data.js').Meal} Meal
 * @typedef {import('./data.js').FoodSnapshot} FoodSnapshot
 * @typedef {import('./data.js').Macros} Macros
 * @typedef {import('./data.js').CreateFoodInput} CreateFoodInput
 */

/**
 * Validate Macros object; returns normalized macros.
 * @param {unknown} v
 * @returns {Macros}
 */
export function macros(v){
	assert(isObject(v), 'Expected Macros object', ['kcal','prot','carbs','fats']);
		const o = /** @type {Record<string, unknown>} */ (v);
		const res = validateAndCollect({
			// Accept decimals for kcal and round to nearest integer instead of erroring
			kcal: () => Math.round(number(o.kcal, { min: 0, max: 5000 })),
			prot: () => number(o.prot, { min: 0, max: 1000 }),
			carbs: () => number(o.carbs, { min: 0, max: 1000 }),
			fats: () => number(o.fats, { min: 0, max: 1000 }),
		});
		return /** @type {import('./data.js').Macros} */ (res);
}

/**
 * Validate a FoodSnapshot object.
 * @param {unknown} v
 * @returns {FoodSnapshot}
 */
export function foodSnapshot(v){
	assert(isObject(v), 'Expected FoodSnapshot', ['id','name','refLabel','kcal','prot','carbs','fats','updatedAt']);
	const o = /** @type {Record<string, unknown>} */ (v);
	/** @type {Set<string>} */
	const bad = new Set();
	/** @type {Partial<import('./data.js').FoodSnapshot>} */
	let base = {};
	try {
		base = validateAndCollect({
			id: () => number(o.id, { min: 1, integer: true }),
			name: () => string(o.name, { minLen: 1, maxLen: 120, pattern:/^[\p{L}\p{N}\s'\-_.()]+$/u }),
			refLabel: () => string(o.refLabel, { minLen: 1, maxLen: 120 }),
			updatedAt: () => number(o.updatedAt, { min: 0, integer: true }),
		});
	} catch (e) {
		collectFieldsFromError(e, bad, 'id');
	}
	/** @type {import('./data.js').Macros|undefined} */
	let m;
	try { m = macros(o); } catch (e) { collectFieldsFromError(e, bad, 'kcal'); }
	if (bad.size) throw new ValidationError('Invalid fields', Array.from(bad));
	return /** @type {import('./data.js').FoodSnapshot} */({ ...base, ...m });
}

/**
 * Validate a Food object.
 * @param {unknown} v
 * @returns {Food}
 */
export function food(v){
	assert(isObject(v), 'Expected Food', ['id','name','refLabel','kcal','prot','carbs','fats','archived','updatedAt']);
	const o = /** @type {Record<string, unknown>} */ (v);
	/** @type {Set<string>} */
	const bad = new Set();
	/** @type {Partial<import('./data.js').Food>} */
	let base = {};
	try {
		base = validateAndCollect({
			id: () => number(o.id, { min: 1, integer: true }),
			name: () => string(o.name, { minLen: 1, maxLen: 120, pattern:/^[\p{L}\p{N}\s'\-_.()]+$/u }),
			refLabel: () => string(o.refLabel, { minLen: 1, maxLen: 120 }),
			updatedAt: () => number(o.updatedAt, { min: 0, integer: true }),
		});
	} catch (e) { collectFieldsFromError(e, bad, 'id'); }
	/** @type {import('./data.js').Macros|undefined} */
	let m;
	try { m = macros(o); } catch (e) { collectFieldsFromError(e, bad, 'kcal'); }
	if (bad.size) throw new ValidationError('Invalid fields', Array.from(bad));
	return /** @type {import('./data.js').Food} */({ ...base, ...m, archived: Boolean(o.archived) });
}

/**
 * Validate CreateFoodInput (form payload for Foods.create/update from foods.js).
 * @param {unknown} v
 * @returns {CreateFoodInput}
 */
export function createFoodInput(v){
	assert(isObject(v), 'Expected CreateFoodInput', ['name','refLabel','kcal','prot','carbs','fats']);
	const o = /** @type {Record<string, unknown>} */ (v);
	/** @type {Set<string>} */
	const bad = new Set();
	/** @type {Partial<import('./data.js').CreateFoodInput>} */
	let base = {};
	try {
		base = validateAndCollect({
			name: () => string(o.name, { minLen: 1, maxLen: 120, pattern:/^[\p{L}\p{N}\s'\-_.()]+$/u }),
			refLabel: () => string(o.refLabel, { minLen: 1, maxLen: 120 }),
		});
	} catch (e) { collectFieldsFromError(e, bad, 'name'); }
	/** @type {import('./data.js').Macros|undefined} */
	let m;
	try { m = macros(o); } catch (e) { collectFieldsFromError(e, bad, 'kcal'); }
	if (bad.size) throw new ValidationError('Invalid fields', Array.from(bad));
	return /** @type {import('./data.js').CreateFoodInput} */({ ...base, ...m });
}

/**
 * Validate a Meal object.
 * @param {unknown} v
 * @returns {Meal}
 */
export function meal(v){
	assert(isObject(v), 'Expected Meal', ['id','foodId','foodSnapshot','multiplier','date','updatedAt']);
	const o = /** @type {Record<string, unknown>} */ (v);
	/** @type {Set<string>} */
	const bad = new Set();
	/** @type {Partial<import('./data.js').Meal>} */
	const out = {};
	try { out.id = number(o.id, { min: 1, integer: true }); } catch (e) { collectFieldsFromError(e, bad, 'id'); }
	try { out.foodId = number(o.foodId, { min: 1, integer: true }); } catch (e) { collectFieldsFromError(e, bad, 'foodId'); }
	try { out.foodSnapshot = foodSnapshot(o.foodSnapshot); } catch (e) { collectFieldsFromError(e, bad, 'foodSnapshot'); }
	try { out.multiplier = number(o.multiplier, { min: 0, max: 100 }); } catch (e) { collectFieldsFromError(e, bad, 'multiplier'); }
	try { out.date = isoDate(o.date); } catch (e) { collectFieldsFromError(e, bad, 'date'); }
	try { out.updatedAt = number(o.updatedAt, { min: 0, integer: true }); } catch (e) { collectFieldsFromError(e, bad, 'updatedAt'); }
	if (bad.size) throw new ValidationError('Invalid fields', Array.from(bad));
	return /** @type {import('./data.js').Meal} */ (out);
}

/**
 * Validate the input passed to Meals.create from meal.js.
 * @param {unknown} v
 * @returns {{ food: Food, multiplier: number, date: string }}
 */
export function mealCreate(v){
	assert(isObject(v), 'Expected meal create opts', ['food','multiplier','date']);
	const o = /** @type {Record<string, unknown>} */ (v);
	/** @type {Set<string>} */
	const bad = new Set();
	/** @type {{ food: import('./data.js').Food; multiplier: number; date: string }} */
	// @ts-ignore - we'll fill incrementally and throw if incomplete
	const out = {};
	try { out.food = food(o.food); } catch (e) { collectFieldsFromError(e, bad, 'food'); }
	try { out.multiplier = number(o.multiplier, { min: 0, max: 100 }); } catch (e) { collectFieldsFromError(e, bad, 'multiplier'); }
	try { out.date = isoDate(o.date); } catch (e) { collectFieldsFromError(e, bad, 'date'); }
	if (bad.size) throw new ValidationError('Invalid fields', Array.from(bad));
	return out;
}

/**
 * Utilities to check partial patches for Foods.update/Meals.update.
 * These keep only known, valid keys, validated with appropriate rules.
 */

/**
 * Validate and filter a Food update patch.
 * @param {unknown} patch
 * @returns {Partial<Food>}
 */
export function foodPatch(patch){
	assert(isObject(patch), 'Expected patch object', ['name','refLabel','kcal','prot','carbs','fats','archived']);
	const p = /** @type {Record<string, unknown>} */ (patch);
	const validators = /** @type {Record<string, () => any>} */({});
	if ('name' in p) validators.name = () => string(p.name, { minLen: 1, maxLen: 120 });
	if ('refLabel' in p) validators.refLabel = () => string(p.refLabel, { minLen: 1, maxLen: 120 });
	// Round kcal to nearest integer rather than erroring on decimals
	if ('kcal' in p) validators.kcal = () => Math.round(number(p.kcal, { min: 0, max: 5000 }));
	if ('prot' in p) validators.prot = () => number(p.prot, { min: 0, max: 1000 });
	if ('carbs' in p) validators.carbs = () => number(p.carbs, { min: 0, max: 1000 });
	if ('fats' in p) validators.fats = () => number(p.fats, { min: 0, max: 1000 });
	if ('archived' in p) validators.archived = () => boolean(p.archived);
	// updatedAt is always handled by data layer; ignore external values
	return /** @type {Partial<Food>} */ (validateAndCollect(validators, 'Invalid fields'));
}

/**
 * Validate and filter a Meal update patch.
 * @param {unknown} patch
 * @returns {Partial<Meal>}
 */
export function mealPatch(patch){
	assert(isObject(patch), 'Expected patch object', ['multiplier','date','foodSnapshot']);
	const p = /** @type {Record<string, unknown>} */ (patch);
	/** @type {Set<string>} */
	const bad = new Set();
	/** @type {Partial<Meal>} */
	const out = {};
	if ('multiplier' in p){ try { out.multiplier = number(p.multiplier, { min: 0, max: 100 }); } catch (e) { collectFieldsFromError(e, bad, 'multiplier'); } }
	if ('date' in p){ try { out.date = isoDate(p.date); } catch (e) { collectFieldsFromError(e, bad, 'date'); } }
	if ('foodSnapshot' in p){ try { out.foodSnapshot = foodSnapshot(p.foodSnapshot); } catch (e) { collectFieldsFromError(e, bad, 'foodSnapshot'); } }
	// id, foodId, updatedAt are controlled by data layer; ignore external changes
	if (bad.size) throw new ValidationError('Invalid fields', Array.from(bad));
	return out;
}

/**
 * Narrow and validate an id read from DOM dataset or input.
 * @param {unknown} v
 * @returns {number}
 */
export function id(v){
	return number(v, { min: 1, integer: true });
}

export { ValidationError };

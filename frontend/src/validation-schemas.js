import {
    ValidationError,
    collectFieldsFromError,
    validateAndCollect,
    isObject,
    string,
    number,
    boolean,
    isoDate,
} from './validation-core.js';

/**
 * @typedef {import('./data.js').Food} Food
 * @typedef {import('./data.js').Meal} Meal
 * @typedef {import('./data.js').FoodSnapshot} FoodSnapshot
 * @typedef {import('./data.js').Macros} Macros
 * @typedef {import('./data.js').CreateFoodInput} CreateFoodInput
 */

/**
 * Validate Macros object; returns normalized macros.
 * Rounds kcal to nearest integer; prot/carbs/fats to 1 decimal place.
 * @param {unknown} v
 * @returns {Macros}
 * @throws {ValidationError}
 */
function macros(v){
    isObject(v) || (()=>{ throw new ValidationError('Expected Macros object', ['kcal','prot','carbs','fats']); })();
    const o = /** @type {Record<string, unknown>} */ (v);
    const res = validateAndCollect({
        kcal: () => Math.round(number(o.kcal, { min: 0, max: 5000 })),
        prot: () => number(o.prot, { min: 0, max: 1000 }),
        carbs: () => number(o.carbs, { min: 0, max: 1000 }),
        fats: () => number(o.fats, { min: 0, max: 1000 }),
    });
    return /** @type {Macros} */ (res);
}

/**
 * Validate a FoodSnapshot object.
 * @param {unknown} v
 * @returns {FoodSnapshot}
 * @throws {ValidationError}
 */
function foodSnapshot(v){
    isObject(v) || (()=>{ throw new ValidationError('Expected FoodSnapshot', ['id','name','refLabel','kcal','prot','carbs','fats','updatedAt']); })();
    const o = /** @type {Record<string, unknown>} */ (v);
    /** @type {Set<string>} */
    const bad = new Set();
    /** @type {Partial<FoodSnapshot>} */
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
    /** @type {Macros|undefined} */
    let m;
    try { m = macros(o); }
    catch (e) { collectFieldsFromError(e, bad, 'kcal'); }

    if (bad.size) {throw new ValidationError('Invalid fields', Array.from(bad));}
    return /** @type {FoodSnapshot} */({ ...base, ...m });
}

/**
 * Validate a Food object.
 * @param {unknown} v
 * @returns {Food}
 * @throws {ValidationError}
 */
function food(v){
    isObject(v) || (()=>{ throw new ValidationError('Expected Food', ['id','name','refLabel','kcal','prot','carbs','fats','archived','updatedAt']); })();
    const o = /** @type {Record<string, unknown>} */ (v);
    /** @type {Set<string>} */
    const bad = new Set();
    /** @type {Partial<Food>} */
    let base = {};
    try {
        base = validateAndCollect({
            id: () => number(o.id, { min: 1, integer: true }),
            name: () => string(o.name, { minLen: 1, maxLen: 120, pattern:/^[\p{L}\p{N}\s'\-_.()]+$/u }),
            refLabel: () => string(o.refLabel, { minLen: 1, maxLen: 120 }),
            updatedAt: () => number(o.updatedAt, { min: 0, integer: true }),
        });
    } catch (e) { collectFieldsFromError(e, bad, 'id'); }
    /** @type {Macros|undefined} */
    let m;
    try { m = macros(o); }
    catch (e) { collectFieldsFromError(e, bad, 'kcal'); }
    if (bad.size) {throw new ValidationError('Invalid fields', Array.from(bad));}
    return /** @type {Food} */({ ...base, ...m, archived: Boolean(o.archived) });
}

/**
 * Validate CreateFoodInput (form payload for Foods.create/update).
 * @param {unknown} v
 * @returns {CreateFoodInput}
 * @throws {ValidationError}
 */
function createFoodInput(v){
    isObject(v) || (()=>{ throw new ValidationError('Expected CreateFoodInput', ['name','refLabel','kcal','prot','carbs','fats']); })();
    const o = /** @type {Record<string, unknown>} */ (v);
    /** @type {Set<string>} */
    const bad = new Set();
    /** @type {Partial<CreateFoodInput>} */
    let base = {};
    try {
        base = validateAndCollect({
            name: () => string(o.name, { minLen: 1, maxLen: 120, pattern:/^[\p{L}\p{N}\s'\-_.()]+$/u }),
            refLabel: () => string(o.refLabel, { minLen: 1, maxLen: 120 }),
        });
    } catch (e) { collectFieldsFromError(e, bad, 'name'); }
    /** @type {Macros|undefined} */
    let m;
    try { m = macros(o); }
    catch (e) { collectFieldsFromError(e, bad, 'kcal'); }
    if (bad.size) {throw new ValidationError('Invalid fields', Array.from(bad));}
    return /** @type {CreateFoodInput} */({ ...base, ...m });
}

/**
 * Validate a Meal object.
 * @param {unknown} v
 * @returns {Meal}
 * @throws {ValidationError}
 */
function meal(v){
    isObject(v) || (()=>{ throw new ValidationError('Expected Meal', ['id','foodId','foodSnapshot','multiplier','date','updatedAt']); })();
    const o = /** @type {Record<string, unknown>} */ (v);
    /** @type {Set<string>} */
    const bad = new Set();
    /** @type {Partial<Meal>} */
    const out = {};
    try { out.id = number(o.id, { min: 1, integer: true }); }
    catch (e) { collectFieldsFromError(e, bad, 'id'); }

    try { out.foodId = number(o.foodId, { min: 1, integer: true }); }
    catch (e) { collectFieldsFromError(e, bad, 'foodId'); }

    try { out.foodSnapshot = foodSnapshot(o.foodSnapshot); }
    catch (e) { collectFieldsFromError(e, bad, 'foodSnapshot'); }

    try { out.multiplier = number(o.multiplier, { min: 0, max: 100 }); }
    catch (e) { collectFieldsFromError(e, bad, 'multiplier'); }

    try { out.date = isoDate(o.date); }
    catch (e) { collectFieldsFromError(e, bad, 'date'); }

    try { out.updatedAt = number(o.updatedAt, { min: 0, integer: true }); }
    catch (e) { collectFieldsFromError(e, bad, 'updatedAt'); }

    if (bad.size) {throw new ValidationError('Invalid fields', Array.from(bad));}
    return /** @type {Meal} */ (out);
}

/**
 * Validate the input passed to Meals.create from meal.js.
 * @param {unknown} v
 * @returns {{ food: Food, multiplier: number, date: string }}
 * @throws {ValidationError}
 */
function mealCreate(v){
    isObject(v) || (()=>{ throw new ValidationError('Expected meal create opts', ['food','multiplier','date']); })();
    const o = /** @type {Record<string, unknown>} */ (v);
    /** @type {Set<string>} */
    const bad = new Set();
    /** @type {{ food: Food; multiplier: number; date: string }} */
    // @ts-ignore - filled incrementally
    const out = {};
    try { out.food = food(o.food); }
    catch (e) { collectFieldsFromError(e, bad, 'food'); }

    try { out.multiplier = number(o.multiplier, { min: 0, max: 100 }); }
    catch (e) { collectFieldsFromError(e, bad, 'multiplier'); }

    try { out.date = isoDate(o.date); }
    catch (e) { collectFieldsFromError(e, bad, 'date'); }

    if (bad.size) {throw new ValidationError('Invalid fields', Array.from(bad));}
    return out;
}

/**
 * Validate and filter a Food update patch.
 * Only provided fields are validated; omitted fields are not required.
 * @param {unknown} patch
 * @returns {Partial<Food>}
 * @throws {ValidationError}
 */
function foodPatch(patch){
    isObject(patch) || (()=>{ throw new ValidationError('Expected patch object', ['name','refLabel','kcal','prot','carbs','fats','archived']); })();
    const p = /** @type {Record<string, unknown>} */ (patch);
    const validators = /** @type {Record<string, () => any>} */({});
    if ('name' in p) {validators.name = () => string(p.name, { minLen: 1, maxLen: 120 });}
    if ('refLabel' in p) {validators.refLabel = () => string(p.refLabel, { minLen: 1, maxLen: 120 });}
    if ('kcal' in p) {validators.kcal = () => Math.round(number(p.kcal, { min: 0, max: 5000 }));}
    if ('prot' in p) {validators.prot = () => number(p.prot, { min: 0, max: 1000 });}
    if ('carbs' in p) {validators.carbs = () => number(p.carbs, { min: 0, max: 1000 });}
    if ('fats' in p) {validators.fats = () => number(p.fats, { min: 0, max: 1000 });}
    if ('archived' in p) {validators.archived = () => boolean(p.archived);}
    return /** @type {Partial<Food>} */ (validateAndCollect(validators, 'Invalid fields'));
}

/**
 * Validate and filter a Meal update patch.
 * Only provided fields are validated; omitted fields are not required.
 * @param {unknown} patch
 * @returns {Partial<Meal>}
 * @throws {ValidationError}
 */
function mealPatch(patch){
    isObject(patch) || (()=>{ throw new ValidationError('Expected patch object', ['multiplier','date','foodSnapshot']); })();
    const p = /** @type {Record<string, unknown>} */ (patch);
    /** @type {Set<string>} */
    const bad = new Set();
    /** @type {Partial<Meal>} */
    const out = {};
    if ('multiplier' in p) {
        try { out.multiplier = number(p.multiplier, { min: 0, max: 100 }); }
        catch (e) { collectFieldsFromError(e, bad, 'multiplier'); }
    }
    if ('date' in p) {
        try { out.date = isoDate(p.date); }
        catch (e) { collectFieldsFromError(e, bad, 'date'); }
    }
    if ('foodSnapshot' in p) {
        try { out.foodSnapshot = foodSnapshot(p.foodSnapshot); }
        catch (e) { collectFieldsFromError(e, bad, 'foodSnapshot'); }
    }
    if (bad.size) {throw new ValidationError('Invalid fields', Array.from(bad));}
    return out;
}

/**
 * Narrow and validate an id read from DOM dataset or input.
 * @param {unknown} v
 * @returns {number}
 * @throws {ValidationError}
 */
function id(v){
    return number(v, { min: 1, integer: true });
}

export {
    macros,
    foodSnapshot,
    food,
    createFoodInput,
    meal,
    mealCreate,
    foodPatch,
    mealPatch,
    id,
};

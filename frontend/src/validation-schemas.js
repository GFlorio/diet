import {
    boolean,
    collectFieldsFromError,
    isObject,
    isoDate,
    number,
    string,
    ValidationError,
    validateAndCollect,
} from './validation-core.js';

const NAME_MAX_LEN   = 120;
const KCAL_MAX       = 5000;
const MACRO_G_MAX    = 1000;
const MULTIPLIER_MAX = 100;

/** @param {unknown} value */
function nonEmptyString(value) {
    return string(value, { minLen: 1 });
}

/** @param {unknown} val */
const validateName = (val) => string(val, {
    minLen: 1, maxLen: NAME_MAX_LEN, pattern: /^[\p{L}\p{N}\s'\-_.()]+$/u,
});
/** @param {unknown} val */
const validateRefLabel = (val) => string(val, { minLen: 1, maxLen: NAME_MAX_LEN });

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
 * @param {unknown} value
 * @returns {Macros}
 * @throws {ValidationError}
 */
function macros(value){
    if (!isObject(value)) {
        throw new ValidationError('Expected Macros object', ['kcal','prot','carbs','fats']);
    }
    const fields = /** @type {Record<string, unknown>} */ (value);
    const validatedMacros = validateAndCollect({
        kcal: () => Math.round(number(fields.kcal, { min: 0, max: KCAL_MAX })),
        prot: () => number(fields.prot, { min: 0, max: MACRO_G_MAX }),
        carbs: () => number(fields.carbs, { min: 0, max: MACRO_G_MAX }),
        fats: () => number(fields.fats, { min: 0, max: MACRO_G_MAX }),
    });
    return /** @type {Macros} */ (validatedMacros);
}

/**
 * Shared validation for Food and FoodSnapshot (id + base fields + macros).
 * @param {unknown} value
 * @param {string} typeName
 * @param {string[]} typeFields
 * @returns {{ fields: Record<string, unknown>, base: Record<string, unknown>, macros: Macros }}
 */
function validateFoodLike(value, typeName, typeFields) {
    if (!isObject(value)) { throw new ValidationError(`Expected ${typeName}`, typeFields); }
    const fields = /** @type {Record<string, unknown>} */ (value);
    /** @type {Set<string>} */
    const invalidFields = new Set();
    /** @type {Record<string, unknown>} */
    let base = {};
    try {
        base = validateAndCollect({
            id: () => nonEmptyString(fields.id),
            name: () => validateName(fields.name),
            refLabel: () => validateRefLabel(fields.refLabel),
            updatedAt: () => number(fields.updatedAt, { min: 0, integer: true }),
        });
    } catch (e) {
        collectFieldsFromError(e, invalidFields, 'id');
    }
    /** @type {Macros|undefined} */
    let macroFields;
    try { macroFields = macros(fields); }
    catch (e) { collectFieldsFromError(e, invalidFields, 'kcal'); }
    if (invalidFields.size) { throw new ValidationError('Invalid fields', Array.from(invalidFields)); }
    return { fields, base, macros: /** @type {Macros} */ (macroFields) };
}

/**
 * Validate a FoodSnapshot object.
 * @param {unknown} value
 * @returns {FoodSnapshot}
 * @throws {ValidationError}
 */
function foodSnapshot(value){
    const fields = ['id','name','refLabel','kcal','prot','carbs','fats','updatedAt'];
    const { base, macros: macroFields } = validateFoodLike(value, 'FoodSnapshot', fields);
    return /** @type {FoodSnapshot} */({ ...base, ...macroFields });
}

/**
 * Validate a Food object.
 * @param {unknown} value
 * @returns {Food}
 * @throws {ValidationError}
 */
function food(value){
    const fields = ['id','name','refLabel','kcal','prot','carbs','fats','archived','updatedAt'];
    const { fields: foodFields, base, macros: macroFields } = validateFoodLike(value, 'Food', fields);
    return /** @type {Food} */({ ...base, ...macroFields, archived: Boolean(foodFields.archived) });
}

/**
 * Validate CreateFoodInput (form payload for Foods.create/update).
 * @param {unknown} value
 * @returns {CreateFoodInput}
 * @throws {ValidationError}
 */
function createFoodInput(value){
    if (!isObject(value)) {
        throw new ValidationError('Expected CreateFoodInput',
            ['name','refLabel','kcal','prot','carbs','fats']);
    }
    const fields = /** @type {Record<string, unknown>} */ (value);
    /** @type {Set<string>} */
    const invalidFields = new Set();
    /** @type {Partial<CreateFoodInput>} */
    let base = {};
    try {
        base = validateAndCollect({
            name: () => validateName(fields.name),
            refLabel: () => validateRefLabel(fields.refLabel),
        });
    } catch (e) { collectFieldsFromError(e, invalidFields, 'name'); }
    /** @type {Macros|undefined} */
    let macroFields;
    try { macroFields = macros(fields); }
    catch (e) { collectFieldsFromError(e, invalidFields, 'kcal'); }
    if (invalidFields.size) {throw new ValidationError('Invalid fields', Array.from(invalidFields));}
    return /** @type {CreateFoodInput} */({ ...base, ...macroFields });
}

/**
 * Validate a Meal object.
 * @param {unknown} value
 * @returns {Meal}
 * @throws {ValidationError}
 */
function meal(value){
    if (!isObject(value)) {
        throw new ValidationError('Expected Meal',
            ['id','foodId','foodSnapshot','multiplier','date','updatedAt']);
    }
    const fields = /** @type {Record<string, unknown>} */ (value);
    /** @type {Set<string>} */
    const invalidFields = new Set();
    /** @type {Partial<Meal>} */
    const validatedMeal = {};
    try { validatedMeal.id = nonEmptyString(fields.id); }
    catch (e) { collectFieldsFromError(e, invalidFields, 'id'); }

    try { validatedMeal.foodId = nonEmptyString(fields.foodId); }
    catch (e) { collectFieldsFromError(e, invalidFields, 'foodId'); }

    try { validatedMeal.foodSnapshot = foodSnapshot(fields.foodSnapshot); }
    catch (e) { collectFieldsFromError(e, invalidFields, 'foodSnapshot'); }

    try { validatedMeal.multiplier = number(fields.multiplier, { min: 0, max: MULTIPLIER_MAX }); }
    catch (e) { collectFieldsFromError(e, invalidFields, 'multiplier'); }

    try { validatedMeal.date = isoDate(fields.date); }
    catch (e) { collectFieldsFromError(e, invalidFields, 'date'); }

    try { validatedMeal.updatedAt = number(fields.updatedAt, { min: 0, integer: true }); }
    catch (e) { collectFieldsFromError(e, invalidFields, 'updatedAt'); }

    if (invalidFields.size) {throw new ValidationError('Invalid fields', Array.from(invalidFields));}
    return /** @type {Meal} */ (validatedMeal);
}

/**
 * Validate the input passed to Meals.create from meal.js.
 * @param {unknown} value
 * @returns {{ food: Food, multiplier: number, date: string }}
 * @throws {ValidationError}
 */
function mealCreate(value){
    if (!isObject(value)) {
        throw new ValidationError('Expected meal create opts', ['food','multiplier','date']);
    }
    const fields = /** @type {Record<string, unknown>} */ (value);
    /** @type {Set<string>} */
    const invalidFields = new Set();
    /** @type {{ food: Food; multiplier: number; date: string }} */
    const mealInput = /** @type {any} */ ({});
    try { mealInput.food = food(fields.food); }
    catch (e) { collectFieldsFromError(e, invalidFields, 'food'); }

    try { mealInput.multiplier = number(fields.multiplier, { min: 0, max: MULTIPLIER_MAX }); }
    catch (e) { collectFieldsFromError(e, invalidFields, 'multiplier'); }

    try { mealInput.date = isoDate(fields.date); }
    catch (e) { collectFieldsFromError(e, invalidFields, 'date'); }

    if (invalidFields.size) {throw new ValidationError('Invalid fields', Array.from(invalidFields));}
    return mealInput;
}

/**
 * Validate and filter a Food update patch.
 * Only provided fields are validated; omitted fields are not required.
 * @param {unknown} patch
 * @returns {Partial<Food>}
 * @throws {ValidationError}
 */
function foodPatch(patch){
    if (!isObject(patch)) {
        throw new ValidationError('Expected patch object',
            ['name','refLabel','kcal','prot','carbs','fats','archived']);
    }
    const fields = /** @type {Record<string, unknown>} */ (patch);
    const validators = /** @type {Record<string, () => any>} */({});
    if ('name' in fields) {validators.name = () => validateName(fields.name);}
    if ('refLabel' in fields) {validators.refLabel = () => validateRefLabel(fields.refLabel);}
    if ('kcal' in fields) {validators.kcal = () => Math.round(number(fields.kcal, { min: 0, max: KCAL_MAX }));}
    if ('prot' in fields) {validators.prot = () => number(fields.prot, { min: 0, max: MACRO_G_MAX });}
    if ('carbs' in fields) {validators.carbs = () => number(fields.carbs, { min: 0, max: MACRO_G_MAX });}
    if ('fats' in fields) {validators.fats = () => number(fields.fats, { min: 0, max: MACRO_G_MAX });}
    if ('archived' in fields) {validators.archived = () => boolean(fields.archived);}
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
    if (!isObject(patch)) {
        throw new ValidationError('Expected patch object',
            ['multiplier','date','foodSnapshot']);
    }
    const fields = /** @type {Record<string, unknown>} */ (patch);
    const validators = /** @type {Record<string, () => any>} */({});
    if ('multiplier' in fields) {
        validators.multiplier = () => number(fields.multiplier, { min: 0, max: 100 });
    }
    if ('date' in fields) {validators.date = () => isoDate(fields.date);}
    if ('foodSnapshot' in fields) {validators.foodSnapshot = () => foodSnapshot(fields.foodSnapshot);}
    return /** @type {Partial<Meal>} */ (validateAndCollect(validators, 'Invalid fields'));
}

export {
    createFoodInput,
    food,
    foodPatch,
    foodSnapshot,
    macros,
    meal,
    mealCreate,
    mealPatch,
};

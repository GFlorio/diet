import { Foods } from './data-foods.js';
import { Meals, resolveMealMacros, resolveSnapshotMacros } from './data-meals.js';

/**
 * Re-export typedefs for external JSDoc consumers.
 * @typedef {import('./db.js').Macros} Macros
 * @typedef {import('./db.js').Food} Food
 * @typedef {import('./db.js').FoodSnapshot} FoodSnapshot
 * @typedef {import('./db.js').MealSnapshot} MealSnapshot
 * @typedef {import('./db.js').BasicFoodRecord} BasicFoodRecord
 * @typedef {import('./db.js').RecipeFoodRecord} RecipeFoodRecord
 * @typedef {import('./db.js').ResolvedRecipeFood} ResolvedRecipeFood
 * @typedef {import('./db.js').Meal} Meal
 * @typedef {import('./data-foods.js').CreateFoodInput} CreateFoodInput
 */

export { Foods, Meals, resolveMealMacros, resolveSnapshotMacros };

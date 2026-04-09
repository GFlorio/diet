import * as db from './db.js';
import { Foods } from './data-foods.js';
import { Meals } from './data-meals.js';

/**
 * Re-export typedefs for external JSDoc consumers.
 * @typedef {import('./db.js').Macros} Macros
 * @typedef {import('./db.js').Food} Food
 * @typedef {import('./db.js').FoodSnapshot} FoodSnapshot
 * @typedef {import('./db.js').Meal} Meal
 * @typedef {import('./data-foods.js').CreateFoodInput} CreateFoodInput
 */

export const { openDB } = db;
export { Foods, Meals };

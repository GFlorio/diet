/**
 * @typedef {{ kcal: number, prot: number, carbs: number, fats: number }} Macros
 */

/** @returns {Macros} */
export function zeroMacros() {
  return { kcal: 0, prot: 0, carbs: 0, fats: 0 };
}

/**
 * @param {Macros} total
 * @param {Macros} macros
 * @param {number} multiplier
 */
export function addMacros(total, macros, multiplier) {
  total.kcal += macros.kcal * multiplier;
  total.prot += macros.prot * multiplier;
  total.carbs += macros.carbs * multiplier;
  total.fats += macros.fats * multiplier;
}

/**
 * Recipe portion totals are normalized only after every ingredient is summed.
 * @param {Macros} macros
 * @returns {Macros}
 */
export function normalizeMacros(macros) {
  return {
    kcal: Math.round(macros.kcal),
    prot: Math.round(macros.prot * 10) / 10,
    carbs: Math.round(macros.carbs * 10) / 10,
    fats: Math.round(macros.fats * 10) / 10,
  };
}

/**
 * Resolve macros from either a legacy/basic snapshot or a structural recipe
 * snapshot. Recipe snapshots deliberately have no top-level macro fields.
 * @param {import('./db.js').MealSnapshot} snapshot
 * @returns {Macros}
 */
export function resolveSnapshotMacros(snapshot) {
  if (snapshot.type !== 'recipe') {
    return {
      kcal: snapshot.kcal,
      prot: snapshot.prot,
      carbs: snapshot.carbs,
      fats: snapshot.fats,
    };
  }

  const total = zeroMacros();
  for (const ingredient of snapshot.ingredients) {
    addMacros(total, resolveSnapshotMacros(ingredient.foodSnapshot), ingredient.multiplier);
  }
  return normalizeMacros(total);
}

/**
 * Apply the logged quantity only after resolving one food/recipe portion.
 * @param {import('./db.js').Meal} meal
 * @returns {Macros}
 */
export function resolveMealMacros(meal) {
  const portion = resolveSnapshotMacros(meal.foodSnapshot);
  return {
    kcal: portion.kcal * meal.multiplier,
    prot: portion.prot * meal.multiplier,
    carbs: portion.carbs * meal.multiplier,
    fats: portion.fats * meal.multiplier,
  };
}

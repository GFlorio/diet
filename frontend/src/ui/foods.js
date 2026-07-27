import { Foods, Meals } from '../data.js';
import {
  decodeFoodCode,
  decodeRecipeCode,
  encodeFoodCode,
  encodeRecipeCode,
} from '../food-share-code.js';
import {
  archiveIcon,
  editIcon,
  importCodeIcon,
  removeIcon,
  shareIcon,
} from '../icons.js';
import { normalizeMacros } from '../macro-resolution.js';
import * as $ from '../utils.js';
import * as v from '../validation.js';

/**
 * @typedef {import('../data.js').Food} Food
 * @typedef {import('../db.js').BasicFoodRecord} BasicFood
 * @typedef {import('../data-foods.js').PortableRecipe} PortableRecipe
 * @typedef {{
 *   foodId: string|null,
 *   multiplier: number,
 *   food: Pick<BasicFood, 'id'|'name'|'refLabel'|'kcal'|'prot'|'carbs'|'fats'|'archived'|'updatedAt'>,
 *   portableFood?: PortableRecipe['ingredients'][number]['food'],
 *   localMatch?: boolean
 * }} SelectedIngredient
 */

/** Initialize foods page UI and handlers. */
export function setupFoods() {
  const foodLibraryCard = $.html($.id('foodLibraryCard'));
  const foodFormCard = $.html($.id('foodFormCard'));
  const foodForm = $.form($.id('foodForm'));
  const foodFormTitle = $.html($.id('foodFormTitle'));
  const foodFormDescription = $.html($.id('foodFormDescription'));
  const foodUpdated = $.html($.id('foodUpdated'));
  const foodId = $.input($.id('foodId'));
  const foodNameLabel = $.html($.id('foodNameLabel'));
  const foodName = $.input($.id('foodName'));
  const foodRefLabelText = $.html($.id('foodRefLabelText'));
  const foodRefLabel = $.input($.id('foodRefLabel'));
  const foodKcal = $.input($.id('foodKcal'));
  const foodProt = $.input($.id('foodProt'));
  const foodCarb = $.input($.id('foodCarb'));
  const foodFat = $.input($.id('foodFat'));
  const foodMacroFields = $.html($.id('foodMacroFields'));
  const recipeEditor = $.html($.id('recipeEditor'));
  const recipeSummary = $.html($.id('recipeSummary'));
  const recipeIngredientSearch = $.input($.id('recipeIngredientSearch'));
  const recipeIngredientResults = $.html($.id('recipeIngredientResults'));
  const recipeIngredients = $.html($.id('recipeIngredients'));
  const addFoodBtn = $.button($.id('addFoodBtn'));
  const createRecipeBtn = $.button($.id('createRecipeBtn'));
  const resetFoodBtn = $.button($.id('resetFoodBtn'));
  const saveFoodBtn = $.button($.id('saveFoodBtn'));
  const foodsList = $.html($.id('foodsList'));
  const foodsListCard = $.html($.id('foodsListCard'));
  const foodSearch = $.input($.id('foodSearch'));
  const foodStatus = $.select($.id('foodStatus'));
  const foodFormMsg = $.html($.id('foodFormMsg'));
  const foodImportToggle = $.button($.id('foodImportToggle'));
  const foodImportArea = $.html($.id('foodImportArea'));
  const foodImportInput = $.input($.id('foodImportInput'));
  const foodImportApply = $.button($.id('foodImportApply'));
  const foodImportMsg = $.html($.id('foodImportMsg'));

  foodImportToggle.innerHTML = `${importCodeIcon} Import link`;

  /** @type {'basic'|'recipe'} */
  let formType = 'basic';
  /** @type {SelectedIngredient[]} */
  let selectedIngredients = [];
  let portableDraft = false;

  const fieldToInput = new Map([
    ['name', foodName],
    ['refLabel', foodRefLabel],
    ['kcal', foodKcal],
    ['prot', foodProt],
    ['carbs', foodCarb],
    ['fats', foodFat],
    ['ingredients', recipeIngredientSearch],
  ]);

  function clearFieldErrors() {
    fieldToInput.forEach(input => {
      input.classList.remove('error');
    });
  }

  /** @param {unknown} error */
  function applyValidationErrors(error) {
    const validationError = /** @type {{fields?: string[]}} */ (error || {});
    if (!Array.isArray(validationError.fields)) { return; }
    for (const field of validationError.fields) {
      fieldToInput.get(field)?.classList.add('error');
    }
  }

  /** @returns {{name:string, refLabel:string, kcal:string, prot:string, carbs:string, fats:string}} */
  function readBasicPayload() {
    return {
      name: foodName.value,
      refLabel: foodRefLabel.value,
      kcal: foodKcal.value,
      prot: foodProt.value,
      carbs: foodCarb.value,
      fats: foodFat.value,
    };
  }

  function validateRecipeForm() {
    const base = v.createFoodInput({
      name: foodName.value,
      refLabel: foodRefLabel.value,
      kcal: 0,
      prot: 0,
      carbs: 0,
      fats: 0,
    });
    if (selectedIngredients.length === 0) {
      const error = new v.ValidationError('Add at least one ingredient.', ['ingredients']);
      throw error;
    }
    return {
      type: /** @type {const} */ ('recipe'),
      name: base.name,
      refLabel: base.refLabel,
      ingredients: selectedIngredients.map(ingredient => ({
        foodId: ingredient.foodId,
        multiplier: v.number(ingredient.multiplier, { min: Number.MIN_VALUE, max: 100 }),
      })),
    };
  }

  function updateTypeUi() {
    const isRecipe = formType === 'recipe';
    const editing = Boolean(foodId.value);
    let title = isRecipe ? 'Create recipe' : 'Add food';
    if (editing) { title = isRecipe ? 'Edit recipe' : 'Edit food'; }
    foodFormTitle.textContent = title;
    foodFormDescription.textContent = isRecipe
      ? 'Combine foods from your library. Nutrition is calculated automatically.'
      : 'Enter nutrition for one reference portion.';
    foodNameLabel.textContent = isRecipe ? 'Recipe name' : 'Name';
    foodRefLabelText.textContent = isRecipe ? 'Recipe portion' : 'Reference portion';
    foodRefLabel.placeholder = isRecipe ? 'e.g. 1 bowl, 1 slice' : 'e.g. 100 g, 1 slice';
    saveFoodBtn.textContent = isRecipe ? 'Save recipe' : 'Save food';
    foodMacroFields.classList.toggle('hidden', isRecipe);
    recipeEditor.classList.toggle('hidden', !isRecipe);
    for (const input of [foodKcal, foodProt, foodCarb, foodFat]) {
      input.required = !isRecipe;
    }
  }

  function recipeTotals() {
    const total = { kcal: 0, prot: 0, carbs: 0, fats: 0 };
    for (const ingredient of selectedIngredients) {
      $.addScaledMacros(total, ingredient.food, ingredient.multiplier);
    }
    return normalizeMacros(total);
  }

  function updateRecipeSummary() {
    const empty = selectedIngredients.length === 0;
    recipeSummary.classList.toggle('hidden', empty);
    if (empty) {
      recipeSummary.innerHTML = '';
      return;
    }
    const totals = recipeTotals();
    recipeSummary.innerHTML = `
      <div class="recipe-summary-copy">
        <span class="recipe-summary-label">Recipe total</span>
        <span class="recipe-summary-macros">P ${$.fmtNum(totals.prot)}g · C ${$.fmtNum(totals.carbs)}g · F ${$.fmtNum(totals.fats)}g</span>
      </div>
      <strong class="recipe-summary-kcal">${$.fmtNum(totals.kcal, 0)} kcal</strong>`;
  }

  function renderSelectedIngredients() {
    recipeIngredients.innerHTML = selectedIngredients.map((ingredient, index) => {
      const kcal = ingredient.food.kcal * ingredient.multiplier;
      const archived = ingredient.food.archived ? '<span class="chip">Archived</span>' : '';
      const match = portableDraft
        ? `<span class="chip">${ingredient.localMatch ? 'Local match' : 'New food'}</span>`
        : '';
      return `
        <div class="recipe-ingredient-row" data-index="${index}">
          <div class="recipe-ingredient-main">
            <strong>${$.esc(ingredient.food.name)}</strong> ${archived} ${match}
            <span class="meta">${$.esc(ingredient.food.refLabel)} · ${$.fmtNum(kcal, 0)} kcal</span>
          </div>
          <label class="recipe-ingredient-qty">
            <span aria-hidden="true">×</span>
            <input class="ingredient-multiplier" type="number" min="0.1" max="100" step="0.1"
              inputmode="decimal" value="${ingredient.multiplier}"
              aria-label="Quantity for ${$.esc(ingredient.food.name)}" />
          </label>
          <button type="button" class="btn small ghost remove-ingredient"
            aria-label="Remove ${$.esc(ingredient.food.name)}">${removeIcon}</button>
        </div>`;
    }).join('') || '<div class="recipe-ingredients-empty muted">Search above to add your first ingredient.</div>';
    updateRecipeSummary();
  }

  async function renderIngredientResults() {
    if (formType !== 'recipe') { return; }
    const selectedIds = new Set(selectedIngredients.map(ingredient => ingredient.foodId));
    const foods = await Foods.list({
      search: recipeIngredientSearch.value,
      status: 'active',
      type: 'basic',
    });
    recipeIngredientResults.innerHTML = foods
      .filter(food => !selectedIds.has(food.id))
      .slice(0, 5)
      .map(food => `
        <button type="button" class="recipe-search-result" data-id="${food.id}">
          <span><strong>${$.esc(food.name)}</strong><small>${$.esc(food.refLabel)}</small></span>
          <span>${$.fmtNum(food.kcal, 0)} kcal</span>
        </button>`)
      .join('');
  }

  function updateSaveState() {
    foodFormMsg.textContent = '';
    clearFieldErrors();
    try {
      if (formType === 'basic') {
        v.createFoodInput(readBasicPayload());
      } else {
        validateRecipeForm();
      }
      saveFoodBtn.disabled = false;
    } catch (error) {
      applyValidationErrors(error);
      saveFoodBtn.disabled = true;
    }
  }

  /** @param {'basic'|'recipe'} type */
  function resetFoodFields(type) {
    foodUpdated.textContent = '';
    foodId.value = '';
    foodName.value = '';
    foodRefLabel.value = '';
    foodKcal.value = '';
    foodProt.value = '';
    foodCarb.value = '';
    foodFat.value = '';
    recipeIngredientSearch.value = '';
    recipeIngredientResults.innerHTML = '';
    foodFormMsg.textContent = '';
    formType = type;
    selectedIngredients = [];
    portableDraft = false;
    clearFieldErrors();
    updateTypeUi();
    renderSelectedIngredients();
    saveFoodBtn.disabled = true;
  }

  /** @param {boolean} open */
  function setEditorOpen(open) {
    foodLibraryCard.classList.toggle('hidden', open);
    foodFormCard.classList.toggle('hidden', !open);
    foodsListCard.classList.toggle('hidden', open);
  }

  /** @param {'basic'|'recipe'} type */
  function startFoodForm(type) {
    resetFoodFields(type);
    setEditorOpen(true);
    if (type === 'recipe') { void renderIngredientResults(); }
    foodName.focus();
  }

  function closeFoodForm() {
    resetFoodFields('basic');
    setEditorOpen(false);
  }

  /** @param {Food} food */
  function setFoodForm(food) {
    const recipe = food.type === 'recipe';
    resetFoodFields(recipe ? 'recipe' : 'basic');
    foodUpdated.textContent = `updated ${new Date(food.updatedAt).toLocaleString()}`;
    foodId.value = food.id;
    foodName.value = food.name;
    foodRefLabel.value = food.refLabel;
    if (recipe) {
      selectedIngredients = food.resolvedIngredients.map(ingredient => ({
        foodId: ingredient.foodId,
        multiplier: ingredient.multiplier,
        food: ingredient.food,
      }));
      foodKcal.value = '';
      foodProt.value = '';
      foodCarb.value = '';
      foodFat.value = '';
    } else {
      selectedIngredients = [];
      foodKcal.value = String(food.kcal);
      foodProt.value = String(food.prot);
      foodCarb.value = String(food.carbs);
      foodFat.value = String(food.fats);
    }
    foodFormMsg.textContent = '';
    clearFieldErrors();
    updateTypeUi();
    renderSelectedIngredients();
    saveFoodBtn.disabled = false;
    setEditorOpen(true);
  }

  async function renderFoods() {
    const status = foodStatus.value === 'archived' ? 'archived'
      : foodStatus.value === 'all' ? 'all' : 'active';
    const foods = await Foods.list({ search: foodSearch.value, status });
    foodsList.innerHTML = foods.map(food => {
      const archivedChip = food.archived ? '<span class="chip">Archived</span>' : '';
      const recipeChip = food.type === 'recipe' ? '<span class="chip recipe-chip">Recipe</span>' : '';
      const archiveClass = food.archived ? 'unarchive' : 'archive';
      const archiveLabel = food.archived ? `${archiveIcon} Unarchive` : `${archiveIcon} Archive`;
      return `
        <div class="item" data-id="${food.id}">
          <div><strong>${$.esc(food.name)}</strong> ${recipeChip} ${archivedChip}</div>
          <div class="actions">
            <button class="btn small ghost edit">${editIcon} Edit</button>
            <button class="btn small ghost share">${shareIcon} Share</button>
            <button class="btn small ghost ${archiveClass}">${archiveLabel}</button>
          </div>
          <div class="meta">${$.esc(food.refLabel)} · ${$.nutrMeta(
            food.kcal,
            food.prot,
            food.carbs,
            food.fats,
          )}</div>
        </div>`;
    }).join('') || '<div class="muted">No foods yet.</div>';
  }

  /** @param {Food} food */
  async function shareFood(food) {
    const recipe = food.type === 'recipe';
    const code = recipe ? encodeRecipeCode(food) : encodeFoodCode(food);
    const parameter = recipe ? 'r' : 'f';
    const url = `${location.origin}${location.pathname}?${parameter}=${code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: food.name, url });
      } catch (error) {
        if (/** @type {Error} */ (error).name !== 'AbortError') { throw error; }
      }
      return;
    }
    await navigator.clipboard.writeText(url);
    $.toast('Link copied!');
  }

  foodsList.addEventListener('click', async event => {
    const target = /** @type {HTMLElement} */ (event.target);
    const button = target.closest('button');
    const row = target.closest('.item');
    if (!button || !row) { return; }
    const id = /** @type {HTMLElement} */ (row).dataset.id;
    if (!id) { return; }
    const food = await Foods.byId(id);
    if (!food) { return; }

    if (button.classList.contains('edit')) {
      setFoodForm(food);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (button.classList.contains('share')) {
      await shareFood(food);
      return;
    }
    if (button.classList.contains('archive')) {
      await Foods.setArchived(id, true);
      await renderFoods();
      const [hasMeals, references] = await Promise.all([
        Meals.hasForFood(id),
        Foods.referencedBy(id),
      ]);
      if (references.length > 0) {
        $.toast(`Archived. ${references.length} recipe${references.length === 1 ? '' : 's'} still use this food, so it cannot be deleted.`);
        return;
      }
      if (!hasMeals) {
        $.toast(`No meal history for "${food.name}" — delete permanently?`, {
          duration: 8000,
          action: {
            label: 'Delete',
            callback: async () => {
              await Foods.remove(id);
              await renderFoods();
              $.toast(`"${food.name}" deleted`, {
                duration: 5000,
                action: {
                  label: 'Undo',
                  callback: async () => {
                    await Foods.restore({ ...food, archived: true });
                    await renderFoods();
                  },
                },
              });
            },
          },
        });
      }
      return;
    }
    if (button.classList.contains('unarchive')) {
      await Foods.setArchived(id, false);
      await renderFoods();
    }
  });

  addFoodBtn.addEventListener('click', () => startFoodForm('basic'));
  createRecipeBtn.addEventListener('click', () => startFoodForm('recipe'));

  recipeIngredientSearch.addEventListener('input', () => void renderIngredientResults());

  recipeIngredientResults.addEventListener('click', async event => {
    const button = /** @type {HTMLElement} */ (event.target).closest('.recipe-search-result');
    if (!(button instanceof HTMLButtonElement) || !button.dataset.id) { return; }
    const food = await Foods.byId(button.dataset.id);
    if (!food || food.type === 'recipe') { return; }
    if (selectedIngredients.some(ingredient => ingredient.foodId === food.id)) { return; }
    selectedIngredients.push({ foodId: food.id, multiplier: 1, food });
    recipeIngredientSearch.value = '';
    renderSelectedIngredients();
    await renderIngredientResults();
    updateSaveState();
  });

  recipeIngredients.addEventListener('input', event => {
    const input = /** @type {HTMLElement} */ (event.target);
    if (!(input instanceof HTMLInputElement) || !input.classList.contains('ingredient-multiplier')) { return; }
    const row = input.closest('.recipe-ingredient-row');
    const index = Number(/** @type {HTMLElement} */ (row).dataset.index);
    selectedIngredients[index].multiplier = Number(input.value);
    updateRecipeSummary();
    updateSaveState();
  });

  recipeIngredients.addEventListener('click', event => {
    const button = /** @type {HTMLElement} */ (event.target).closest('.remove-ingredient');
    if (!(button instanceof HTMLButtonElement)) { return; }
    const row = button.closest('.recipe-ingredient-row');
    const index = Number(/** @type {HTMLElement} */ (row).dataset.index);
    selectedIngredients.splice(index, 1);
    renderSelectedIngredients();
    void renderIngredientResults();
    updateSaveState();
  });

  /** @param {string} id */
  async function showSyncPrompt(id) {
    const summary = await Meals.syncSummaryForFood(id);
    if (summary.totalCount === 0) { return; }
    const directCopy = `${summary.directCount} direct meal${summary.directCount === 1 ? '' : 's'}`;
    const recipeCopy = `${summary.recipeCount} recipe meal${summary.recipeCount === 1 ? '' : 's'}`;
    const targets = summary.directCount > 0 && summary.recipeCount > 0
      ? `${directCopy} and ${recipeCopy}`
      : summary.recipeCount > 0 ? recipeCopy : directCopy;
    $.toast(`Update ${targets} with the latest values?`, {
      duration: 8000,
      action: {
        label: 'Update meals',
        callback: async () => {
          try {
            const result = await Meals.syncAllForFood(id);
            const recipeNote = result.recipeCount > 0 ? ` (${result.recipeCount} recipe)` : '';
            $.toast(`✓ ${result.totalCount} meal${result.totalCount === 1 ? '' : 's'} updated${recipeNote}`);
          } catch (error) {
            $.toast(/** @type {Error} */ (error).message, { type: 'error' });
          }
        },
      },
    });
  }

  foodForm.addEventListener('submit', async event => {
    event.preventDefault();
    const submitButton = $.button(foodForm.querySelector('[type=submit]'));
    try {
      clearFieldErrors();
      const isNew = !foodId.value;
      const editId = isNew ? null : foodId.value;
      const recipePayload = formType === 'recipe' ? validateRecipeForm() : null;
      const basicPayload = formType === 'basic' ? v.createFoodInput(readBasicPayload()) : null;
      const displayName = recipePayload?.name ?? basicPayload?.name ?? '';
      await $.withConfirm(submitButton, async () => {
        if (portableDraft && recipePayload) {
          /** @type {PortableRecipe} */
          const bundle = {
            version: 1,
            type: 'recipe',
            name: recipePayload.name,
            refLabel: recipePayload.refLabel,
            ingredients: selectedIngredients.map(ingredient => ({
              multiplier: ingredient.multiplier,
              food: ingredient.portableFood ?? {
                name: ingredient.food.name,
                refLabel: ingredient.food.refLabel,
                kcal: ingredient.food.kcal,
                prot: ingredient.food.prot,
                carbs: ingredient.food.carbs,
                fats: ingredient.food.fats,
              },
            })),
          };
          await Foods.savePortableRecipe(bundle);
        } else if (editId) {
          await Foods.update(editId, /** @type {any} */ (recipePayload ?? basicPayload));
        } else {
          await Foods.create(/** @type {any} */ (recipePayload ?? basicPayload));
        }
        closeFoodForm();
        await renderFoods();
        $.html($.sel('#quickList')).dispatchEvent(new Event('refresh'));
      }, '✓ Saved');

      if (isNew) {
        $.toast(`"${displayName}" added — log a meal now?`, {
          duration: 6000,
          action: {
            label: 'Add meal',
            callback: () => window.dispatchEvent(
              new CustomEvent('go-meals', { detail: { name: displayName } }),
            ),
          },
        });
      } else if (editId) {
        await showSyncPrompt(editId);
      }
    } catch (error) {
      const typedError = /** @type {Error & {fields?: string[]}} */ (error);
      foodFormMsg.textContent = typedError.message || 'Invalid input';
      applyValidationErrors(typedError);
    }
  });

  const liveCheck = $.debounce(updateSaveState, 300);
  for (const input of [foodName, foodRefLabel, foodKcal, foodProt, foodCarb, foodFat]) {
    input.addEventListener('input', liveCheck);
  }

  resetFoodBtn.addEventListener('click', closeFoodForm);
  foodSearch.addEventListener('input', () => void renderFoods());
  foodStatus.addEventListener('change', () => void renderFoods());
  foodSearch.addEventListener('focus', () => {
    const touchDevice = window.matchMedia($.MEDIA_COARSE_POINTER).matches;
    if (touchDevice && window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        foodsListCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, { once: true });
    } else {
      foodsListCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  window.addEventListener('go-foods', async event => {
    const detail = /** @type {CustomEvent} */ (event).detail;
    $.showPage('foods');
    if (detail?.id) {
      const food = await Foods.byId(detail.id);
      if (food) { setFoodForm(food); }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    startFoodForm('basic');
    foodName.value = detail?.name || '';
    foodName.focus();
  });

  /**
   * @param {{name:string, refLabel:string, kcal:string, prot:string, carbs:string, fats:string}} data
   */
  async function applyBasicFoodData(data) {
    $.showPage('foods');
    const matches = await Foods.list({ search: data.name, status: 'all', type: 'basic' });
    const existing = matches.find(food =>
      food.name.trim().toLowerCase() === data.name.trim().toLowerCase()
    );
    if (existing) {
      setFoodForm(existing);
    } else {
      startFoodForm('basic');
      foodName.value = data.name;
      foodRefLabel.value = data.refLabel;
      foodKcal.value = data.kcal;
      foodProt.value = data.prot;
      foodCarb.value = data.carbs;
      foodFat.value = data.fats;
      updateSaveState();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** @param {PortableRecipe} bundle */
  async function applyRecipeData(bundle) {
    const prepared = await Foods.preparePortableRecipe(bundle);
    $.showPage('foods');
    startFoodForm('recipe');
    portableDraft = true;
    foodName.value = prepared.name;
    foodRefLabel.value = prepared.refLabel;
    selectedIngredients = prepared.ingredients.map(ingredient => ({
      foodId: ingredient.match?.id ?? null,
      multiplier: ingredient.multiplier,
      food: ingredient.match ?? {
        id: '',
        ...ingredient.food,
        archived: false,
        updatedAt: 0,
      },
      portableFood: ingredient.food,
      localMatch: Boolean(ingredient.match),
    }));
    updateTypeUi();
    renderSelectedIngredients();
    updateSaveState();
    void renderIngredientResults();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function applyImportCode() {
    let code = foodImportInput.value.trim();
    if (!code) { return; }
    try {
      const url = new URL(code);
      code = url.searchParams.get('r') ?? url.searchParams.get('f') ?? code;
    } catch {
      // Raw code.
    }
    const recipe = decodeRecipeCode(code);
    const basic = recipe ? null : decodeFoodCode(code);
    if (!recipe && !basic) {
      foodImportMsg.textContent = 'Invalid code.';
      return;
    }
    try {
      if (recipe) { await applyRecipeData(recipe); }
      else if (basic) { await applyBasicFoodData(basic); }
      foodImportMsg.textContent = '';
      foodImportArea.classList.add('hidden');
      foodImportInput.value = '';
    } catch (error) {
      foodImportMsg.textContent = /** @type {Error} */ (error).message;
    }
  }

  foodImportToggle.addEventListener('click', () => {
    const opening = foodImportArea.classList.contains('hidden');
    foodImportArea.classList.toggle('hidden');
    if (opening) { foodImportInput.focus(); }
    foodImportMsg.textContent = '';
  });
  foodImportApply.addEventListener('click', () => void applyImportCode());
  foodImportInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') { void applyImportCode(); }
  });

  async function handleFoodFromURL() {
    const parameters = new URLSearchParams(location.search);
    const recipeCode = parameters.get('r');
    const foodCode = parameters.get('f');
    if (!recipeCode && !foodCode) { return; }
    history.replaceState(null, '', location.pathname);
    if (recipeCode) {
      const recipe = decodeRecipeCode(recipeCode);
      if (recipe) { await applyRecipeData(recipe); }
      else { console.warn('Invalid recipe share parameter.'); }
      return;
    }
    const food = decodeFoodCode(/** @type {string} */ (foodCode));
    if (food) { await applyBasicFoodData(food); }
    else { console.warn('Invalid food share parameter.'); }
  }

  closeFoodForm();
  void renderFoods();
  void handleFoodFromURL();
}

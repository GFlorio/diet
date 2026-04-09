import { Foods, Meals } from '../data.js';
import * as v from '../validation.js';
import * as $ from '../utils.js';

/**
 * @typedef {import('../data.js').Food} Food
 */

/** Initialize foods page UI and handlers */
export function setupFoods(){
  const foodForm = $.form($.id('foodForm'));
  const foodFormTitle = $.html($.id('foodFormTitle'));
  const foodUpdated = $.html($.id('foodUpdated'));
  const foodId = $.input($.id('foodId'));
  const foodName = $.input($.id('foodName'));
  const foodRefLabel = $.input($.id('foodRefLabel'));
  const foodKcal = $.input($.id('foodKcal'));
  const foodProt = $.input($.id('foodProt'));
  const foodCarb = $.input($.id('foodCarb'));
  const foodFat = $.input($.id('foodFat'));
  const resetFoodBtn = $.button($.id('resetFoodBtn'));
  const foodsList = $.html($.id('foodsList'));
  const foodSearch = $.input($.id('foodSearch'));
  const foodStatus = $.select($.id('foodStatus'));
  const foodFormMsg = $.html($.id('foodFormMsg'));

  /** Map validation field names to corresponding input elements */
  const fieldToInput = new Map([
    ['name', foodName],
    ['refLabel', foodRefLabel],
    ['kcal', foodKcal],
    ['prot', foodProt],
    ['carbs', foodCarb],
    ['fats', foodFat],
    // Fallback keys used by validators
    ['string', foodName],
    ['number', foodKcal],
  ]);

  /**
   * Remove error styling from all food form input fields.
   */
  function clearFieldErrors(){
    fieldToInput.forEach(el => el.classList.remove('error'));
  }

  /**
   * Apply ValidationError field highlights to inputs.
   * @param {unknown} err - Error object, expected to have optional `fields` array
   */
  function applyValidationErrors(err){
    const e = /** @type {{ fields?: string[] }} */ (err || {});
    if (!Array.isArray(e.fields)) {return;}
    e.fields.forEach(f => {
      const el = fieldToInput.get(f);
      if (el) {el.classList.add('error');}
    });
  }

  /**
   * Reset the food form to its initial "add new food" state.
   */
  function clearFoodForm(){
    foodFormTitle.textContent = 'Add food';
    foodUpdated.textContent='';
    foodId.value='';
    foodName.value='';
    foodRefLabel.value='';
    foodKcal.value='';
    foodProt.value='';
    foodCarb.value='';
    foodFat.value='';
    foodFormMsg.textContent = '';
    clearFieldErrors();
  }

  resetFoodBtn.addEventListener('click', ()=> setFoodForm());

  /**
   * Set the food form to either edit an existing food or reset to create a new one.
   * @param {Food=} f - Food to edit, or undefined/null to reset for new food
   */
  function setFoodForm(f){
    if (!f){
      clearFoodForm();
    } else {
      foodFormTitle.textContent = 'Edit food'; foodUpdated.textContent = `updated ${new Date(f.updatedAt).toLocaleString()}`;
      foodId.value = String(f.id);
      foodName.value=f.name;
      foodRefLabel.value=f.refLabel;
      foodKcal.value=String(f.kcal);
      foodProt.value=String(f.prot);
      foodCarb.value=String(f.carbs);
      foodFat.value=String(f.fats);
      foodFormMsg.textContent = '';
      clearFieldErrors();
    }
  }

  /**
   * Render the foods list based on current search and status filters.
   */
  async function renderFoods(){
    const status = foodStatus.value === 'archived' ? 'archived' : 'active';
    const xs = /** @type {Food[]} */ (await Foods.list({ search: foodSearch.value, status }));
    foodsList.innerHTML = xs.map((/** @type {Food} */ f)=>`
      <div class="item" data-id="${f.id}">
        <div>
          <div><strong>${$.esc(f.name)}</strong> ${f.archived?'<span class="chip">Archived</span>':''}</div>
          <div class="meta">${$.esc(f.refLabel)} · ${$.nutrMeta(f.kcal, f.prot, f.carbs, f.fats)}</div>
        </div>
        <div class="actions">
          <button class="btn small ghost edit">✏️ Edit</button>
          <button class="btn small ghost ${f.archived?'unarchive':'archive'}">${f.archived?'📦 Unarchive':'📦 Archive'}</button>
          <button class="btn small ghost updateMeals" title="Update past meals to latest">⟳ Update meals</button>
        </div>
      </div>`).join('') || `<div class="muted">No foods yet.</div>`;
  }

  foodsList.addEventListener('click', async (/** @type {MouseEvent} */ e) => {
    const target = $.html($.assertEl(e.target));
    const row = $.html($.assertEl(target.closest('.item')));
    if (!row) {return;}

    const id = v.id(row.dataset.id);
    const f = await Foods.byId(id);
    if (target.classList.contains('edit')){
      setFoodForm(f);
      window.scrollTo({top:0, behavior:'smooth'});
      return;
    }
    if (target.classList.contains('archive')){
      await Foods.setArchived(id, true);
      renderFoods();
      return;
    }
    if (target.classList.contains('unarchive')){
      await Foods.setArchived(id, false);
      renderFoods();
      return;
    }
    if (target.classList.contains('updateMeals')){
      const n = await Meals.syncAllForFood(id);
      alert(`Updated ${n} meal(s) using this food.`);
      return;
    }
  });

  foodSearch.addEventListener('input', renderFoods);
  foodStatus.addEventListener('change', renderFoods);

  foodForm.addEventListener('submit', async (/** @type {SubmitEvent} */ e) => {
    e.preventDefault();
    // Validate on submit; avoid annoying while typing
    try {
      clearFieldErrors();
      const payload = v.createFoodInput({
        name: foodName.value,
        refLabel: foodRefLabel.value,
        kcal: foodKcal.value,
        prot: foodProt.value,
        carbs: foodCarb.value,
        fats: foodFat.value,
      });
      if (foodId.value) {
        await Foods.update(v.id(foodId.value), payload);
      } else { await Foods.create(payload); }
      setFoodForm(); renderFoods();
      const quickListEl = /** @type {HTMLElement|undefined} */ ($.sel('#quickList'));
      if (quickListEl) {quickListEl.dispatchEvent(new Event('refresh'));}
    } catch (err) {
      const e = /** @type {Error & {fields?: string[]}} */ (err);
      const msg = e?.message || 'Invalid input';
      foodFormMsg.textContent = msg;
      clearFieldErrors();
      applyValidationErrors(e);
    }
  });

  // Gentle live validation (non-blocking): only mark fields after short pause
  const liveCheck = $.debounce(()=>{
    foodFormMsg.textContent = '';
    clearFieldErrors();
    try {
      v.createFoodInput({
        name: foodName.value,
        refLabel: foodRefLabel.value,
        kcal: foodKcal.value,
        prot: foodProt.value,
        carbs: foodCarb.value,
        fats: foodFat.value,
      });
    } catch (err) {
      applyValidationErrors(err);
    }
  }, 400);
  [foodName, foodRefLabel, foodKcal, foodProt, foodCarb, foodFat].forEach(el => el.addEventListener('input', liveCheck));

  // Listen to cross-module navigation prefill
  window.addEventListener('go-foods', (/** @type {Event} */ e) => {
    const name = /** @type {CustomEvent} */(e).detail?.name || '';
    const foodNameEl = $.input($.id('foodName'));
    const foodFormEl = $.form($.id('foodForm'));
    $.showPage('foods');
    foodFormEl.reset();
    foodNameEl.value = name;
    foodNameEl.focus();
  });

  renderFoods();
}

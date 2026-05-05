import { Foods, Meals } from '../data.js';
import { decodeFoodCode, encodeFoodCode } from '../food-share-code.js';
import * as $ from '../utils.js';
import * as v from '../validation.js';
import { archiveIcon, editIcon, importCodeIcon, shareIcon } from '../icons.js';

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
  const saveFoodBtn = $.button($.id('saveFoodBtn'));
  const foodsList = $.html($.id('foodsList'));
  const foodSearch = $.input($.id('foodSearch'));
  const foodStatus = $.select($.id('foodStatus'));
  const foodFormMsg = $.html($.id('foodFormMsg'));
  const foodImportToggle = $.button($.id('foodImportToggle'));
  foodImportToggle.innerHTML = `${importCodeIcon} Code`;
  const foodImportArea = $.html($.id('foodImportArea'));
  const foodImportInput = $.input($.id('foodImportInput'));
  const foodImportApply = $.button($.id('foodImportApply'));
  const foodImportMsg = $.html($.id('foodImportMsg'));

  /** Map validation field names to corresponding input elements */
  const fieldToInput = new Map([
    ['name', foodName],
    ['refLabel', foodRefLabel],
    ['kcal', foodKcal],
    ['prot', foodProt],
    ['carbs', foodCarb],
    ['fats', foodFat],
  ]);

  /**
   * Remove error styling from all food form input fields.
   */
  function clearFieldErrors(){
    fieldToInput.forEach(el => { el.classList.remove('error'); });
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
    saveFoodBtn.disabled = true;
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
      foodFormTitle.textContent = 'Edit food';
      foodUpdated.textContent = `updated ${new Date(f.updatedAt).toLocaleString()}`;
      foodId.value = String(f.id);
      foodName.value=f.name;
      foodRefLabel.value=f.refLabel;
      foodKcal.value=String(f.kcal);
      foodProt.value=String(f.prot);
      foodCarb.value=String(f.carbs);
      foodFat.value=String(f.fats);
      foodFormMsg.textContent = '';
      clearFieldErrors();
      saveFoodBtn.disabled = false;
    }
  }

  /**
   * Render the foods list based on current search and status filters.
   */
  async function renderFoods(){
    const status = foodStatus.value === 'archived' ? 'archived'
      : foodStatus.value === 'all' ? 'all' : 'active';
    const xs = /** @type {Food[]} */ (await Foods.list({ search: foodSearch.value, status }));
    foodsList.innerHTML = xs.map((f)=>{
      const archivedChip = f.archived ? '<span class="chip">Archived</span>' : '';
      const archiveClass = f.archived ? 'unarchive' : 'archive';
      const archiveLabel = f.archived ? `${archiveIcon} Unarchive` : `${archiveIcon} Archive`;
      const meta = $.nutrMeta(f.kcal, f.prot, f.carbs, f.fats);
      return `
      <div class="item" data-id="${f.id}">
        <div><strong>${$.esc(f.name)}</strong> ${archivedChip}</div>
        <div class="actions">
          <button class="btn small ghost edit">${editIcon} Edit</button>
          <button class="btn small ghost share">${shareIcon} Share</button>
          <button class="btn small ghost ${archiveClass}">${archiveLabel}</button>
        </div>
        <div class="meta">${$.esc(f.refLabel)} · ${meta}</div>
      </div>`;
    }).join('') || `<div class="muted">No foods yet.</div>`;
  }

  foodsList.addEventListener('click', async (e) => {
    const target = $.html($.assertEl(e.target));
    const row = $.html($.assertEl(target.closest('.item')));

    const id = row.dataset.id;
    if (!id) { return; }
    const f = await Foods.byId(id);
    if (target.classList.contains('edit')){
      setFoodForm(f);
      window.scrollTo({top:0, behavior:'smooth'});
      return;
    }
    if (target.classList.contains('share')){
      if (!f) { return; }
      const code = encodeFoodCode(f);
      const url = `${location.origin}${location.pathname}?f=${code}`;
      if (navigator.share) {
        try {
          await navigator.share({ title: f.name, url });
        } catch (err) {
          if (/** @type {Error} */(err).name !== 'AbortError') { throw err; }
        }
      } else {
        await navigator.clipboard.writeText(url);
        $.toast('Link copied!');
      }
      return;
    }
    if (target.classList.contains('archive')){
      await Foods.setArchived(id, true);
      await renderFoods();
      const hasMeals = await Meals.hasForFood(id);
      if (!hasMeals && f) {
        $.toast(`No meal history for "${$.esc(f.name)}" — delete permanently?`, {
          duration: 8000,
          action: {
            label: 'Delete',
            callback: async () => {
              await Foods.remove(id);
              await renderFoods();
              $.toast(`"${$.esc(f.name)}" deleted`, {
                duration: 5000,
                action: {
                  label: 'Undo',
                  callback: async () => { await Foods.restore({ ...f, archived: true }); await renderFoods(); },
                },
              });
            },
          },
        });
      }
      return;
    }
    if (target.classList.contains('unarchive')){
      await Foods.setArchived(id, false);
      await renderFoods();
      return;
    }
  });

  foodSearch.addEventListener('input', renderFoods);
  foodStatus.addEventListener('change', renderFoods);

  /**
   * Read current form field values into a payload object.
   * @returns {{ name: string, refLabel: string,
   *   kcal: string, prot: string, carbs: string, fats: string }}
   */
  function readFormPayload() {
    return {
      name: foodName.value,
      refLabel: foodRefLabel.value,
      kcal: foodKcal.value,
      prot: foodProt.value,
      carbs: foodCarb.value,
      fats: foodFat.value,
    };
  }

  foodForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = $.button(foodForm.querySelector('[type=submit]'));
    // Validate on submit; avoid annoying while typing
    try {
      clearFieldErrors();
      const payload = v.createFoodInput(readFormPayload());
      const isNew = !foodId.value;
      const editId = isNew ? null : foodId.value;
      await $.withConfirm(submitBtn, async () => {
        if (editId) {
          await Foods.update(editId, payload);
        } else { await Foods.create(payload); }
        setFoodForm(); await renderFoods();
        const quickListEl = /** @type {HTMLElement|undefined} */ ($.sel('#quickList'));
        if (quickListEl) {quickListEl.dispatchEvent(new Event('refresh'));}
      }, '✓ Saved');
      if (isNew) {
        $.toast(`"${$.esc(payload.name)}" added — log a meal now?`, {
          duration: 6000,
          action: {
            label: 'Add meal',
            callback: () => window.dispatchEvent(
              new CustomEvent('go-meals', { detail: { name: payload.name } })
            ),
          },
        });
      } else if (editId) {
        const hasMeals = await Meals.hasForFood(editId);
        if (hasMeals) {
          $.toast(`Update past meals to "${$.esc(payload.name)}" latest macros?`, {
            duration: 8000,
            action: {
              label: 'Update meals',
              callback: async () => {
                const n = await Meals.syncAllForFood(editId);
                $.toast(`✓ ${n} meal${n === 1 ? '' : 's'} updated`);
              },
            },
          });
        }
      }
    } catch (err) {
      const e = /** @type {Error & {fields?: string[]}} */ (err);
      const msg = e?.message || 'Invalid input';
      foodFormMsg.textContent = msg;
      applyValidationErrors(e);
    }
  });

  // Gentle live validation (non-blocking): only mark fields after short pause
  const liveCheck = $.debounce(()=>{
    foodFormMsg.textContent = '';
    clearFieldErrors();
    try {
      v.createFoodInput(readFormPayload());
      saveFoodBtn.disabled = false;
    } catch (err) {
      applyValidationErrors(err);
      saveFoodBtn.disabled = true;
    }
  }, 400);
  [foodName, foodRefLabel, foodKcal, foodProt, foodCarb, foodFat]
    .forEach(el => { el.addEventListener('input', liveCheck); });

  // Listen to cross-module navigation prefill
  window.addEventListener('go-foods', async (e) => {
    const detail = /** @type {CustomEvent} */(e).detail;
    $.showPage('foods');
    if (detail?.id) {
      const f = await Foods.byId(detail.id);
      if (f) { setFoodForm(f); }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      foodForm.reset();
      foodName.value = detail?.name || '';
      foodName.focus();
    }
  });

  void renderFoods();

  /**
   * Pre-fill the add-food form from decoded share data. Switches to edit mode
   * if a food with the same name already exists in the DB.
   * @param {{ name: string, refLabel: string, kcal: string, prot: string, carbs: string, fats: string }} data
   */
  async function applyFoodData(data){
    $.showPage('foods');
    const matches = await Foods.list({ search: data.name, status: 'all' });
    const existing = matches.find(f => f.name.trim().toLowerCase() === data.name.trim().toLowerCase());
    if (existing) {
      setFoodForm(existing);
    } else {
      clearFoodForm();
      foodName.value = data.name;
      foodRefLabel.value = data.refLabel;
      foodKcal.value = data.kcal;
      foodProt.value = data.prot;
      foodCarb.value = data.carbs;
      foodFat.value = data.fats;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Import-code toggle UI
  foodImportToggle.addEventListener('click', () => {
    const opening = foodImportArea.classList.toggle('hidden');
    if (!opening) { foodImportInput.focus(); }
    foodImportMsg.textContent = '';
  });

  async function applyImportCode(){
    let code = foodImportInput.value.trim();
    if (!code) { return; }
    try {
      const urlParam = new URL(code).searchParams.get('f');
      if (urlParam) { code = urlParam; }
    } catch { /* not a URL, treat as raw code */ }
    const data = decodeFoodCode(code);
    if (!data) {
      foodImportMsg.textContent = 'Invalid code.';
      return;
    }
    foodImportMsg.textContent = '';
    foodImportArea.classList.add('hidden');
    foodImportInput.value = '';
    await applyFoodData(data);
  }

  foodImportApply.addEventListener('click', () => { void applyImportCode(); });
  foodImportInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { void applyImportCode(); }
  });

  /** Pre-fill the food form from a ?f= base64 URL param on app load. */
  async function handleFoodFromURL(){
    const param = new URLSearchParams(location.search).get('f');
    if (!param) { return; }
    history.replaceState(null, '', location.pathname);
    const data = decodeFoodCode(param);
    if (!data) {
      console.warn('Invalid food share param — could not decode');
      return;
    }
    await applyFoodData(data);
  }
  void handleFoodFromURL();
}

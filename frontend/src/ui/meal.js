import * as $ from '../utils.js';
import { Foods, Meals } from '../data.js';

/**
 * @typedef {import('../data.js').Food} Food
 * @typedef {import('../data.js').Meal} Meal
 */

/** Initialize meals page UI and handlers. */
export function setupMeals(){
  const mealDate = $.input($.id('mealDate'));
  const dayLabel = $.html($.id('dayLabel'));
  const mealsList = $.html($.id('mealsList'));
  const mealsInfo = $.html($.id('mealsInfo'));
  const quickSearch = $.input($.id('quickSearch'));
  const quickList = $.html($.id('quickList'));

  mealDate.value = $.isoToday();
  dayLabel.textContent = mealDate.value;
  mealDate.addEventListener('change', ()=>{ dayLabel.textContent = mealDate.value; renderMeals(); });

  async function renderQuickList(){
    const q = quickSearch.value.trim();
    const foods = await Foods.list({ search: q, status: 'active' });
    quickList.innerHTML = foods.slice(0, 40).map(f => `
      <div class="item" data-id="${f.id}">
        <div>
          <div><strong>${$.esc(f.name)}</strong></div>
          <div class="meta">${$.esc(f.refLabel)} · ${$.nutrMeta(f.kcal, f.prot, f.carbs, f.fats)}</div>
        </div>
        <div class="actions">
          <input type="number" inputmode="decimal" step="0.5" min="0" value="1" class="qty" title="Qty (×ref portion)" style="width:80px" />
          <button class="btn small add">＋ Add</button>
          <button class="btn small ghost add05">+0.5</button>
          <button class="btn small ghost add1">+1</button>
          <button class="btn small ghost editFood" title="Edit food">✏️</button>
        </div>
      </div>`).join('') || `<div class="muted">No foods yet. Type a name and <a href="#" id="quickNew">create it</a>.</div>`;
    const createLink = document.getElementById('quickNew');
    if (createLink) { $.html(createLink).addEventListener('click', (e) => { e.preventDefault(); goFoodsWithPrefill(q); }); }
  }

  quickSearch.addEventListener('input', renderQuickList);
  quickSearch.addEventListener('keydown', (/** @type {KeyboardEvent} */ e)=>{
    if (e.key==='Enter'){
      const first = quickList.querySelector('.item');
      const btn = first?.querySelector('.add');
      if (btn && btn instanceof HTMLElement){ btn.click(); e.preventDefault(); }
    }
  });
  quickList.addEventListener('refresh', renderQuickList);

  quickList.addEventListener('click', async (/** @type {MouseEvent} */ e) => {
    const target = /** @type {HTMLElement} */ (e.target);
  const item = target.closest('.item'); if (!item) return;
  const itemEl = /** @type {HTMLElement} */ (item);
  const id = Number(itemEl.dataset.id);
    const food = await Foods.byId(id); if (!food) return;
    const qtyEl = $.input(item.querySelector('.qty'));
    if (target.classList.contains('add') || target.classList.contains('add1')) {
      const qty = Number(qtyEl.value ?? 1);
      await Meals.create({ food, multiplier: qty, date: mealDate.value });
      qtyEl.value = '1';
      renderMeals();
      return;
    }
    if (target.classList.contains('add05')) { qtyEl.value = String(Number(qtyEl.value ?? 1) + 0.5); return; }
    if (target.classList.contains('editFood')) { goFoodsWithPrefill(food.name); return; }
  });

  async function renderMeals(){
    const xs = /** @type {Meal[]} */ (await Meals.listByDate(mealDate.value));
    const count = xs.length;
    const totals = xs.reduce((a, /** @type {Meal} */ m)=>{
      a.k+=m.foodSnapshot.kcal*m.multiplier;
      a.p+=m.foodSnapshot.prot*m.multiplier;
      a.c+=m.foodSnapshot.carbs*m.multiplier;
      a.f+=m.foodSnapshot.fats*m.multiplier;
      return a;
    }, {k:0,p:0,c:0,f:0});
    mealsInfo.textContent = count ? `${count} meal${count>1?'s':''} · ${$.fmtNum(totals.k,0)} kcal · P${$.fmtNum(totals.p)} C${$.fmtNum(totals.c)} F${$.fmtNum(totals.f)}` : 'No meals yet';
    mealsList.innerHTML = xs.map(m => `
      <div class="item" data-id="${m.id}">
        <div>
          <div><strong>${$.esc(m.foodSnapshot.name)}</strong> <span class="chip">×${$.fmtNum(m.multiplier)}</span></div>
          <div class="meta">${$.esc(m.foodSnapshot.refLabel)} · ${$.nutrMeta(m.foodSnapshot.kcal*m.multiplier, m.foodSnapshot.prot*m.multiplier, m.foodSnapshot.carbs*m.multiplier, m.foodSnapshot.fats*m.multiplier)}</div>
        </div>
        <div class="actions">
          <button class="btn small ghost qtyMinus" title="-0.5">−0.5</button>
          <button class="btn small ghost qtyPlus" title="+0.5">+0.5</button>
          <button class="btn small ghost sync" title="Update to latest food">⟳</button>
          <button class="btn small ghost del" title="Delete">🗑️</button>
        </div>
      </div>`).join('');
  }

  document.getElementById('mealsList')?.addEventListener('click', async (/** @type {MouseEvent} */ e) => {
    const target = /** @type {HTMLElement} */ (e.target);
  const row = target.closest('.item'); if (!row) return;
  const rowEl = /** @type {HTMLElement} */ (row);
  const id = Number(rowEl.dataset.id);
    const meal = (await Meals.listByDate(mealDate.value)).find(m => m.id === id);
    if (!meal) return;
    if (target.classList.contains('del')) { await Meals.remove(meal.id); renderMeals(); return; }
    if (target.classList.contains('qtyPlus')) { await Meals.update(meal.id, { multiplier: +(meal.multiplier + 0.5).toFixed(2) }); renderMeals(); return; }
    if (target.classList.contains('qtyMinus')) {
      const v = Math.max(0, meal.multiplier - 0.5);
      if (v === 0) { await Meals.remove(meal.id); }
      else { await Meals.update(meal.id, { multiplier: +v.toFixed(2) }); }
      renderMeals();
      return;
    }
    if (target.classList.contains('sync')) { await Meals.syncMealToFood(meal); renderMeals(); return; }
  });

  /** @param {string=} name */
  function goFoodsWithPrefill(name){
    // Delegate to Foods page; focus the name field if present
    const evt = new CustomEvent('go-foods', { detail: { name: name || '' } });
    window.dispatchEvent(evt);
  }

  renderQuickList();
  renderMeals();
}

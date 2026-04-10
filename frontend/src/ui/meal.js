import * as $ from '../utils.js';
import * as V from '../validation.js';
import { Foods, Meals } from '../data.js';

/**
 * @typedef {import('../data.js').Food} Food
 * @typedef {import('../data.js').Meal} Meal
 */

/** Initialize meals page UI and handlers. */
export function setupMeals(){
  const dayLabel = $.html($.id('dayLabel'));
  const daysHeader = $.html($.id('mealsSubHeader'));
  const prevDayBox = $.html($.id('prevDayBox'));
  const nextDayBox = $.html($.id('nextDayBox'));
  const mealsList = $.html($.id('mealsList'));
  const mealsInfo = $.html($.id('mealsInfo'));
  const quickSearch = $.input($.id('quickSearch'));
  const quickList = $.html($.id('quickList'));
  const dayTotals = $.html($.id('dayTotals'));
  const mealsPage = $.html($.id('page-meals'));
  const quickAddCard = $.html($.id('quickAddCard'));
  const mealsCard = $.html($.id('mealsCard'));
  // Use entire body as swipe surface so user can swipe even in gutter areas outside .app
  const swipeSurface = document.body;

  // Swipe detection thresholds (named constants to avoid magic numbers)
  const SWIPE_MIN_X = 50; // Minimum horizontal delta
  const SWIPE_MAX_Y = 40; // Maximum vertical delta to still count as horizontal swipe
  const SWIPE_ANIM_MS = 260; // Duration of the date change animation

  let curDate = $.isoToday();
  /** @type {Meal[]} */
  let currentMeals = [];

  /**
   * Format ISO date (YYYY-MM-DD) to human-friendly short form (e.g., "Oct 30").
   * @param {string} iso - ISO date string
   * @returns {string}
   */
  function fmtHuman(iso){
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month:'short', day:'numeric' });
  }

  /**
   * Update the date header with current, previous, and next day labels.
   */
  function updateHeader(){
    dayLabel.dataset.iso = curDate;
    dayLabel.textContent = fmtHuman(curDate);
    const d = new Date(curDate + 'T00:00:00');
    const prev = new Date(d); prev.setDate(d.getDate()-1);
    const next = new Date(d); next.setDate(d.getDate()+1);
    const prevISO = $.toISO(prev);
    const nextISO = $.toISO(next);
    prevDayBox.textContent = fmtHuman(prevISO);
    nextDayBox.textContent = fmtHuman(nextISO);
  }
  updateHeader();

  /**
   * Shift current date by delta days and update UI with animation.
   * @param {number} delta - Number of days to shift (positive or negative)
   */
  function shiftDate(delta){
    const d = new Date(curDate + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    curDate = $.toISO(d);
    updateHeader();
    renderMeals();
    // Animate date change (direction aware)
    const cls = delta > 0 ? 'dateSlideLeft' : 'dateSlideRight';
    const animEls = [daysHeader, dayTotals, quickAddCard, mealsCard];
    animEls.forEach(el => el && el.classList.add(cls));
    setTimeout(()=> animEls.forEach(el => el && el.classList.remove(cls)), SWIPE_ANIM_MS);
  }
  prevDayBox.addEventListener('click', ()=> shiftDate(-1));
  nextDayBox.addEventListener('click', ()=> shiftDate(1));
  prevDayBox.addEventListener('keydown', (e)=>{
    if (e.key==='Enter' || e.key===' ') {
      e.preventDefault(); shiftDate(-1);
    }
  });
  nextDayBox.addEventListener('keydown', (e)=>{
    if (e.key==='Enter' || e.key===' ') {
      e.preventDefault(); shiftDate(1);
    }
  });

  // Swipe handler across entire app area; only triggers when meals page is active
  // and swipe starts below date bar.
  let touchStartX = 0;
  let touchStartY = 0;
  let touchActive = false;
  let startTargetBelowBar = false;

  /**
   * Check if touch movement qualifies as a valid horizontal swipe.
   * @param {number} dx - Horizontal delta
   * @param {number} dy - Vertical delta
   * @returns {boolean}
   */
  function isValidSwipe(dx, dy){
    return Math.abs(dx) >= SWIPE_MIN_X && Math.abs(dy) <= SWIPE_MAX_Y;
  }

  function onTouchStart(/** @type {TouchEvent} */ e){
    if (e.touches.length!==1) {return;}
    // Ignore if meals page hidden
    if (mealsPage.classList.contains('hidden')) {return;}
    touchActive = true;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    const subRect = daysHeader.getBoundingClientRect();
    const y = e.touches[0].clientY;
    startTargetBelowBar = y > subRect.bottom;
  }
  function onTouchEnd(/** @type {TouchEvent} */ e){
    if (!touchActive) { return; }
    touchActive=false;
    if (!startTargetBelowBar) {return;} // must start below the date bar
    const dx = (e.changedTouches[0].clientX - touchStartX);
    const dy = (e.changedTouches[0].clientY - touchStartY);
    if (!isValidSwipe(dx, dy)) {return;}
    if (dx < 0) { shiftDate(1); }
    else { shiftDate(-1); }
  }
  swipeSurface.addEventListener('touchstart', onTouchStart, { passive:true });
  swipeSurface.addEventListener('touchend', onTouchEnd);

  /**
   * Render the quick-add food search results (limited to 3 foods).
   */
  async function renderQuickList(){
    const q = quickSearch.value.trim();
    const foods = await Foods.list({ search: q, status: 'active' });
    // Limit to 3 foods
    quickList.innerHTML = foods.slice(0, 3).map(f => {
      const meta = $.nutrMeta(f.kcal, f.prot, f.carbs, f.fats);
      return `
      <div class="item" data-id="${f.id}">
        <div><strong>${$.esc(f.name)}</strong></div>
        <div class="actions">
          <input type="number" inputmode="decimal" step="0.5" min="0"
            value="1" class="qty" title="Qty (×ref portion)" style="width:80px" />
          <button class="btn small add">＋ Add</button>
          <button class="btn small ghost add05" title="+0.5">+0.5</button>
          <button class="btn small ghost add1" title="+1">+1</button>
          <button class="btn small ghost editFood" title="Edit food">✏️</button>
        </div>
        <div class="meta">${$.esc(f.refLabel)} · ${meta}</div>
      </div>`;
    }).join('') || '<div class="muted">No foods yet. '
      + 'Type a name and <a href="#" id="quickNew">create it</a>.</div>';
    const createLink = document.getElementById('quickNew');
    if (createLink) {
      $.html(createLink).addEventListener('click', (e) => {
        e.preventDefault(); goFoodsWithPrefill(q);
      });
    }
  }

  quickSearch.addEventListener('input', $.debounce(renderQuickList, 200));
  quickSearch.addEventListener('keydown', (e)=>{
    if (e.key==='Enter'){
      const first = quickList.querySelector('.item');
      const btn = first?.querySelector('.add');
      if (btn && btn instanceof HTMLElement) {
        btn.click(); e.preventDefault();
      }
    }
  });
  quickList.addEventListener('refresh', renderQuickList);
  window.addEventListener('meals-activate', renderQuickList);

  quickList.addEventListener('click', async (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
  const item = target.closest('.item');
  if (!item) { return; }
    const itemEl = /** @type {HTMLElement} */ (item);
    const id = V.id(itemEl.dataset.id);
    const food = await Foods.byId(id); if (!food) {
      itemEl.classList.add('shake');
      setTimeout(()=> itemEl.classList.remove('shake'), 500);
      return;
    }
  const qtyEl = $.input(item.querySelector('.qty'));
    if (target.classList.contains('add')) {
      let qty;
      try {
        qty = V.number(qtyEl.value || '0', { min: 0, max: 100 });
        if (qty <= 0) { throw new Error(); }
      } catch {
        qtyEl.classList.add('error'); setTimeout(()=>qtyEl.classList.remove('error'), 700);
        return;
      }
      await $.withConfirm($.button(target), async () => {
        await Meals.create(V.mealCreate({ food, multiplier: qty, date: curDate }));
        qtyEl.value = '1';
        quickSearch.value = '';
        renderQuickList();
        renderMeals();
      }, '✓ Added');
      return;
    }
    if (target.classList.contains('add1')) {
      qtyEl.value = String(V.number((Number(qtyEl.value || '0') + 1))); return;
    }
    if (target.classList.contains('add05')) {
      qtyEl.value = String(V.number((Number(qtyEl.value || '0') + 0.5))); return;
    }
    if (target.classList.contains('editFood')) {
      goFoodsWithPrefill(food.name); return;
    }
  });

  /**
   * Compute aggregate nutrition totals from an array of meals.
   * @param {Meal[]} meals
   * @returns {import('../data.js').Macros}
   */
  function computeTotals(meals){
    return meals.reduce((a, m)=>{
      a.kcal+=m.foodSnapshot.kcal*m.multiplier;
      a.prot+=m.foodSnapshot.prot*m.multiplier;
      a.carbs+=m.foodSnapshot.carbs*m.multiplier;
      a.fats+=m.foodSnapshot.fats*m.multiplier;
      return a;
    }, {kcal:0,prot:0,carbs:0,fats:0});
  }

  /**
   * Render day header info and macros totals display.
   * @param {Meal[]} meals
   * @param {import('../data.js').Macros} totals
   */
  function renderDayInfo(meals, totals){
    const count = meals.length;
    const nutrStr = $.nutrMeta(totals.kcal, totals.prot, totals.carbs, totals.fats);
    mealsInfo.textContent = count
      ? `${count} meal${count>1?'s':''} · ${nutrStr}`
      : 'No meals yet';
    dayTotals.innerHTML = `
      <div class="totalsWrap">
        <div class="totalBlock">
          <div class="label">Calories</div>
          <div class="value">${$.fmtNum(totals.kcal,0)}<span class="unit">kcal</span></div>
        </div>
        <div class="totalBlock">
          <div class="label">Protein</div>
          <div class="value">${$.fmtNum(totals.prot,0)}<span class="unit">g</span></div>
        </div>
        <div class="totalBlock">
          <div class="label">Carbs</div>
          <div class="value">${$.fmtNum(totals.carbs,0)}<span class="unit">g</span></div>
        </div>
        <div class="totalBlock">
          <div class="label">Fat</div>
          <div class="value">${$.fmtNum(totals.fats,0)}<span class="unit">g</span></div>
        </div>
      </div>`;
  }

  /**
   * Update a single meal row's multiplier chip and macro meta in place.
   * Avoids a full list re-render when only the quantity changes.
   * @param {HTMLElement} rowEl
   * @param {Meal} meal
   */
  function patchMealRow(rowEl, meal) {
    const snap = meal.foodSnapshot;
    const mul = meal.multiplier;
    const mealMeta = $.nutrMeta(snap.kcal*mul, snap.prot*mul, snap.carbs*mul, snap.fats*mul);
    const chip = rowEl.querySelector('.chip');
    const meta = rowEl.querySelector('.meta');
    if (chip) { $.html(chip).textContent = `×${$.fmtNum(mul)}`; }
    if (meta) { $.html(meta).textContent = `${snap.refLabel} · ${mealMeta}`; }
  }

  /**
   * Render the list of meals with action buttons.
   * @param {Meal[]} meals
   */
  function renderMealsList(meals){
    mealsList.innerHTML = meals.map(/** @param {Meal} m */ m => {
      const snap = m.foodSnapshot;
      const mul = m.multiplier;
      const mealMeta = $.nutrMeta(snap.kcal*mul, snap.prot*mul, snap.carbs*mul, snap.fats*mul);
      return `
      <div class="item" data-id="${m.id}">
        <div><strong>${$.esc(snap.name)}</strong>
          <span class="chip">×${$.fmtNum(mul)}</span></div>
        <div class="actions">
          <button class="btn small ghost qtyMinus" title="-0.5">−0.5</button>
          <button class="btn small ghost qtyPlus" title="+0.5">+0.5</button>
          <button class="btn small ghost sync" title="Update to latest food">⟳</button>
          <button class="btn small ghost del" title="Delete">🗑️</button>
        </div>
        <div class="meta">${$.esc(snap.refLabel)} · ${mealMeta}</div>
      </div>`;
    }).join('');
  }

  /**
   * Fetch meals for current date, compute totals, and render UI.
   */
  async function renderMeals(){
    currentMeals = /** @type {Meal[]} */ (await Meals.listByDate(curDate));
    const totals = computeTotals(currentMeals);
    renderDayInfo(currentMeals, totals);
    renderMealsList(currentMeals);
  }

  mealsList.addEventListener('click', async (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const row = target.closest('.item');
    if (!row) { return; }
    const rowEl = /** @type {HTMLElement} */ (row);
    const id = V.id(rowEl.dataset.id);
    const meal = currentMeals.find(m => m.id === id);
    if (!meal) { return; }
    if (target.classList.contains('del')) {
      await Meals.remove(meal.id); renderMeals();
      return;
    }
    if (target.classList.contains('qtyPlus')) {
      const newMul = V.number(meal.multiplier + 0.5);
      await Meals.update(meal.id, { multiplier: newMul });
      meal.multiplier = newMul;
      patchMealRow(rowEl, meal);
      renderDayInfo(currentMeals, computeTotals(currentMeals));
      return;
    }
    if (target.classList.contains('qtyMinus')) {
      const btn = $.button(target);
      if (meal.multiplier - 0.5 <= 0) {
        btn.classList.add('error');
        setTimeout(() => btn.classList.remove('error'), 700);
        return;
      }
      const newMul = V.number(meal.multiplier - 0.5);
      await Meals.update(meal.id, { multiplier: newMul });
      meal.multiplier = newMul;
      patchMealRow(rowEl, meal);
      renderDayInfo(currentMeals, computeTotals(currentMeals));
      return;
    }
    if (target.classList.contains('sync')) {
      await Meals.syncMealToFood(meal);
      renderMeals();
      return;
    }
  });

  /** @param {string=} name */
  function goFoodsWithPrefill(name){
    // Delegate to Foods page; focus the name field if present
    const evt = new CustomEvent('go-foods', { detail: { name: name || '' } });
    window.dispatchEvent(evt);
  }

  // Listen to cross-module navigation prefill
  window.addEventListener('go-meals', (e) => {
    const name = /** @type {CustomEvent} */(e).detail?.name || '';
    $.showPage('meals');
    quickSearch.value = name;
    renderQuickList();
    quickSearch.focus();
  });

  renderQuickList();
  renderMeals();
}

import * as $ from '../utils.js';
import * as V from '../validation.js';
import { Foods, Meals } from '../data.js';

/**
 * @typedef {import('../data.js').Food} Food
 * @typedef {import('../data.js').Meal} Meal
 * @typedef {import('../data.js').Macros} Macros
 * @typedef {{ consumed: number, target: number|null, remaining: number|null, status: 'none'|'ok'|'warn'|'bad' }} MacroVM
 */

/** Initialize meals page UI and handlers. */
export function setupMeals(){
  const dayLabel = $.html($.id('dayLabel'));
  const daysHeader = $.html($.id('mealsSubHeader'));
  const prevDayBox = $.html($.id('prevDayBox'));
  const nextDayBox = $.html($.id('nextDayBox'));
  const mealsList = $.html($.id('mealsList'));
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

  const mealsUiState = {
    mode: /** @type {'overview'|'entry'} */ ('overview'),
    quickSearchFocused: false,
    /** Set to true when goals feature is implemented */
    goalsEnabled: false,
  };

  /** @param {'overview'|'entry'} mode */
  function setMealsMode(mode){
    mealsPage.classList.toggle('mode-overview', mode === 'overview');
    mealsPage.classList.toggle('mode-entry', mode === 'entry');
    mealsUiState.mode = mode;
  }

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
  const SWIPE_DAMPING = 0.35;       // Fraction of drag distance applied as translate
  const SWIPE_MAX_TRANSLATE = 55;   // Max px of translate during drag
  const SWIPE_SNAP_MS = 200;        // Snap-back transition duration (ms)

  let touchStartX = 0;
  let touchStartY = 0;
  let touchActive = false;
  let startTargetBelowBar = false;
  // Elements that follow the user's drag (same set that gets the slide animation)
  const dragEls = [daysHeader, dayTotals, quickAddCard, mealsCard];

  /**
   * Check if touch movement qualifies as a valid horizontal swipe.
   * @param {number} dx - Horizontal delta
   * @param {number} dy - Vertical delta
   * @returns {boolean}
   */
  function isValidSwipe(dx, dy){
    return Math.abs(dx) >= SWIPE_MIN_X && Math.abs(dy) <= SWIPE_MAX_Y;
  }

  /** Apply translateX to all drag elements (no transition). */
  /** @param {number} x */
  function setDragTranslate(x){
    const val = x === 0 ? '' : `translateX(${x}px)`;
    dragEls.forEach(el => el && (el.style.transform = val));
  }

  /** Animate drag elements back to rest position. */
  function snapBack(){
    dragEls.forEach(el => {
      if (!el) { return; }
      el.style.transition = `transform ${SWIPE_SNAP_MS}ms ease-out`;
      el.style.transform = '';
      el.addEventListener('transitionend', () => { el.style.transition = ''; }, { once: true });
    });
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
  function onTouchMove(/** @type {TouchEvent} */ e){
    if (!touchActive || !startTargetBelowBar || e.touches.length !== 1) {return;}
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if (Math.abs(dy) > SWIPE_MAX_Y) {return;} // likely a scroll, don't translate
    const clamped = Math.max(-SWIPE_MAX_TRANSLATE, Math.min(SWIPE_MAX_TRANSLATE, dx * SWIPE_DAMPING));
    setDragTranslate(clamped);
  }
  function onTouchEnd(/** @type {TouchEvent} */ e){
    if (!touchActive) { return; }
    touchActive=false;
    if (!startTargetBelowBar) {
      snapBack(); return;
    }
    const dx = (e.changedTouches[0].clientX - touchStartX);
    const dy = (e.changedTouches[0].clientY - touchStartY);
    if (!isValidSwipe(dx, dy)) {
      snapBack(); return;
    }
    // Valid swipe — clear drag transform immediately so the slide animation is clean
    setDragTranslate(0);
    if (dx < 0) { shiftDate(1); }
    else { shiftDate(-1); }
  }
  function onTouchCancel(){
    if (!touchActive) {return;}
    touchActive = false;
    snapBack();
  }
  swipeSurface.addEventListener('touchstart', onTouchStart, { passive:true });
  swipeSurface.addEventListener('touchmove', onTouchMove, { passive:true });
  swipeSurface.addEventListener('touchend', onTouchEnd);
  swipeSurface.addEventListener('touchcancel', onTouchCancel);

  const FRECENCY_DAYS = 90;

  /**
   * Render the quick-add food search results (limited to 3 foods).
   */
  async function renderQuickList(){
    const q = quickSearch.value.trim();
    const todayISO = $.isoToday();
    const sinceDate = new Date(todayISO + 'T00:00:00');
    sinceDate.setDate(sinceDate.getDate() - FRECENCY_DAYS);
    const sinceISO = $.toISO(sinceDate);
    const scores = await Meals.frecencyScores(sinceISO, todayISO);
    const foods = await Foods.list({ search: q, status: 'active', scores });
    // Limit to 3 foods
    quickList.innerHTML = foods.slice(0, 3).map(f => {
      const meta = $.nutrMeta(f.kcal, f.prot, f.carbs, f.fats);
      return `
      <div class="item" data-id="${f.id}">
        <div><button class="btn ghost food-link">${$.esc(f.name)}</button></div>
        <div class="actions">
          <input type="number" inputmode="decimal" step="0.5" min="0"
            value="1" class="qty" title="Qty (×ref portion)" style="width:80px" />
          <button class="btn small add">＋ Add</button>
          <button class="btn small ghost add05" title="+0.5">+0.5</button>
          <button class="btn small ghost add1" title="+1">+1</button>
        </div>
        <div class="meta">${$.esc(f.refLabel)} · ${meta}</div>
      </div>`;
    }).join('') || '<div class="muted">No Foods match the filter. '
      + 'Type a name and <a href="#" id="quickNew">create it</a>.</div>';
    const createLink = document.getElementById('quickNew');
    if (createLink) {
      $.html(createLink).addEventListener('click', (e) => {
        e.preventDefault(); goFoodsWithPrefill(q);
      });
    }
  }

  quickSearch.addEventListener('focus', () => {
    mealsUiState.quickSearchFocused = true;
    document.body.classList.add('header-hidden');
    setMealsMode('entry');
    // Scroll so the totals summary sits at the top of the viewport (below sticky header)
    // const headerHeight = document.querySelector('header')?.getBoundingClientRect().height ?? 0;
    const targetY = dayTotals.getBoundingClientRect().top + window.scrollY - 8;
    if (window.scrollY < targetY) {
      window.scrollTo({ top: targetY, behavior: 'smooth' });
    }
  });
  quickSearch.addEventListener('blur', () => {
    mealsUiState.quickSearchFocused = false;
    window.setTimeout(() => {
      if (!mealsUiState.quickSearchFocused) { setMealsMode('overview'); }
    }, 120);
  });

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
        renderMeals(true);
        renderQuickList();
        quickSearch.focus();
      }, '✓ Added');
      return;
    }
    if (target.classList.contains('add1')) {
      qtyEl.value = String(V.number((Number(qtyEl.value || '0') + 1)));
      quickSearch.focus(); return;
    }
    if (target.classList.contains('add05')) {
      qtyEl.value = String(V.number((Number(qtyEl.value || '0') + 0.5)));
      quickSearch.focus(); return;
    }
    if (target.classList.contains('food-link')) {
      window.dispatchEvent(new CustomEvent('go-foods', { detail: { id: food.id } })); return;
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
   * Build a normalized totals view model.
   * Targets/remaining/status are stubbed until goals feature exists.
   * @param {Macros} totals
   * @returns {{ calories: MacroVM, protein: MacroVM, carbs: MacroVM, fat: MacroVM }}
   */
  function buildTotalsViewModel(totals){
    /** @param {number} consumed @returns {MacroVM} */
    const stub = (consumed) => ({ consumed, target: null, remaining: null, status: 'none' });
    return {
      calories: stub(totals.kcal),
      protein:  stub(totals.prot),
      carbs:    stub(totals.carbs),
      fat:      stub(totals.fats),
    };
  }

  /**
   * Render macros totals display — expanded (overview) + compact (entry) variants.
   * @param {import('../data.js').Macros} totals
   */
  function renderDayInfo(totals){
    const vm = buildTotalsViewModel(totals);
    dayTotals.innerHTML = `
      <div class="day-summary day-summary-expanded">
        <div class="summary-hero">
          <div class="summary-hero-label">Calories</div>
          <div class="summary-hero-value">
            <span class="num">${$.fmtNum(vm.calories.consumed, 0)}</span>
            <span class="unit">kcal</span>
          </div>
        </div>
        <div class="summary-macros">
          <div class="macro-card macro-protein">
            <div class="macro-label">Protein</div>
            <div class="macro-value">${$.fmtNum(vm.protein.consumed, 0)}<span class="unit">g</span></div>
          </div>
          <div class="macro-card macro-carbs">
            <div class="macro-label">Carbs</div>
            <div class="macro-value">${$.fmtNum(vm.carbs.consumed, 0)}<span class="unit">g</span></div>
          </div>
          <div class="macro-card macro-fat">
            <div class="macro-label">Fat</div>
            <div class="macro-value">${$.fmtNum(vm.fat.consumed, 0)}<span class="unit">g</span></div>
          </div>
        </div>
      </div>
      <div class="day-summary day-summary-compact">
        <div class="compact-primary">${$.fmtNum(vm.calories.consumed, 0)} kcal</div>
        <div class="compact-secondary">P ${$.fmtNum(vm.protein.consumed, 0)}g · C ${$.fmtNum(vm.carbs.consumed, 0)}g · F ${$.fmtNum(vm.fat.consumed, 0)}g</div>
      </div>`;
  }

  /**
   * Render the list of meals with action buttons.
   * @param {Meal[]} meals
   */
  /**
   * @param {Meal[]} meals
   * @param {boolean} [animateFirst]
   */
  function renderMealsList(meals, animateFirst = false){
    mealsList.innerHTML = [...meals].reverse().map(/** @param {Meal} m */ m => {
      const snap = m.foodSnapshot;
      const mul = m.multiplier;
      const mealMeta = $.nutrMeta(snap.kcal*mul, snap.prot*mul, snap.carbs*mul, snap.fats*mul);
      return `
      <div class="meal-row" data-id="${m.id}">
        <div class="meal-row-body">
          <span class="meal-name">${$.esc(snap.name)}</span>
          <span class="chip">×${$.fmtNum(mul)}</span>
          <span class="meal-row-meta">${$.esc(snap.refLabel)} · ${mealMeta}</span>
        </div>
        <button class="btn small ghost del" title="Delete">🗑️</button>
      </div>`;
    }).join('');
    if (animateFirst) {
      const first = /** @type {HTMLElement|null} */ (mealsList.querySelector('.meal-row'));
      if (first) {
        first.classList.add('meal-row-added');
        first.addEventListener('animationend', () => first.classList.remove('meal-row-added'), { once: true });
      }
    }
  }

  /**
   * Fetch meals for current date, compute totals, and render UI.
   * @param {boolean} [animateFirst]
   */
  async function renderMeals(animateFirst = false){
    currentMeals = /** @type {Meal[]} */ (await Meals.listByDate(curDate));
    const totals = computeTotals(currentMeals);
    renderDayInfo(totals);
    renderMealsList(currentMeals, animateFirst);
  }

  mealsList.addEventListener('click', async (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const row = target.closest('.meal-row');
    if (!row) { return; }
    const rowEl = /** @type {HTMLElement} */ (row);
    const id = V.id(rowEl.dataset.id);
    const meal = currentMeals.find(m => m.id === id);
    if (!meal) { return; }
    if (target.classList.contains('del')) {
      await Meals.remove(meal.id);
      renderMeals();
      $.toast(`"${$.esc(meal.foodSnapshot.name)}" removed`, {
        duration: 5000,
        action: {
          label: 'Undo',
          callback: () => Meals.restore(meal).then(() => renderMeals()),
        },
      });
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

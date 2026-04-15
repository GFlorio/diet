import * as $ from '../utils.js';
import * as V from '../validation.js';
import { Foods, Meals } from '../data.js';
import * as Goals from '../data-goals.js';

/**
 * @typedef {import('../data.js').Food} Food
 * @typedef {import('../data.js').Meal} Meal
 * @typedef {import('../data.js').Macros} Macros
 * @typedef {import('../data-goals.js').Goals} GoalsType
 * @typedef {import('../data-goals.js').WindowVM} WindowVM
 * @typedef {{ consumed: number, target: number|null, remaining: number|null, status: 'none'|'ok'|'warn'|'bad' }} MacroVM
 */

/** Initialize meals page UI and handlers. */
export function setupMeals(){
  const dayLabel    = $.html($.id('dayLabel'));
  const daysHeader  = $.html($.id('mealsSubHeader'));
  const prevDayBox  = $.html($.id('prevDayBox'));
  const nextDayBox  = $.html($.id('nextDayBox'));
  const mealsList   = $.html($.id('mealsList'));
  const quickSearch = $.input($.id('quickSearch'));
  const quickList   = $.html($.id('quickList'));
  const dayTotals   = $.html($.id('dayTotals'));
  const mealsPage   = $.html($.id('page-meals'));
  const quickAddCard = $.html($.id('quickAddCard'));
  const mealsCard   = $.html($.id('mealsCard'));
  const SWIPE_ANIM_MS = 260;

  const mealsUiState = {
    mode: /** @type {'overview'|'entry'|'spacious'} */ ('overview'),
    quickSearchFocused: false,
    /** Set to true when goals are loaded */
    goalsEnabled: false,
  };

  /** @param {'overview'|'entry'|'spacious'} mode */
  function setMealsMode(mode){
    mealsPage.classList.toggle('mode-overview', mode === 'overview');
    mealsPage.classList.toggle('mode-entry',    mode === 'entry');
    mealsPage.classList.toggle('mode-spacious', mode === 'spacious');
    mealsUiState.mode = mode;
  }

  let curDate = $.isoToday();
  /** @type {Meal[]} */
  let currentMeals = [];
  /** @type {GoalsType | null} */
  let currentGoals = null;
  /** @type {WindowVM | null} */
  let currentWindowVM = null;

  /**
   * Format ISO date (YYYY-MM-DD) to human-friendly short form (e.g., "Oct 30").
   * @param {string} iso
   * @returns {string}
   */
  function fmtHuman(iso){
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month:'short', day:'numeric' });
  }

  function updateHeader(){
    dayLabel.dataset.iso  = curDate;
    dayLabel.textContent  = fmtHuman(curDate);
    const d    = new Date(curDate + 'T00:00:00');
    const prev = new Date(d); prev.setDate(d.getDate()-1);
    const next = new Date(d); next.setDate(d.getDate()+1);
    prevDayBox.textContent = fmtHuman($.toISO(prev));
    nextDayBox.textContent = fmtHuman($.toISO(next));
  }
  updateHeader();

  /**
   * @param {number} delta
   */
  /** @param {'dateSlideLeft'|'dateSlideRight'} cls */
  function animateDateChange(cls){
    const animEls = [daysHeader, dayTotals, quickAddCard, mealsCard];
    animEls.forEach(el => el && el.classList.add(cls));
    setTimeout(()=> animEls.forEach(el => el && el.classList.remove(cls)), SWIPE_ANIM_MS);
  }

  function shiftDate(delta){
    const d = new Date(curDate + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    curDate = $.toISO(d);
    updateHeader();
    renderMeals();
    updateTodayBtn();
    animateDateChange(delta > 0 ? 'dateSlideLeft' : 'dateSlideRight');
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

  // Floating "Today" button — appears when viewing a past/future date
  const todayFab = document.createElement('button');
  todayFab.className = 'btn primary today-fab';
  todayFab.setAttribute('aria-label', 'Go to today');
  todayFab.textContent = 'Today';
  mealsPage.appendChild(todayFab);

  function updateTodayBtn(){
    const onMeals = !mealsPage.classList.contains('hidden');
    const isToday = curDate === $.isoToday();
    todayFab.classList.toggle('today-fab--visible', onMeals && !isToday);
  }

  todayFab.addEventListener('click', () => {
    const today = $.isoToday();
    const cls = curDate < today ? 'dateSlideLeft' : 'dateSlideRight';
    curDate = today;
    updateHeader();
    renderMeals();
    updateTodayBtn();
    animateDateChange(cls);
  });

  new MutationObserver(updateTodayBtn).observe(mealsPage, { attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { updateTodayBtn(); }
  });

  const FRECENCY_DAYS = 90;

  /**
   * Render the quick-add food search results (limited to 3 foods).
   */
  async function renderQuickList(){
    const q        = quickSearch.value.trim();
    const todayISO = $.isoToday();
    const sinceDate = new Date(todayISO + 'T00:00:00');
    sinceDate.setDate(sinceDate.getDate() - FRECENCY_DAYS);
    const sinceISO = $.toISO(sinceDate);
    const scores   = await Meals.frecencyScores(sinceISO, todayISO);
    const foods    = await Foods.list({ search: q, status: 'active', scores });
    const totals   = computeTotals(currentMeals);

    quickList.innerHTML = foods.slice(0, 3).map(f => {
      // Impact preview — 1x serving
      const deltaKcal  = f.kcal;
      const deltaLine  = `+${$.fmtNum(deltaKcal, 0)} kcal · P ${$.fmtNum(f.prot, 0)}g · C ${$.fmtNum(f.carbs, 0)}g · F ${$.fmtNum(f.fats, 0)}g`;

      let afterHtml = '';
      if (currentGoals) {
        const afterKcal  = totals.kcal + deltaKcal;
        const status     = Goals.computeStatus(afterKcal, currentGoals.kcal);
        const diff       = afterKcal - currentGoals.kcal;
        const afterLabel = diff <= 0
          ? `After: ${$.fmtNum(afterKcal, 0)} kcal (${$.fmtNum(-diff, 0)} left)`
          : `After: ${$.fmtNum(afterKcal, 0)} kcal (${$.fmtNum(diff, 0)} over)`;
        afterHtml = `<div class="food-result-after ${status}">${afterLabel}</div>`;
      }

      return `
      <div class="item" data-id="${f.id}">
        <div>
          <button class="btn ghost food-link" tabindex="-1">${$.esc(f.name)}</button>
          <div class="food-result-delta">${deltaLine}</div>
          ${afterHtml}
        </div>
        <div class="actions">
          <input type="number" inputmode="decimal" step="0.5" min="0"
            value="1" class="qty" title="Qty (×ref portion)" style="width:80px" />
          <button class="btn small add" tabindex="-1">＋ Add</button>
          <button class="btn small ghost add05" tabindex="-1" title="+0.5">+0.5</button>
          <button class="btn small ghost add1"  tabindex="-1" title="+1">+1</button>
        </div>
        <div class="meta">${$.esc(f.refLabel)}</div>
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
    const touchDevice    = window.matchMedia('(pointer: coarse)').matches;
    const quickAddBottom = quickAddCard.getBoundingClientRect().bottom;
    if (!touchDevice && quickAddBottom <= window.innerHeight) {
      setMealsMode('spacious');
    } else {
      document.body.classList.add('header-hidden');
      setMealsMode('entry');
      const targetY = daysHeader.getBoundingClientRect().bottom + window.scrollY;
      if (window.scrollY < targetY) {
        window.scrollTo({ top: targetY, behavior: 'smooth' });
      }
    }
  });
  quickSearch.addEventListener('blur', () => {
    mealsUiState.quickSearchFocused = false;
    window.setTimeout(() => {
      if (!mealsUiState.quickSearchFocused && !quickAddCard.contains(document.activeElement)) {
        setMealsMode('overview');
        document.body.classList.remove('header-hidden');
      }
    }, 120);
  });

  quickSearch.addEventListener('input', $.debounce(renderQuickList, 200));
  quickSearch.addEventListener('keydown', (e)=>{
    if (e.key==='Enter'){
      const first = quickList.querySelector('.item');
      const btn   = first?.querySelector('.add');
      if (btn && btn instanceof HTMLElement) {
        btn.click(); e.preventDefault();
      }
    }
    if (e.key==='Escape'){
      quickSearch.blur(); e.preventDefault();
    }
    if (e.key==='Tab' && !e.shiftKey){
      const firstQty = /** @type {HTMLInputElement|null} */ (quickList.querySelector('.qty'));
      if (firstQty) {
        firstQty.focus();
        firstQty.select(); e.preventDefault();
      }
    }
  });

  quickList.addEventListener('keydown', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (!target.classList.contains('qty')) { return; }
    if (e.key === 'Enter') {
      const addBtn = /** @type {HTMLElement|null} */ (target.closest('.item')?.querySelector('.add'));
      if (addBtn) {
        addBtn.click(); e.preventDefault();
      }
    }
    if (e.key === 'Tab') {
      const qtys = /** @type {NodeListOf<HTMLInputElement>} */ (quickList.querySelectorAll('.qty'));
      const idx  = Array.prototype.indexOf.call(qtys, target);
      if (!e.shiftKey && idx < qtys.length - 1) {
        qtys[idx + 1].focus();
        qtys[idx + 1].select(); e.preventDefault();
      } else if (!e.shiftKey && idx === qtys.length - 1) {
        setMealsMode('overview');
        document.body.classList.remove('header-hidden');
      } else if (e.shiftKey && idx > 0) {
        qtys[idx - 1].focus();
        qtys[idx - 1].select(); e.preventDefault();
      } else if (e.shiftKey && idx === 0) {
        quickSearch.focus(); e.preventDefault();
      }
    }
  });
  quickList.addEventListener('refresh', renderQuickList);

  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) { return; }
    if (mealsPage.classList.contains('hidden')) { return; }
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) { return; }
    e.preventDefault();
    shiftDate(e.key === 'ArrowRight' ? 1 : -1);
  });

  quickList.addEventListener('click', async (e) => {
    const target  = /** @type {HTMLElement} */ (e.target);
    const item    = target.closest('.item');
    if (!item) { return; }
    const itemEl  = /** @type {HTMLElement} */ (item);
    const id      = V.id(itemEl.dataset.id);
    const food    = await Foods.byId(id);
    if (!food) {
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
   * @param {Meal[]} meals
   * @returns {Macros}
   */
  function computeTotals(meals){
    return meals.reduce((a, m)=>{
      a.kcal  += m.foodSnapshot.kcal  * m.multiplier;
      a.prot  += m.foodSnapshot.prot  * m.multiplier;
      a.carbs += m.foodSnapshot.carbs * m.multiplier;
      a.fats  += m.foodSnapshot.fats  * m.multiplier;
      return a;
    }, {kcal:0,prot:0,carbs:0,fats:0});
  }

  /**
   * Build normalized totals view model, incorporating goals when set.
   * @param {Macros} totals
   * @returns {{ calories: MacroVM, protein: MacroVM, carbs: MacroVM, fat: MacroVM }}
   */
  function buildTotalsViewModel(totals){
    if (!currentGoals) {
      /** @param {number} consumed @returns {MacroVM} */
      const stub = (consumed) => ({ consumed, target: null, remaining: null, status: 'none' });
      return {
        calories: stub(totals.kcal),
        protein:  stub(totals.prot),
        carbs:    stub(totals.carbs),
        fat:      stub(totals.fats),
      };
    }
    const g = Goals.derivedGrams(currentGoals);
    /** @param {number} consumed @param {number} target @returns {MacroVM} */
    const macro = (consumed, target) => ({
      consumed,
      target,
      remaining: target - consumed,
      status:    Goals.computeStatus(consumed, target),
    });
    return {
      calories: macro(totals.kcal, currentGoals.kcal),
      protein:  macro(totals.prot, g.protG),
      carbs:    macro(totals.carbs, g.carbsG),
      fat:      macro(totals.fats, g.fatG),
    };
  }

  /**
   * Render macros totals display — expanded (overview) + compact (entry) variants.
   * @param {Macros} totals
   */
  function renderDayInfo(totals){
    const vm    = buildTotalsViewModel(totals);
    const goals = currentGoals;

    /** @param {MacroVM} mvm @param {'kcal'|'g'} unit @returns {string} */
    const subtextStr = (mvm, unit) => {
      if (mvm.remaining === null) { return ''; }
      const abs = Math.abs(mvm.remaining);
      return mvm.remaining >= 0
        ? `${$.fmtNum(abs, 0)} ${unit} left`
        : `${$.fmtNum(abs, 0)} ${unit} over`;
    };

    /** @param {MacroVM} mvm @returns {number} */
    const barPct = (mvm) =>
      mvm.target ? Math.min(100, Math.round((mvm.consumed / mvm.target) * 100)) : 0;

    // Hero extras (only when goals set)
    const heroExtras = goals ? `
      <div class="summary-hero-subtext status-${vm.calories.status}">${subtextStr(vm.calories, 'kcal')}</div>
      <div class="summary-hero-bar">
        <div class="summary-hero-bar-fill ${vm.calories.status}" style="width:${barPct(vm.calories)}%"></div>
      </div>` : '';

    /** @param {MacroVM} mvm @returns {string} */
    const macroExtras = (mvm) => goals ? `
      <div class="macro-subtext status-${mvm.status}">${subtextStr(mvm, 'g')}</div>
      <div class="macro-bar"><div class="macro-bar-fill" style="width:${barPct(mvm)}%"></div></div>` : '';

    // 7-day window badge (only when goals set and window data available)
    let windowBadgeHtml = '';
    if (goals && currentWindowVM) {
      const statuses   = [currentWindowVM.calories, currentWindowVM.protein, currentWindowVM.carbs, currentWindowVM.fat].map(m => m.status);
      const order      = { none: 0, ok: 1, warn: 2, bad: 3 };
      const worstStatus = statuses.reduce((a, b) => order[a] >= order[b] ? a : b, /** @type {'none'|'ok'|'warn'|'bad'} */ ('none'));
      const statusLabel = { ok: 'on track', warn: 'drifting', bad: 'off track', none: '' };
      const dataHint    = currentWindowVM.dataWarning ? ` (${currentWindowVM.windowDays} / 7 days)` : '';
      windowBadgeHtml   = `
        <div class="window-badge" data-testid="windowBadge">
          <span>7-day avg: ${$.fmtNum(currentWindowVM.calories.avgConsumed, 0)} kcal</span>
          <span class="status-dot ${worstStatus}"></span>
          <span>${statusLabel[worstStatus]}${dataHint}</span>
        </div>`;
    }

    // Compact summary
    let compactLine1 = `${$.fmtNum(vm.calories.consumed, 0)} kcal`;
    if (goals && vm.calories.remaining !== null) {
      const calSubtext = subtextStr(vm.calories, 'kcal');
      if (calSubtext) { compactLine1 += ` — ${calSubtext}`; }
    }

    /** @param {string} label @param {MacroVM} mvm @returns {string} */
    const compactMacro = (label, mvm) => {
      if (goals && mvm.remaining !== null) {
        const s = subtextStr(mvm, 'g');
        return `${label} ${s}`;
      }
      return `${label} ${$.fmtNum(mvm.consumed, 0)}g`;
    };
    const compactLine2 = `${compactMacro('P', vm.protein)} · ${compactMacro('C', vm.carbs)} · ${compactMacro('F', vm.fat)}`;

    dayTotals.innerHTML = `
      <div class="day-summary day-summary-expanded">
        <div class="summary-hero">
          <div class="summary-hero-label">Calories</div>
          <div class="summary-hero-value">
            <span class="num">${$.fmtNum(vm.calories.consumed, 0)}</span>
            <span class="unit">kcal</span>
          </div>
          ${heroExtras}
        </div>
        <div class="summary-macros">
          <div class="macro-card macro-protein${goals ? ' status-' + vm.protein.status : ''}">
            <div class="macro-label">Protein</div>
            <div class="macro-value">${$.fmtNum(vm.protein.consumed, 0)}<span class="unit">g</span></div>
            ${macroExtras(vm.protein)}
          </div>
          <div class="macro-card macro-carbs${goals ? ' status-' + vm.carbs.status : ''}">
            <div class="macro-label">Carbs</div>
            <div class="macro-value">${$.fmtNum(vm.carbs.consumed, 0)}<span class="unit">g</span></div>
            ${macroExtras(vm.carbs)}
          </div>
          <div class="macro-card macro-fat${goals ? ' status-' + vm.fat.status : ''}">
            <div class="macro-label">Fat</div>
            <div class="macro-value">${$.fmtNum(vm.fat.consumed, 0)}<span class="unit">g</span></div>
            ${macroExtras(vm.fat)}
          </div>
        </div>
        ${windowBadgeHtml}
      </div>
      <div class="day-summary day-summary-compact">
        <div class="compact-primary">${compactLine1}</div>
        <div class="compact-secondary">${compactLine2}</div>
      </div>`;
  }

  /**
   * @param {Meal[]} meals
   * @param {boolean} [animateFirst]
   */
  function renderMealsList(meals, animateFirst = false){
    mealsList.innerHTML = [...meals].reverse().map(/** @param {Meal} m */ m => {
      const snap     = m.foodSnapshot;
      const mul      = m.multiplier;
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
   * Fetch meals for current date, goals, and window VM, then render UI.
   * @param {boolean} [animateFirst]
   */
  async function renderMeals(animateFirst = false){
    [currentMeals, currentGoals] = await Promise.all([
      /** @type {Promise<Meal[]>} */ (Meals.listByDate(curDate)),
      Goals.get(),
    ]);
    currentWindowVM = await Goals.computeWindowVM($.isoToday(), currentGoals);
    mealsUiState.goalsEnabled = currentGoals !== null;
    const totals = computeTotals(currentMeals);
    renderDayInfo(totals);
    renderMealsList(currentMeals, animateFirst);
  }

  mealsList.addEventListener('click', async (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const row    = target.closest('.meal-row');
    if (!row) { return; }
    const rowEl  = /** @type {HTMLElement} */ (row);
    const id     = V.id(rowEl.dataset.id);
    const meal   = currentMeals.find(m => m.id === id);
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
    window.dispatchEvent(new CustomEvent('go-foods', { detail: { name: name || '' } }));
  }

  window.addEventListener('go-meals', (e) => {
    const name = /** @type {CustomEvent} */(e).detail?.name || '';
    $.showPage('meals');
    quickSearch.value = name;
    renderQuickList();
    quickSearch.focus();
  });

  // Re-render meals (and quick list) when the user navigates back to this tab,
  // ensuring goals changes made on the report page are reflected immediately.
  window.addEventListener('meals-activate', async () => {
    await renderMeals();
    renderQuickList();
  });

  renderQuickList();
  renderMeals();
}

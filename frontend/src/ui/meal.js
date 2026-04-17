import { Foods, Meals } from '../data.js';
import * as Goals from '../data-goals.js';
import * as $ from '../utils.js';
import * as V from '../validation.js';

/**
 * @typedef {import('../data.js').Food} Food
 * @typedef {import('../data.js').Meal} Meal
 * @typedef {import('../data.js').Macros} Macros
 * @typedef {import('../data-goals.js').GoalRecord} GoalsType
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
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString(undefined, { month:'short', day:'numeric' });
  }

  function updateHeader(){
    dayLabel.dataset.iso  = curDate;
    dayLabel.textContent  = fmtHuman(curDate);
    const d    = new Date(`${curDate}T00:00:00`);
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
    animEls.forEach(el => { el?.classList.add(cls); });
    setTimeout(()=> animEls.forEach(el => { el?.classList.remove(cls); }), SWIPE_ANIM_MS);
  }

  function shiftDate(/** @type {number} */ delta){
    const d = new Date(`${curDate}T00:00:00`);
    d.setDate(d.getDate() + delta);
    curDate = $.toISO(d);
    updateHeader();
    void renderMeals();
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
    void renderMeals();
    updateTodayBtn();
    animateDateChange(cls);
  });

  new MutationObserver(updateTodayBtn).observe(mealsPage, { attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { updateTodayBtn(); }
  });

  const FRECENCY_DAYS = 90;

  /**
   * Build quantity-adjusted macro contribution line HTML.
   * Each segment is colored: green up to 5% over goal, yellow up to 15%, red beyond.
   * @param {import('../data.js').Food} f
   * @param {number} qty
   * @param {Macros} totals
   * @returns {string}
   */
  function macroContribHtml(f, qty, totals){
    const dKcal  = f.kcal  * qty;
    const dProt  = f.prot  * qty;
    const dCarbs = f.carbs * qty;
    const dFats  = f.fats  * qty;
    const g = currentGoals ? Goals.derivedGrams(currentGoals) : null;

    /** @param {number} consumed @param {number} delta @param {number|null} goal @returns {'ok'|'warn'|'bad'|'none'} */
    const statusFor = (consumed, delta, goal) => {
      if (!goal) {return 'none';}
      const after = consumed + delta;
      if (after <= goal * 1.05) {return 'ok';}
      if (after <= goal * 1.15) {return 'warn';}
      return 'bad';
    };

    const kcalSt  = statusFor(totals.kcal,  dKcal,  currentGoals ? currentGoals.kcal : null);
    const protSt  = statusFor(totals.prot,  dProt,  g ? g.protG  : null);
    const carbsSt = statusFor(totals.carbs, dCarbs, g ? g.carbsG : null);
    const fatSt   = statusFor(totals.fats,  dFats,  g ? g.fatG   : null);

    /** @param {number} v @param {string} unit @param {string} st @returns {string} */
    const seg = (v, unit, st) => {
      const text = `+${$.fmtNum(v, 0)}${unit}`;
      return st === 'none'
        ? `<span>${text}</span>`
        : `<span class="status-${st}">${text}</span>`;
    };

    return [
      seg(dKcal, ' kcal', kcalSt),
      seg(dProt, 'g protein', protSt),
      seg(dCarbs, 'g carbs', carbsSt),
      seg(dFats, 'g fat', fatSt),
    ].join('');
  }

  /**
   * Render the quick-add food search results (limited to 3 foods).
   */
  async function renderQuickList(){
    const q        = quickSearch.value.trim();
    const todayISO = $.isoToday();
    const sinceDate = new Date(`${todayISO}T00:00:00`);
    sinceDate.setDate(sinceDate.getDate() - FRECENCY_DAYS);
    const sinceISO = $.toISO(sinceDate);
    const scores   = await Meals.frecencyScores(sinceISO, todayISO);
    const foods    = await Foods.list({ search: q, status: 'active', scores });
    const totals   = computeTotals(currentMeals);

    quickList.innerHTML = foods.slice(0, 3).map(f => `
      <div class="item food-card" data-id="${f.id}">
        <div class="food-card-header">
          <button class="btn ghost food-link" tabindex="-1">${$.esc(f.name)}</button>
          <span class="food-card-portion">${$.esc(f.refLabel)}</span>
        </div>
        <div class="actions">
          <input type="number" inputmode="decimal" step="0.5" min="0"
            value="1" class="qty" title="Qty (×ref portion)" style="width:80px" />
          <button class="btn small add" tabindex="-1">＋ Add</button>
          <button class="btn small ghost add05" tabindex="-1" title="+0.5">+0.5</button>
          <button class="btn small ghost add1"  tabindex="-1" title="+1">+1</button>
        </div>
        <div class="food-card-macros">${macroContribHtml(f, 1, totals)}</div>
      </div>`
    ).join('') || '<div class="muted">No Foods match the filter. '
      + 'Type a name and <a href="#" id="quickNew">create it</a>.</div>';

    const createLink = document.getElementById('quickNew');
    if (createLink) {
      $.html(createLink).addEventListener('click', (e) => {
        e.preventDefault(); goFoodsWithPrefill(q);
      });
    }

    // Attach qty→macros live update listeners
    quickList.querySelectorAll('.item[data-id]').forEach(el => {
      const itemEl = /** @type {HTMLElement} */ (el);
      const food = foods.find(f => String(f.id) === itemEl.dataset.id);
      if (!food) {return;}
      const qtyInput = /** @type {HTMLInputElement|null} */ (itemEl.querySelector('.qty'));
      const macrosDiv = itemEl.querySelector('.food-card-macros');
      if (!qtyInput || !macrosDiv) {return;}
      qtyInput.addEventListener('input', () => {
        const qty = Math.max(0, Number(qtyInput.value) || 0);
        macrosDiv.innerHTML = macroContribHtml(food, qty, totals);
      });
    });
  }

  quickSearch.addEventListener('focus', () => {
    mealsUiState.quickSearchFocused = true;
    const touchDevice    = window.matchMedia('(pointer: coarse)').matches;
    const quickAddBottom = quickAddCard.getBoundingClientRect().bottom;
    if (!touchDevice && quickAddBottom <= window.innerHeight) {
      setMealsMode('spacious');
    } else {
      setMealsMode('entry');
      if (touchDevice && window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
          dayTotals.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, { once: true });
      } else {
        dayTotals.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });
  quickSearch.addEventListener('blur', () => {
    mealsUiState.quickSearchFocused = false;
    window.setTimeout(() => {
      if (!mealsUiState.quickSearchFocused && !quickAddCard.contains(document.activeElement)) {
        setMealsMode('overview');
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
    const id      = itemEl.dataset.id;
    if (!id) { return; }
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
        qtyEl.classList.add('error');
        qtyEl.addEventListener('input', () => qtyEl.classList.remove('error'), { once: true });
        return;
      }
      await $.withConfirm($.button(target), async () => {
        await Meals.create(V.mealCreate({ food, multiplier: qty, date: curDate }));
        qtyEl.value = '1';
        quickSearch.value = '';
        await renderMeals(true);
        quickSearch.focus();
      }, '✓ Added');
      return;
    }
    if (target.classList.contains('add1')) {
      qtyEl.value = String(V.number((Number(qtyEl.value || '0') + 1)));
      qtyEl.dispatchEvent(new Event('input'));
      quickSearch.focus(); return;
    }
    if (target.classList.contains('add05')) {
      qtyEl.value = String(V.number((Number(qtyEl.value || '0') + 0.5)));
      qtyEl.dispatchEvent(new Event('input'));
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
    const vm   = buildTotalsViewModel(totals);
    const wvm  = currentWindowVM;


    /** @param {number} delta @param {'kcal'|'g'} unit @returns {string} */
    const deltaStr = (delta, unit) => delta >= 0
      ? `${$.fmtNum(delta, 0)} ${unit} left`
      : `${$.fmtNum(Math.abs(delta), 0)} ${unit} over`;

    // --- Hero section ---
    let heroValueHtml;
    let heroExtras = '';

    if (wvm) {
      // Primary mode: 7-day avg is the signal, delta guides today's eating
      const st       = wvm.calories.status;
      const calDelta = wvm.calories.idealToday - vm.calories.consumed;
      const todayPct = Math.min(100, Math.round((vm.calories.consumed / wvm.calories.idealToday) * 100));
      heroValueHtml = `
        <div class="summary-hero-value status-${st}">
          <span class="num">${$.fmtNum(wvm.calories.avgConsumed, 0)}</span>
          <span class="unit">kcal avg</span>
        </div>`;
      heroExtras = `
        <div class="summary-hero-subtext status-warn">${wvm.windowDays}/7 days logged</div>
        <div class="summary-hero-subtext"><span class="muted">${$.fmtNum(vm.calories.consumed, 0)} kcal today</span> · ${deltaStr(calDelta, 'kcal')}</div>
        <div class="summary-hero-bar">
          <div class="summary-hero-bar-fill ${st}" style="width:${todayPct}%"></div>
        </div>`;
    } else if (currentGoals) {
      // Fallback: goals set but no window data yet (brand-new user)
      const remaining = vm.calories.remaining;
      const subtext   = remaining !== null
        ? (remaining >= 0 ? `${$.fmtNum(remaining, 0)} kcal left` : `${$.fmtNum(Math.abs(remaining), 0)} kcal over`)
        : '';
      const barPct = vm.calories.target
        ? Math.min(100, Math.round((vm.calories.consumed / vm.calories.target) * 100))
        : 0;

      heroValueHtml = `
        <div class="summary-hero-value">
          <span class="num">${$.fmtNum(vm.calories.consumed, 0)}</span>
          <span class="unit">kcal</span>
        </div>`;
      heroExtras = `
        <div class="summary-hero-subtext status-${vm.calories.status}">${subtext}</div>
        <div class="summary-hero-bar">
          <div class="summary-hero-bar-fill ${vm.calories.status}" style="width:${barPct}%"></div>
        </div>`;
    } else {
      heroValueHtml = `
        <div class="summary-hero-value">
          <span class="num">${$.fmtNum(vm.calories.consumed, 0)}</span>
          <span class="unit">kcal</span>
        </div>`;
    }

    // --- Macro cards ---
    /**
     * @param {string} label
     * @param {MacroVM} macroVM
     * @param {import('../data-goals.js').MacroWindow | undefined} macroWin
     * @param {string} cls
     * @returns {string}
     */
    const macroCard = (label, macroVM, macroWin, cls) => {
      if (wvm && macroWin) {
        const d      = macroWin.idealToday - macroVM.consumed;
        const barPct = Math.min(100, Math.round((macroVM.consumed / macroWin.idealToday) * 100));
        return `
          <div class="macro-card ${cls} status-${macroWin.status}">
            <div class="macro-label">${label}</div>
            <div class="macro-value">${$.fmtNum(macroWin.avgConsumed, 0)}<span class="unit">g avg</span></div>
            <div class="macro-subtext"><span class="muted">${$.fmtNum(macroVM.consumed, 0)}g</span> · ${deltaStr(d, 'g')}</div>
            <div class="macro-bar"><div class="macro-bar-fill" style="width:${barPct}%"></div></div>
          </div>`;
      }
      if (currentGoals) {
        const remaining = macroVM.remaining;
        const subtext   = remaining !== null
          ? (remaining >= 0 ? `${$.fmtNum(remaining, 0)}g left` : `${$.fmtNum(Math.abs(remaining), 0)}g over`)
          : '';
        const barPct = macroVM.target
          ? Math.min(100, Math.round((macroVM.consumed / macroVM.target) * 100))
          : 0;
        return `
          <div class="macro-card ${cls} status-${macroVM.status}">
            <div class="macro-label">${label}</div>
            <div class="macro-value">${$.fmtNum(macroVM.consumed, 0)}<span class="unit">g</span></div>
            <div class="macro-subtext status-${macroVM.status}">${subtext}</div>
            <div class="macro-bar"><div class="macro-bar-fill" style="width:${barPct}%"></div></div>
          </div>`;
      }
      return `
        <div class="macro-card ${cls}">
          <div class="macro-label">${label}</div>
          <div class="macro-value">${$.fmtNum(macroVM.consumed, 0)}<span class="unit">g</span></div>
        </div>`;
    };

    // --- Compact summary ---
    let compactLine1;
    let compactLine2;

    if (wvm) {
      const calDelta = wvm.calories.idealToday - vm.calories.consumed;
      compactLine1   = deltaStr(calDelta, 'kcal');

      /** @param {string} lbl @param {MacroVM} macroVM @param {import('../data-goals.js').MacroWindow} macroWin @returns {string} */
      const compactMacroDelta = (lbl, macroVM, macroWin) => {
        const d = macroWin.idealToday - macroVM.consumed;
        return d >= 0
          ? `${lbl} ${$.fmtNum(d, 0)}g left`
          : `${lbl} ${$.fmtNum(Math.abs(d), 0)}g over`;
      };
      compactLine2 = `${compactMacroDelta('P', vm.protein, wvm.protein)} · ${compactMacroDelta('C', vm.carbs, wvm.carbs)} · ${compactMacroDelta('F', vm.fat, wvm.fat)}`;
    } else {
      compactLine1 = `${$.fmtNum(vm.calories.consumed, 0)} kcal`;
      if (currentGoals && vm.calories.remaining !== null) {
        const r = vm.calories.remaining;
        const s = r >= 0 ? `${$.fmtNum(r, 0)} kcal left` : `${$.fmtNum(Math.abs(r), 0)} kcal over`;
        compactLine1 += ` — ${s}`;
      }
      /** @param {string} lbl @param {MacroVM} mvm @returns {string} */
      const compactMacro = (lbl, mvm) => {
        if (currentGoals && mvm.remaining !== null) {
          const r = mvm.remaining;
          return `${lbl} ${r >= 0 ? `${$.fmtNum(r, 0)}g left` : `${$.fmtNum(Math.abs(r), 0)}g over`}`;
        }
        return `${lbl} ${$.fmtNum(mvm.consumed, 0)}g`;
      };
      compactLine2 = `${compactMacro('P', vm.protein)} · ${compactMacro('C', vm.carbs)} · ${compactMacro('F', vm.fat)}`;
    }

    dayTotals.innerHTML = `
      <div class="day-summary day-summary-expanded">
        <div class="summary-hero">
          <div class="summary-hero-label">Calories</div>
          ${heroValueHtml}
          ${heroExtras}
        </div>
        <div class="summary-macros">
          ${macroCard('Protein', vm.protein, wvm?.protein, 'macro-protein')}
          ${macroCard('Carbs',   vm.carbs,   wvm?.carbs,   'macro-carbs')}
          ${macroCard('Fat',     vm.fat,     wvm?.fat,     'macro-fat')}
        </div>
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
      Goals.getActive(),
    ]);
    currentWindowVM = await Goals.computeWindowVM(curDate, currentGoals);
    mealsUiState.goalsEnabled = currentGoals !== null;
    const totals = computeTotals(currentMeals);
    renderDayInfo(totals);
    renderMealsList(currentMeals, animateFirst);
    await renderQuickList();
  }

  mealsList.addEventListener('click', async (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const row    = target.closest('.meal-row');
    if (!row) { return; }
    const rowEl  = /** @type {HTMLElement} */ (row);
    const id     = rowEl.dataset.id;
    const meal   = currentMeals.find(m => m.id === id);
    if (!meal) { return; }
    if (target.classList.contains('del')) {
      await Meals.remove(meal.id);
      await renderMeals();
      $.toast(`"${$.esc(meal.foodSnapshot.name)}" removed`, {
        duration: 5000,
        action: {
          label: 'Undo',
          callback: async () => { await Meals.restore(meal); await renderMeals(); },
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
    void renderQuickList();
    quickSearch.focus();
  });

  // Re-render meals (and quick list) when the user navigates back to this tab,
  // ensuring goals changes made on the goals page are reflected immediately.
  window.addEventListener('meals-activate', () => renderMeals());

  void renderMeals();
}

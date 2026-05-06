import { Foods, Meals } from '../data.js';
import * as Goals from '../data-goals.js';
import { calendarIcon, recoveryIcon, trendIcon } from '../icons.js';
import * as $ from '../utils.js';
import * as V from '../validation.js';

/**
 * @typedef {import('../data.js').Food} Food
 * @typedef {import('../data.js').Meal} Meal
 * @typedef {import('../data.js').Macros} Macros
 * @typedef {import('../data-goals.js').GoalRecord} GoalsType
 * @typedef {import('../data-goals.js').WindowVM} WindowVM
 * @typedef {{ consumed: number, target: number|null, remaining: number|null, status: 'none'|'low'|'ok'|'warn'|'bad' }} MacroVM
 */

const SWIPE_ANIM_MS   = 260;
const FRECENCY_DAYS   = 90;
const QUICK_LIST_LIMIT = 3;

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

  const mealsUiState = {
    mode: /** @type {'overview'|'entry'|'spacious'} */ ('overview'),
    quickSearchFocused: false,
    /** Set to true when goals are loaded */
    goalsEnabled: false,
    /** Daily totals vs. 7-day rolling average view */
    summaryMode: /** @type {'daily'|'average'} */ ('daily'),
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
    return $.localDate(iso).toLocaleDateString(undefined, { month:'short', day:'numeric' });
  }

  function updateHeader(){
    dayLabel.dataset.iso  = curDate;
    dayLabel.textContent  = fmtHuman(curDate);
    const d    = $.localDate(curDate);
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
    const d = $.localDate(curDate);
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

  /**
   * Build quantity-adjusted macro contribution line HTML.
   * Each segment is colored: green up to 5% over goal, yellow up to 10%, red beyond.
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

    const wvm = currentWindowVM;
    const ed  = wvm?.effectiveDays ?? 1;

    const kcalSt  = Goals.macroVisuals(totals.kcal + dKcal,  wvm?.calories, ed, currentGoals?.kcal ?? null).status;
    const protSt  = Goals.macroVisuals(totals.prot + dProt,   wvm?.protein,  ed, g?.protG ?? null).status;
    const carbsSt = Goals.macroVisuals(totals.carbs + dCarbs,  wvm?.carbs,    ed, g?.carbsG ?? null).status;
    const fatSt   = Goals.macroVisuals(totals.fats + dFats,    wvm?.fat,      ed, g?.fatG ?? null).status;

    /** @param {number} v @param {string} unit @param {string} st @returns {string} */
    const seg = (v, unit, st) => {
      const text = `+${$.fmtNum(v, 0)}${unit}`;
      return st === 'none'
        ? `<span>${text}</span>`
        : `<span class="status-${st}">${text}</span>`;
    };

    return [
      seg(dKcal, ' kcal', kcalSt),
      seg(dProt, ' g protein', protSt),
      seg(dCarbs, ' g carbs', carbsSt),
      seg(dFats, ' g fat', fatSt),
    ].join('');
  }

  /**
   * Render the quick-add food search results (limited to 3 foods).
   */
  async function renderQuickList(){
    const q        = quickSearch.value.trim();
    const todayISO = $.isoToday();
    const sinceDate = $.localDate(todayISO);
    sinceDate.setDate(sinceDate.getDate() - FRECENCY_DAYS);
    const sinceISO = $.toISO(sinceDate);
    const scores   = await Meals.frecencyScores(sinceISO, todayISO);
    const foods    = await Foods.list({ search: q, status: 'active', scores });
    const totals   = computeTotals(currentMeals);

    quickList.innerHTML = foods.slice(0, QUICK_LIST_LIMIT).map(f => `
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

  // On mobile, tapping a tabindex="-1" button doesn't shift focus to it, so the
  // blur→overview timer fires before quickSearch.focus() is restored by the click
  // handler. Track pointerdown on the card to suppress that spurious mode reset.
  let blurSuppressed = false;
  quickAddCard.addEventListener('pointerdown', (e) => {
    if (e.target !== quickSearch) {
      blurSuppressed = true;
      setTimeout(() => { blurSuppressed = false; }, 400);
    }
  });

  quickSearch.addEventListener('focus', () => {
    blurSuppressed = false;
    mealsUiState.quickSearchFocused = true;
    const touchDevice    = window.matchMedia($.MEDIA_COARSE_POINTER).matches;
    const quickAddBottom = quickAddCard.getBoundingClientRect().bottom;
    if (!touchDevice && quickAddBottom <= window.innerHeight) {
      setMealsMode('spacious');
    } else {
      const wasEntry = mealsUiState.mode === 'entry';
      setMealsMode('entry');
      // Only scroll into position when first entering entry mode. On re-focus
      // (e.g. after tapping a quick-add button) the keyboard is already up and
      // the user's scroll position should be left alone.
      if (!wasEntry) {
        if (touchDevice && window.visualViewport) {
          window.visualViewport.addEventListener('resize', () => {
            dayTotals.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, { once: true });
        } else {
          dayTotals.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }
  });
  quickSearch.addEventListener('blur', () => {
    mealsUiState.quickSearchFocused = false;
    window.setTimeout(() => {
      if (!mealsUiState.quickSearchFocused && !quickAddCard.contains(document.activeElement) && !blurSuppressed) {
        if (window.innerWidth < 720) {
          setMealsMode('overview');
        }
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
  // Prevent focus from leaving quickSearch when tapping buttons/links in the
  // quick list. Without this, Chrome closes and reopens the keyboard on every
  // button tap. HTMLInputElement targets (qty fields) are excluded so they can
  // still receive focus normally.
  quickList.addEventListener('mousedown', (e) => {
    if (!(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
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
    const total = $.zeroMacros();
    for (const m of meals) { $.addScaledMacros(total, m.foodSnapshot, m.multiplier); }
    return total;
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
      status:    Goals.macroVisuals(consumed, null, 1, target).status,
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
    const avgMode = mealsUiState.summaryMode === 'average' && wvm !== null && currentGoals !== null;

    /** @param {number} delta @param {'kcal'|'g'} unit @returns {string} */
    const deltaStr = (delta, unit) => delta >= 0
      ? `${$.fmtNum(delta, 0)} ${unit} left`
      : `${$.fmtNum(Math.abs(delta), 0)} ${unit} over`;

    /** @param {number} delta @param {'kcal'|'g'} unit @returns {string} */
    const avgDeltaStr = (delta, unit) => delta >= 0
      ? `${$.fmtNum(delta, 0)} ${unit} under`
      : `${$.fmtNum(Math.abs(delta), 0)} ${unit} over`;

    const ed = wvm?.effectiveDays ?? 1;
    const avgDivisor = wvm ? Math.max(1, wvm.windowDays) : 1;

    /**
     * Render a multi-segment progress bar from pre-computed bar segments.
     * @param {{ basePct: number, warnPct: number, badPct: number }} seg
     * @param {'none'|'low'|'ok'|'warn'|'bad'} status
     * @returns {string}
     */
    const barHtml = (seg, status) => {
      const baseClass = status === 'low' ? 'macro-bar-low' : 'macro-bar-ok';
      return `<div class="macro-bar">`
        + `<div class="macro-bar-fill ${baseClass}" style="width:${seg.basePct}%"></div>`
        + (seg.warnPct > 0 ? `<div class="macro-bar-fill macro-bar-warn" style="width:${seg.warnPct}%"></div>` : '')
        + (seg.badPct > 0 ? `<div class="macro-bar-fill macro-bar-bad" style="width:${seg.badPct}%"></div>` : '')
        + `</div>`;
    };

    /**
     * Render a hero-sized progress bar from pre-computed bar segments.
     * @param {{ basePct: number, warnPct: number, badPct: number }} seg
     * @param {'none'|'low'|'ok'|'warn'|'bad'} status
     * @returns {string}
     */
    const heroBarHtml = (seg, status) => {
      const baseClass = status === 'low' ? 'low' : 'ok';
      return `<div class="summary-hero-bar">`
        + `<div class="summary-hero-bar-fill ${baseClass}" style="width:${seg.basePct}%"></div>`
        + (seg.warnPct > 0 ? `<div class="summary-hero-bar-fill warn" style="width:${seg.warnPct}%"></div>` : '')
        + (seg.badPct > 0 ? `<div class="summary-hero-bar-fill bad" style="width:${seg.badPct}%"></div>` : '')
        + `</div>`;
    };

    // --- Hero section ---
    const heroClampHtml = (() => {
      if (!wvm) { return ''; }
      const clamped = Goals.isGoalClamped(wvm.calories, wvm.effectiveDays);
      if (!clamped) { return ''; }
      const n   = Goals.recoveryDays(wvm.calories, wvm.effectiveDays, clamped);
      const dir = clamped === 'below' ? 'over' : 'under';
      const adj = clamped === 'below' ? 'reduced' : 'increased';
      return `<span class="macro-clamp-wrap summary-hero-clamp">
          <button class="macro-clamp-btn" type="button" aria-label="Recovery mode">${recoveryIcon}</button>
          <div class="macro-clamp-tooltip" role="tooltip">
            <strong>Recovery mode</strong><br>
            Your daily calorie target has been ${adj} to compensate for recent
            ${dir}-consumption. Adjusted target applies for ~${n} more day${n !== 1 ? 's' : ''}.
          </div>
        </span>`;
    })();
    let heroValueHtml;
    let heroExtras = '';
    const heroLabel = 'Calories';

    if (avgMode && wvm && currentGoals) {
      const avgKcal = (wvm.calories.prevSum + vm.calories.consumed) / avgDivisor;
      const calVis  = Goals.macroVisuals(avgKcal, null, 1, currentGoals.kcal);
      const delta   = currentGoals.kcal - avgKcal;
      heroValueHtml = `
        <div class="summary-hero-value status-${calVis.status}">
          ${heroClampHtml}
          <span class="num">${$.fmtNum(avgKcal, 0)}</span>
          <span class="unit">kcal</span>
        </div>`;
      heroExtras = `
        <div class="summary-hero-subtext status-${calVis.status}">${avgDeltaStr(delta, 'kcal')}</div>
        ${heroBarHtml(calVis.bar, calVis.status)}`;
    } else if (wvm) {
      const calVis   = Goals.macroVisuals(vm.calories.consumed, wvm.calories, ed);
      const calDelta = wvm.calories.idealToday - vm.calories.consumed;
      heroValueHtml = `
        <div class="summary-hero-value status-${calVis.status}">
          ${heroClampHtml}
          <span class="num">${$.fmtNum(vm.calories.consumed, 0)}</span>
          <span class="unit">kcal</span>
        </div>`;
      heroExtras = `
        <div class="summary-hero-subtext status-${calVis.status}">${deltaStr(calDelta, 'kcal')}</div>
        ${heroBarHtml(calVis.bar, calVis.status)}`;
    } else if (currentGoals) {
      // Fallback: goals set but no window data yet (brand-new user)
      const calVis    = Goals.macroVisuals(vm.calories.consumed, null, ed, vm.calories.target);
      const remaining = vm.calories.remaining;
      const subtext   = remaining !== null
        ? (remaining >= 0 ? `${$.fmtNum(remaining, 0)} kcal left` : `${$.fmtNum(Math.abs(remaining), 0)} kcal over`)
        : '';

      heroValueHtml = `
        <div class="summary-hero-value status-${calVis.status}">
          ${heroClampHtml}
          <span class="num">${$.fmtNum(vm.calories.consumed, 0)}</span>
          <span class="unit">kcal</span>
        </div>`;
      heroExtras = `
        <div class="summary-hero-subtext status-${calVis.status}">${subtext}</div>
        ${heroBarHtml(calVis.bar, calVis.status)}`;
    } else {
      heroValueHtml = `
        <div class="summary-hero-value">
          ${heroClampHtml}
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
      const clamped = wvm && macroWin ? Goals.isGoalClamped(macroWin, wvm.effectiveDays) : false;
      const clampInline = (() => {
        if (!clamped || !wvm || !macroWin) { return ''; }
        const n   = Goals.recoveryDays(macroWin, wvm.effectiveDays, clamped);
        const dir = clamped === 'below' ? 'over' : 'under';
        const adj = clamped === 'below' ? 'reduced' : 'increased';
        return `<span class="macro-clamp-wrap">
            <button class="macro-clamp-btn" type="button" aria-label="Recovery mode">${recoveryIcon}</button>
            <div class="macro-clamp-tooltip" role="tooltip">
              <strong>Recovery mode</strong><br>
              Your daily ${label.toLowerCase()} target has been ${adj} to compensate for recent
              ${dir}-consumption. Adjusted target applies for ~${n} more day${n !== 1 ? 's' : ''}.
            </div>
          </span>`;
      })();

      if (avgMode && macroWin && macroWin.target !== null) {
        const avg   = (macroWin.prevSum + macroVM.consumed) / avgDivisor;
        const vis   = Goals.macroVisuals(avg, null, 1, macroWin.target);
        const delta = macroWin.target - avg;
        return `
          <div class="macro-row ${cls}">
            <div class="macro-row-hd">
              <div class="macro-label">${label}</div>
              <div class="macro-value">${clampInline}${$.fmtNum(avg, 0)}<span class="unit"> / ${macroWin.target}g</span></div>
            </div>
            ${barHtml(vis.bar, vis.status)}
            <div class="macro-subtext status-${vis.status}">${avgDeltaStr(delta, 'g')}</div>
          </div>`;
      }
      if (wvm && macroWin) {
        const vis = Goals.macroVisuals(macroVM.consumed, macroWin, ed);
        const d   = macroWin.idealToday - macroVM.consumed;
        return `
          <div class="macro-row ${cls}">
            <div class="macro-row-hd">
              <div class="macro-label">${label}</div>
              <div class="macro-value">${clampInline}${$.fmtNum(macroVM.consumed, 0)}<span class="unit"> / ${$.fmtNum(macroWin.idealToday, 0)}g</span></div>
            </div>
            ${barHtml(vis.bar, vis.status)}
            <div class="macro-subtext status-${vis.status}">${deltaStr(d, 'g')}</div>
          </div>`;
      }
      if (currentGoals) {
        const vis       = Goals.macroVisuals(macroVM.consumed, null, ed, macroVM.target);
        const remaining = macroVM.remaining;
        const subtext   = remaining !== null
          ? (remaining >= 0 ? `${$.fmtNum(remaining, 0)}g left` : `${$.fmtNum(Math.abs(remaining), 0)}g over`)
          : '';
        return `
          <div class="macro-row ${cls}">
            <div class="macro-row-hd">
              <div class="macro-label">${label}</div>
              <div class="macro-value">${$.fmtNum(macroVM.consumed, 0)}<span class="unit"> / ${macroVM.target ?? '?'}g</span></div>
            </div>
            ${barHtml(vis.bar, vis.status)}
            ${subtext ? `<div class="macro-subtext status-${vis.status}">${subtext}</div>` : ''}
          </div>`;
      }
      return `
        <div class="macro-row ${cls}">
          <div class="macro-row-hd">
            <div class="macro-label">${label}</div>
            <div class="macro-value">${$.fmtNum(macroVM.consumed, 0)}<span class="unit"> g</span></div>
          </div>
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

    const canToggleMode = wvm !== null && currentGoals !== null;
    const toggleBtnHtml = canToggleMode
      ? `<button type="button" class="summary-mode-toggle"
            data-mode="${avgMode ? 'average' : 'daily'}"
            aria-pressed="${avgMode}"
            aria-label="${avgMode ? 'Switch to daily view' : 'Switch to 7-day average'}"
            title="${avgMode ? 'Switch to daily view' : 'Switch to 7-day average'}">
            ${avgMode ? calendarIcon : trendIcon}
          </button>`
      : '';
    const avgIndicatorHtml = avgMode && wvm
      ? `<div class="summary-avg-indicator">7-day average · ${wvm.windowDays} ${wvm.windowDays === 1 ? 'day' : 'days'} logged</div>`
      : '';

    dayTotals.innerHTML = `
      <div class="day-summary day-summary-expanded${avgMode ? ' summary-avg' : ''}">
        ${toggleBtnHtml}
        <div class="summary-hero">
          <div class="summary-hero-label">${heroLabel}</div>
          ${heroValueHtml}
          ${heroExtras}
        </div>
        <div class="summary-macros">
          ${macroCard('Protein', vm.protein, wvm?.protein, 'macro-protein')}
          ${macroCard('Carbs',   vm.carbs,   wvm?.carbs,   'macro-carbs')}
          ${macroCard('Fat',     vm.fat,     wvm?.fat,     'macro-fat')}
        </div>
        ${avgIndicatorHtml}
      </div>
      <div class="day-summary day-summary-compact">
        <div class="compact-primary">${compactLine1}</div>
        <div class="compact-secondary">${compactLine2}</div>
      </div>`;
  }

  dayTotals.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);

    const clampBtn = target.closest('.macro-clamp-btn');
    if (clampBtn) {
      e.stopPropagation();
      const wrap = /** @type {HTMLElement|null} */ (clampBtn.closest('.macro-clamp-wrap'));
      const tip  = /** @type {HTMLElement|null} */ (wrap?.querySelector('.macro-clamp-tooltip'));
      if (!wrap || !tip) { return; }
      // Align tooltip to avoid viewport overflow on the leftmost card
      const rect    = wrap.getBoundingClientRect();
      const tipWidth = 220;
      if (rect.left < tipWidth) {
        tip.style.right = 'auto';
        tip.style.left  = '0';
      } else {
        tip.style.right = '0';
        tip.style.left  = 'auto';
      }
      dayTotals.querySelectorAll('.macro-clamp-tooltip.open').forEach(t => {
        if (t !== tip) { t.classList.remove('open'); }
      });
      tip.classList.toggle('open');
      return;
    }

    const modeBtn = target.closest('.summary-mode-toggle');
    if (!modeBtn) { return; }
    mealsUiState.summaryMode = mealsUiState.summaryMode === 'daily' ? 'average' : 'daily';
    renderDayInfo(computeTotals(currentMeals));
  });

  document.addEventListener('click', () => {
    dayTotals.querySelectorAll('.macro-clamp-tooltip.open').forEach(t => { t.classList.remove('open'); });
  });

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
          <span class="meal-row-qty">${$.esc(snap.refLabel)} <span class="meal-row-mul">×${$.fmtNum(mul)}</span></span>
          <span class="meal-row-meta">${mealMeta}</span>
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

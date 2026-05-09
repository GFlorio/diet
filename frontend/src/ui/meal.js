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

  let currentDate = $.isoToday();
  /** @type {Meal[]} */
  let currentMeals = [];
  /** @type {GoalsType | null} */
  let currentGoals = null;
  /** @type {WindowVM | null} */
  let currentWindowVM = null;

  /**
   * Format ISO date (YYYY-MM-DD) to human-friendly short form (e.g., "Oct 30").
   * @param {string} isoDate
   * @returns {string}
   */
  function fmtHuman(isoDate){
    return $.localDate(isoDate).toLocaleDateString(undefined, { month:'short', day:'numeric' });
  }

  function updateHeader(){
    dayLabel.dataset.iso  = currentDate;
    dayLabel.textContent  = fmtHuman(currentDate);
    const date = $.localDate(currentDate);
    const previousDate = new Date(date); previousDate.setDate(date.getDate()-1);
    const nextDate = new Date(date); nextDate.setDate(date.getDate()+1);
    prevDayBox.textContent = fmtHuman($.toISO(previousDate));
    nextDayBox.textContent = fmtHuman($.toISO(nextDate));
  }
  updateHeader();

  /**
   * @param {number} delta
   */
  /** @param {'dateSlideLeft'|'dateSlideRight'} animationClass */
  function animateDateChange(animationClass){
    const animEls = [daysHeader, dayTotals, quickAddCard, mealsCard];
    animEls.forEach(element => { element?.classList.add(animationClass); });
    setTimeout(()=> animEls.forEach(element => { element?.classList.remove(animationClass); }), SWIPE_ANIM_MS);
  }

  function shiftDate(/** @type {number} */ delta){
    const date = $.localDate(currentDate);
    date.setDate(date.getDate() + delta);
    currentDate = $.toISO(date);
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
    const isToday = currentDate === $.isoToday();
    todayFab.classList.toggle('today-fab--visible', onMeals && !isToday);
  }

  todayFab.addEventListener('click', () => {
    const today = $.isoToday();
    const animationClass = currentDate < today ? 'dateSlideLeft' : 'dateSlideRight';
    currentDate = today;
    updateHeader();
    void renderMeals();
    updateTodayBtn();
    animateDateChange(animationClass);
  });

  new MutationObserver(updateTodayBtn).observe(mealsPage, { attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { updateTodayBtn(); }
  });

  /**
   * Build quantity-adjusted macro contribution line HTML.
   * Each segment is colored: green up to 5% over goal, yellow up to 10%, red beyond.
   * @param {import('../data.js').Food} food
   * @param {number} quantity
   * @param {Macros} totals
   * @returns {string}
   */
  function macroContribHtml(food, quantity, totals){
    const kcalDelta  = food.kcal  * quantity;
    const protDelta  = food.prot  * quantity;
    const carbsDelta = food.carbs * quantity;
    const fatsDelta  = food.fats  * quantity;
    const gramGoals = currentGoals ? Goals.derivedGrams(currentGoals) : null;

    const windowViewModel = currentWindowVM;
    const effectiveDays  = windowViewModel?.effectiveDays ?? 1;

    const kcalStatus  = Goals.macroVisuals(totals.kcal  + kcalDelta,  windowViewModel?.calories, effectiveDays, currentGoals?.kcal ?? null).status;
    const protStatus  = Goals.macroVisuals(totals.prot  + protDelta,  windowViewModel?.protein,  effectiveDays, gramGoals?.protG ?? null).status;
    const carbsStatus = Goals.macroVisuals(totals.carbs + carbsDelta, windowViewModel?.carbs,    effectiveDays, gramGoals?.carbsG ?? null).status;
    const fatStatus   = Goals.macroVisuals(totals.fats  + fatsDelta,  windowViewModel?.fat,      effectiveDays, gramGoals?.fatG ?? null).status;

    /** @param {number} value @param {string} unit @param {string} status @returns {string} */
    const segmentHtml = (value, unit, status) => {
      const text = `+${$.fmtNum(value, 0)}${unit}`;
      return status === 'none'
        ? `<span>${text}</span>`
        : `<span class="status-${status}">${text}</span>`;
    };

    return [
      segmentHtml(kcalDelta, ' kcal', kcalStatus),
      segmentHtml(protDelta, ' g protein', protStatus),
      segmentHtml(carbsDelta, ' g carbs', carbsStatus),
      segmentHtml(fatsDelta, ' g fat', fatStatus),
    ].join('');
  }

  /**
   * Render the quick-add food search results (limited to 3 foods).
   */
  async function renderQuickList(){
    const query = quickSearch.value.trim();
    const todayISO = $.isoToday();
    const sinceDate = $.localDate(todayISO);
    sinceDate.setDate(sinceDate.getDate() - FRECENCY_DAYS);
    const sinceISO = $.toISO(sinceDate);
    const scores   = await Meals.frecencyScores(sinceISO, todayISO);
    const foods    = await Foods.list({ search: query, status: 'active', scores });
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
          <button class="btn small ghost add1"  tabindex="-1" title="+1">+1</button>
          <button class="btn small ghost add05" tabindex="-1" title="-0.5">-0.5</button>
        </div>
        <div class="food-card-macros">${macroContribHtml(f, 1, totals)}</div>
      </div>`
    ).join('') || '<div class="muted">No Foods match the filter. '
      + 'Type a name and <a href="#" id="quickNew">create it</a>.</div>';

    const createLink = document.getElementById('quickNew');
    if (createLink) {
      $.html(createLink).addEventListener('click', (e) => {
        e.preventDefault(); goFoodsWithPrefill(query);
      });
    }

    // Attach qty→macros live update listeners
    quickList.querySelectorAll('.item[data-id]').forEach(el => {
      const itemEl = /** @type {HTMLElement} */ (el);
      const food = foods.find(f => String(f.id) === itemEl.dataset.id);
      if (!food) {return;}
      const quantityInput = /** @type {HTMLInputElement|null} */ (itemEl.querySelector('.qty'));
      const macrosDiv = itemEl.querySelector('.food-card-macros');
      if (!quantityInput || !macrosDiv) {return;}
      quantityInput.addEventListener('input', () => {
        const quantity = Math.max(0, Number(quantityInput.value) || 0);
        macrosDiv.innerHTML = macroContribHtml(food, quantity, totals);
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
      const quantityInputs = /** @type {NodeListOf<HTMLInputElement>} */ (quickList.querySelectorAll('.qty'));
      const inputIndex  = Array.prototype.indexOf.call(quantityInputs, target);
      if (!e.shiftKey && inputIndex < quantityInputs.length - 1) {
        quantityInputs[inputIndex + 1].focus();
        quantityInputs[inputIndex + 1].select(); e.preventDefault();
      } else if (!e.shiftKey && inputIndex === quantityInputs.length - 1) {
        setMealsMode('overview');
      } else if (e.shiftKey && inputIndex > 0) {
        quantityInputs[inputIndex - 1].focus();
        quantityInputs[inputIndex - 1].select(); e.preventDefault();
      } else if (e.shiftKey && inputIndex === 0) {
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
    // Read qty synchronously before any await so the value isn't stale after a re-render.
    const quantityEl = $.input(item.querySelector('.qty'));
    if (target.classList.contains('add')) {
      let quantity;
      try {
        quantity = V.number(quantityEl.value || '0', { min: 0, max: 100 });
        if (quantity <= 0) { throw new Error(); }
      } catch {
        quantityEl.classList.add('error');
        quantityEl.addEventListener('input', () => quantityEl.classList.remove('error'), { once: true });
        return;
      }
      const food = await Foods.byId(id);
      if (!food) {
        itemEl.classList.add('shake');
        setTimeout(()=> itemEl.classList.remove('shake'), 500);
        return;
      }
      await $.withConfirm($.button(target), async () => {
        await Meals.create(V.mealCreate({ food, multiplier: quantity, date: currentDate }));
        quantityEl.value = '1';
        quickSearch.value = '';
        await renderMeals(true);
        quickSearch.focus();
      }, '✓ Added');
      return;
    }
    const food    = await Foods.byId(id);
    if (!food) {
      itemEl.classList.add('shake');
      setTimeout(()=> itemEl.classList.remove('shake'), 500);
      return;
    }
    if (target.classList.contains('add1')) {
      quantityEl.value = String(V.number((Number(quantityEl.value || '0') + 1)));
      quantityEl.dispatchEvent(new Event('input'));
      quickSearch.focus({ preventScroll: true }); return;
    }
    if (target.classList.contains('add05')) {
      quantityEl.value = String(V.number((Number(quantityEl.value || '0') - 0.5)));
      quantityEl.dispatchEvent(new Event('input'));
      quickSearch.focus({ preventScroll: true }); return;
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
    for (const meal of meals) { $.addScaledMacros(total, meal.foodSnapshot, meal.multiplier); }
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
    const gramGoals = Goals.derivedGrams(currentGoals);
    /** @param {number} consumed @param {number} target @returns {MacroVM} */
    const macro = (consumed, target) => ({
      consumed,
      target,
      remaining: target - consumed,
      status:    Goals.macroVisuals(consumed, null, 1, target).status,
    });
    return {
      calories: macro(totals.kcal, currentGoals.kcal),
      protein:  macro(totals.prot, gramGoals.protG),
      carbs:    macro(totals.carbs, gramGoals.carbsG),
      fat:      macro(totals.fats, gramGoals.fatG),
    };
  }

  /**
   * Render macros totals display — expanded (overview) + compact (entry) variants.
   * @param {Macros} totals
   */
  function renderDayInfo(totals){
    const totalsViewModel = buildTotalsViewModel(totals);
    const windowViewModel = currentWindowVM;
    const avgMode = mealsUiState.summaryMode === 'average' && windowViewModel !== null && currentGoals !== null;

    /** @param {number} delta @param {'kcal'|'g'} unit @returns {string} */
    const deltaStr = (delta, unit) => delta >= 0
      ? `${$.fmtNum(delta, 0)} ${unit} left`
      : `${$.fmtNum(Math.abs(delta), 0)} ${unit} over`;

    /** @param {number} delta @param {'kcal'|'g'} unit @returns {string} */
    const avgDeltaStr = (delta, unit) => delta >= 0
      ? `${$.fmtNum(delta, 0)} ${unit} under`
      : `${$.fmtNum(Math.abs(delta), 0)} ${unit} over`;

    const effectiveDays = windowViewModel?.effectiveDays ?? 1;
    const avgDivisor = windowViewModel ? Math.max(1, windowViewModel.windowDays) : 1;

    /**
     * Render a multi-segment progress bar from pre-computed bar segments.
     * @param {{ basePct: number, warnPct: number, badPct: number }} segments
     * @param {'none'|'low'|'ok'|'warn'|'bad'} status
     * @param {{ root: string, fill: string, low: string, ok: string, warn: string, bad: string }} classes
     * @returns {string}
     */
    const progressBarHtml = (segments, status, classes) => {
      const baseClass = status === 'low' ? classes.low : classes.ok;
      /** @param {string} className @param {number} percent @returns {string} */
      const fill = (className, percent) => percent > 0
        ? `<div class="${classes.fill} ${className}" style="width:${percent}%"></div>`
        : '';
      return `<div class="${classes.root}">`
        + fill(baseClass, segments.basePct)
        + fill(classes.warn, segments.warnPct)
        + fill(classes.bad, segments.badPct)
        + `</div>`;
    };

    const macroBarClasses = {
      root: 'macro-bar',
      fill: 'macro-bar-fill',
      low:  'macro-bar-low',
      ok:   'macro-bar-ok',
      warn: 'macro-bar-warn',
      bad:  'macro-bar-bad',
    };
    const heroBarClasses = {
      root: 'summary-hero-bar',
      fill: 'summary-hero-bar-fill',
      low:  'low',
      ok:   'ok',
      warn: 'warn',
      bad:  'bad',
    };

    /** @param {{ basePct: number, warnPct: number, badPct: number }} segments @param {'none'|'low'|'ok'|'warn'|'bad'} status @returns {string} */
    const barHtml = (segments, status) => progressBarHtml(segments, status, macroBarClasses);

    /**
     * @param {string} label
     * @param {import('../data-goals.js').MacroWindow | null | undefined} macroWin
     * @param {string} [extraClass]
     * @returns {string}
     */
    const clampHtml = (label, macroWin, extraClass = '') => {
      if (!windowViewModel || !macroWin) { return ''; }
      const clamped = Goals.isGoalClamped(macroWin, windowViewModel.effectiveDays);
      if (!clamped) { return ''; }
      const recoveryDays = Goals.recoveryDays(macroWin, windowViewModel.effectiveDays, clamped);
      const direction = clamped === 'below' ? 'over' : 'under';
      const adjustmentText = clamped === 'below' ? 'reduced' : 'increased';
      const classes = `macro-clamp-wrap${extraClass ? ` ${extraClass}` : ''}`;
      return `<span class="${classes}">
          <button class="macro-clamp-btn" type="button" aria-label="Recovery mode">${recoveryIcon}</button>
          <div class="macro-clamp-tooltip" role="tooltip">
            <strong>Recovery mode</strong><br>
            Your daily ${label.toLowerCase()} target has been ${adjustmentText} to compensate for recent
            ${direction}-consumption. Adjusted target applies for ~${recoveryDays} more day${recoveryDays !== 1 ? 's' : ''}.
          </div>
        </span>`;
    };

    /** @param {number} value @param {'kcal'|'g'} unit @param {'none'|'low'|'ok'|'warn'|'bad'} [status] @param {string} [prefix] @returns {string} */
    const metricValueHtml = (value, unit, status = 'none', prefix = '') => `
      <div class="summary-hero-value${status !== 'none' ? ` status-${status}` : ''}">
        ${prefix}
        <span class="num">${$.fmtNum(value, 0)}</span>
        <span class="unit">${unit}</span>
      </div>`;

    /** @param {number|null} remaining @param {'kcal'|'g'} unit @returns {string} */
    const remainingText = (remaining, unit) => {
      if (remaining === null) { return ''; }
      return remaining >= 0
        ? `${$.fmtNum(remaining, 0)}${unit === 'g' ? 'g' : ' kcal'} left`
        : `${$.fmtNum(Math.abs(remaining), 0)}${unit === 'g' ? 'g' : ' kcal'} over`;
    };

    /** @returns {{ value: number, status: 'none'|'low'|'ok'|'warn'|'bad', subtext: string, bar: string }} */
    const buildHero = () => {
      if (avgMode && windowViewModel && currentGoals) {
        const avgKcal = (windowViewModel.calories.prevSum + totalsViewModel.calories.consumed) / avgDivisor;
        const visuals = Goals.macroVisuals(avgKcal, null, 1, currentGoals.kcal);
        return {
          value:   avgKcal,
          status:  visuals.status,
          subtext: avgDeltaStr(currentGoals.kcal - avgKcal, 'kcal'),
          bar:     progressBarHtml(visuals.bar, visuals.status, heroBarClasses),
        };
      }
      if (windowViewModel) {
        const visuals = Goals.macroVisuals(totalsViewModel.calories.consumed, windowViewModel.calories, effectiveDays);
        return {
          value:   totalsViewModel.calories.consumed,
          status:  visuals.status,
          subtext: deltaStr(windowViewModel.calories.idealToday - totalsViewModel.calories.consumed, 'kcal'),
          bar:     progressBarHtml(visuals.bar, visuals.status, heroBarClasses),
        };
      }
      if (currentGoals) {
        const visuals = Goals.macroVisuals(totalsViewModel.calories.consumed, null, effectiveDays, totalsViewModel.calories.target);
        return {
          value:   totalsViewModel.calories.consumed,
          status:  visuals.status,
          subtext: remainingText(totalsViewModel.calories.remaining, 'kcal'),
          bar:     progressBarHtml(visuals.bar, visuals.status, heroBarClasses),
        };
      }
      return { value: totalsViewModel.calories.consumed, status: 'none', subtext: '', bar: '' };
    };

    const hero = buildHero();
    const heroValueHtml = metricValueHtml(
      hero.value,
      'kcal',
      hero.status,
      clampHtml('calorie', windowViewModel?.calories, 'summary-hero-clamp'),
    );
    const heroExtras = hero.subtext || hero.bar
      ? `${hero.subtext ? `<div class="summary-hero-subtext status-${hero.status}">${hero.subtext}</div>` : ''}${hero.bar}`
      : '';

    // --- Macro cards ---
    /**
     * @param {string} label
     * @param {MacroVM} macroVM
     * @param {import('../data-goals.js').MacroWindow | undefined} macroWin
     * @param {string} className
     * @returns {string}
     */
    const macroCard = (label, macroVM, macroWin, className) => {
      const clampInline = clampHtml(label, macroWin);
      /** @param {string} valueHtml @param {string} [bar] @param {string} [subtext] @returns {string} */
      const rowHtml = (valueHtml, bar = '', subtext = '') => `
        <div class="macro-row ${className}">
          <div class="macro-row-hd">
            <div class="macro-label">${label}</div>
            <div class="macro-value">${valueHtml}</div>
          </div>
          ${bar}
          ${subtext}
        </div>`;

      if (avgMode && macroWin && macroWin.target !== null) {
        const avg   = (macroWin.prevSum + macroVM.consumed) / avgDivisor;
        const visuals = Goals.macroVisuals(avg, null, 1, macroWin.target);
        const delta = macroWin.target - avg;
        return rowHtml(
          `${clampInline}${$.fmtNum(avg, 0)}<span class="unit"> / ${macroWin.target}g</span>`,
          barHtml(visuals.bar, visuals.status),
          `<div class="macro-subtext status-${visuals.status}">${avgDeltaStr(delta, 'g')}</div>`,
        );
      }
      if (windowViewModel && macroWin) {
        const visuals = Goals.macroVisuals(macroVM.consumed, macroWin, effectiveDays);
        const delta   = macroWin.idealToday - macroVM.consumed;
        return rowHtml(
          `${clampInline}${$.fmtNum(macroVM.consumed, 0)}<span class="unit"> / ${$.fmtNum(macroWin.idealToday, 0)}g</span>`,
          barHtml(visuals.bar, visuals.status),
          `<div class="macro-subtext status-${visuals.status}">${deltaStr(delta, 'g')}</div>`,
        );
      }
      if (currentGoals) {
        const visuals   = Goals.macroVisuals(macroVM.consumed, null, effectiveDays, macroVM.target);
        const subtext   = remainingText(macroVM.remaining, 'g');
        return rowHtml(
          `${$.fmtNum(macroVM.consumed, 0)}<span class="unit"> / ${macroVM.target ?? '?'}g</span>`,
          barHtml(visuals.bar, visuals.status),
          subtext ? `<div class="macro-subtext status-${visuals.status}">${subtext}</div>` : '',
        );
      }
      return rowHtml(`${$.fmtNum(macroVM.consumed, 0)}<span class="unit"> g</span>`);
    };

    // --- Compact summary ---
    let compactLine1;
    let compactLine2;

    if (windowViewModel) {
      const calDelta = windowViewModel.calories.idealToday - totalsViewModel.calories.consumed;
      compactLine1   = deltaStr(calDelta, 'kcal');

      /** @param {string} label @param {MacroVM} macroVM @param {import('../data-goals.js').MacroWindow} macroWin @returns {string} */
      const compactMacroDelta = (label, macroVM, macroWin) => {
        const delta = macroWin.idealToday - macroVM.consumed;
        return delta >= 0
          ? `${label} ${$.fmtNum(delta, 0)}g left`
          : `${label} ${$.fmtNum(Math.abs(delta), 0)}g over`;
      };
      compactLine2 = `${compactMacroDelta('P', totalsViewModel.protein, windowViewModel.protein)} · ${compactMacroDelta('C', totalsViewModel.carbs, windowViewModel.carbs)} · ${compactMacroDelta('F', totalsViewModel.fat, windowViewModel.fat)}`;
    } else {
      compactLine1 = `${$.fmtNum(totalsViewModel.calories.consumed, 0)} kcal`;
      if (currentGoals && totalsViewModel.calories.remaining !== null) {
        const remaining = totalsViewModel.calories.remaining;
        const remainingSummary = remaining >= 0 ? `${$.fmtNum(remaining, 0)} kcal left` : `${$.fmtNum(Math.abs(remaining), 0)} kcal over`;
        compactLine1 += ` — ${remainingSummary}`;
      }
      /** @param {string} label @param {MacroVM} macroVM @returns {string} */
      const compactMacro = (label, macroVM) => {
        if (currentGoals && macroVM.remaining !== null) {
          const remaining = macroVM.remaining;
          return `${label} ${remaining >= 0 ? `${$.fmtNum(remaining, 0)}g left` : `${$.fmtNum(Math.abs(remaining), 0)}g over`}`;
        }
        return `${label} ${$.fmtNum(macroVM.consumed, 0)}g`;
      };
      compactLine2 = `${compactMacro('P', totalsViewModel.protein)} · ${compactMacro('C', totalsViewModel.carbs)} · ${compactMacro('F', totalsViewModel.fat)}`;
    }

    const canToggleMode = windowViewModel !== null && currentGoals !== null;
    const toggleBtnHtml = canToggleMode
      ? `<button type="button" class="summary-mode-toggle"
            data-mode="${avgMode ? 'average' : 'daily'}"
            aria-pressed="${avgMode}"
            aria-label="${avgMode ? 'Switch to daily view' : 'Switch to 7-day average'}"
            title="${avgMode ? 'Switch to daily view' : 'Switch to 7-day average'}">
            ${avgMode ? calendarIcon : trendIcon}
          </button>`
      : '';
    const avgIndicatorHtml = avgMode && windowViewModel
      ? `<div class="summary-avg-indicator">7-day average${
        windowViewModel.windowDays !== 7 ?
          `· ${windowViewModel.windowDays} ${windowViewModel.windowDays === 1 ? 'day' : 'days'} logged</div>` : ''}`
      : '';

    dayTotals.innerHTML = `
      <div class="day-summary day-summary-expanded${avgMode ? ' summary-avg' : ''}">
        ${toggleBtnHtml}
        <div class="summary-hero">
          <div class="summary-hero-label">Calories</div>
          ${heroValueHtml}
          ${heroExtras}
        </div>
        <div class="summary-macros">
          ${macroCard('Protein', totalsViewModel.protein, windowViewModel?.protein, 'macro-protein')}
          ${macroCard('Carbs',   totalsViewModel.carbs,   windowViewModel?.carbs,   'macro-carbs')}
          ${macroCard('Fat',     totalsViewModel.fat,     windowViewModel?.fat,     'macro-fat')}
        </div>
        ${avgIndicatorHtml}
      </div>
      <div class="day-summary day-summary-compact">
        <div class="compact-primary">${compactLine1}</div>
        <div class="compact-secondary">${compactLine2}</div>
      </div>`;
  }

  // --- Long-press on a macro card → log goal story to console ---
  const MACRO_HOLD_MS = 5_000;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let macroHoldTimer = null;

  /**
   * Print a structured explanation of why a macro's ideal-today is what it is.
   * @param {'calories'|'protein'|'carbs'|'fat'} macroKey
   */
  function logMacroGoalStory(macroKey) {
    if (!currentWindowVM || !currentGoals) {
      console.log('[macro goal story] No window view model available — goals not set or no meals in window.');
      return;
    }
    console.log(Goals.explainMacroGoal(macroKey, currentWindowVM, currentGoals, currentDate));
  }

  dayTotals.addEventListener('pointerdown', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const row = target.closest('.macro-row');
    if (!row) { return; }
    /** @type {'calories'|'protein'|'carbs'|'fat'} */
    let macroKey;
    if (row.classList.contains('macro-protein'))      { macroKey = 'protein'; }
    else if (row.classList.contains('macro-carbs'))   { macroKey = 'carbs'; }
    else if (row.classList.contains('macro-fat'))     { macroKey = 'fat'; }
    else                                              { macroKey = 'calories'; }
    macroHoldOrigin = { x: e.clientX, y: e.clientY };
    macroHoldTimer = setTimeout(() => { logMacroGoalStory(macroKey); }, MACRO_HOLD_MS);
  });

  const cancelMacroHold = () => {
    if (macroHoldTimer !== null) { clearTimeout(macroHoldTimer); macroHoldTimer = null; }
  };
  /** @type {{ x: number, y: number } | null} */
  let macroHoldOrigin = null;
  dayTotals.addEventListener('pointermove', (e) => {
    if (!macroHoldOrigin || macroHoldTimer === null) { return; }
    const dx = e.clientX - macroHoldOrigin.x;
    const dy = e.clientY - macroHoldOrigin.y;
    if (dx * dx + dy * dy > 100) { cancelMacroHold(); } // >10px movement cancels
  });
  dayTotals.addEventListener('pointerup',     cancelMacroHold);
  dayTotals.addEventListener('pointercancel', cancelMacroHold);

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
    dayTotals.querySelectorAll('.macro-clamp-tooltip.open').forEach(tooltip => { tooltip.classList.remove('open'); });
  });

  /**
   * @param {Meal[]} meals
   * @param {boolean} [animateFirst]
   */
  function renderMealsList(meals, animateFirst = false){
    mealsList.innerHTML = [...meals].reverse().map(/** @param {Meal} meal */ meal => {
      const foodSnapshot = meal.foodSnapshot;
      const multiplier = meal.multiplier;
      const mealMeta = $.nutrMeta(foodSnapshot.kcal*multiplier, foodSnapshot.prot*multiplier, foodSnapshot.carbs*multiplier, foodSnapshot.fats*multiplier);
      return `
      <div class="meal-row" data-id="${meal.id}">
        <div class="meal-row-body">
          <span class="meal-name">${$.esc(foodSnapshot.name)}</span>
          <span class="meal-row-qty">${$.esc(foodSnapshot.refLabel)} <span class="meal-row-mul">×${$.fmtNum(multiplier)}</span></span>
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
      /** @type {Promise<Meal[]>} */ (Meals.listByDate(currentDate)),
      Goals.getActive(),
    ]);
    currentWindowVM = await Goals.computeWindowVM(currentDate, currentGoals);
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
    const meal   = currentMeals.find(currentMeal => currentMeal.id === id);
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

import * as $ from '../utils.js';
import { Meals } from '../data.js';
import * as Goals from '../data-goals.js';

/**
 * @typedef {import('../data-goals.js').Goals} GoalsType
 */

export function setupReport() {
  const goalsCard    = $.html($.id('goalsCard'));
  const heatmapCard  = $.html($.id('heatmapCard'));

  // -------------------------------------------------------------------------
  // Goals card
  // -------------------------------------------------------------------------

  async function refreshGoals() {
    const goals = await Goals.get();
    renderGoalsCard(goals);
    renderHeatmap();
  }

  /** @param {GoalsType | null} goals */
  function renderGoalsCard(goals) {
    if (!goals) {
      goalsCard.innerHTML = `
        <div class="goals-view-header">
          <span class="goals-view-title">Daily goals</span>
        </div>
        <p style="margin:0 0 16px; font-size:14px; color:var(--muted)">No daily targets set yet.</p>
        <button class="btn small" id="goalsEditBtn" data-testid="goalsEditBtn">Set daily targets</button>`;
    } else {
      const g = Goals.derivedGrams(goals);
      goalsCard.innerHTML = `
        <div class="goals-view-header">
          <span class="goals-view-title">Daily goals</span>
          <button class="btn small ghost right" id="goalsEditBtn" data-testid="goalsEditBtn">Edit</button>
        </div>
        <div class="goals-view-hero">
          <div class="goals-view-hero-label">Daily calorie target</div>
          <div>
            <span class="goals-view-hero-num">${$.fmtNum(goals.kcal, 0)}</span>
            <span class="goals-view-hero-unit">kcal</span>
          </div>
        </div>
        <div class="goals-macros-row">
          <div class="goals-macro-pill">
            <div class="goals-macro-pill-name">Protein</div>
            <div class="goals-macro-pill-g">${g.protG}<span style="font-size:11px;color:var(--muted);font-weight:500"> g</span></div>
            <div class="goals-macro-pill-pct">${goals.protPct}%</div>
          </div>
          <div class="goals-macro-pill">
            <div class="goals-macro-pill-name">Carbs</div>
            <div class="goals-macro-pill-g">${g.carbsG}<span style="font-size:11px;color:var(--muted);font-weight:500"> g</span></div>
            <div class="goals-macro-pill-pct">${goals.carbsPct}%</div>
          </div>
          <div class="goals-macro-pill">
            <div class="goals-macro-pill-name">Fat</div>
            <div class="goals-macro-pill-g">${g.fatG}<span style="font-size:11px;color:var(--muted);font-weight:500"> g</span></div>
            <div class="goals-macro-pill-pct">${goals.fatPct}%</div>
          </div>
        </div>`;
    }
    goalsCard.querySelector('#goalsEditBtn')?.addEventListener('click', () => renderGoalsEditForm(goals));
  }

  /** @param {GoalsType | null} existingGoals */
  function renderGoalsEditForm(existingGoals) {
    const snap5 = (/** @type {number} */ n) => Math.round(n / 5) * 5;
    const maintenance = existingGoals?.maintenanceKcal ?? existingGoals?.kcal ?? '';
    const calMode     = existingGoals?.calMode ?? 'deficit';

    // Mutable form state (JS variables)
    let magnitude = existingGoals?.calMagnitude ?? 500;
    let protPct   = snap5(existingGoals?.protPct  ?? 30);
    let carbsPct  = Math.min(snap5(existingGoals?.carbsPct ?? 40), 100 - protPct);
    let fatPct    = 100 - protPct - carbsPct;

    goalsCard.innerHTML = `
      <div class="goals-view-header" style="margin-bottom:12px">
        <span class="goals-view-title">Daily goals</span>
      </div>

      <div class="field">
        <label for="goalsMaintenanceKcal">Maintenance kcal / day</label>
        <input id="goalsMaintenanceKcal" data-testid="goalsMaintenanceKcal" type="number"
          min="500" max="9999" step="1" value="${$.esc(String(maintenance))}" placeholder="2500" />
      </div>

      <div class="goals-cal-row">
        <div class="goals-mode-toggle" id="goalsModeToggle">
          <button type="button" class="goals-mode-btn${calMode === 'deficit' ? ' active' : ''}" data-mode="deficit">Cutting</button>
          <button type="button" class="goals-mode-btn${calMode === 'surplus' ? ' active' : ''}" data-mode="surplus">Bulking</button>
        </div>
        <div class="goals-mag-inline">
          <button type="button" class="btn small" id="goalsMagMinus" aria-label="Decrease">−</button>
          <span class="goals-mag-inline-val"><span id="goalsMagnitudeVal">${magnitude}</span> kcal</span>
          <button type="button" class="btn small" id="goalsMagPlus" aria-label="Increase">+</button>
        </div>
      </div>

      <div class="goals-view-hero" style="padding:10px 0 8px; border-bottom:none; margin-bottom:0; margin-top:10px">
        <div class="goals-view-hero-label">Daily calorie target</div>
        <div>
          <span class="goals-view-hero-num" id="goalsTargetNum">—</span>
          <span class="goals-view-hero-unit">kcal</span>
        </div>
      </div>

      <div class="goals-section-label" style="margin-top:16px">Macros</div>

      <div class="goals-macro-bar-wrap" id="macroBarWrap">
        <div class="goals-macro-bar" id="macroBar">
          <div class="goals-macro-seg goals-macro-seg-prot" id="macroSegProt">
            <div class="goals-macro-seg-name">Protein</div>
            <div class="goals-macro-seg-pct" id="macroSegProtPct">${protPct}%</div>
            <div class="goals-macro-seg-g" id="macroSegProtG">— g</div>
          </div>
          <div class="goals-macro-seg goals-macro-seg-carbs" id="macroSegCarbs">
            <div class="goals-macro-seg-name">Carbs</div>
            <div class="goals-macro-seg-pct" id="macroSegCarbsPct">${carbsPct}%</div>
            <div class="goals-macro-seg-g" id="macroSegCarbsG">— g</div>
          </div>
          <div class="goals-macro-seg goals-macro-seg-fat" id="macroSegFat">
            <div class="goals-macro-seg-name">Fat</div>
            <div class="goals-macro-seg-pct" id="macroSegFatPct">${fatPct}%</div>
            <div class="goals-macro-seg-g" id="macroSegFatG">— g</div>
          </div>
        </div>
        <div class="goals-macro-handle" id="macroHandle1"></div>
        <div class="goals-macro-handle" id="macroHandle2"></div>
      </div>

      <!-- Hidden inputs: expose state for test automation via 'stepper-set' custom events -->
      <input type="hidden" data-testid="goalsMagnitude" id="goalsMagnitudeHidden" value="${magnitude}" />
      <input type="hidden" data-testid="goalsProtPct"   id="goalsProtHidden"      value="${protPct}" />
      <input type="hidden" data-testid="goalsCarbsPct"  id="goalsCarbsHidden"     value="${carbsPct}" />
      <input type="hidden" data-testid="goalsFatPct"    id="goalsFatHidden"       value="${fatPct}" />

      <div class="goals-actions">
        <button class="btn primary" id="goalsSaveBtn" data-testid="goalsSaveBtn" disabled>Save</button>
        <button class="btn" id="goalsCancelBtn" data-testid="goalsCancelBtn">Cancel</button>
      </div>
      ${existingGoals
        ? '<div class="goals-remove-action"><button class="btn ghost" id="goalsRemoveBtn" data-testid="goalsRemoveBtn" style="color:var(--bad); font-size:13px">Remove goals</button></div>'
        : ''}`;

    // --- DOM refs ---
    const maintenanceInput = $.input($.id('goalsMaintenanceKcal'));
    const modeToggle       = $.html($.id('goalsModeToggle'));
    const magnitudeValEl   = $.html($.id('goalsMagnitudeVal'));
    const targetNumEl      = $.html($.id('goalsTargetNum'));
    const barEl            = $.html($.id('macroBar'));
    const protSegEl        = $.html($.id('macroSegProt'));
    const carbsSegEl       = $.html($.id('macroSegCarbs'));
    const fatSegEl         = $.html($.id('macroSegFat'));
    const protPctEl        = $.html($.id('macroSegProtPct'));
    const carbsPctEl       = $.html($.id('macroSegCarbsPct'));
    const fatPctEl         = $.html($.id('macroSegFatPct'));
    const protGEl          = $.html($.id('macroSegProtG'));
    const carbsGEl         = $.html($.id('macroSegCarbsG'));
    const fatGEl           = $.html($.id('macroSegFatG'));
    const handle1El        = $.html($.id('macroHandle1'));
    const handle2El        = $.html($.id('macroHandle2'));
    const magnitudeHidden  = $.input($.id('goalsMagnitudeHidden'));
    const protHidden       = $.input($.id('goalsProtHidden'));
    const carbsHidden      = $.input($.id('goalsCarbsHidden'));
    const fatHidden        = $.input($.id('goalsFatHidden'));
    const saveBtn          = $.button($.id('goalsSaveBtn'));
    const cancelBtn        = $.button($.id('goalsCancelBtn'));

    /** @returns {'surplus'|'deficit'} */
    function getMode() {
      return /** @type {'surplus'|'deficit'} */ (
        /** @type {HTMLElement | null} */ (modeToggle.querySelector('.goals-mode-btn.active'))?.dataset.mode ?? 'deficit'
      );
    }

    function updateForm() {
      const maintenanceVal = Number(maintenanceInput.value) || 0;
      const sign           = getMode() === 'surplus' ? 1 : -1;
      const targetKcal     = maintenanceVal + sign * magnitude;

      // Magnitude + target hero
      magnitudeValEl.textContent = String(magnitude);
      targetNumEl.textContent    = targetKcal > 0 ? $.fmtNum(targetKcal, 0) : '—';

      // Macro bar segment proportions
      protSegEl.style.flex  = String(protPct);
      carbsSegEl.style.flex = String(carbsPct);
      fatSegEl.style.flex   = String(fatPct);

      // Macro text content
      protPctEl.textContent  = `${protPct}%`;
      carbsPctEl.textContent = `${carbsPct}%`;
      fatPctEl.textContent   = `${fatPct}%`;

      if (maintenanceVal > 0) {
        protGEl.textContent  = `${Math.round(targetKcal * protPct  / 100 / 4)} g`;
        carbsGEl.textContent = `${Math.round(targetKcal * carbsPct / 100 / 4)} g`;
        fatGEl.textContent   = `${Math.round(targetKcal * fatPct   / 100 / 9)} g`;
      } else {
        protGEl.textContent = carbsGEl.textContent = fatGEl.textContent = '— g';
      }

      // Narrow class hides label/g when segment is too small to show them
      protSegEl.classList.toggle('narrow', protPct   < 15);
      carbsSegEl.classList.toggle('narrow', carbsPct < 15);
      fatSegEl.classList.toggle('narrow', fatPct     < 15);

      // Handle positions (percentage of bar width)
      handle1El.style.left = `${protPct}%`;
      handle2El.style.left = `${protPct + carbsPct}%`;

      // Sync hidden state inputs (used by test automation)
      magnitudeHidden.value = String(magnitude);
      protHidden.value      = String(protPct);
      carbsHidden.value     = String(carbsPct);
      fatHidden.value       = String(fatPct);

      const maintenanceNum = Number(maintenanceInput.value);
      const valid = maintenanceInput.value !== ''
        && maintenanceNum >= 500 && maintenanceNum <= 9999 && Number.isInteger(maintenanceNum);
      saveBtn.disabled = !valid;
    }

    // Mode toggle
    modeToggle.querySelectorAll('.goals-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        modeToggle.querySelectorAll('.goals-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateForm();
      });
    });

    maintenanceInput.addEventListener('input', updateForm);

    // Magnitude stepper
    $.button($.id('goalsMagMinus')).addEventListener('click', () => {
      magnitude = Math.max(0, magnitude - 100);
      updateForm();
    });
    $.button($.id('goalsMagPlus')).addEventListener('click', () => {
      magnitude = Math.min(1200, magnitude + 100);
      updateForm();
    });
    magnitudeHidden.addEventListener('stepper-set', () => {
      magnitude = Number(magnitudeHidden.value) || 0;
      updateForm();
    });

    // Macro bar drag handles.
    // Handle 1 (protein/carbs boundary): dragging adjusts protPct; carbsPct takes the remainder; fatPct stays.
    // Handle 2 (carbs/fat boundary): dragging adjusts carbsPct; fatPct takes the remainder; protPct stays.
    /** @param {HTMLElement} handleEl @param {1|2} handleNum */
    function setupHandle(handleEl, handleNum) {
      handleEl.addEventListener('pointerdown', e => {
        e.preventDefault();
        handleEl.setPointerCapture(e.pointerId);
      });
      handleEl.addEventListener('pointermove', e => {
        if (!handleEl.hasPointerCapture(e.pointerId)) {return;}
        const rect    = barEl.getBoundingClientRect();
        const snapped = snap5(Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100)));
        if (handleNum === 1) {
          const newProt = Math.max(0, Math.min(100 - fatPct, snapped));
          if (newProt === protPct) {return;}
          protPct  = newProt;
          carbsPct = 100 - newProt - fatPct;
        } else {
          const newBoundary = Math.max(protPct, Math.min(100, snapped));
          const newCarbs    = newBoundary - protPct;
          if (newCarbs === carbsPct) {return;}
          carbsPct = newCarbs;
          fatPct   = 100 - protPct - newCarbs;
        }
        updateForm();
      });
    }
    setupHandle(handle1El, 1);
    setupHandle(handle2El, 2);

    // Hidden input 'stepper-set' events — programmatic control for test automation.
    // Protein: carbs/fat compensate proportionally.
    protHidden.addEventListener('stepper-set', () => {
      const newProt   = Math.max(0, Math.min(100, snap5(Number(protHidden.value) || 0)));
      const remaining = 100 - newProt;
      const prevCF    = carbsPct + fatPct;
      if (prevCF > 0) {
        const newCarbs = Math.round((remaining * carbsPct / prevCF) / 5) * 5;
        carbsPct = newCarbs;
        fatPct   = remaining - newCarbs;
      } else {
        carbsPct = Math.round(remaining / 2 / 5) * 5;
        fatPct   = remaining - carbsPct;
      }
      protPct = newProt;
      updateForm();
    });
    // Carbs: fat compensates.
    carbsHidden.addEventListener('stepper-set', () => {
      const newCarbs = Math.max(0, Math.min(100 - protPct, snap5(Number(carbsHidden.value) || 0)));
      carbsPct = newCarbs;
      fatPct   = 100 - protPct - newCarbs;
      updateForm();
    });
    // Fat: carbs compensates.
    fatHidden.addEventListener('stepper-set', () => {
      const newFat = Math.max(0, Math.min(100 - protPct, snap5(Number(fatHidden.value) || 0)));
      fatPct   = newFat;
      carbsPct = 100 - protPct - newFat;
      updateForm();
    });

    saveBtn.addEventListener('click', async () => {
      await Goals.save({
        maintenanceKcal: Number(maintenanceInput.value),
        calMode:         getMode(),
        calMagnitude:    magnitude,
        protPct,
        carbsPct,
        fatPct,
      });
      refreshGoals();
    });

    cancelBtn.addEventListener('click', () => refreshGoals());

    const removeBtnEl = document.getElementById('goalsRemoveBtn');
    if (removeBtnEl) {
      $.button(removeBtnEl).addEventListener('click', async () => {
        await Goals.remove();
        refreshGoals();
      });
    }

    updateForm(); // initial render
    goalsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    maintenanceInput.focus();
  }

  // -------------------------------------------------------------------------
  // Calorie adherence heatmap
  // -------------------------------------------------------------------------

  /** @type {HTMLElement | null} */
  let tooltipEl = null;
  /** @type {HTMLElement | null} */
  let activeDay = null;

  function hideTooltip() {
    tooltipEl?.classList.add('hidden');
    activeDay = null;
  }

  /** @param {HTMLElement} dayEl */
  function showTooltip(dayEl) {
    if (!tooltipEl) { return; }
    const { iso, status, kcal, goal } = dayEl.dataset;
    const date    = new Date((iso ?? '') + 'T00:00:00');
    const dateStr = date.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
    const STATUS_LABELS = /** @type {Record<string,string>} */ ({ ok: 'On target', warn: 'Close', bad: 'Off target' });

    let body = '';
    if (status === 'future') {
      body = '<div class="cal-tt-muted">Future</div>';
    } else if (kcal !== null && kcal !== undefined) {
      const kcalNum = Number(kcal);
      body = `<div class="cal-tt-kcal">${$.fmtNum(kcalNum, 0)} kcal</div>`;
      if (goal) {
        body += `<div class="cal-tt-muted">${$.fmtNum(Number(goal), 0)} target</div>`;
      }
      if (STATUS_LABELS[status ?? '']) {
        body += `<div class="cal-tt-status cal-tt-${status}">${STATUS_LABELS[status ?? '']}</div>`;
      }
    } else {
      body = '<div class="cal-tt-muted">No data</div>';
    }

    tooltipEl.innerHTML = `<div class="cal-tt-date">${$.esc(dateStr)}</div>${body}`;

    const rect   = dayEl.getBoundingClientRect();
    const cx     = rect.left + rect.width / 2;
    const spaceAbove = rect.top;
    const top    = spaceAbove > 80 ? rect.top - 8 : rect.bottom + 8;
    const anchor = spaceAbove > 80 ? 'bottom' : 'top';

    const tooltipLeft = Math.min(Math.max(8, cx - 68), window.innerWidth - 144);
    tooltipEl.style.left      = `${tooltipLeft}px`;
    tooltipEl.style.top       = `${top}px`;
    tooltipEl.style.transform = anchor === 'bottom' ? 'translateY(-100%)' : 'translateY(0)';
    tooltipEl.style.setProperty('--arrow-x', `${cx - tooltipLeft}px`);
    tooltipEl.dataset.anchor  = anchor;
    tooltipEl.classList.remove('hidden');
    activeDay = dayEl;
  }

  // Hide tooltip on click outside the heatmap card (registered once)
  document.addEventListener('click', e => {
    if (!(/** @type {HTMLElement} */ (e.target)).closest('#heatmapCard')) {
      hideTooltip();
    }
  });

  async function renderHeatmap() {
    const goals     = await Goals.get();
    const today     = $.isoToday();
    const NUM_WEEKS = 16;

    // Find the Monday of the week that started NUM_WEEKS-1 weeks ago
    const todayDate       = new Date(today + 'T00:00:00');
    const dayOfWeek       = todayDate.getDay(); // 0=Sun…6=Sat
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const startDate       = new Date(todayDate);
    startDate.setDate(todayDate.getDate() - daysSinceMonday - (NUM_WEEKS - 1) * 7);

    const fromISO = $.toISO(startDate);
    const meals   = await Meals.listRange(fromISO, today);

    /** @type {Record<string, number>} */
    const kcalByDay = {};
    for (const m of meals) {
      kcalByDay[m.date] = (kcalByDay[m.date] ?? 0) + m.foodSnapshot.kcal * m.multiplier;
    }

    /** @type {Array<Array<{iso:string, status:string, kcal:number|null}>>} */
    const weeks = [];
    for (let w = 0; w < NUM_WEEKS; w++) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const date     = new Date(startDate);
        date.setDate(startDate.getDate() + w * 7 + d);
        const iso      = $.toISO(date);
        const isFuture = iso > today;
        const kcal     = kcalByDay[iso] ?? null;
        let status     = 'empty';
        if (isFuture) {
          status = 'future';
        } else if (kcal !== null) {
          status = goals ? Goals.computeStatus(kcal, goals.kcal) : 'logged';
        }
        week.push({ iso, status, kcal });
      }
      weeks.push(week);
    }

    const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

    // Month header row: one cell per week column, label shown when month changes
    let lastMonth = '';
    const monthCells = weeks.map(week => {
      const monthName  = new Date(week[0].iso + 'T00:00:00').toLocaleString('en', { month: 'short' });
      const monthLabel = monthName !== lastMonth ? monthName : '';
      lastMonth = monthName;
      return `<div class="cal-month-cell">${$.esc(monthLabel)}</div>`;
    }).join('');
    const monthRowHtml = `<div class="cal-month-row"><div class="cal-dlabel-spacer"></div>${monthCells}</div>`;

    // One row per day of week; one square per week column
    const dayRowsHtml = DAY_LABELS.map((label, d) => {
      const squares = weeks.map(week => {
        const { iso, status, kcal } = week[d];
        const dataKcal = kcal !== null ? ` data-kcal="${Math.round(kcal)}"` : '';
        const dataGoal = goals ? ` data-goal="${goals.kcal}"` : '';
        return `<div class="cal-day cal-day-${status}" data-iso="${$.esc(iso)}" data-status="${status}"${dataKcal}${dataGoal}></div>`;
      }).join('');
      return `<div class="cal-day-row"><div class="cal-dlabel">${label}</div>${squares}</div>`;
    }).join('');

    const legendHtml = `
      <div class="cal-legend">
        <div class="cal-day cal-day-ok"></div><span>On target</span>
        <div class="cal-day cal-day-warn"></div><span>Close</span>
        <div class="cal-day cal-day-bad"></div><span>Off</span>
        <div class="cal-day cal-day-empty"></div><span>No data</span>
      </div>`;

    heatmapCard.innerHTML = `
      <div class="goals-view-header" style="margin-bottom:12px">
        <span class="goals-view-title">Calorie adherence</span>
      </div>
      <div class="cal-heatmap">
        ${monthRowHtml}
        ${dayRowsHtml}
      </div>
      ${legendHtml}
      <div class="cal-tooltip hidden" id="calTooltip"></div>
      ${!goals ? '<p class="muted" style="margin:10px 0 0;font-size:12px">Set daily targets above to see goal adherence.</p>' : ''}`;

    tooltipEl = $.html($.id('calTooltip'));
    activeDay = null;

    const grid = heatmapCard.querySelector('.cal-heatmap');
    if (!grid) { return; }

    // Desktop: hover (only on devices that support hover, to avoid synthetic mouse events on touch)
    if (window.matchMedia('(hover: hover)').matches) {
      grid.addEventListener('mouseover', e => {
        const day = /** @type {HTMLElement} */ (e.target).closest('.cal-day[data-iso]');
        if (day) { showTooltip(/** @type {HTMLElement} */ (day)); }
      });
      grid.addEventListener('mouseout', e => {
        const to = /** @type {HTMLElement | null} */ (e.relatedTarget);
        if (!to?.closest('.cal-day[data-iso]')) { hideTooltip(); }
      });
    }

    // Mobile: tap to toggle
    grid.addEventListener('click', e => {
      const day = /** @type {HTMLElement} */ (e.target).closest('.cal-day[data-iso]');
      if (!day) {
        hideTooltip();
        return;
      }
      if (activeDay === day) {
        hideTooltip();
        return;
      }
      showTooltip(/** @type {HTMLElement} */ (day));
    });
  }

  window.addEventListener('report-activate', () => {
    refreshGoals();
    renderHeatmap();
  });

  refreshGoals();
  renderHeatmap();
}

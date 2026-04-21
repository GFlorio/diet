import { Meals } from '../data.js';
import * as Goals from '../data-goals.js';
import * as $ from '../utils.js';

const NUM_WEEKS = 16;

/**
 * @typedef {import('../data-goals.js').GoalRecord} GoalRecord
 */

export function setupGoals() {
  const goalsCard    = $.html($.id('goalsCard'));
  const heatmapCard  = $.html($.id('heatmapCard'));

  // -------------------------------------------------------------------------
  // Goals card
  // -------------------------------------------------------------------------

  async function refreshGoals() {
    const [goals, allRecords] = await Promise.all([Goals.getActive(), Goals.list()]);
    renderGoalsCard(goals, allRecords);
    await renderHeatmap();
  }

  /**
   * @param {GoalRecord | null} goals
   * @param {GoalRecord[]} allRecords
   */
  function renderGoalsCard(goals, allRecords) {
    if (!goals) {
      goalsCard.innerHTML = `
        <div class="goals-view-header">
          <span class="goals-view-title">Daily goals</span>
        </div>
        <p style="margin:0 0 16px; font-size:14px; color:var(--muted)">No daily targets set yet.</p>
        <button class="btn small" id="goalsEditBtn" data-testid="goalsEditBtn">Set daily targets</button>`;
    } else {
      const g = Goals.derivedGrams(goals);
      const historyBtn = allRecords.length > 0
        ? `<button class="btn small ghost" id="goalHistoryBtn" data-testid="goalHistoryBtn"
             aria-label="Goal history" title="Goal history" style="min-width:36px;min-height:36px;padding:4px 8px;font-size:16px">&#x23F1;</button>`
        : '';
      goalsCard.innerHTML = `
        <div class="goals-view-header">
          <span class="goals-view-title">Daily goals</span>
          <div style="display:flex;gap:6px;margin-left:auto">
            ${historyBtn}
            <button class="btn small ghost" id="goalsEditBtn" data-testid="goalsEditBtn">Edit</button>
          </div>
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
    goalsCard.querySelector('#goalHistoryBtn')?.addEventListener('click', () => openHistoryPanel());
  }

  /** @param {GoalRecord | null} existingGoals */
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
        protGEl.textContent  = `${Math.round(targetKcal * protPct  / 100 / Goals.KCAL_PER_G_PROTEIN)} g`;
        carbsGEl.textContent = `${Math.round(targetKcal * carbsPct / 100 / Goals.KCAL_PER_G_CARBS)} g`;
        fatGEl.textContent   = `${Math.round(targetKcal * fatPct   / 100 / Goals.KCAL_PER_G_FAT)} g`;
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
        modeToggle.querySelectorAll('.goals-mode-btn').forEach(b => { b.classList.remove('active'); });
        btn.classList.add('active');
        updateForm();
      });
    });

    maintenanceInput.addEventListener('input', updateForm);
    maintenanceInput.addEventListener('change', updateForm);

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

    /** @param {number} prot @param {number} carbs @param {number} fat */
    function setMacros(prot, carbs, fat) {
      protPct = prot;
      carbsPct = carbs;
      fatPct = fat;
      updateForm();
    }

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
          setMacros(newProt, 100 - newProt - fatPct, fatPct);
        } else {
          const newBoundary = Math.max(protPct, Math.min(100, snapped));
          const newCarbs    = newBoundary - protPct;
          if (newCarbs === carbsPct) {return;}
          setMacros(protPct, newCarbs, 100 - protPct - newCarbs);
        }
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
      const newCarbs  = prevCF > 0
        ? Math.round((remaining * carbsPct / prevCF) / 5) * 5
        : Math.round(remaining / 2 / 5) * 5;
      setMacros(newProt, newCarbs, remaining - newCarbs);
    });
    // Carbs: fat compensates.
    carbsHidden.addEventListener('stepper-set', () => {
      const newCarbs = Math.max(0, Math.min(100 - protPct, snap5(Number(carbsHidden.value) || 0)));
      setMacros(protPct, newCarbs, 100 - protPct - newCarbs);
    });
    // Fat: carbs compensates.
    fatHidden.addEventListener('stepper-set', () => {
      const newFat = Math.max(0, Math.min(100 - protPct, snap5(Number(fatHidden.value) || 0)));
      setMacros(protPct, 100 - protPct - newFat, newFat);
    });

    saveBtn.addEventListener('click', async () => {
      try {
        await Goals.save({
          maintenanceKcal: Number(maintenanceInput.value),
          calMode:         getMode(),
          calMagnitude:    magnitude,
          protPct,
          carbsPct,
          fatPct,
        });
        await refreshGoals();
      } catch (e) {
        $.toast('Failed to save goals — please try again.', { type: 'error' });
        throw e;
      }
    });

    cancelBtn.addEventListener('click', () => refreshGoals());

    const removeBtnEl = document.getElementById('goalsRemoveBtn');
    if (removeBtnEl) {
      $.button(removeBtnEl).addEventListener('click', async () => {
        await Goals.remove();
        await refreshGoals();
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
    const { iso, status, kcal, goal, goalSince } = dayEl.dataset;
    const date    = $.localDate(iso ?? '');
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
      if (goalSince) {
        const sinceDate = $.localDate(goalSince);
        const sinceStr  = sinceDate.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
        body += `<div class="cal-tt-muted">Goal since ${$.esc(sinceStr)}</div>`;
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
    const allGoalRecords = await Goals.list();
    const today     = $.isoToday();
    const todayGoal = Goals.goalForDate(allGoalRecords, today);

    // Find the Monday of the week that started NUM_WEEKS-1 weeks ago
    const todayDate       = $.localDate(today);
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

    /** @type {Array<Array<{iso:string, status:string, kcal:number|null, cellGoal: import('../data-goals.js').GoalRecord|null}>>} */
    const weeks = [];
    for (let w = 0; w < NUM_WEEKS; w++) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const date     = new Date(startDate);
        date.setDate(startDate.getDate() + w * 7 + d);
        const iso      = $.toISO(date);
        const isFuture = iso > today;
        const kcal     = kcalByDay[iso] ?? null;
        const cellGoal = Goals.goalForDate(allGoalRecords, iso);
        let status     = 'empty';
        if (isFuture) {
          status = 'future';
        } else if (kcal !== null) {
          status = Goals.computeStatus(kcal, cellGoal?.kcal ?? null);
        }
        week.push({ iso, status, kcal, cellGoal });
      }
      weeks.push(week);
    }

    const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

    // Month header row: one cell per week column, label shown when month changes
    let lastMonth = '';
    const monthCells = weeks.map(week => {
      const monthName  = $.localDate(week[0].iso).toLocaleString('en', { month: 'short' });
      const monthLabel = monthName !== lastMonth ? monthName : '';
      lastMonth = monthName;
      return `<div class="cal-month-cell">${$.esc(monthLabel)}</div>`;
    }).join('');
    const monthRowHtml = `<div class="cal-month-row"><div class="cal-dlabel-spacer"></div>${monthCells}</div>`;

    // One row per day of week; one square per week column
    const dayRowsHtml = DAY_LABELS.map((label, d) => {
      const squares = weeks.map(week => {
        const { iso, status, kcal, cellGoal } = week[d];
        const dataKcal    = kcal !== null ? ` data-kcal="${Math.round(kcal)}"` : '';
        const dataGoal    = cellGoal ? ` data-goal="${cellGoal.kcal}"` : '';
        // Show "Goal since" hint only when this cell's goal differs from today's active goal
        const dataGoalSince = (cellGoal && cellGoal.id !== todayGoal?.id)
          ? ` data-goal-since="${$.esc(cellGoal.effectiveFrom)}"`
          : '';
        return `<div class="cal-day cal-day-${status}" data-iso="${$.esc(iso)}" data-status="${status}"${dataKcal}${dataGoal}${dataGoalSince}></div>`;
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
      ${allGoalRecords.length === 0 ? '<p class="muted" style="margin:10px 0 0;font-size:12px">Set daily targets above to see goal adherence.</p>' : ''}`;

    tooltipEl = $.html($.id('calTooltip'));
    activeDay = null;

    const grid = heatmapCard.querySelector('.cal-heatmap');
    if (!grid) { return; }

    // Desktop: hover (only on devices that support hover, to avoid synthetic mouse events on touch)
    if (window.matchMedia($.MEDIA_HOVER).matches) {
      grid.addEventListener('mouseover', e => {
        const day = /** @type {HTMLElement} */ (e.target).closest('.cal-day[data-iso]');
        if (day) { showTooltip(/** @type {HTMLElement} */ (day)); }
      });
      grid.addEventListener('mouseout', e => {
        const to = /** @type {HTMLElement | null} */ ((/** @type {MouseEvent} */ (e)).relatedTarget);
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

  // -------------------------------------------------------------------------
  // Goal history panel
  // -------------------------------------------------------------------------

  function openHistoryPanel() {
    let panelEl = /** @type {HTMLDialogElement|null} */ (document.getElementById('goalHistoryPanel'));
    if (!panelEl) {
      panelEl = document.createElement('dialog');
      panelEl.id = 'goalHistoryPanel';
      panelEl.className = 'goal-history-dialog';
      document.body.appendChild(panelEl);

      // Close on backdrop click
      panelEl.addEventListener('click', e => {
        if (e.target === panelEl) { panelEl?.close(); }
      });
    }
    void renderHistoryPanel(panelEl);
    panelEl.showModal();
  }

  /** @param {HTMLDialogElement} panelEl */
  async function renderHistoryPanel(panelEl) {
    const records = await Goals.list();

    /** @param {GoalRecord} r @param {boolean} isActive @param {boolean} isLast */
    const rowHtml = (r, isActive, isLast) => {
      const g = Goals.derivedGrams(r);
      const badge = isActive
        ? '<span class="goal-history-badge">Active</span>'
        : '';
      return `
        <div class="goal-history-row" data-id="${$.esc(r.id)}">
          <div class="goal-history-row-header">
            ${badge}
            <label class="goal-history-from-label">From</label>
            <input type="date" class="goal-history-date" value="${$.esc(r.effectiveFrom)}" data-original="${$.esc(r.effectiveFrom)}" />
            <button class="btn small ghost goal-history-delete" aria-label="Delete goal" title="Delete"
              style="margin-left:auto;min-width:36px;min-height:36px;color:var(--muted)"
              ${isLast ? 'data-last="true"' : ''}>🗑</button>
          </div>
          <div class="goal-history-summary">${$.fmtNum(r.kcal, 0)} kcal · ${r.protPct}P / ${r.carbsPct}C / ${r.fatPct}F · ${g.protG} g protein</div>
          <div class="goal-history-date-error hidden" style="font-size:12px;color:var(--bad);margin-top:4px"></div>
        </div>`;
    };

    const todayISO = $.isoToday();
    const activeId = Goals.goalForDate(records, todayISO)?.id ?? null;
    const rowsHtml = records.map((r, i) =>
      rowHtml(r, r.id === activeId, records.length === 1 && i === 0)
    ).join('<hr class="goal-history-sep">');

    panelEl.innerHTML = `
      <div class="goal-history-inner">
        <div class="goal-history-header">
          <span class="goal-history-title">Goal history</span>
          <button class="btn small ghost goal-history-close" aria-label="Close" style="min-width:36px;min-height:36px">✕</button>
        </div>
        <div class="goal-history-list" data-testid="goalHistoryList">
          ${rowsHtml || '<p style="color:var(--muted);font-size:14px;margin:0">No goal history.</p>'}
        </div>
      </div>`;

    panelEl.querySelector('.goal-history-close')?.addEventListener('click', () => panelEl.close());

    // Date change handlers
    panelEl.querySelectorAll('.goal-history-date').forEach(inputEl => {
      const input = /** @type {HTMLInputElement} */ (inputEl);
      const row   = /** @type {HTMLElement} */ (input.closest('.goal-history-row'));
      const errEl = /** @type {HTMLElement} */ (row.querySelector('.goal-history-date-error'));
      input.addEventListener('change', async () => {
        const id         = row.dataset.id ?? '';
        const newDate    = input.value;
        const original   = input.dataset.original ?? '';
        try {
          await Goals.updateEffectiveFrom(id, newDate);
          input.dataset.original = newDate;
          errEl.textContent = '';
          errEl.classList.add('hidden');
          await renderHistoryPanel(panelEl);
          await renderHeatmap();
        } catch (e) {
          input.value = original;
          errEl.textContent = /** @type {Error} */ (e).message;
          errEl.classList.remove('hidden');
        }
      });
    });

    // Delete handlers
    panelEl.querySelectorAll('.goal-history-delete').forEach(btnEl => {
      const btn = /** @type {HTMLElement} */ (btnEl);
      const row = /** @type {HTMLElement} */ (btn.closest('.goal-history-row'));
      btn.addEventListener('click', async () => {
        const id     = row.dataset.id ?? '';
        const isLast = btn.dataset.last === 'true';
        if (isLast) {
          // Inline confirmation for last record
          const confirmEl = row.querySelector('.goal-history-confirm');
          if (confirmEl) {
            confirmEl.remove();
            return;
          }
          const div  = document.createElement('div');
          div.className = 'goal-history-confirm';
          div.style.cssText = 'font-size:13px;color:var(--muted);margin-top:8px;display:flex;gap:8px;align-items:center';
          div.innerHTML = '<span>This will remove all your goals.</span><button class="btn small ghost" style="color:var(--bad)">Confirm</button>';
          div.querySelector('button')?.addEventListener('click', async () => {
            await Goals.deleteRecord(id);
            panelEl.close();
            await refreshGoals();
          });
          row.appendChild(div);
          return;
        }
        await Goals.deleteRecord(id);
        await renderHistoryPanel(panelEl);
        await renderHeatmap();
      });
    });

  }

  window.addEventListener('goals-activate', () => {
    void refreshGoals();
    void renderHeatmap();
  });

  void refreshGoals();
  void renderHeatmap();
}

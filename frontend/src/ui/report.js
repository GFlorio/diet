import * as $ from '../utils.js';
import { Meals } from '../data.js';
import * as Goals from '../data-goals.js';

/**
 * @typedef {import('../data.js').Meal} Meal
 * @typedef {import('../data.js').Macros} Macros
 * @typedef {import('../data-goals.js').Goals} GoalsType
 * @typedef {import('../data-goals.js').WindowVM} WindowVM
 * @typedef {import('../data-goals.js').MacroWindow} MacroWindow
 */

export function setupReport() {
  const goalsCard  = $.html($.id('goalsCard'));
  const windowCard = $.html($.id('windowCard'));
  const repFrom    = $.input($.id('repFrom'));
  const repTo      = $.input($.id('repTo'));
  const repTable   = $.html($.id('repTable'));

  /** @type {(d: string, n: number) => string} */
  const shiftDay = (d, n) => {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + n);
    return $.toISO(dt);
  };
  repTo.value   = $.isoToday();
  repFrom.value = shiftDay(repTo.value, -6);
  repFrom.addEventListener('change', renderReport);
  repTo.addEventListener('change', renderReport);

  // -------------------------------------------------------------------------
  // Goals card
  // -------------------------------------------------------------------------

  async function refreshGoals() {
    const goals    = await Goals.get();
    const windowVM = await Goals.computeWindowVM($.isoToday(), goals);
    renderGoalsCard(goals);
    renderWindowCard(goals, windowVM);
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
        if (!handleEl.hasPointerCapture(e.pointerId)) return;
        const rect    = barEl.getBoundingClientRect();
        const snapped = snap5(Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100)));
        if (handleNum === 1) {
          const newProt = Math.max(0, Math.min(100 - fatPct, snapped));
          if (newProt === protPct) return;
          protPct  = newProt;
          carbsPct = 100 - newProt - fatPct;
        } else {
          const newBoundary = Math.max(protPct, Math.min(100, snapped));
          const newCarbs    = newBoundary - protPct;
          if (newCarbs === carbsPct) return;
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
  // Window card
  // -------------------------------------------------------------------------

  /**
   * @param {GoalsType | null} goals
   * @param {WindowVM | null} windowVM
   */
  function renderWindowCard(goals, windowVM) {
    if (!goals) {
      windowCard.innerHTML = '<div class="muted" style="font-size:13px">Set daily targets above to see your 7-day average.</div>';
      return;
    }
    if (!windowVM) {
      windowCard.innerHTML = `
        <div class="row"><strong>7-day average</strong></div>
        <div class="muted" style="margin-top:6px; font-size:13px">Log meals to see your 7-day average.</div>`;
      return;
    }

    const { windowDays, dataWarning, calories, protein, carbs, fat } = windowVM;

    /** @param {MacroWindow} m @param {string} label @param {string} unit */
    const row = (m, label, unit) => `
      <div class="item">
        <div>
          <span>${label}</span>
          <span class="muted"> · ${$.fmtNum(m.avgConsumed, 0)} / ${$.fmtNum(m.target ?? 0, 0)} ${unit}</span>
        </div>
        <span class="status-dot ${m.status}"></span>
      </div>`;

    windowCard.innerHTML = `
      <div class="row">
        <strong>7-day average</strong>
        <span class="muted right">${windowDays} of 7 days</span>
      </div>
      <div class="list" style="margin-top:8px">
        ${row(calories, 'Calories', 'kcal')}
        ${row(protein,  'Protein',  'g')}
        ${row(carbs,    'Carbs',    'g')}
        ${row(fat,      'Fat',      'g')}
      </div>
      ${dataWarning
        ? `<div class="muted" style="margin-top:8px; font-size:12px">Based on ${windowDays} of 7 days — log more meals for a meaningful average.</div>`
        : ''}`;
  }

  // -------------------------------------------------------------------------
  // Date-range report (existing)
  // -------------------------------------------------------------------------

  async function renderReport() {
    const from = repFrom.value;
    const to   = repTo.value;
    if (!from || !to) { return; }
    if (from > to) {
      $.toast('Invalid range', { type: 'error' }); return;
    }
    const inRange = /** @type {Meal[]} */ (await Meals.listRange(from, to));
    /** @type {Record<string, Macros>} */
    const days = {};
    for (const m of inRange) {
      const k = m.date;
      const s = m.foodSnapshot;
      const q = m.multiplier;
      if (!days[k]) { days[k] = { kcal: 0, prot: 0, carbs: 0, fats: 0 }; }
      days[k].kcal  += s.kcal  * q;
      days[k].prot  += s.prot  * q;
      days[k].carbs += s.carbs * q;
      days[k].fats  += s.fats  * q;
    }
    /** @type {Array<[string, Macros]>} */
    const rows = Object.keys(days).sort().map((d) => [d, days[d]]);
    const rowsHtml = rows.length
      ? rows.map(([d, t]) => `
        <div class="item rep-row">
          <div>${d}</div>
          <div class="right">${$.fmtNum(t.kcal, 0)}</div>
          <div class="right">${$.fmtNum(t.prot)}</div>
          <div class="right">${$.fmtNum(t.carbs)}</div>
          <div class="right">${$.fmtNum(t.fats)}</div>
        </div>`).join('')
      : '<div class="muted">No meals in range.</div>';
    repTable.innerHTML = `
      <div class="item rep-row">
        <strong>Day</strong>
        <strong class="right">kcal</strong>
        <strong class="right">P</strong>
        <strong class="right">C</strong>
        <strong class="right">F</strong>
      </div>
      ${rowsHtml}`;
  }

  window.addEventListener('report-activate', () => { refreshGoals(); renderReport(); });

  refreshGoals();
  renderReport();
}

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
    const calMode     = existingGoals?.calMode     ?? 'deficit';
    const magnitude   = existingGoals?.calMagnitude ?? 500;
    const prot        = snap5(existingGoals?.protPct  ?? 30);
    const carbs       = Math.min(snap5(existingGoals?.carbsPct ?? 40), 100 - prot);
    const fat         = 100 - prot - carbs;

    goalsCard.innerHTML = `
      <div class="goals-view-header" style="margin-bottom:16px">
        <span class="goals-view-title">Daily goals</span>
      </div>

      <div class="goals-section-label">Calorie target</div>

      <div class="field">
        <label for="goalsMaintenanceKcal">Maintenance kcal / day</label>
        <input id="goalsMaintenanceKcal" data-testid="goalsMaintenanceKcal" type="number"
          min="500" max="9999" step="1" value="${$.esc(String(maintenance))}" placeholder="2500" />
      </div>

      <div style="margin-top:10px">
        <div class="goals-mode-toggle" id="goalsModeToggle">
          <button type="button" class="goals-mode-btn${calMode === 'deficit' ? ' active' : ''}" data-mode="deficit">Cutting</button>
          <button type="button" class="goals-mode-btn${calMode === 'surplus' ? ' active' : ''}" data-mode="surplus">Bulking</button>
        </div>
      </div>
      <div class="row nowrap" style="gap:8px; align-items:center; margin-top:10px">
        <input id="goalsMagnitude" data-testid="goalsMagnitude" type="range"
          min="0" max="1200" step="100" value="${magnitude}" style="flex:1" />
        <input id="goalsMagnitudeNum" data-testid="goalsMagnitudeNum" type="number"
          min="0" max="1200" step="100" value="${magnitude}" class="goals-magnitude-num" />
      </div>

      <div class="goals-target-result">
        <div class="goals-target-result-label">Daily calorie target</div>
        <div>
          <span class="goals-target-result-num" id="goalsTargetNum">—</span>
          <span class="goals-target-result-unit">kcal / day</span>
        </div>
      </div>

      <div class="goals-section-label" style="margin-top:24px">Macros</div>

      <div class="goals-macro">
        <div class="row" style="justify-content:space-between">
          <span>Protein</span>
          <span style="font-size:15px; font-weight:600"><span id="goalsProtPctDisplay"></span>%<span id="goalsProtG" class="muted" style="font-size:13px; font-weight:400"></span></span>
        </div>
        <input id="goalsProtPct" data-testid="goalsProtPct" type="range" min="0" max="100" step="5" value="${prot}" />
      </div>
      <div class="goals-macro">
        <div class="row" style="justify-content:space-between">
          <span>Carbs</span>
          <span style="font-size:15px; font-weight:600"><span id="goalsCarbsPctDisplay"></span>%<span id="goalsCarbsG" class="muted" style="font-size:13px; font-weight:400"></span></span>
        </div>
        <input id="goalsCarbsPct" data-testid="goalsCarbsPct" type="range" min="0" max="100" step="5" value="${carbs}" />
      </div>
      <div class="goals-macro">
        <div class="row" style="justify-content:space-between">
          <span>Fat</span>
          <span style="font-size:15px; font-weight:600"><span id="goalsFatPctDisplay"></span>%<span id="goalsFatG" class="muted" style="font-size:13px; font-weight:400"></span></span>
        </div>
        <input id="goalsFatPct" data-testid="goalsFatPct" type="range" min="0" max="100" step="5" value="${fat}" />
      </div>

      <div class="goals-actions">
        <button class="btn primary" id="goalsSaveBtn" data-testid="goalsSaveBtn" disabled>Save</button>
        <button class="btn" id="goalsCancelBtn" data-testid="goalsCancelBtn">Cancel</button>
      </div>
      ${existingGoals
        ? '<div class="goals-remove-action"><button class="btn ghost" id="goalsRemoveBtn" data-testid="goalsRemoveBtn" style="color:var(--bad); font-size:13px">Remove goals</button></div>'
        : ''}`;

    // --- Wire up inputs ---
    const maintenanceInput = $.input($.id('goalsMaintenanceKcal'));
    const modeToggle       = $.html($.id('goalsModeToggle'));
    const magnitudeSlider  = $.input($.id('goalsMagnitude'));
    const magnitudeNum     = $.input($.id('goalsMagnitudeNum'));
    const targetNumEl      = $.html($.id('goalsTargetNum'));
    const protSlider       = $.input($.id('goalsProtPct'));
    const carbsSlider      = $.input($.id('goalsCarbsPct'));
    const fatSlider        = $.input($.id('goalsFatPct'));
    const protPctDisplay   = $.html($.id('goalsProtPctDisplay'));
    const carbsPctDisplay  = $.html($.id('goalsCarbsPctDisplay'));
    const fatPctDisplay    = $.html($.id('goalsFatPctDisplay'));
    const protGEl          = $.html($.id('goalsProtG'));
    const carbsGEl         = $.html($.id('goalsCarbsG'));
    const fatGEl           = $.html($.id('goalsFatG'));
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
      const mag            = Number(magnitudeSlider.value);
      const mode           = getMode();
      const sign           = mode === 'surplus' ? 1 : -1;
      const targetKcal     = maintenanceVal + sign * mag;
      const protVal        = Number(protSlider.value);
      const carbsVal       = Number(carbsSlider.value);
      const fatVal         = Number(fatSlider.value);

      // Target result hero
      targetNumEl.textContent = maintenanceVal > 0 ? $.fmtNum(targetKcal, 0) : '—';

      // Pct displays
      protPctDisplay.textContent  = String(protVal);
      carbsPctDisplay.textContent = String(carbsVal);
      fatPctDisplay.textContent   = String(fatVal);

      // Gram hints — always shown; placeholder when maintenance not yet entered
      if (maintenanceVal > 0) {
        protGEl.textContent  = ` · ${Math.round(targetKcal * protVal  / 100 / 4)} g`;
        carbsGEl.textContent = ` · ${Math.round(targetKcal * carbsVal / 100 / 4)} g`;
        fatGEl.textContent   = ` · ${Math.round(targetKcal * fatVal   / 100 / 9)} g`;
      } else {
        protGEl.textContent = carbsGEl.textContent = fatGEl.textContent = ' · — g';
      }

      // Save button: valid when maintenance is a valid integer in [500, 9999]
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

    // Magnitude: two-way sync between slider and number box
    magnitudeSlider.addEventListener('input', () => {
      magnitudeNum.value = magnitudeSlider.value;
      updateForm();
    });
    magnitudeNum.addEventListener('change', () => {
      const snapped = Math.min(1200, Math.max(0, Math.round((Number(magnitudeNum.value) || 0) / 100) * 100));
      magnitudeNum.value    = String(snapped);
      magnitudeSlider.value = String(snapped);
      updateForm();
    });

    // Protein slider: carbs and fat compensate proportionally, snapped to 5%
    protSlider.addEventListener('input', () => {
      const newProt   = Number(protSlider.value);
      const prevCarbs = Number(carbsSlider.value);
      const prevFat   = Number(fatSlider.value);
      const remaining = 100 - newProt;
      const prevCF    = prevCarbs + prevFat;
      let newCarbs, newFat;
      if (prevCF > 0) {
        newCarbs = Math.round((remaining * prevCarbs / prevCF) / 5) * 5;
        newFat   = remaining - newCarbs;
      } else {
        newCarbs = Math.round(remaining / 2 / 5) * 5;
        newFat   = remaining - newCarbs;
      }
      carbsSlider.value = String(newCarbs);
      fatSlider.value   = String(newFat);
      updateForm();
    });

    // Carbs slider: fat compensates
    carbsSlider.addEventListener('input', () => {
      const protVal  = Number(protSlider.value);
      const newCarbs = Math.min(Number(carbsSlider.value), 100 - protVal);
      carbsSlider.value = String(newCarbs);
      fatSlider.value   = String(100 - protVal - newCarbs);
      updateForm();
    });

    // Fat slider: carbs compensates
    fatSlider.addEventListener('input', () => {
      const protVal = Number(protSlider.value);
      const newFat  = Math.min(Number(fatSlider.value), 100 - protVal);
      fatSlider.value   = String(newFat);
      carbsSlider.value = String(100 - protVal - newFat);
      updateForm();
    });

    saveBtn.addEventListener('click', async () => {
      await Goals.save({
        maintenanceKcal: Number(maintenanceInput.value),
        calMode:         getMode(),
        calMagnitude:    Number(magnitudeSlider.value),
        protPct:         Number(protSlider.value),
        carbsPct:        Number(carbsSlider.value),
        fatPct:          Number(fatSlider.value),
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

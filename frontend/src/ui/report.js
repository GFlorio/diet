import * as $ from '../utils.js';
import { Meals } from '../data.js';

/**
 * @typedef {import('../data.js').Meal} Meal
 * @typedef {import('../data.js').Macros} Macros
 */
export function setupReport(){
  const repFrom = /** @type {HTMLInputElement} */ (document.getElementById('repFrom'));
  const repTo = /** @type {HTMLInputElement} */ (document.getElementById('repTo'));
  const repRefresh = /** @type {HTMLButtonElement} */ (document.getElementById('repRefresh'));
  const repTable = /** @type {HTMLElement} */ (document.getElementById('repTable'));
  /** @type {(d: string, n: number) => string} */
  const shiftDay = (d, n) => {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + n);
    return $.toISO(dt);
  };
  repTo.value = $.isoToday();
  repFrom.value = shiftDay(repTo.value, -6);
  repRefresh.addEventListener('click', renderReport);

  async function renderReport() {
    const from = repFrom.value;
    const to = repTo.value;
    if (!from || !to) { return; }
    if (from > to) {
      alert('Invalid range'); return;
    }
    const inRange = /** @type {Meal[]} */ (await Meals.listRange(from, to));
    /** @type {Record<string, Macros>} */
    const days = {};
    for (const m of inRange) {
      const k = m.date;
      const s = m.foodSnapshot;
      const q = m.multiplier;
      if (!days[k]) {
        days[k] = { kcal: 0, prot: 0, carbs: 0, fats: 0 };
      }
      days[k].kcal += s.kcal * q;
      days[k].prot += s.prot * q;
      days[k].carbs += s.carbs * q;
      days[k].fats += s.fats * q;
    }
    /** @type {Array<[string, Macros]>} */
    const rows = Object.keys(days)
      .sort()
      .map((d) => [d, days[d]]);
    repTable.innerHTML = `
      <div class="item" style="grid-template-columns: 1fr 80px 80px 80px 80px">
        <strong>Day</strong><strong class="right">kcal</strong><strong class="right">P</strong><strong class="right">C</strong><strong class="right">F</strong>
      </div>
      ${
        rows.length
          ? rows
              .map(
                ([d, t]) => `
       <div class="item" style="grid-template-columns: 1fr 80px 80px 80px 80px">
         <div>${d}</div>
         <div class="right">${$.fmtNum(t.kcal, 0)}</div>
         <div class="right">${$.fmtNum(t.prot)}</div>
         <div class="right">${$.fmtNum(t.carbs)}</div>
         <div class="right">${$.fmtNum(t.fats)}</div>
       </div>`
              )
              .join('')
          : '<div class="muted">No meals in range.</div>'
      }
    `;
  }

  renderReport();
}

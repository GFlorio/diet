/**
 * Selects the first element matching the selector within the root.
 * @param {string} sel
 * @param {Document|Element} [root=document]
 * @returns {Element}
 */
export const sel = (sel, root = document) => assertEl(root.querySelector(sel));


/**
 * Selects the first element matching the selector within the root.
 * @param {string} id
 * @returns {Element}
 */
export const id = (id) => assertEl(document.getElementById(id));

/**
 * Selects all elements matching the selector within the root.
 * @param {string} sel
 * @param {Document|Element} [root=document]
 * @returns {Element[]}
 */
export const arr = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Asserts that the given object is a non-nullish Element.
 * @template T
 * @param {T|null|undefined} obj
 * @returns {Element}
 */
export function assertEl(obj) {
	if (obj === null || obj === undefined) {throw new Error(`Object ${obj} is nullish!`);}
    if (!(obj instanceof Element)) {throw new Error(`Object ${obj} is not an Element!`);}
    return obj;
}

/**
 * Show a given page and toggle tabs.
 * @param {'meals'|'foods'|'goals'} page
 */
export function showPage(page){
  const pages = ['meals', 'foods', 'goals'];
  arr('.tab').forEach(t => html(t).classList.toggle('active', html(t).dataset.page === page));
  pages.forEach(p =>
    html(document.getElementById('page-' + p)).classList.toggle('hidden', p !== page));
}

/** Format macro nutrients meta string
 * @param {number} kcal
 * @param {number} prot
 * @param {number} carbs
 * @param {number} fats
 */
export function nutrMeta(kcal, prot, carbs, fats){
  return `${fmtNum(kcal,0)} kcal · Prot ${fmtNum(prot)}g · Carbs ${fmtNum(carbs)}g · Fat ${fmtNum(fats)}g`;
}

/**
 * Asserts that an element is an instance of the given constructor.
 * @template {abstract new (...args: any) => Element} C
 * @param {Element|null} el
 * @param {C} Ctor
 * @param {string} label
 * @returns {InstanceType<C>}
 */
function castEl(el, Ctor, label) {
    if (el instanceof Ctor) { return /** @type {InstanceType<C>} */ (el); }
    throw new Error(`Element is not an ${label}`);
}

/**
 * Returns the element as a HTMLElement.
 * @param {Element|null} el
 * @returns {HTMLElement}
 */
export function html(el) { return castEl(el, HTMLElement, 'HTML element'); }

/**
 * Returns the element as a HTMLInputElement.
 * @param {Element|null} el
 * @returns {HTMLInputElement}
 */
export function input(el) { return castEl(el, HTMLInputElement, 'HTML input element'); }

/**
 * Returns the element as a HTMLFormElement.
 * @param {Element|null} el
 * @returns {HTMLFormElement}
 */
export function form(el) { return castEl(el, HTMLFormElement, 'HTML form element'); }

/**
 * Returns the element as a HTMLButtonElement.
 * @param {Element|null} el
 * @returns {HTMLButtonElement}
 */
export function button(el) { return castEl(el, HTMLButtonElement, 'HTML button element'); }

/**
 * Returns the element as a HTMLSelectElement.
 * @param {Element|null} el
 * @returns {HTMLSelectElement}
 */
export function select(el) { return castEl(el, HTMLSelectElement, 'HTML select element'); }


/**
 * Formats a number to a fixed decimal, removing trailing zeros.
 * @param {number} n
 * @param {number} [d=1]
 * @returns {string}
 */
export const fmtNum = (n, d = 1) => Number(n).toFixed(d).replace(/\.0+$/, '');

/**
 * Returns today's date in ISO format (YYYY-MM-DD).
 * @returns {string}
 */
export const isoToday = () => new Date().toISOString().slice(0, 10);

/**
 * Converts a date to ISO format (YYYY-MM-DD).
 * @param {string|Date} d
 * @returns {string}
 */
export const toISO = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * Returns the current timestamp in milliseconds.
 * @returns {number}
 */
export const now = () => Date.now();

/**
 * Returns a comparator function for sorting by key k.
 * @param {string} k
 * @returns {(a: {[key: string]: any}, b: {[key: string]: any}) => number}
 */
export const by = (k) => (a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0);

/**
 * Escapes HTML special characters in a string.
 * @param {string} [s='']
 * @returns {string}
 */
export const esc = (s = '') => ('' + s).replace(/[&<>"']/g, c => ({
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
}[c] || ''));

/**
 * @typedef {{ label: string, callback: () => void }} ToastAction
 */

/**
 * Show a non-blocking toast message fixed below the header.
 * Dismissable via X button, swipe, or auto-removal after `duration` ms.
 * @param {string} msg
 * @param {{ type?: 'error'|'', duration?: number, action?: ToastAction }} [opts]
 */
export function toast(msg, { type = '', duration = 3000, action } = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.setAttribute('role', 'status');

  const text = document.createElement('span');
  text.className = 'toast-msg';
  text.textContent = msg;
  el.appendChild(text);

  if (action) {
    const btn = document.createElement('button');
    btn.className = 'btn small';
    const isDesktop = window.matchMedia('(hover: hover)').matches;
    btn.textContent = isDesktop ? `${action.label} (Y)` : action.label;
    btn.addEventListener('click', () => {
      action.callback();
      dismiss();
    });
    el.appendChild(btn);

    function onKey(/** @type {KeyboardEvent} */ e) {
      if (dismissed) {
        document.removeEventListener('keydown', onKey); return;
      }
      if (e.key !== 'y' && e.key !== 'Y') { return; }
      const tag = /** @type {HTMLElement} */ (e.target).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { return; }
      e.preventDefault();
      document.removeEventListener('keydown', onKey);
      btn.click();
    }
    document.addEventListener('keydown', onKey);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.setAttribute('aria-label', 'Dismiss');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', dismiss);
  el.appendChild(closeBtn);

  document.body.appendChild(el);

  let dismissed = false;
  const timer = setTimeout(dismiss, duration);

  function dismiss() {
    if (dismissed) { return; }
    dismissed = true;
    clearTimeout(timer);
    el.remove();
  }

  /** @param {1|-1} dir */
  function dismissToSide(dir) {
    if (dismissed) { return; }
    dismissed = true;
    clearTimeout(timer);
    el.style.transition = 'transform .25s ease-in, opacity .25s ease-in';
    el.style.transform = `translateX(calc(-50% + ${dir * 110}vw))`;
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 270);
  }

  let startX = 0;

  el.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    el.style.transition = 'none';
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    const delta = e.touches[0].clientX - startX;
    el.style.transform = `translateX(calc(-50% + ${delta}px))`;
    el.style.opacity = String(Math.max(0, 1 - Math.abs(delta) / 200));
  }, { passive: true });

  el.addEventListener('touchend', (e) => {
    const delta = e.changedTouches[0].clientX - startX;
    if (Math.abs(delta) > 80) {
      dismissToSide(delta > 0 ? 1 : -1);
    } else {
      el.style.transition = 'transform .2s ease-out, opacity .2s ease-out';
      el.style.transform = 'translateX(-50%)';
      el.style.opacity = '1';
    }
  }, { passive: true });
}

/**
 * Debounce a function; returns a wrapper that delays invocation until after ms have elapsed
 * since the last call.
 * @template {any[]} A
 * @param {(...args: A) => void} fn
 * @param {number} [ms=300]
 * @returns {(...args: A) => void}
 */
export function debounce(fn, ms = 300){
    /** @type {number|undefined} */
    let t;
    return (...args) => {
        if (t) {window.clearTimeout(t);}
        t = window.setTimeout(() => fn(...args), ms);
    };
}

/**
 * Run an async action with button confirmation feedback.
 * Disables the button while the action runs, then briefly shows a confirmation
 * label before restoring the original text. On error, restores immediately and rethrows.
 * @template T
 * @param {HTMLButtonElement} btn
 * @param {() => Promise<T>} action
 * @param {string | ((r: T) => string)} [doneLabel='✓']
 * @param {number} [doneMs=1500]
 * @returns {Promise<T>}
 */
export async function withConfirm(btn, action, doneLabel = '✓', doneMs = 1500) {
  const orig = btn.textContent ?? '';
  btn.disabled = true;
  try {
    const result = await action();
    btn.textContent = typeof doneLabel === 'function' ? doneLabel(result) : doneLabel;
    setTimeout(() => {
      btn.textContent = orig;
      btn.disabled = false;
    }, doneMs);
    return result;
  } catch (err) {
    btn.textContent = orig;
    btn.disabled = false;
    throw err;
  }
}

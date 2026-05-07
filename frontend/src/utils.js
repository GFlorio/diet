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
  arr('.tab').forEach(tab => { html(tab).classList.toggle('active', html(tab).dataset.page === page); });
  pages.forEach(pageName => { html(document.getElementById(`page-${pageName}`)).classList.toggle('hidden', pageName !== page); });
}

/** Format macro nutrients meta string
 * @param {number} kcal
 * @param {number} prot
 * @param {number} carbs
 * @param {number} fats
 */
export function nutrMeta(kcal, prot, carbs, fats){
  return `${fmtNum(kcal,0)} kcal · Protein ${fmtNum(prot)} g · Carbs ${fmtNum(carbs)} g · Fat ${fmtNum(fats)} g`;
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
 * @param {number} value
 * @param {number} [digits=1]
 * @returns {string}
 */
export const fmtNum = (value, digits = 1) => Number(value).toFixed(digits).replace(/\.0+$/, '');

/**
 * Format a Date to local YYYY-MM-DD (respects the user's timezone).
 * @param {Date} date
 * @returns {string}
 */
const localISO = (date) => {
  const year  = date.getFullYear();
  const month  = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Returns today's date in ISO format (YYYY-MM-DD), in the user's local timezone.
 * @returns {string}
 */
export const isoToday = () => localISO(new Date());

/**
 * Converts a date to ISO format (YYYY-MM-DD), in the user's local timezone.
 * @param {string|Date} date
 * @returns {string}
 */
export const toISO = (date) => localISO(new Date(date));

/**
 * Convert an ISO date string (YYYY-MM-DD) to a local midnight Date object.
 * Use this instead of `new Date(\`${iso}T00:00:00\`)` throughout the codebase.
 * @param {string} iso
 * @returns {Date}
 */
export const localDate = (iso) => new Date(`${iso}T00:00:00`);

/**
 * Returns the current timestamp in milliseconds.
 * @returns {number}
 */
export const now = () => Date.now();

/**
 * Returns a UUID v4 string using crypto.getRandomValues().
 * @returns {string}
 */
export function randomUUID() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

/**
 * Escapes HTML special characters in a string.
 * @param {string} [value='']
 * @returns {string}
 */
export const esc = (value = '') => (`${value}`).replace(/[&<>"']/g, character => ({
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
}[character] || ''));

/** Media query: device supports hover (i.e. not a touch-only device). */
export const MEDIA_HOVER = '(hover: hover)';
/** Media query: device uses a coarse pointer (touch screen). */
export const MEDIA_COARSE_POINTER = '(pointer: coarse)';

/**
 * Returns a zero-initialized macros accumulator object.
 * @returns {{ kcal: number, prot: number, carbs: number, fats: number }}
 */
export const zeroMacros = () => ({ kcal: 0, prot: 0, carbs: 0, fats: 0 });

/**
 * Add a snapshot's macros scaled by multiplier into an accumulator in place.
 * @param {{ kcal: number, prot: number, carbs: number, fats: number }} acc
 * @param {{ kcal: number, prot: number, carbs: number, fats: number }} macros
 * @param {number} multiplier
 */
export function addScaledMacros(acc, macros, multiplier) {
  acc.kcal  += macros.kcal  * multiplier;
  acc.prot  += macros.prot  * multiplier;
  acc.carbs += macros.carbs * multiplier;
  acc.fats  += macros.fats  * multiplier;
}

/**
 * @typedef {{ label: string, callback: () => void }} ToastAction
 */

/**
 * Show a non-blocking toast message fixed below the header.
 * Dismissable via X button, swipe, or auto-removal after `duration` ms.
 * @param {string} message
 * @param {{ type?: 'error'|'', duration?: number, action?: ToastAction }} [opts]
 */
export function toast(message, { type = '', duration = 3000, action } = {}) {
  const toastEl = document.createElement('div');
  toastEl.className = `toast${type ? ` ${type}` : ''}`;
  toastEl.setAttribute('role', 'status');

  const text = document.createElement('span');
  text.className = 'toast-msg';
  text.textContent = message;
  toastEl.appendChild(text);

  if (action) {
    const actionBtn = document.createElement('button');
    actionBtn.className = 'btn small';
    const isDesktop = window.matchMedia(MEDIA_HOVER).matches;
    actionBtn.textContent = isDesktop ? `${action.label} (Y)` : action.label;
    actionBtn.addEventListener('click', () => {
      action.callback();
      dismiss();
    });
    toastEl.appendChild(actionBtn);

    function onKey(/** @type {KeyboardEvent} */ e) {
      if (dismissed) {
        document.removeEventListener('keydown', onKey); return;
      }
      if (e.key !== 'y' && e.key !== 'Y') { return; }
      const tag = /** @type {HTMLElement} */ (e.target).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { return; }
      e.preventDefault();
      document.removeEventListener('keydown', onKey);
      actionBtn.click();
    }
    document.addEventListener('keydown', onKey);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.setAttribute('aria-label', 'Dismiss');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', dismiss);
  toastEl.appendChild(closeBtn);

  document.body.appendChild(toastEl);

  let dismissed = false;
  const timer = setTimeout(dismiss, duration);

  function dismiss() {
    if (dismissed) { return; }
    dismissed = true;
    clearTimeout(timer);
    toastEl.remove();
  }

  /** @param {1|-1} dir */
  function dismissToSide(dir) {
    if (dismissed) { return; }
    dismissed = true;
    clearTimeout(timer);
    toastEl.style.transition = 'transform .25s ease-in, opacity .25s ease-in';
    toastEl.style.transform = `translateX(calc(-50% + ${dir * 110}vw))`;
    toastEl.style.opacity = '0';
    setTimeout(() => toastEl.remove(), 270);
  }

  let startX = 0;

  toastEl.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    toastEl.style.transition = 'none';
  }, { passive: true });

  toastEl.addEventListener('touchmove', (e) => {
    const delta = e.touches[0].clientX - startX;
    toastEl.style.transform = `translateX(calc(-50% + ${delta}px))`;
    toastEl.style.opacity = String(Math.max(0, 1 - Math.abs(delta) / 200));
  }, { passive: true });

  toastEl.addEventListener('touchend', (e) => {
    const delta = e.changedTouches[0].clientX - startX;
    if (Math.abs(delta) > 80) {
      dismissToSide(delta > 0 ? 1 : -1);
    } else {
      toastEl.style.transition = 'transform .2s ease-out, opacity .2s ease-out';
      toastEl.style.transform = 'translateX(-50%)';
      toastEl.style.opacity = '1';
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
    let timeoutId;
    return (...args) => {
        if (timeoutId) {window.clearTimeout(timeoutId);}
        timeoutId = window.setTimeout(() => fn(...args), ms);
    };
}

/**
 * Run an async action with button confirmation feedback.
 * Disables the button while the action runs, then briefly shows a confirmation
 * label before restoring the original text. On error, restores immediately and rethrows.
 * @template T
 * @param {HTMLButtonElement} buttonEl
 * @param {() => Promise<T>} action
 * @param {string | ((result: T) => string)} [doneLabel='✓']
 * @param {number} [doneMs=1500]
 * @returns {Promise<T>}
 */
export async function withConfirm(buttonEl, action, doneLabel = '✓', doneMs = 1500) {
  const originalText = buttonEl.textContent ?? '';
  buttonEl.disabled = true;
  try {
    const result = await action();
    buttonEl.textContent = typeof doneLabel === 'function' ? doneLabel(result) : doneLabel;
    setTimeout(() => {
      buttonEl.textContent = originalText;
      buttonEl.disabled = false;
    }, doneMs);
    return result;
  } catch (err) {
    buttonEl.textContent = originalText;
    buttonEl.disabled = false;
    throw err;
  }
}

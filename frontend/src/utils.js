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
	if (obj === null || obj === undefined) throw new Error(`Object ${obj} is nullish!`);
    if (!(obj instanceof Element)) throw new Error(`Object ${obj} is not an Element!`);
    return obj;
}

/**
 * Show a given page and toggle tabs.
 * @param {'meals'|'foods'|'report'} page
 */
export function showPage(page){
  const pages = ['meals', 'foods', 'report'];
  arr('.tab').forEach(t => html(t).classList.toggle('active', html(t).dataset.page === page));
  pages.forEach(p => html(document.getElementById('page-' + p)).classList.toggle('hidden', p !== page));
}

/** Format macro nutrients meta string
 * @param {number} kcal
 * @param {number} prot
 * @param {number} carbs
 * @param {number} fats
 */
export function nutrMeta(kcal, prot, carbs, fats){
  return `${fmtNum(kcal,0)} kcal · P${fmtNum(prot)} C${fmtNum(carbs)} F${fmtNum(fats)}`;
}

/**
 * Returns the element as a HTMLElement.
 * @param {Element|null} el
 * @returns {HTMLElement}
 */
export function html(el) {
    if (el instanceof (HTMLElement)) {
        return el;
    }
    throw new Error('Element is not an HTML element');
}

/**
 * Returns the element as a HTMLInputElement.
 * @param {Element|null} el
 * @returns {HTMLInputElement}
 */
export function input(el) {
    if (el instanceof HTMLInputElement) {
        return el;
    }
    throw new Error('Element is not an HTML input element');
}

/**
 * Returns the element as a HTMLFormElement.
 * @param {Element|null} el
 * @returns {HTMLFormElement}
 */
export function form(el) {
    if (el instanceof HTMLFormElement) {
        return el;
    }
    throw new Error('Element is not an HTML form element');
}

/**
 * Returns the element as a HTMLButtonElement.
 * @param {Element|null} el
 * @returns {HTMLButtonElement}
 */
export function button(el) {
    if (el instanceof HTMLButtonElement) {
        return el;
    }
    throw new Error('Element is not an HTML button element');
}

/**
 * Returns the element as a HTMLSelectElement.
 * @param {Element|null} el
 * @returns {HTMLSelectElement}
 */
export function select(el) {
    if (el instanceof HTMLSelectElement) {
        return el;
    }
    throw new Error('Element is not an HTML select element');
}


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

import * as $ from '../utils.js'
import { setupMeals } from './meal.js';
import { setupFoods } from './foods.js';
import { setupReport } from './report.js';

/** Setup theme button and apply stored theme */
export function setupTheme(){
	const themeBtn = $.button(document.getElementById('themeBtn'));
	/** @returns {'auto'|'light'|'dark'} */
	const getStoredTheme = () => {
		const v = localStorage.getItem('theme');
		return v === 'light' || v === 'dark' || v === 'auto' ? v : 'auto';
	};
	/** @param {'auto'|'light'|'dark'} t */
	const applyTheme = (t) => {
		document.documentElement.setAttribute('data-theme', t);
		themeBtn.textContent = t==='dark' ? '🌙' : t==='light' ? '☀️' : '🌓';
	};
	themeBtn.addEventListener('click', () => {
		const cur = getStoredTheme();
		const next = cur==='auto' ? 'light' : cur==='light' ? 'dark' : 'auto';
		localStorage.setItem('theme', next);
		applyTheme(next);
	});
	applyTheme(getStoredTheme());
}

export function setupNav(){
	$.arr('.tab').forEach(tab => $.html(tab).addEventListener('click', () => {
		const page = /** @type {'meals'|'foods'|'report'} */ ($.html(tab).dataset.page);
		$.showPage(page);
		if (page === 'meals')  { window.dispatchEvent(new Event('meals-activate')); }
		if (page === 'report') { window.dispatchEvent(new Event('report-activate')); }
	}));
}

function setupScrollHide(){
	const HIDE_THRESHOLD = 80;  // px down before header hides
	const SHOW_THRESHOLD = 15;  // px up before header reappears
	let lastY = window.scrollY;
	let upAccum = 0;
	window.addEventListener('scroll', () => {
		const y = window.scrollY;
		if (y < HIDE_THRESHOLD) {
			upAccum = 0;
			document.body.classList.remove('header-hidden');
		} else if (y > lastY) {
			upAccum = 0;
			document.body.classList.add('header-hidden');
		} else {
			upAccum += lastY - y;
			if (upAccum >= SHOW_THRESHOLD) { document.body.classList.remove('header-hidden'); }
		}
		lastY = y;
	}, { passive: true });
}

export function setupUI(){
	setupTheme();
	setupNav();
	setupScrollHide();
}

export function populateViews(){
	setupMeals();
	setupFoods();
	setupReport();
}

export { setupMeals, setupFoods, setupReport };

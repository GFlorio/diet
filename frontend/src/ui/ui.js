import * as $ from '../utils.js'
import { setupMeals } from './meal.js';
import { setupFoods } from './foods.js';
import { setupGoals } from './goals.js';

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
		const page = /** @type {'meals'|'foods'|'goals'} */ ($.html(tab).dataset.page);
		$.showPage(page);
		if (page === 'meals')  { window.dispatchEvent(new Event('meals-activate')); }
		if (page === 'goals') { window.dispatchEvent(new Event('goals-activate')); }
	}));
}

export function setupUI(){
	setupTheme();
	setupNav();
}

export function populateViews(){
	setupMeals();
	setupFoods();
	setupGoals();
}

export { setupMeals, setupFoods, setupGoals };

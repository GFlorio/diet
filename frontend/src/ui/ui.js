import { canInstallPWA, isPWAInstalled, promptInstall } from '../pwa.js';
import * as $ from '../utils.js'
import { setupFoods } from './foods.js';
import { setupGoals } from './goals.js';
import { setupMeals } from './meal.js';

/** @returns {'auto'|'light'|'dark'} */
function getStoredTheme() {
	const v = localStorage.getItem('theme');
	return v === 'light' || v === 'dark' || v === 'auto' ? v : 'auto';
}

/** @param {'auto'|'light'|'dark'} t */
function applyTheme(t) {
	document.documentElement.setAttribute('data-theme', t);
	$.arr('.config-theme-btn').forEach(btn => {
		$.html(btn).classList.toggle('active', $.html(btn).dataset.theme === t);
	});
}

/** Setup config modal: theme selection and status report */
export function setupConfigModal(){
	const dialog = /** @type {HTMLDialogElement} */ ($.id('configModal'));
	const configBtn = $.button($.id('configBtn'));
	const closeBtn = $.button($.id('configModalClose'));
	const installBtn = $.button($.id('installPWABtn'));
	const installNote = $.html($.id('installPWANote'));

	// Apply stored theme on load
	applyTheme(getStoredTheme());

	// Theme buttons
	$.arr('.config-theme-btn').forEach(btn => {
		$.html(btn).addEventListener('click', () => {
			const t = /** @type {'auto'|'light'|'dark'} */ ($.html(btn).dataset.theme);
			if (t !== 'auto' && t !== 'light' && t !== 'dark') { return; }
			localStorage.setItem('theme', t);
			applyTheme(t);
		});
	});

	// PWA install button
	installBtn.addEventListener('click', async () => {
		const accepted = await promptInstall();
		if (accepted) {
			await refreshStatus();
		}
	});

	async function refreshStatus() {
		// PWA installed status
		const pwaDot = /** @type {HTMLElement} */ ($.id('statusPWA').querySelector('.status-dot'));
		const installed = isPWAInstalled();
		pwaDot.className = `status-dot ${installed ? 'ok' : 'bad'}`;
		const canInstall = canInstallPWA();
		installBtn.classList.toggle('hidden', installed || !canInstall);
		installNote.classList.toggle('hidden', installed || canInstall);

		// Persistent storage status
		const storageDot = /** @type {HTMLElement} */ ($.id('statusStorage').querySelector('.status-dot'));
		const persisted = await navigator.storage?.persisted?.() ?? false;
		storageDot.className = `status-dot ${persisted ? 'ok' : 'bad'}`;

		// Service worker / offline status
		const swDot = /** @type {HTMLElement} */ ($.id('statusSW').querySelector('.status-dot'));
		const swRegs = await navigator.serviceWorker?.getRegistrations();
		const swActive = swRegs?.some(r => r.active) ?? false;
		swDot.className = `status-dot ${swActive ? 'ok' : 'bad'}`;
	}

	configBtn.addEventListener('click', () => {
		void refreshStatus();
		dialog.showModal();
	});

	closeBtn.addEventListener('click', () => dialog.close());

	// Close on backdrop click
	dialog.addEventListener('click', (e) => {
		if (e.target === dialog) { dialog.close(); }
	});
}

export function setupNav(){
	$.arr('.tab').forEach(tab => { $.html(tab).addEventListener('click', () => {
		const page = /** @type {'meals'|'foods'|'goals'} */ ($.html(tab).dataset.page);
		$.showPage(page);
		if (page === 'meals')  { window.dispatchEvent(new Event('meals-activate')); }
		if (page === 'goals') { window.dispatchEvent(new Event('goals-activate')); }
	}); });
}

export function setupUI(){
	setupConfigModal();
	setupNav();
}

export function populateViews(){
	setupMeals();
	setupFoods();
	setupGoals();
}

export { setupFoods, setupGoals, setupMeals };

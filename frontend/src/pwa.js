// biome-ignore lint/correctness/noUnresolvedImports: virtual Vite module
import { registerSW } from 'virtual:pwa-register';
import * as $ from './utils.js';

/**
 * @typedef {Event & {
 *   prompt: function(): Promise<void>,
 *   userChoice: Promise<{ outcome: string, platform: string }>
 * }} BeforeInstallPromptEvent
 */

/** @type {BeforeInstallPromptEvent|null} */
let _deferredPrompt = null;
/** @type {(() => void)|null} */
let _onInstallabilityChange = null;

/** @returns {Promise<boolean>} */
export async function isPWAInstalled() {
    if (window.matchMedia('(display-mode: standalone)').matches ||
        /** @type {any} */ (window.navigator).standalone === true) {
        return true;
    }
    // Detect install even when running in a browser tab (Chrome/Edge desktop+Android).
    if ('getInstalledRelatedApps' in navigator) {
        try {
            const apps = await /** @type {any} */ (navigator).getInstalledRelatedApps();
            if (apps.length > 0) { return true; }
        } catch {
            // API unavailable in this context (e.g. non-HTTPS), fall through.
        }
    }
    return false;
}

/** @returns {boolean} */
export function canInstallPWA() {
    return _deferredPrompt !== null;
}

/**
 * Register a callback to be called whenever install availability changes
 * (i.e. when beforeinstallprompt or appinstalled fires).
 * @param {() => void} cb
 */
export function onInstallabilityChange(cb) {
    _onInstallabilityChange = cb;
}

/** @returns {Promise<boolean>} */
export async function promptInstall() {
    if (!_deferredPrompt) { return false; }
    _deferredPrompt.prompt();
    const { outcome } = await _deferredPrompt.userChoice;
    _deferredPrompt = null;
    return outcome === 'accepted';
}

export function setupPWA(){
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        _deferredPrompt = /** @type {BeforeInstallPromptEvent} */ (e);
        _onInstallabilityChange?.();
    });

    // User installed via browser UI (not through our prompt button) — clear the
    // deferred prompt so the install button is hidden on next status refresh.
    window.addEventListener('appinstalled', () => {
        _deferredPrompt = null;
        _onInstallabilityChange?.();
    });

    const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
            $.toast('A new version is available.', {
                duration: 10000,
                action: {
                    label: 'Reload',
                    callback: () => updateSW(true),
                },
            });
        },
        onOfflineReady() {
            console.log('App ready to work offline.');
        },
        onRegisteredSW(swScriptUrl, registration) {
            console.log('SW registered', swScriptUrl, registration?.scope);
        }
    });

    // Visibility regain: when user returns to tab, perform a check for freshness.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            updateSW().catch((e) => console.warn('SW update check failed', e));
        }
    });
}

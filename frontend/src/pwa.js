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

/** @returns {boolean} */
export function isPWAInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches ||
        /** @type {any} */ (window.navigator).standalone === true;
}

/** @returns {boolean} */
export function canInstallPWA() {
    return _deferredPrompt !== null;
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
    });

    const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
            $.toast('A new version is available.', {
                duration: 10000,
                action: {
                    label: 'Reload',
                    callback: () => navigator.serviceWorker?.controller?.postMessage({ type: 'SKIP_WAITING' }),
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

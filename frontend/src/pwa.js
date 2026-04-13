// eslint-disable-next-line import/no-unresolved
import { registerSW } from 'virtual:pwa-register';
import * as $ from './utils.js';

/**
 * @typedef {Event & {
 *   prompt: function(): Promise<void>,
 *   userChoice: Promise<{ outcome: string, platform: string }>
 * }} BeforeInstallPromptEvent
 */

export function setupPWA(){
    /** @type {BeforeInstallPromptEvent|null} */
    let deferredPrompt;
    const installBtn = $.sel('#installBtn');
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = /** @type {BeforeInstallPromptEvent} */ (e);
      installBtn.classList.remove('hidden');
    });
    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) {return;}
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome) {installBtn.classList.add('hidden');}
        deferredPrompt = null;
    });

        // Register SW; with registerType 'prompt' we decide when to reload.
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

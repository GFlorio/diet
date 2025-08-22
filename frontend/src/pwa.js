import { $ } from './utils.js';

/**
 * @typedef {Event & {
 *   prompt: function(): Promise<void>,
 *   userChoice: Promise<{ outcome: string, platform: string }>
 * }} BeforeInstallPromptEvent
 */

export function setupPWA(){
    /** @type {BeforeInstallPromptEvent|null} */
    let deferredPrompt;
    const installBtn = $('#installBtn');
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = /** @type {BeforeInstallPromptEvent} */ (e);
      installBtn.classList.remove('hidden');
    });
    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome) installBtn.classList.add('hidden');
        deferredPrompt = null;
    });

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.error));
    }
}

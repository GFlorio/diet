// Entry point to wire everything together
import { openDB } from './data.js';
import { setupPWA } from './pwa.js';
import { setupUI, populateViews } from './ui/ui.js';

(async function init(){
  setupUI();
  setupPWA();
  await openDB();
  populateViews();
})();

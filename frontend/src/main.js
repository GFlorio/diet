// Entry point to wire everything together
import { openDB, Foods } from './data.js';
import { setupPWA } from './pwa.js';
import { setupUI, populateViews } from './ui/ui.js';
import { showPage } from './utils.js';

(async function init(){
  setupUI();
  setupPWA();
  await openDB();
  populateViews();
  const activeFoods = await Foods.list({ status: 'active' });
  if (activeFoods.length === 0) { showPage('foods'); }
})();

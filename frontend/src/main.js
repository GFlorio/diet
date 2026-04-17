// Entry point to wire everything together
import { Foods } from './data.js';
import { setupPWA } from './pwa.js';
import { populateViews, setupUI } from './ui/ui.js';
import { showPage } from './utils.js';

void (async function init(){
  setupUI();
  setupPWA();
  populateViews();
  const activeFoods = await Foods.list({ status: 'active' });
  if (activeFoods.length === 0) { showPage('foods'); }
})();

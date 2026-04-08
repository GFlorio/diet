
export async function getAllFromStore(page, dbName, store) {
  return page.evaluate(({ dbName, store }) => {
    function openDB(name) {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => { resolve(req.result); };
        req.onerror = () => { reject(req.error); };
      });
    }
    return openDB(dbName).then(db => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction([store], 'readonly');
        const s = tx.objectStore(store);
        const req = s.getAll();
        req.onsuccess = () => { resolve(req.result); };
        req.onerror = () => { reject(req.error); };
      });
    });
  }, { dbName, store });
}

const DB_NAME = 'nutri-pwa';

// Isolate tests: start with a clean DB by deleting it via page context
export async function resetDB(page, dbName = DB_NAME) {
  await page.evaluate((name) => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => { resolve(); };
      req.onerror = () => { reject(req.error); };
      req.onblocked = () => { resolve(); };
    });
  }, dbName);
}

import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate, NetworkOnly } from 'workbox-strategies';
import { BackgroundSyncPlugin } from 'workbox-background-sync';

precacheAndRoute(self.__WB_MANIFEST);

clientsClaim();

cleanupOutdatedCaches();

// StaleWhileRevalidate for app, NetworkOnly for sync data.
registerRoute(
  ({ request, url }) => request.method === 'GET' && url.origin === self.location.origin && !url.pathname.startsWith('/db/'),
  new StaleWhileRevalidate({ cacheName: 'nutri-app' })
);
registerRoute(
  ({ request, url }) => request.method === 'GET' && url.origin === self.location.origin && url.pathname.startsWith('/db/'),
  new NetworkOnly()
);
const dbMutationQueue = new BackgroundSyncPlugin('db-mutations-queue', {
  maxRetentionTime: 24 * 60 // Retry for up to 24h.
});

registerRoute(
  ({ request, url }) => url.origin === self.location.origin && url.pathname.startsWith('/db/') && ['POST','PUT','PATCH','DELETE'].includes(request.method),
  new NetworkOnly({ plugins: [dbMutationQueue] })
);


// Skip waiting to activate new service worker immediately
// Minimal message handler to allow manual skipping (used by UI banner when user confirms update).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

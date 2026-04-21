import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// When GITHUB_PAGES=true the app is served from a subpath (e.g. /diet/).
const base = process.env.GITHUB_PAGES ? '/diet/' : '/';
const siteOrigin = process.env.SITE_ORIGIN ?? '';

export default defineConfig({
  base,
  plugins: [
    VitePWA({
      registerType: 'prompt', // user-triggered update flow
      strategies: 'injectManifest', // keep injectManifest to own sw logic
      srcDir: '.',
      filename: 'sw.js',
      manifest: {
        name: 'Diet',
        short_name: 'Diet',
        start_url: base,
        scope: base,
        id: '/diet/',
        display: 'standalone',
        background_color: '#0b1220',
        theme_color: '#0ea5e9',
        description: 'Offline-first meal logger',
        icons: [
          { src: `${base}icons/app-icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}icons/app-icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${base}icons/maskable-192.png`, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: `${base}icons/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        ...(siteOrigin && {
          related_applications: [
            { platform: 'webapp', url: `${siteOrigin}${base}manifest.webmanifest` }
          ]
        })
      },
      // Explicitly include static icon assets so they are copied to dist and not served via SPA fallback.
      includeAssets: [
        '/icons/app-icon-192.png',
        '/icons/app-icon-512.png',
        '/icons/app-icon-1024.png',
        '/icons/maskable-192.png',
        '/icons/maskable-512.png',
        '/icons/favicon.ico',
        '/icons/favicon-48.png',
        '/icons/favicon-32.png',
        '/icons/favicon-16.png',
        '/icons/apple-touch-icon-180.png'
      ],
    devOptions: { enabled: true, type: 'module' }
    })
  ],
  build: {
    rollupOptions: {
      input: 'index.html'
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{js,ts}'],
    coverage: {
      reporter: ['text', 'html'],
    }
  }
});

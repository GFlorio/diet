import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'prompt', // user-triggered update flow
      strategies: 'injectManifest', // keep injectManifest to own sw logic
      srcDir: '.',
      filename: 'sw.js',
      manifest: {
        name: 'Diet',
        short_name: 'Diet',
        // Use absolute root so install shortcuts open correctly regardless of path depth.
        start_url: '/',
        scope: '/',
        id: 'lame-diet',
        display: 'standalone',
        background_color: '#0b1220',
        theme_color: '#0ea5e9',
        description: 'Offline-first meal logger PWA',
        icons: [
          { src: '/icons/app-icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/app-icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/favicon.ico', sizes: '64x64 32x32 24x24', type: 'image/x-icon' }
        ]
      },
      // Explicitly include static icon assets so they are copied to dist and not served via SPA fallback.
      includeAssets: [
        '/icons/app-icon-192.png',
        '/icons/app-icon-512.png',
        '/icons/app-icon-1024.png',
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

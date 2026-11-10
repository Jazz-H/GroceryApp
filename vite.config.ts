import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Shown in Settings so you can tell which deploy a phone is running.
    __BUILD_ID__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
  },
  plugins: [
    react(),
    VitePWA({
      // We register the service worker ourselves (src/pwa.ts) and ask before reloading.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'badge-96.png'],
      manifest: {
        name: 'Fridgeboard',
        short_name: 'Fridgeboard',
        description: 'Our shared grocery list',
        theme_color: '#1d5fd0',
        background_color: '#ffc93c',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        // Links into the installed app load in the open window instead of only focusing it.
        launch_handler: { client_mode: 'navigate-existing' },
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Push and notification-click handlers live in public/push-sw.js.
        importScripts: ['push-sw.js'],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Firebase's sign-in handler must always come from the network, never the app shell.
        navigateFallbackDenylist: [/^\/__\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  // Firebase is most of the bundle; it's precached by the service worker, so one chunk is fine.
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
  },
});

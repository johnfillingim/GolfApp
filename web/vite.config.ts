import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// `base` must match the GitHub Pages path (https://<user>.github.io/GolfApp/),
// or every asset 404s once deployed. Local dev is unaffected.
const BASE = '/GolfApp/';

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Birdie — Golf Bets',
        short_name: 'Birdie',
        description:
          'Track side bets, live standings, and settle-up for your golf round.',
        theme_color: '#0B0912',
        background_color: '#0B0912',
        display: 'standalone',
        orientation: 'portrait',
        start_url: BASE,
        scope: BASE,
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            // Separate art: Android's circular mask crops the full-bleed disc,
            // so the maskable variant keeps everything inside the safe zone.
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The whole app is precached: once installed it opens with no network,
        // which is the normal condition on a course.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${BASE}index.html`,
      },
    }),
  ],
});

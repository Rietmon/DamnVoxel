import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const THEME = '#1b1d22';

export default defineConfig({
  // Relative base: the build works from any path (GitHub Pages, a subfolder, a file server).
  base: './',
  plugins: [
    svelte(),
    VitePWA({
      // The page never reloads by itself: an update waits for the user so no work is lost.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'DamnVoxel — voxel editor',
        short_name: 'DamnVoxel',
        description: 'A voxel model editor: PC, tablet and phone, works offline.',
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: THEME,
        theme_color: THEME,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // The guide's pages work offline with the editor; its screenshots load when online.
        globIgnores: ['guide/img/**'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/guide\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/kernels/**', 'src/formats/**', 'src/io/**'],
      exclude: ['**/*.test.ts'],
      // The data core is what must never break; keep it thoroughly tested.
      thresholds: { lines: 90, functions: 90, branches: 85 },
    },
  },
});

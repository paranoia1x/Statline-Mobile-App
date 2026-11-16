import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

// Relative base so the app works at any path (GitHub Pages serves it under /Statline-Mobile-App/).
export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // the desktop components and route handlers are reused through these small stand-ins
      "next/link": path.resolve(__dirname, "src/shims/next-link.tsx"),
      "next/navigation": path.resolve(__dirname, "src/shims/next-navigation.ts"),
      "next/server": path.resolve(__dirname, "src/shims/next-server.ts"),
    },
  },
  build: { target: "es2020", chunkSizeWarningLimit: 1500 },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null, // registered in src/main.tsx
      includeAssets: ["icons/*.png", "brand/*.png"],
      manifest: {
        name: "STATLINE Sports Analytics",
        short_name: "STATLINE",
        description: "Player & team stats, AI hit probabilities, pick and parlay analyzers. Track • Analyze • Win.",
        start_url: "./",
        scope: "./",
        display: "standalone",
        orientation: "portrait",
        background_color: "#06040b",
        theme_color: "#06040b",
        categories: ["sports", "productivity"],
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // app shell is precached; data, OCR and images are cached as they are used
        globPatterns: ["**/*.{js,css,html,woff2,png,svg}"],
        globIgnores: ["ocr/**", "data/**"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            // stats snapshots: fresh when online, last copy when offline
            urlPattern: ({ url }) => url.pathname.includes("/data/") && url.pathname.endsWith(".json"),
            handler: "NetworkFirst",
            options: { cacheName: "statline-data", networkTimeoutSeconds: 6, expiration: { maxEntries: 20 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes("/ocr/"),
            handler: "CacheFirst",
            options: { cacheName: "statline-ocr", expiration: { maxEntries: 10 } },
          },
          {
            urlPattern: ({ url }) => url.hostname === "a.espncdn.com",
            handler: "CacheFirst",
            options: { cacheName: "statline-images", expiration: { maxEntries: 1500, maxAgeSeconds: 30 * 24 * 3600 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            urlPattern: ({ url }) => url.hostname === "site.api.espn.com",
            handler: "NetworkFirst",
            options: { cacheName: "statline-live", networkTimeoutSeconds: 6, expiration: { maxEntries: 40, maxAgeSeconds: 2 * 24 * 3600 } },
          },
        ],
      },
    }),
  ],
});

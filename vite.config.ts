import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), cloudflare()],
  build: {
    // Suppress the ">500 kB" warning for the main client chunk while keeping it
    // visible if a single chunk grows beyond 600 kB (signal to code-split more).
    chunkSizeWarningLimit: 600,
  },
});

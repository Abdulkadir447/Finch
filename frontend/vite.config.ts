import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
  build: {
    outDir: '../frontend/dist', // output to folder that Electron will load
    emptyOutDir: true,
  },
});
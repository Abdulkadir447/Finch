import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
  base: './', // This tells Vite to use relative paths
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets', // Keeps assets in a subfolder
    rollupOptions: {
      output: {
        // This ensures consistent asset naming
        assetFileNames: 'assets/[name]-[hash].[ext]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
});
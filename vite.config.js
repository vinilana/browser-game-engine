import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173, host: true },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: 'index.html',
        textures: 'textures.html',
        sandbox: 'sandbox.html',
        rts: 'rts.html',
      },
    },
  },
});

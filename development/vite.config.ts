import { defineConfig } from 'vite';
export default defineConfig({ root: 'preview', base: './', build: { outDir: '../preview-dist', emptyOutDir: true } });

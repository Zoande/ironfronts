/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  test: {
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
  publicDir: false,
  plugins: [viteStaticCopy({ targets: [
    { src: 'public/audio', dest: '.' },
    { src: 'public/menu', dest: '.' },
    { src: 'public/models', dest: '.' },
    { src: 'public/textures', dest: '.' },
    { src: 'public/world', dest: '.' },
  ] })],
  build: {
    rollupOptions: {
      input: {
        dossier: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html'),
      },
    },
  },
});

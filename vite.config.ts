/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { splitCloudflareWorld } from './scripts/split-cloudflare-assets.mjs';
import { resolve } from 'node:path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  test: {
    testTimeout: 15_000,
    hookTimeout: 60_000,
    // Full-world simulation cases are CPU-heavy and synchronous. A small pool
    // prevents worker RPC heartbeats from being starved under local contention.
    maxWorkers: 4,
  },
  publicDir: false,
  plugins: [viteStaticCopy({ targets: [
    { src: 'public/audio', dest: '.' },
    { src: 'public/menu', dest: '.' },
    { src: 'public/models', dest: '.' },
    { src: 'public/textures', dest: '.' },
    { src: 'public/ui', dest: '.' },
    { src: 'public/world', dest: '.' },
    { src: 'public/europe', dest: '.' },
  ] }), {
    name: 'split-cloudflare-world-assets',
    apply: 'build',
    async closeBundle() {
      await splitCloudflareWorld(resolve(__dirname, 'dist/world'));
      await splitCloudflareWorld(resolve(__dirname, 'dist/europe'));
    },
  }],
  build: {
    rollupOptions: {
      input: {
        dossier: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html'),
      },
    },
  },
});

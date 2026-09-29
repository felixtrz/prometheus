/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { chromium } from 'playwright';
import { defineConfig, type Plugin } from 'vite';
import { vitexec } from 'vitexec';
import { campCapturePlugin } from './tests/capture-plugin.mjs';

const CDP_PATCHED = Symbol.for('prometheus.managedCdp');

/**
 * Give the IWSDK managed browser a Chrome DevTools port (PROMETHEUS_CDP_PORT,
 * default 9333) so vitexec checks can drive the managed runtime
 * (tests/vitexec-managed.mjs). The plugin launches Chromium through Playwright in
 * this process; its launch options gain one flag. Skipped for vitexec's own
 * isolated servers (tests/vitexec.config.ts sets IWSDK_DEV_OPEN=false).
 */
function managedBrowserDebugPort(): Plugin {
  return {
    name: 'prometheus:managed-cdp',
    apply: 'serve',
    config() {
      if (process.env.IWSDK_DEV_OPEN === 'false' || process.env.PROMETHEUS_CDP_PORT === 'off') return;
      const target = chromium as typeof chromium & { [CDP_PATCHED]?: boolean };
      if (target[CDP_PATCHED]) return;
      target[CDP_PATCHED] = true;
      const flag = `--remote-debugging-port=${process.env.PROMETHEUS_CDP_PORT ?? '9333'}`;
      const launch = chromium.launch.bind(chromium);
      const launchPersistentContext = chromium.launchPersistentContext.bind(chromium);
      chromium.launch = (options = {}) => launch({ ...options, args: [...(options.args ?? []), flag] });
      chromium.launchPersistentContext = (userDataDir, options = {}) =>
        launchPersistentContext(userDataDir, { ...options, args: [...(options.args ?? []), flag] });
    },
  };
}

export default defineConfig({
  plugins: [
    managedBrowserDebugPort(),
    iwsdkDev(),
    // Dev-only script injection for vitexec checks (no generated pages, nothing in builds).
    vitexec({ directory: false }),
    ...(process.env.VITE_CAMP_CAPTURE === '1' ? [campCapturePlugin()] : []),
  ],
  server: { host: '0.0.0.0', port: 8081, open: false },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});

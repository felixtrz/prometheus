/**
 * Vite config for vitexec gameplay checks (`npm run check -- <script>`).
 *
 * Same app and plugins as vite.config.ts, with two differences so a check can run
 * while `npm run dev` is up:
 * - its own dependency cache, so the two servers never re-optimise each other's deps
 *   (a mid-load re-optimisation reloads the page and orphans the check script);
 * - no managed IWSDK browser: vitexec brings its own Playwright page. The dev plugin
 *   still injects the IWER emulator (window.IWER_DEVICE) into that page;
 * - no HMR or file watching (see below).
 */
import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import base from '../vite.config.ts';

process.env.IWSDK_DEV_OPEN ??= 'false';

const config = mergeConfig(base, {
  root: fileURLToPath(new URL('..', import.meta.url)),
  // One cache per concurrent user (VITEXEC_CACHE_DIR), so parallel checks never re-optimise each other.
  cacheDir: process.env.VITEXEC_CACHE_DIR ?? 'node_modules/.vite-vitexec',
});

// A check is a snapshot: no HMR and no file watching, so edits made elsewhere during a
// run (other agents, the editor) never reload the page under a running script.
config.server = { ...config.server, hmr: false, watch: { ignored: () => true } };
export default config;

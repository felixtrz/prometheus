/**
 * Gameplay checks: runs the in-page scripts in ./vitexec through vitexec, each
 * scenario on a fresh page (its own Vite server, Chromium and storage, so every run
 * starts a new journey). Works alongside a running `npm run dev`.
 *
 *   npm run check                      # every scenario
 *   npm run check -- opening survival  # just these
 *   npm run check -- expedition --headed --record
 *   npm run check -- --shots design/verify/tour   # evidence screenshots from shot() calls
 *
 * `--record` writes design/verify/vitexec/<step>.mp4. A RELOAD step reloads the page
 * between two scripts (save/restore checks).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage, run } from 'vitexec/cli';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELOAD = Symbol('reload');
const SCENARIOS = {
  opening: ['opening.ts'],
  survival: ['survival.ts', RELOAD, 'survival-restore.ts'],
  expedition: ['expedition.ts'],
  night: ['night.ts'],
  finale: ['finale.ts'],
  perf: ['perf.ts'],
};

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const names = args.filter((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--shots');
const selected = names.length ? names : Object.keys(SCENARIOS);
for (const name of selected) if (!SCENARIOS[name]) throw new Error(`unknown scenario ${name}; known: ${Object.keys(SCENARIOS).join(', ')}`);
const recordDir = path.join(root, 'design/verify/vitexec');
const shotsAt = args.indexOf('--shots');
const shotsDir = shotsAt >= 0 ? path.resolve(root, args[shotsAt + 1] ?? 'design/verify/shots') : undefined;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
if (flags.has('--record')) mkdirSync(recordDir, { recursive: true });

/**
 * Wait until the app has booted and stays on the same document: on a cold cache Vite
 * re-optimises dependencies and reloads the page once, which would orphan a script.
 */
export async function ready(page) {
  const deadline = Date.now() + 180_000;
  for (let attempt = 1; ; attempt++) {
    if (Date.now() > deadline) throw new Error(`the app never settled (${attempt - 1} attempts in 3 min)`);
    try {
      await page.waitForFunction(() => Boolean(window.FRAMEWORK_MCP_RUNTIME?.world), null, { timeout: 90_000 });
      const token = await page.evaluate(() => (window.__vitexecReady = Math.random()));
      await page.waitForTimeout(2500);
      if (await page.evaluate((t) => window.__vitexecReady === t, token)) return;
      console.log(`  … page reloaded while settling (attempt ${attempt})`);
    } catch (error) {
      console.log(`  … not ready yet (attempt ${attempt}): ${String(error?.message ?? error).split('\n')[0]}`);
    }
  }
}

/** Reject after `ms` so one stuck scenario can never stall the whole suite. */
function watchdog(ms, what) {
  let timer;
  const promise = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} exceeded ${Math.round(ms / 60_000)} min`)), ms); });
  promise.catch(() => {});
  return { promise, clear: () => clearTimeout(timer) };
}
/** Minutes a scenario may take in total (boot, every step, reloads). */
const SCENARIO_MINUTES = 12;

let stopWatching = () => {};
const results = [];
for (const name of selected) {
  const began = Date.now();
  console.log(`\n=== ${name} ===`);
  let page;
  const guard = watchdog(SCENARIO_MINUTES * 60_000, name);
  try {
    await Promise.race([guard.promise, (async () => {
    page = await openPage({
      root,
      configFile: path.join(root, 'tests/vitexec.config.ts'),
      headless: !flags.has('--headed'),
      timeoutMs: 120_000,
      onLog: (line) => { if (/\[(error|pageerror)\]|FAIL|Uncaught/i.test(line)) console.log(`  [page] ${line}`); },
    });
    if (shotsDir) {
      await page.exposeFunction('__vitexecShot', (shotName) =>
        page.screenshot({ path: path.join(shotsDir, `${name}-${shotName}.png`) }).then(() => undefined));
    }
    await ready(page);
    for (const step of SCENARIOS[name]) {
      if (step === RELOAD) {
        console.log('  ↻ reload');
        await page.reload({ waitUntil: 'load' });
        await ready(page);
        continue;
      }
      const code = readFileSync(path.join(root, 'vitexec', step), 'utf8');
      // A reload under a running script (a late dependency re-optimisation on a cold
      // cache) destroys it; rerun the step once on the fresh page rather than hang.
      for (let attempt = 0; ; attempt++) {
        const navigated = new Promise((_, reject) => {
          const onNavigate = (frame) => {
            if (frame !== page.mainFrame()) return;
            page.off('framenavigated', onNavigate);
            reject(new Error(`page navigated to ${frame.url()} under ${step}`));
          };
          page.on('framenavigated', onNavigate);
          stopWatching = () => page.off('framenavigated', onNavigate);
        });
        navigated.catch(() => {});
        try {
          await Promise.race([
            run(page, code, {
              moduleExtension: '.ts',
              timeoutMs: 8 * 60_000,
              onLog: (line) => console.log(line.replace(/^\[log\] /, '')),
              ...(flags.has('--record') ? { recordPath: path.join(recordDir, step.replace(/\.ts$/, '.mp4')) } : {}),
            }),
            navigated,
          ]);
          stopWatching();
          break;
        } catch (error) {
          stopWatching();
          const reloaded = /navigat|Execution context was destroyed/.test(String(error?.message ?? error));
          if (!reloaded || attempt >= 1) throw error;
          console.log(`  ↻ ${error.message}; rerunning ${step} on the reloaded page`);
          await ready(page);
        }
      }
    }
    })()]);
    results.push({ name, ok: true, seconds: (Date.now() - began) / 1000 });
  } catch (error) {
    console.log(`  ✗ ${error instanceof Error ? error.message : error}`);
    results.push({ name, ok: false, seconds: (Date.now() - began) / 1000 });
  } finally {
    guard.clear();
    // Never let a wedged browser hold up the next scenario.
    await Promise.race([page?.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 15_000))]);
  }
}

console.log('\n=== summary ===');
for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}  (${result.seconds.toFixed(0)} s)`);
process.exit(results.every((result) => result.ok) ? 0 : 1);

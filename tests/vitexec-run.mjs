/**
 * Gameplay checks: runs the in-page scripts in ./vitexec through vitexec inside the
 * IWSDK managed browser — the app runtime iframe of the workspace that `npm run dev`
 * launched, the same live world the iwsdk CLI/MCP tools see. One browser, no private
 * pages. Scenarios run one after another; each starts on a fresh runtime (storage
 * cleared, reloaded), so every run is a new journey.
 *
 *   npm run check                      # every scenario
 *   npm run check -- opening survival  # just these
 *   npm run check -- expedition@S11    # resume at the first section matching "S11" (or @5: the 5th)
 *   npm run check -- vitexec/probe.ts  # any script, on the runtime as it is (no reset)
 *   npm run check -- --shots design/verify/tour   # evidence screenshots from shot() calls
 *   npm run check -- expedition --record          # design/verify/vitexec/<step>.mp4
 *
 * Needs the managed browser's DevTools port, which every `npm run dev` /
 * `npx iwsdk dev up|restart` opens (PROMETHEUS_CDP_PORT, default 9333; see
 * vite.config.ts and the dev:runtime script). A RELOAD step
 * reloads the runtime between two scripts (save/restore checks). Scripts run against
 * the live dev server, so don't edit sources while a check runs: HMR would reload
 * the runtime under it.
 *
 * Checkpoints: a full run stores one per section (harness `section()`) in
 * .vitexec/checkpoints/<scenario>.json: the game's save, the rig and head pose, and
 * what each hand holds. `scenario@section` seeds that save, boots through Continue and
 * skips the sections before it, so iterating on a late section costs seconds, not
 * the whole scenario. A checkpoint is only as current as the last full run through
 * it; rerun the scenario in full after changing what earlier sections do.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { run } from 'vitexec/cli';

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
const scenarioOf = (name) => name.split('@')[0];
for (const name of names) {
  if (!SCENARIOS[scenarioOf(name)] && !name.endsWith('.ts')) throw new Error(`unknown scenario ${name}; known: ${Object.keys(SCENARIOS).join(', ')} (or a path to a .ts script)`);
}
const selected = names.length ? names : Object.keys(SCENARIOS);
const recordDir = path.join(root, 'design/verify/vitexec');
const shotsAt = args.indexOf('--shots');
const shotsDir = shotsAt >= 0 ? path.resolve(root, args[shotsAt + 1] ?? 'design/verify/shots') : undefined;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
if (flags.has('--record')) mkdirSync(recordDir, { recursive: true });

const port = process.env.PROMETHEUS_CDP_PORT ?? '9333';
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch((error) => {
  throw new Error(`No managed browser on DevTools port ${port}. Start it with \`npm run dev\` or \`npx iwsdk dev restart --headless\` (the dev:runtime script opens the port).\n${error.message}`);
});

/** The managed workspace page, its runtime iframe element and that frame. */
async function runtime() {
  const deadline = Date.now() + 90_000;
  for (;;) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const element = await page.$('#workspace-runtime-frame').catch(() => null);
        const frame = await element?.contentFrame().catch(() => null);
        if (frame) return { page, element, frame };
      }
    }
    if (Date.now() > deadline) throw new Error('the managed workspace has no runtime frame (is `npx iwsdk dev status` command-ready?)');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/**
 * Wait until the app has booted and stays on the same document: a dependency
 * re-optimisation reloads the runtime once, which would orphan a script.
 */
async function ready(frame) {
  const deadline = Date.now() + 180_000;
  for (let attempt = 1; ; attempt++) {
    if (Date.now() > deadline) throw new Error(`the app never settled (${attempt - 1} attempts in 3 min)`);
    try {
      await frame.waitForFunction(() => Boolean(window.FRAMEWORK_MCP_RUNTIME?.world), null, { timeout: 90_000 });
      const token = await frame.evaluate(() => (window.__vitexecReady = Math.random()));
      await new Promise((resolve) => setTimeout(resolve, 2500));
      if (await frame.evaluate((t) => window.__vitexecReady === t, token)) return;
      console.log(`  … runtime reloaded while settling (attempt ${attempt})`);
    } catch (error) {
      console.log(`  … not ready yet (attempt ${attempt}): ${String(error?.message ?? error).split('\n')[0]}`);
    }
  }
}

/**
 * Reload the runtime frame and wait for the app: optionally clearing its storage first,
 * and seeding a checkpoint (its save, plus the resume note the harness reads at boot).
 */
async function reload(frame, { clear, seed }) {
  await frame.evaluate(({ wipe, seed }) => {
    if (wipe) { localStorage.clear(); sessionStorage.clear(); }
    if (seed) {
      localStorage.setItem(seed.saveKey, seed.save);
      sessionStorage.setItem('vitexec.resume', JSON.stringify(seed));
    }
    location.reload();
  }, { wipe: clear, seed }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const target = await runtime();
  await target.frame.waitForLoadState('load');
  await ready(target.frame);
  return target;
}

/**
 * vitexec injects into a Page's main document; aim its evaluations at the runtime
 * frame instead. CDP logging, input bindings and screenshots stay page-level. Its
 * script cleanup uses the context's Node HTTP client, which rejects the dev
 * server's self-signed certificate, so that one request goes through the frame.
 * One proxy per page for the whole suite: vitexec registers its input binding once
 * per page object, and a second registration on the same page throws.
 */
const proxies = new Map();
function framed({ page, frame }) {
  let entry = proxies.get(page);
  if (!entry) {
    const state = { frame };
    const request = {
      delete: async (url) => {
        const r = await state.frame.evaluate(async (u) => {
          const response = await fetch(u, { method: 'DELETE' });
          return { ok: response.ok, status: response.status, text: await response.text() };
        }, url);
        return { ok: () => r.ok, status: () => r.status, text: async () => r.text };
      },
    };
    const passThrough = (object, overrides) => new Proxy(object, {
      get(source, key) {
        if (key in overrides) return overrides[key];
        const value = Reflect.get(source, key);
        return typeof value === 'function' ? value.bind(source) : value;
      },
    });
    const context = passThrough(page.context(), { request });
    const proxy = passThrough(page, { evaluate: (...call) => state.frame.evaluate(...call), context: () => context });
    entry = { state, proxy };
    proxies.set(page, entry);
  }
  entry.state.frame = frame;
  return entry.proxy;
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

const checkpointDir = path.join(root, '.vitexec/checkpoints');
const checkpointFile = (scenario) => path.join(checkpointDir, `${scenario}.json`);
const readCheckpoints = (scenario) => existsSync(checkpointFile(scenario)) ? JSON.parse(readFileSync(checkpointFile(scenario), 'utf8')) : [];

/** The stored checkpoint `scenario@query` names: a 1-based index or a case-insensitive title fragment. */
function findCheckpoint(scenario, query) {
  const points = readCheckpoints(scenario);
  const list = points.map((point, i) => `  ${i + 1}. ${point.title}`).join('\n') || '  (none: run the scenario in full once)';
  const found = /^\d+$/.test(query) ? points[Number(query) - 1] : points.find((point) => point.title.toLowerCase().includes(query.toLowerCase()));
  if (!found) throw new Error(`no checkpoint "${query}" for ${scenario}; stored:\n${list}`);
  return found;
}

let target = await runtime();
let current = '';
let currentStep = '';
/** Section titles this scenario reached: a full passing run keeps only these checkpoints. */
const seenSections = new Set();
// Checkpoints from harness section(): the latest per title, in the order sections first ran.
await target.page.exposeFunction('__vitexecCheckpoint', (json) => {
  const point = JSON.parse(json);
  if (!point || !SCENARIOS[current]) return;
  mkdirSync(checkpointDir, { recursive: true });
  point.step = currentStep;
  seenSections.add(point.title);
  const points = readCheckpoints(current);
  const at = points.findIndex((stored) => stored.title === point.title);
  if (at < 0) points.push(point);
  else points[at] = point;
  writeFileSync(checkpointFile(current), JSON.stringify(points, null, 1));
});
if (shotsDir) {
  // Page bindings reach every frame, the runtime iframe included.
  await target.page.exposeFunction('__vitexecShot', (shotName) =>
    target.element.screenshot({ path: path.join(shotsDir, `${current}-${shotName}.png`) }).then(() => undefined));
}

const results = [];
for (const name of selected) {
  const began = Date.now();
  const script = !SCENARIOS[scenarioOf(name)];
  const [scenario, query] = name.split('@');
  current = script ? path.basename(name, '.ts') : scenario;
  seenSections.clear();
  console.log(`\n=== ${name} (managed runtime) ===`);
  const guard = watchdog(SCENARIO_MINUTES * 60_000, name);
  try {
    await Promise.race([guard.promise, (async () => {
      const seed = query === undefined ? undefined : findCheckpoint(scenario, query);
      if (seed) console.log(`  ⏩ resuming at "${seed.title}" (${seed.step})`);
      target = script ? await runtime() : await reload((await runtime()).frame, { clear: true, seed });
      const steps = script ? [name] : SCENARIOS[scenario];
      for (const step of seed ? steps.slice(steps.indexOf(seed.step)) : steps) {
        currentStep = step;
        if (step === RELOAD) {
          console.log('  ↻ reload');
          target = await reload(target.frame, { clear: false });
          continue;
        }
        const file = script ? path.resolve(step) : path.join(root, 'vitexec', step);
        const { page, frame } = target;
        // A reload under a running script (HMR, a late dependency re-optimisation)
        // destroys it: fail fast rather than hang until the watchdog.
        let stopWatching = () => {};
        const navigated = new Promise((_, reject) => {
          const onNavigate = (navigatedFrame) => {
            if (navigatedFrame !== frame) return;
            reject(new Error(`runtime navigated to ${navigatedFrame.url()} under ${step}`));
          };
          page.on('framenavigated', onNavigate);
          stopWatching = () => page.off('framenavigated', onNavigate);
        });
        navigated.catch(() => {});
        try {
          await Promise.race([
            run(framed(target), readFileSync(file, 'utf8'), {
              moduleExtension: path.extname(file) || '.ts',
              timeoutMs: 8 * 60_000,
              onLog: (line) => console.log(line.replace(/^\[log\] /, '')),
              ...(flags.has('--record') ? { recordPath: path.join(recordDir, path.basename(file).replace(/\.ts$/, '.mp4')) } : {}),
            }),
            navigated,
          ]);
        } finally {
          stopWatching();
        }
      }
    })()]);
    results.push({ name, ok: true, seconds: (Date.now() - began) / 1000 });
    // A full pass saw every section: drop checkpoints of renamed or removed ones.
    if (!script && query === undefined && existsSync(checkpointFile(scenario))) {
      writeFileSync(checkpointFile(scenario), JSON.stringify(readCheckpoints(scenario).filter((point) => seenSections.has(point.title)), null, 1));
    }
  } catch (error) {
    console.log(`  ✗ ${error instanceof Error ? error.message : error}`);
    results.push({ name, ok: false, seconds: (Date.now() - began) / 1000 });
  } finally {
    guard.clear();
  }
}

console.log('\n=== summary ===');
for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}  (${result.seconds.toFixed(0)} s)`);
// Disconnect only: the managed browser belongs to the dev server.
process.exit(results.every((result) => result.ok) ? 0 : 1);

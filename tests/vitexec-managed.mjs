/**
 * Run vitexec scripts inside the IWSDK managed browser: the app runtime iframe of
 * the managed workspace that `npm run dev` / `iwsdk dev up` launched, instead of a
 * private page. The same live world the iwsdk CLI/MCP tools see.
 *
 *   npm run check:managed -- vitexec/opening.ts [more.ts …] [--fresh] [--screenshot out.png]
 *
 * --fresh clears the runtime's storage and reloads it first (a brand-new journey).
 * Needs vite.config.ts's managed-cdp plugin (DevTools port PROMETHEUS_CDP_PORT,
 * default 9333) and vitexec() injection; restart the dev server after changing it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { run } from 'vitexec/cli';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const screenshot = option('--screenshot');
const scripts = args.filter((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--screenshot');
if (!scripts.length) throw new Error('usage: node tests/vitexec-managed.mjs <script.ts> [--fresh] [--screenshot out.png]');

const port = process.env.PROMETHEUS_CDP_PORT ?? '9333';
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch((error) => {
  throw new Error(`No managed browser on DevTools port ${port}. Restart the dev server (npx iwsdk dev restart --headless) so vite.config.ts adds the port.\n${error.message}`);
});

/** The managed workspace page and its app runtime frame. */
async function runtime() {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      const element = await page.$('#workspace-runtime-frame').catch(() => null);
      const frame = await element?.contentFrame();
      if (frame) return { page, element, frame };
    }
  }
  throw new Error('The managed workspace has no runtime frame yet (is `iwsdk dev status` command-ready?)');
}

let { page, element, frame } = await runtime();
if (flag('--fresh')) {
  console.log('↻ fresh runtime (storage cleared, reloaded)');
  await frame.evaluate(() => { localStorage.clear(); sessionStorage.clear(); location.reload(); }).catch(() => {});
  await page.waitForTimeout(1500);
  ({ page, element, frame } = await runtime());
  await frame.waitForLoadState('load');
  await frame.waitForFunction(() => Boolean(window.FRAMEWORK_MCP_RUNTIME?.world), null, { timeout: 90_000 });
}

// vitexec injects into a Page's main document; aim its evaluations at the runtime
// frame instead. CDP logging, input bindings and screenshots stay page-level. Its
// script cleanup uses the context's Node HTTP client, which rejects the dev
// server's self-signed certificate, so that one request goes through the frame.
const request = {
  delete: async (url) => {
    const r = await frame.evaluate(async (u) => {
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
const target = passThrough(page, { evaluate: frame.evaluate.bind(frame), context: () => context });

let failed = false;
for (const script of scripts) {
  console.log(`=== ${script} (managed runtime) ===`);
  try {
    await run(target, readFileSync(path.resolve(script), 'utf8'), {
      moduleExtension: path.extname(script) || '.ts',
      timeoutMs: 8 * 60_000,
      onLog: (line) => console.log(line.replace(/^\[log\] /, '')),
    });
  } catch (error) {
    failed = true;
    console.log(`✗ ${error instanceof Error ? error.message : error}`);
    break;
  }
}
if (screenshot) {
  await element.screenshot({ path: screenshot });
  console.log(`[screenshot] ${screenshot}`);
}
// Disconnect only: the managed browser belongs to the dev server.
process.exit(failed ? 1 : 0);

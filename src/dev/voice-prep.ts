/**
 * Dev-only voice preparation page (voice-prep.html on the Vite dev server).
 *
 * `?batch=N` declares batch N's lines with Drawcall's `speech()`: in the dev server
 * that sends any clip not generated yet for preparation, which moves the page to
 * Drawcall (sign in, generate) and back here. Drawcall prepares at most 32 requests
 * at a time, hence batches of PREP_BATCH. Without `?batch`, the page only checks.
 *
 * The page then lists every line with its status (ok / missing) and a play button.
 * When the batch it came back from is done and another batch still has missing
 * clips, it continues with that one after a short countdown (`?auto=0` to stop).
 *
 * The game never calls `speech()` (it would hijack every dev page load) and never
 * imports the package: it loads the URLs from voice-urls.ts, a static module that
 * `node scripts/voice-urls.mjs` writes with the same package. This is the only
 * runtime module that imports @drawcall/generate; it warns when voice-urls.ts is stale
 * (a line's text changed since the module was generated), because the game would then
 * look for clips at the old URLs. Each line's subtitle-only hint is shown, never sent.
 */
import { assetUrl, requestHash, speech, speechSchema } from '@drawcall/generate';
import {
  DRAWCALL_ORIGIN, LINES, PREP_BATCH, PREP_BATCHES, VOICE, prepBatchOf, speechInput, type GuideLine,
} from '../game/voice-lines.js';
import { VOICE_HASHES } from '../game/voice-urls.js';

type Status = 'checking' | 'ok' | 'missing';

const params = new URLSearchParams(location.search);
const batch = Number(params.get('batch') ?? 0);
const auto = params.get('auto') !== '0';
const status = new Map<string, Status>(LINES.map((line) => [line.id, 'checking']));
const summary = document.getElementById('summary')!;
const tbody = document.getElementById('lines')!;
let countdown: number | undefined;

/** The package's hash for a line (what speech() declares and generates). */
const voiceHash = (line: GuideLine) => requestHash({ type: 'speech', input: speechSchema.parse(speechInput(line)) });
const voiceUrl = (line: GuideLine) => assetUrl(voiceHash(line), DRAWCALL_ORIGIN);
/** Lines whose static hash (voice-urls.ts) no longer matches: the game would miss their clips. */
const stale = LINES.filter((line) => VOICE_HASHES[line.id] !== voiceHash(line)).map((line) => line.id);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const batchLines = (n: number) => LINES.filter((_, i) => prepBatchOf(i) === n);
const missingIn = (n: number) => batchLines(n).filter((line) => status.get(line.id) === 'missing').length;

function goToBatch(n: number): void {
  const url = new URL(location.href);
  url.searchParams.set('batch', String(n));
  location.assign(url.href);
}

/** Which clips exist: one request to Drawcall's cache resolver, or a HEAD per clip if that fails. */
async function check(): Promise<void> {
  const hashes = LINES.map((line) => voiceHash(line));
  try {
    const response = await fetch(new URL('/api/v1/cache/resolve', DRAWCALL_ORIGIN), {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hashes }),
    });
    if (!response.ok) throw new Error(`resolve ${response.status}`);
    const { missing } = await response.json() as { missing: string[] };
    const gone = new Set(missing);
    LINES.forEach((line, i) => status.set(line.id, gone.has(hashes[i]) ? 'missing' : 'ok'));
  } catch {
    await Promise.all(LINES.map(async (line) => {
      const response = await fetch(voiceUrl(line), { method: 'HEAD', credentials: 'omit' }).catch(() => undefined);
      status.set(line.id, response?.ok ? 'ok' : 'missing');
    }));
  }
}

function play(button: HTMLButtonElement, url: string): void {
  const audio = new Audio(url);
  button.disabled = true;
  button.textContent = 'Playing';
  const reset = () => { button.disabled = false; button.textContent = 'Play'; };
  audio.addEventListener('ended', reset);
  audio.addEventListener('error', reset);
  audio.addEventListener('loadedmetadata', () => { button.title = `${audio.duration.toFixed(1)} s`; });
  void audio.play().catch(reset);
}

function renderLines(): void {
  tbody.replaceChildren(...LINES.map((line, i) => {
    const state = status.get(line.id)!;
    const button = el('button', { className: 'ghost', textContent: 'Play', disabled: state !== 'ok', type: 'button' });
    button.addEventListener('click', () => play(button, voiceUrl(line)));
    return el('tr', {},
      el('td', {}, String(i + 1)),
      el('td', { className: 'id' }, line.id, el('br'), el('small', { className: 'batch' }, `batch ${prepBatchOf(i)}`)),
      el('td', { className: 'on' }, line.on.join(' | ')),
      el('td', { className: 'text' }, line.text, ...(line.hint ? [el('br'), el('small', { className: 'hint' }, `Subtitle only: ${line.hint}`)] : [])),
      el('td', {}, el('span', { className: `status ${state}` }, state === 'ok' ? 'ok' : state === 'missing' ? 'missing' : '…')),
      el('td', {}, button));
  }));
}

function renderSummary(note = ''): void {
  const ready = [...status.values()].filter((s) => s === 'ok').length;
  const checking = [...status.values()].some((s) => s === 'checking');
  const buttons = Array.from({ length: PREP_BATCHES }, (_, k) => {
    const n = k + 1;
    const lines = batchLines(n);
    const first = (n - 1) * PREP_BATCH + 1;
    const missing = missingIn(n);
    const label = checking ? `Batch ${n}` : missing ? `Generate batch ${n} (${missing} missing)` : `Batch ${n} ready`;
    const button = el('button', { type: 'button', textContent: label, disabled: checking || !missing });
    button.title = `Lines ${first}–${first + lines.length - 1}`;
    button.addEventListener('click', () => goToBatch(n));
    return button;
  });
  const recheck = el('button', { type: 'button', className: 'ghost', textContent: 'Check again' });
  recheck.addEventListener('click', () => void refresh());
  summary.replaceChildren(
    el('p', { className: 'notice' }, checking ? 'Checking which clips exist…' : `${ready} of ${LINES.length} clips ready.`),
    el('p', {}, `Voice: ${VOICE.voice}. Style: “${VOICE.style}”`),
    ...(stale.length ? [el('p', { className: 'notice warn' },
      `voice-urls.ts is stale for ${stale.join(', ')}: run \`node scripts/voice-urls.mjs\` so the game loads these clips.`)] : []),
    el('div', { className: 'row' }, ...buttons, recheck),
    ...(note ? [el('p', { className: 'notice' }, note)] : []),
  );
}

function scheduleNext(): void {
  const next = Array.from({ length: PREP_BATCHES }, (_, k) => k + 1).find((n) => missingIn(n) > 0);
  if (!batch || !next || next === batch || missingIn(batch) > 0 || !auto) {
    if (batch && missingIn(batch) === 0) renderSummary(`Batch ${batch} is ready.${next ? ` Batch ${next} still has missing clips.` : ' Every clip is ready; the game will speak.'}`);
    return;
  }
  let seconds = 4;
  const tick = () => {
    renderSummary(`Batch ${batch} is ready. Continuing with batch ${next} in ${seconds} s…`);
    const stop = el('button', { type: 'button', className: 'ghost', textContent: 'Stop' });
    stop.addEventListener('click', () => { window.clearInterval(countdown); renderSummary(`Batch ${batch} is ready.`); });
    summary.append(stop);
    if (seconds-- <= 0) { window.clearInterval(countdown); goToBatch(next); }
  };
  tick();
  countdown = window.setInterval(tick, 1000);
}

async function refresh(): Promise<void> {
  for (const line of LINES) status.set(line.id, 'checking');
  renderSummary();
  renderLines();
  await check();
  renderSummary();
  renderLines();
}

window.addEventListener('drawcall:error', (event) => {
  const error = (event as CustomEvent<Error>).detail;
  renderSummary(`Drawcall preparation failed: ${error?.message ?? error}`);
  summary.querySelector('.notice:last-child')?.classList.add('warn');
});

if (!import.meta.env.DEV) {
  summary.replaceChildren(el('p', { className: 'notice warn' }, 'Voice preparation only runs on the Vite dev server (npm run dev).'));
} else {
  if (batch >= 1 && batch <= PREP_BATCHES) {
    // Declare this batch: missing clips send the page to Drawcall (sign in, generate, return).
    for (const line of batchLines(batch)) speech(speechInput(line));
  }
  await refresh();
  if (batch >= 1 && batch <= PREP_BATCHES && missingIn(batch) > 0) {
    renderSummary(`Batch ${batch}: ${missingIn(batch)} clips are being sent to Drawcall. The page will move there to sign in and generate them.`);
  } else {
    scheduleNext();
  }
}

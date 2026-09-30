import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadTs } from './helpers/load-ts.mjs';

// The package is only for the voice-prep page and scripts/voice-urls.mjs; the tests use
// it to check the static hashes the game loads (src/game/voice-urls.ts).
const require = createRequire(import.meta.url);
const generate = await import(pathToFileURL(require.resolve('@drawcall/generate')).href);
const voice = await loadTs('src/game/voice-lines.ts');
const urls = await loadTs('src/game/voice-urls.ts');
const recipes = await loadTs('src/game/recipes.ts');
const story = await loadTs('src/game/story.ts');
const { LINES } = voice;
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const line = (id) => {
  const found = voice.lineById(id);
  assert.ok(found, `no line ${id}`);
  return found;
};

test('every line has a unique id and short, non-empty text', () => {
  const ids = new Set();
  for (const l of LINES) {
    assert.match(l.id, /^[a-z][a-z0-9-]*$/, `id ${l.id}`);
    assert.ok(!ids.has(l.id), `duplicate id ${l.id}`);
    ids.add(l.id);
    assert.equal(l.text, l.text.trim(), `${l.id} has padded text`);
    assert.ok(l.text.length > 0, `${l.id} is empty`);
    assert.ok(l.text.length <= voice.MAX_TEXT, `${l.id} is ${l.text.length} chars (max ${voice.MAX_TEXT})`);
    assert.ok(l.on.length > 0, `${l.id} has no trigger`);
    assert.ok(Number.isFinite(l.priority), `${l.id} priority`);
    if (l.hint !== undefined) assert.ok(l.hint.length > 0 && l.hint.length <= 60, `${l.id} hint length`);
  }
});

test('lines are about 3–12 s spoken', () => {
  for (const l of LINES) {
    const seconds = voice.estimateSeconds(l.text);
    assert.ok(seconds >= 3 && seconds <= voice.MAX_SECONDS, `${l.id}: ~${seconds} s`);
  }
});

test('the Titan speaks world verbs: controller parts live only in the subtitle hint', () => {
  const jargon = /\b(trigger|grip|button|thumbstick|joystick|controller)\b/i;
  for (const l of LINES) {
    assert.doesNotMatch(l.text, jargon, `${l.id} says controller jargon`);
    const input = voice.speechInput(l);
    assert.deepEqual(Object.keys(input).sort(), ['style', 'text', 'voice']);
    assert.equal(input.text, l.text, `${l.id}: only the words are sent for speech`);
    if (l.hint) assert.ok(!input.text.includes(l.hint), `${l.id}: the hint is never spoken`);
  }
  assert.match(line('intro').text, /to the door/i);
  assert.match(line('intro').hint, /stick/i);
  assert.match(line('wreck-axe').text, /close your hand/i);
  assert.match(line('wreck-axe').hint, /grip/i);
  assert.match(line('lighter').hint, /trigger/i);
  assert.match(line('sleep').hint, /bedroll/);
});

test('voice and style are valid Drawcall speech input', () => {
  const input = generate.speechSchema.parse(voice.speechInput(LINES[0]));
  assert.equal(input.voice, voice.VOICE.voice);
  assert.equal(input.style, voice.VOICE.style);
  assert.equal(voice.DRAWCALL_ORIGIN, 'https://generate.drawcall.ai');
});

test('voice-urls.ts (static) matches the package: the game and voice-prep look up the same clips', () => {
  const origin = 'https://generate.drawcall.ai';
  const seen = new Set();
  assert.deepEqual(Object.keys(urls.VOICE_HASHES).sort(), LINES.map((l) => l.id).sort(),
    'voice-urls.ts lists other lines: run `node scripts/voice-urls.mjs`');
  for (const l of LINES) {
    const expected = generate.requestHash({ type: 'speech', input: generate.speechSchema.parse(voice.speechInput(l)) });
    assert.equal(urls.VOICE_HASHES[l.id], expected, `${l.id}: voice-urls.ts is stale; run \`node scripts/voice-urls.mjs\``);
    const url = urls.voiceClipUrl(urls.VOICE_HASHES[l.id], origin);
    assert.match(url, /^https:\/\/generate\.drawcall\.ai\/assets\/[a-f0-9]{64}$/);
    assert.equal(url, generate.assetUrl(expected, origin));
    // speech() only registers for preparation in a browser dev server; in Node it just returns the URL.
    assert.equal(generate.speech(voice.speechInput(l)), url, `${l.id} matches speech()`);
    assert.ok(!seen.has(url), `${l.id} shares a URL`);
    seen.add(url);
  }
  // Any change to the text changes the hash (the clip must be regenerated).
  const edited = { ...LINES[0], text: `${LINES[0].text} Again.` };
  const hash = (l) => generate.requestHash({ type: 'speech', input: generate.speechSchema.parse(voice.speechInput(l)) });
  assert.notEqual(hash(edited), hash(LINES[0]));
  assert.equal(voice.clipId('intro'), 'voice-intro');
});

test('only the dev voice-prep page imports @drawcall/generate (no zod or @noble in the runtime)', () => {
  const importers = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|js)$/.test(entry.name) && /@drawcall\/generate['"]/.test(readFileSync(path, 'utf8'))) {
        importers.push(relative(root, path));
      }
    }
  };
  walk(join(root, 'src'));
  assert.deepEqual(importers, ['src/dev/voice-prep.ts']);
});

test('voice-prep batches stay within Drawcall\'s 32-request preparation cap', () => {
  assert.ok(voice.PREP_BATCH <= generate.MAX_BATCH_REQUESTS);
  assert.equal(voice.PREP_BATCHES, Math.ceil(LINES.length / voice.PREP_BATCH));
  const sizes = new Map();
  LINES.forEach((_, i) => sizes.set(voice.prepBatchOf(i), (sizes.get(voice.prepBatchOf(i)) ?? 0) + 1));
  assert.equal(sizes.size, voice.PREP_BATCHES);
  for (const size of sizes.values()) assert.ok(size <= generate.MAX_BATCH_REQUESTS);
});

// A representative payload for every event that can trigger a line.
const P = { x: 0, y: 0, z: 0 };
const SAMPLES = [
  { type: 'journey-begin', resumed: false },
  { type: 'journey-begin', resumed: true },
  { type: 'grab', kind: 'lighter', ...P },
  { type: 'grab', kind: 'stick', ...P },
  { type: 'grab', kind: 'axe', ...P },
  { type: 'lighter', lit: true, ...P },
  { type: 'fire-lit', ...P },
  { type: 'fire-out', ...P },
  { type: 'ingredient', kind: 'meat', ...P },
  { type: 'stew-ready', recipe: 'meat+mushroom' },
  { type: 'eat', kind: 'bowl', hunger: 90 },
  { type: 'well-fed', seconds: 90 },
  { type: 'bench-set', product: 'torch', valid: true, known: true },
  { type: 'bench-set', product: '', valid: false, known: false },
  ...recipes.BENCH_RECIPES.map((recipe) => ({ type: 'crafted', product: recipe.product, learned: false, ...P })),
  ...story.PAGES.map((page) => ({ type: 'page', index: page.index, first: true })),
  { type: 'chop', node: 'tree', remaining: 2, ...P },
  { type: 'torch-lit', ...P },
  { type: 'harvest', kind: 'resin', ...P },
  { type: 'harvest', kind: 'reeds', ...P },
  { type: 'hit', kind: 'spear', species: 'deer', killed: true, ...P },
  { type: 'pack', state: 'worn', ...P },
  { type: 'phase', phase: 'dusk', day: 1 },
  { type: 'creature', species: 'wolf', cue: 'howl', ...P },
  { type: 'hurt', amount: 20, cause: 'wolf', x: 1, z: 2 },
  { type: 'respawn', ...P },
  { type: 'sentry-deployed', ...P },
  { type: 'sentry-empty', ...P },
  { type: 'crossbow-empty', ...P },
  { type: 'toast', tone: 'info', text: 'The beacon stays cold', body: 'Something is missing.' },
  { type: 'beacon', progress: 0.1, lit: false },
  { type: 'ending-step', step: 'smoke' },
  { type: 'harvest', kind: 'mushroom', ...P },
  // The opening journey's beats and cues (JourneySystem).
  ...['wake', 'door', 'armed', 'open', 'outside', 'dawn', 'waystation', 'forest', 'camp', 'done',
    'door-glance', 'axe-left', 'pack-left', 'forest-done'].map((step) => ({ type: 'journey', step })),
];

const produced = new Set(SAMPLES.flatMap((event) => voice.triggersOf(event)));
const usedKeys = LINES.flatMap((l) => l.on.map((trigger) => voice.parseTrigger(trigger).key));

test('every trigger a line listens for can actually fire', () => {
  const ids = new Set(LINES.map((l) => l.id));
  for (const key of usedKeys) {
    if (key.startsWith('done:')) {
      assert.ok(ids.has(key.slice(5)), `${key} follows an unknown line`);
      continue;
    }
    assert.ok(produced.has(key) || voice.POLLED_TRIGGERS.includes(key), `nothing raises ${key}`);
  }
  for (const l of LINES) {
    for (const trigger of l.on) {
      const { delay } = voice.parseTrigger(trigger);
      assert.ok(Number.isFinite(delay) && delay >= 0 && delay < 60, `${l.id}: bad delay in ${trigger}`);
    }
  }
});

test('triggers cover every first-time interaction and story beat the guide must speak to', () => {
  const heard = new Set(usedKeys);
  const required = [
    'journey:new', 'journey:resumed', 'hand-near', 'grab:lighter', 'lighter:on',
    'ingredient', 'pot-full', 'stew-ready', 'eat', 'bench:valid', 'bench:invalid',
    ...recipes.BENCH_RECIPES.map((recipe) => `crafted:${recipe.product}`),
    'page:1', 'page:2', 'page:5', 'page:7', 'beacon-cold', 'beacon-slip', 'well-fed',
    'chop', 'harvest', 'phase:dusk', 'wolf', 'hurt', 'hunger-low', 'health-low', 'respawn',
    'sentry-deployed', 'sentry-empty', 'crossbow-empty', 'pack:worn', 'sleep-ready', 'beacon', 'ending-step:smoke',
  ];
  for (const key of required) assert.ok(heard.has(key), `no line for ${key}`);
  assert.equal(new Set(recipes.BENCH_RECIPES.map((r) => r.product)).size, recipes.BENCH_RECIPES.length);
  assert.equal(recipes.BENCH_RECIPES.filter((r) => !r.part).length, 5, 'five products; the rest are parts');
  for (const key of ['harvest:reeds', 'kill:prey']) assert.ok(heard.has(key), `no line for ${key}`);
});

test('the intro opens a new journey with a how-to inside ~10 s; the welcome repeats; the farewell ends it', () => {
  const intro = line('intro');
  const top = Math.max(...LINES.map((l) => l.priority));
  assert.equal(intro.priority, top);
  const start = intro.on.map((t) => voice.parseTrigger(t)).find((t) => t.key === 'journey:new');
  assert.ok(start, 'the intro starts the journey');
  // Delay + fade-in (~1 s) + the words up to the how-to: it lands within ~10 s of journey-begin.
  // In the wreck the first how-to is to walk: up, and to the door.
  const howTo = intro.text.search(/to the door/i);
  assert.ok(howTo >= 0, 'the intro sends the keeper to the door');
  const upTo = intro.text.slice(0, howTo + 'to the door'.length);
  assert.ok(start.delay + 1 + voice.estimateSeconds(upTo) <= 10, 'the first how-to comes within ~10 s');
  assert.ok(voice.estimateSeconds(intro.text) <= 10, 'the opener is short');
  assert.doesNotMatch(intro.text, /Prometheus|stole/, 'no lore monologue before the first how-to');
  assert.ok(intro.covers.includes('key:opening'), 'the opening toast never overlaps the intro');
  const grab = line('grab');
  assert.equal(grab.unless, 'grabbed');
  assert.ok(grab.on.includes('done:wreck-axe+6'), 'the grab how-to follows the axe line');
  assert.ok(!grab.on.includes('grab'), 'grab is taught before the first grab, not after it');
  const welcome = line('welcome');
  assert.ok(welcome.repeat && welcome.on.some((t) => voice.parseTrigger(t).key === 'journey:resumed'));
  assert.ok(!welcome.finale, 'no welcome back once the journey has ended');
  assert.ok(line('ending').finale, 'the farewell speaks after the ending');
  assert.deepEqual(LINES.filter((l) => l.finale).map((l) => l.id), ['ending']);
  // The farewell waits for the theme toast and is never buried by the smoke toast.
  assert.ok(line('ending').on.some((t) => { const p = voice.parseTrigger(t); return p.key === 'ending-step:smoke' && p.delay >= 5; }));
  assert.doesNotMatch(read('src/game/systems/toast-system.ts'), /smoke is rising/);
});

test('combat discipline: only the openers, respawn, near-death, the beacon and the farewell speak while a wolf is near', () => {
  const urgent = LINES.filter((l) => l.priority >= voice.THREAT.priority).map((l) => l.id).sort();
  assert.deepEqual(urgent, ['beacon', 'beacon-slip', 'ending', 'intro', 'respawn', 'weak', 'welcome']);
  for (const id of ['wolf', 'hurt', 'hungry', 'sentry-empty']) assert.ok(line(id).priority < voice.THREAT.priority, id);
  // Urgent lines interrupt a fight: they stay short.
  assert.ok(voice.estimateSeconds(line('weak').text) <= 5.4, 'weak is short');
  assert.ok(voice.estimateSeconds(line('beacon-slip').text) <= 10, 'beacon-slip is short');
  // It leads with the fix for both causes (the flame out of the stone, the guardians on it), never "Let go".
  assert.doesNotMatch(line('beacon-slip').text, /let go/i, 'no order heard as "let go" mid-fight');
  assert.match(line('beacon-slip').text, /flame in the stone/);
  assert.match(line('beacon-slip').text, /drive them/);
  assert.equal(voice.THREAT.radius, 12);
  assert.equal(voice.THREAT.hurtQuiet, 6);
  // The Hollow line waits for dusk at the fire (or the first calm), and only when they will come.
  const wolf = line('wolf');
  assert.ok(wolf.on.some((t) => voice.parseTrigger(t).key === 'done:dusk'));
  assert.deepEqual([...wolf.when].sort(), ['night', 'wolves-stirring']);
  assert.ok(voice.lineTtl(wolf) >= 60, 'it survives a fight to be spoken after');
});

test('stale lines: a context check at play time and a maximum queue age', () => {
  for (const id of ['bench-valid', 'bench-invalid']) assert.ok(line(id).when.includes('at-bench'), `${id} only at the bench`);
  assert.ok(line('bench-valid').when.includes('bench-ready'), 'never "strike the pad" after the craft');
  assert.ok(line('bench-invalid').when.includes('bench-wrong'));
  assert.ok(voice.DEFAULT_TTL <= 30);
  for (const l of LINES) {
    assert.ok(voice.lineTtl(l) <= voice.MAX_TTL, `${l.id} ttl`);
    assert.ok(l.ttl === undefined || l.ttl <= voice.MAX_TTL, `${l.id} ttl above MAX_TTL`);
  }
  assert.equal(line('torch').unless, 'torch-lit');
  assert.equal(line('sentry-kit').unless, 'sentry-built');
  assert.equal(line('fire').unless, 'stew-cooked');
  for (const id of ['stir', 'bowl']) assert.ok(line(id).when.includes('at-camp'), `${id}: only at the pot`);
  assert.ok(line('sentry-empty').when.includes('sentry-dry'), 'never "empty" after a reload');
});

test('covered toasts are real: every pattern matches a toast some system emits', () => {
  const systems = readdirSync(join(root, 'src/game/systems')).map((f) => read(`src/game/systems/${f}`)).join('\n');
  const toastSource = read('src/game/systems/toast-system.ts');
  for (const l of LINES) {
    for (const pattern of [...(l.covers ?? []), ...(l.defers ?? [])]) {
      if (pattern.startsWith('key:')) {
        assert.ok(toastSource.includes(`'${pattern.slice(4)}')`), `${l.id}: no toast posts key ${pattern}`);
      } else {
        assert.ok(systems.includes(pattern), `${l.id}: no toast says "${pattern}" (a system changed its text?)`);
      }
    }
  }
  assert.ok(voice.toastMatches(['key:stew'], 'Hearty stew is ready', 'Dip the bowl', 'stew'));
  assert.ok(!voice.toastMatches(['key:stew'], 'stew', '', 'toast'), 'keys never match text');
  assert.ok(voice.toastMatches(['Strike the pad three times'], 'Torch', 'Strike the pad three times with the hammer head.', 'toast'));
  assert.ok(!voice.toastMatches(undefined, 'x', '', 'toast'));
});

test('events map to trigger keys, ignoring the ones that teach nothing', () => {
  const keys = (event) => voice.triggersOf(event);
  assert.deepEqual(keys({ type: 'grab', kind: 'lighter', ...P }), ['grab', 'grab:lighter']);
  assert.deepEqual(keys({ type: 'lighter', lit: false, ...P }), []);
  assert.deepEqual(keys({ type: 'harvest', kind: 'log', ...P }), [], 'chopped wood is taught by the chop line');
  assert.deepEqual(keys({ type: 'page', index: 2, first: false }), []);
  assert.deepEqual(keys({ type: 'page', index: 5, first: true }), ['page', 'page:5']);
  assert.deepEqual(keys({ type: 'creature', species: 'deer', cue: 'flee', ...P }), []);
  assert.deepEqual(keys({ type: 'harvest', kind: 'reeds', ...P }), ['harvest', 'harvest:reeds']);
  assert.deepEqual(keys({ type: 'hit', kind: 'spear', species: 'deer', killed: true, ...P }), ['kill:prey']);
  assert.deepEqual(keys({ type: 'hit', kind: 'spear', species: 'deer', killed: false, ...P }), [], 'a wound teaches nothing');
  assert.deepEqual(keys({ type: 'hit', kind: 'bolt', species: 'wolf', killed: true, ...P }), [], 'wolves leave no carcass');
  assert.deepEqual(keys({ type: 'beacon', progress: 1, lit: true }), []);
  assert.deepEqual(keys({ type: 'beacon', progress: 0, lit: false }), []);
  assert.deepEqual(keys({ type: 'toast', text: 'x', tone: 'info' }), []);
  // Story beats come from real conditions (watched by the GuideSystem), never from a toast's copy.
  assert.deepEqual(keys({ type: 'toast', text: 'The beacon stays cold', tone: 'info' }), []);
  assert.ok(voice.POLLED_TRIGGERS.includes('beacon-cold') && voice.POLLED_TRIGGERS.includes('beacon-slip'));
  assert.deepEqual(keys({ type: 'well-fed', seconds: 90 }), ['well-fed']);
  assert.deepEqual(keys({ type: 'well-fed', seconds: 0 }), [], 'wearing off teaches nothing');
  const out = ['stale'];
  assert.equal(voice.triggersOf({ type: 'chop', node: 'tree', remaining: 1, ...P }, out), out, 'reuses the out array');
  assert.deepEqual(out, ['chop']);
  assert.deepEqual(voice.parseTrigger('done:intro+0.5'), { key: 'done:intro', delay: 0.5 });
  assert.deepEqual(voice.parseTrigger('crafted:sentry-kit'), { key: 'crafted:sentry-kit', delay: 0 });
  assert.ok(voice.TRIGGERS.get('crafted:torch').some((ref) => ref.line.id === 'torch'));
});

test('GameState.guide keeps comma-separated ids spoken this journey', () => {
  assert.equal(voice.hasSpoken('', 'intro'), false);
  assert.equal(voice.hasSpoken('intro,note', 'intro'), true);
  assert.equal(voice.hasSpoken('intro,note', 'note'), true);
  assert.equal(voice.hasSpoken('intro,note', 'in'), false);
  assert.equal(voice.hasSpoken('sentry-empty', 'sentry'), false);
  assert.equal(voice.hasSpoken('crossbow-empty,sentry', 'sentry'), true);
  let list = '';
  list = voice.addSpoken(list, 'intro');
  list = voice.addSpoken(list, 'grab');
  list = voice.addSpoken(list, 'intro');
  assert.equal(list, 'intro,grab');
  assert.equal(voice.removeSpoken('intro,grab,note', 'grab'), 'intro,note');
  assert.equal(voice.removeSpoken('intro', 'in'), 'intro');
});

test('lines stay in the canon: he stole fire for everyone; the keeper gives it back', () => {
  const all = LINES.map((l) => l.text).join(' ');
  const myth = line('myth').text;
  assert.match(myth, /Prometheus/);
  assert.match(myth, /give it to everyone/);
  assert.match(myth, /took it from everyone/);
  assert.doesNotMatch(all, /as your people did/, 'the two thefts are opposites, not the same');
  assert.match(all, /Hollow/);
  // The beacon line carries the hold's defence rule (its toast is covered): the other hand.
  assert.match(line('beacon').text, /smother/);
  assert.match(line('beacon').text, /other hand/);
  assert.match(line('page-5').text, /Give this one back/);
  assert.match(line('ending').text, /Yours is burning\.$/);
  assert.match(line('ending').text, /smoke/);
  assert.match(line('page-7').text, /lit torch/);
  assert.match(line('respawn').text, /eagle/);
  assert.doesNotMatch(line('respawn').text, /where you fell/, 'the toast says it only when a pack was lost');
  assert.match(line('wolf').text, /thrust your torch/);
  assert.doesNotMatch(line('wolf').text, /drive them back/, 'a torch only works at arm\'s length');
  assert.match(line('bench-valid').text, /hammer/);
});

test('the sentry comes loaded: lines read the starter bolts from recipes.ts', () => {
  const sentry = line('sentry').text;
  assert.ok(sentry.includes(`${voice.numberWord(recipes.SENTRY_STARTER_BOLTS)} bolts loaded`), sentry);
  assert.doesNotMatch(line('sentry-kit').text, /loaded/, 'the sentry line says it, seconds later: not twice');
  assert.ok(line('bolts').text.includes(voice.numberWord(recipes.BOLTS_PER_BUNDLE)));
  for (const l of LINES) assert.doesNotMatch(l.text, /feed it bolts|to load it, and it will loose/, `${l.id} says the sentry starts empty`);
  const hint = story.OBJECTIVES.find((o) => o.id === 'sentry').hint;
  assert.doesNotMatch(hint, /touch bolts/i);
});

test('objective hints name every source; wrist hints keep their verbs in two lines', () => {
  const hint = (id) => story.OBJECTIVES.find((o) => o.id === id).hint;
  assert.match(hint('torch'), /around camp/);
  assert.match(hint('torch'), /grove.*left fork/);
  assert.match(hint('spear'), /right fork.*meadow.*brook/);
  assert.match(hint('spear'), /reeds/);
  assert.match(hint('hunt'), /meadow/);
  assert.match(hint('outpost'), /main trail/);
  assert.match(hint('torch'), /reeds/);
  assert.match(hint('spear'), /three reeds into cord/);
  assert.match(hint('hunt'), /butcher it with your axe/);
  for (const part of ['limb', 'latch', 'camp stump']) assert.match(hint('crossbow'), new RegExp(part), `crossbow hint: ${part}`);
  assert.match(hint('sentry'), /log/);
  // Nothing finished lies in the valley: no hint sends the keeper to salvage.
  for (const o of story.OBJECTIVES) assert.doesNotMatch(`${o.hint} ${o.wrist}`, /crate|salvage|spring|cloth/i, `${o.id} points at salvage`);
  assert.match(hint('beacon'), /torch/);
  for (const o of story.OBJECTIVES) {
    assert.ok(o.wrist.length > 0 && o.wrist.length <= 64, `${o.id} wrist hint is ${o.wrist.length} chars`);
    assert.ok(o.hint.length <= 130, `${o.id} hint is ${o.hint.length} chars`);
  }
  const sentryWrist = story.OBJECTIVES.find((o) => o.id === 'sentry').wrist;
  for (const part of ['Bench', 'log', 'limb', 'latch']) assert.match(sentryWrist, new RegExp(part), `sentry wrist: ${part}`);
  // Every page that teaches a recipe says where it lies (the journal's teaser).
  for (const page of story.PAGES) assert.ok(page.where && page.where.length <= 28, `page ${page.index} where`);
  // Page 7 asks for what the beacon accepts: a lit torch.
  const page7 = story.PAGES[6].body;
  assert.match(page7, /torch/);
  assert.doesNotMatch(page7, /fire here in your own hands/);
});

test('no compass: the keeper has none, so lines, hints and the wrist use landmarks and the trail', () => {
  const compass = /\b(north|south|east|west)(ern|ward|wards)?\b/i;
  for (const l of LINES) {
    assert.doesNotMatch(l.text, compass, `${l.id} says a compass word`);
    if (l.hint) assert.doesNotMatch(l.hint, compass, `${l.id} hint`);
  }
  for (const o of story.OBJECTIVES) {
    assert.doesNotMatch(o.hint, compass, `${o.id} hint`);
    assert.doesNotMatch(o.wrist, compass, `${o.id} wrist`);
  }
  for (const p of story.PAGES) assert.doesNotMatch(p.where, compass, `page ${p.index} where`);
  assert.equal(story.ENDING.body, undefined, 'the unused ending body is gone');
  assert.match(story.ENDING.tally, /journal at camp/);
  assert.match(line('ending').text, /^Look back the way you came/);
});

test('round-3 story fixes: the right verb, one "stay in the light", the note after the meal, no spoilers', () => {
  // The lighter's flame lives only while it is held: never "press it".
  assert.match(line('lighter').text, /\bhold\b/i);
  assert.doesNotMatch(line('lighter').text, /press it|answers only you/i);
  assert.match(line('lighter').hint, /hold/i);
  // The first dusk: the dusk line says the stage toast's news; the wolf line carries the rest.
  assert.ok(line('dusk').covers.includes('key:stage') && line('dusk').covers.includes('key:dusk'));
  const stay = LINES.filter((l) => ['dusk', 'wolf'].includes(l.id) && /stay in(side)? the (fire)?light/i.test(l.text));
  assert.equal(stay.length, 1, 'one "stay in the light" at the first dusk');
  assert.match(line('wolf').text, /carried flame/);
  // The note waits for the meal (not over the pot); page 1 teaches the next task.
  const note = line('note').on.map((t) => voice.parseTrigger(t));
  assert.ok(note.some((t) => t.key === 'done:eat' && t.delay >= 2), 'note after the eat line');
  assert.ok(!note.some((t) => t.key === 'done:myth' && t.delay < 30), 'never straight after the myth, over the pot');
  // The stew's line names the buff.
  assert.ok(line('eat').on.some((t) => voice.parseTrigger(t).key === 'well-fed'));
  assert.match(line('eat').text, /well fed/);
  // No page quoted before it is found (page 4: "only our hurry").
  assert.doesNotMatch(line('spear').text, /hurry|fear only/i);
  assert.doesNotMatch(line('lighter').text, /answers only you/, 'page 7 is Ilse\'s discovery');
});

test('round-4 story fixes: the torch split, the defence taught before the hold, the lighter named', () => {
  // The how-to is short (lighting it early cuts it as stale); the warning waits for the flame.
  const torch = line('torch');
  assert.equal(torch.unless, 'torch-lit');
  assert.ok(voice.estimateSeconds(torch.text) <= 6, `torch how-to ~${voice.estimateSeconds(torch.text)} s`);
  assert.doesNotMatch(torch.text, /dark/, 'the warning is not in the how-to');
  const lit = line('torch-lit');
  assert.ok(lit.on.some((t) => { const p = voice.parseTrigger(t); return p.key === 'torch-lit' && p.delay >= 0.5; }), 'after the flame catches');
  assert.match(lit.text, /the dark sees it too/);
  assert.ok(!lit.unless, 'the warning is never retired unheard by the torch being lit');
  assert.deepEqual(voice.triggersOf({ type: 'torch-lit', ...P }), ['torch-lit']);
  // Voice-only, the lighter line names what is held and what is pressed.
  assert.match(line('lighter').text, /finger/);
  assert.match(line('lighter').text, /lighter's flame/);
  assert.doesNotMatch(line('lighter').text, /^Hold it down/);
  // The hold's defence: the hint, page 7 and the beacon line all say "the other hand"; nobody says "hold anyway".
  const beacon = story.OBJECTIVES.find((o) => o.id === 'beacon');
  assert.match(beacon.hint, /other hand/);
  assert.match(beacon.wrist, /other hand/);
  assert.match(story.PAGES[6].body, /other hand/);
  for (const text of [beacon.hint, beacon.wrist, story.PAGES[6].body, ...LINES.map((l) => l.text)]) assert.doesNotMatch(text, /hold anyway/i);
});

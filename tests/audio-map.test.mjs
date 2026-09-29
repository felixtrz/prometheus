import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import ts from 'typescript';

// Transpile the pure audio rules plus their two runtime imports (rules.ts, terrain.ts)
// into data: modules, rewiring the relative specifiers. Type-only imports are erased.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const transpile = (path) => ts.transpileModule(read(path), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const rulesUrl = dataUrl(transpile('../src/game/rules.ts'));
const terrainUrl = dataUrl(transpile('../src/game/terrain.ts'));
const mapCode = transpile('../src/game/audio-map.ts')
  .replace(/(["'])\.\/rules\.js\1/g, `'${rulesUrl}'`)
  .replace(/(["'])\.\/terrain\.js\1/g, `'${terrainUrl}'`);
assert.doesNotMatch(mapCode, /from\s+["']\.\//, 'audio-map.ts gained an unstubbed runtime import');
const {
  CLIP_DEFS, DUCK, HEARTBEAT, STEP, strideFor, beaconBuildVolume, createCue, dayBedGain, fireLoopVolume, heartbeatVolume, mapEvent,
  nearestOnPolyline, nightBedGain, stepCue, stepSurface, variantId,
} = await import(dataUrl(mapCode));
const { CAMP, DANGER } = await import(rulesUrl);
const { LANDMARKS } = await import(terrainUrl);

// Registry: clip id → file, parsed from the asset module (it needs import.meta.env, so it is not imported).
const registry = new Map([...read('../src/game/audio-assets.ts').matchAll(/^\s*'?([\w-]+)'?:\s*clip\('([^']+)'\)/gm)].map((m) => [m[1], m[2]]));
const LOOPS = ['forest-day', 'night', 'fire-bed', 'fire-pops', 'torch-flame', 'brook', 'beacon-roar', 'beacon-build'];
const audioFile = (id) => new URL(`../public/audio/${registry.get(id)}`, import.meta.url);

// Every bus event type, parsed from the GameEvent union, with a representative payload.
const busTypes = [...read('../src/game/bus.ts').matchAll(/\|\s*\{\s*type:\s*'([\w-]+)'/g)].map((m) => m[1]);
const P = { x: 1, y: 0.5, z: -3 };
const SAMPLES = {
  grab: { kind: 'stick', ...P },
  drop: { kind: 'log', hard: true, ...P },
  snap: { kind: 'stick', target: 'bay-0', ...P },
  reject: { kind: 'meat', reason: 'bay', ...P },
  lighter: { lit: true, ...P },
  'fire-lit': { ...P },
  'fire-out': { ...P },
  'fuel-added': { kind: 'log', fuel: 35 },
  ingredient: { kind: 'meat', ...P },
  stir: { progress: 0.4 },
  'stew-ready': { recipe: 'hearty' },
  'bowl-filled': { recipe: 'hearty' },
  roasted: { ...P },
  eat: { kind: 'berries', hunger: 60 },
  strike: { count: 1, valid: true, ...P },
  crafted: { product: 'torch', learned: false, ...P },
  chop: { node: 'deadwood', remaining: 2, ...P },
  harvest: { kind: 'berries', ...P },
  'torch-lit': { ...P },
  pack: { state: 'unrolled', ...P },
  page: { index: 3, first: true },
  'recipe-learned': { product: 'torch' },
  objective: { index: 2 },
  throw: { kind: 'spear', speed: 8, ...P },
  hit: { kind: 'spear', species: 'wolf', killed: false, ...P },
  'crossbow-fire': { loaded: 0, ...P },
  'crossbow-empty': { ...P },
  reload: { charges: 1, ...P },
  'sentry-deployed': { ...P },
  'sentry-fire': { ...P },
  creature: { species: 'wolf', cue: 'howl', ...P },
  hurt: { amount: 20, cause: 'bite' },
  death: { ...P },
  respawn: { ...P },
  phase: { phase: 'dawn', day: 2 },
  sleep: { day: 2 },
  stage: { stage: 1 },
  beacon: { progress: 1, lit: true },
  ending: {},
  toast: { text: 'hi', tone: 'info' },
  thud: { kind: 'bolt', ...P },
  'bench-set': { product: 'torch', valid: true, known: true },
  'fire-smothered': { rate: 0.5 },
  'brazier-lit': { role: 'outpost', ...P },
  'ending-step': { step: 'theme' },
  'journey-start': { resumed: false },
  'new-game': {},
  'sentry-empty': { x: 1, y: 0, z: 0 },
  guide: { id: 'intro', text: 'Hello', seconds: 2 },
  'guide-end': { id: 'intro', cut: false },
  'journey-begin': { resumed: false },
  'spawn-item': { kind: 'stick', ...P },
  'finale-hold': { active: true },
  'finale-wave': { wave: 1, count: 2 },
  'well-fed': { seconds: 90 },
  'beacon-pressed': { count: 2, joined: true },
  epilogue: { days: 4, deaths: 1, crafted: 6, slain: 5 },
};
// Silent by design: toasts, requests, and 'ending' (the theme starts on ending-step 'theme').
const SILENT = new Set(['toast', 'new-game', 'spawn-item', 'ending', 'guide', 'guide-end', 'journey-begin', 'finale-wave', 'well-fed', 'epilogue']);
const ev = (type, extra = {}) => ({ type, ...SAMPLES[type], ...extra });

test('every bus event type is covered: sounding ones map to a registered clip', () => {
  assert.ok(busTypes.length >= 47, `parsed ${busTypes.length} bus event types`);
  for (const type of busTypes) {
    assert.ok(type in SAMPLES, `bus event '${type}' has no test sample (map it in audio-map.ts, then add it here)`);
    const cue = mapEvent(ev(type));
    if (SILENT.has(type)) { assert.equal(cue, null, type); continue; }
    assert.ok(cue, `bus event '${type}' is silent`);
    assert.ok(cue.clip in CLIP_DEFS, `${type} → unknown clip ${cue.clip}`);
    assert.ok(cue.volume > 0 && cue.volume <= 1, `${type} volume ${cue.volume}`);
    assert.equal(cue.positional, CLIP_DEFS[cue.clip].positional, `${type} positional flag`);
  }
});

test('every clip and variant is registered and synthesized; defs are sane', () => {
  for (const id of Object.keys(CLIP_DEFS)) {
    for (let k = 0; k < CLIP_DEFS[id].variants; k++) {
      const take = variantId(id, k);
      assert.equal(take, k ? `${id}-${k + 1}` : id);
      assert.ok(registry.has(take), `clip ${take} missing from audio-assets.ts`);
      assert.ok(existsSync(audioFile(take)), `public/audio/${registry.get(take)} missing (run node scripts/synth-audio.mjs)`);
    }
  }
  for (const id of LOOPS) {
    assert.ok(registry.has(id), `clip ${id} missing from audio-assets.ts`);
    assert.ok(existsSync(audioFile(id)), `public/audio/${registry.get(id)} missing`);
  }
  for (const id of LOOPS) assert.match(registry.get(id), /\.ogg$/, `${id} loop should be gapless ogg`);
  // Every registered id is either a def, a take of one, or a loop.
  const takes = new Set(Object.keys(CLIP_DEFS).flatMap((id) => Array.from({ length: CLIP_DEFS[id].variants }, (_, k) => variantId(id, k))));
  for (const id of registry.keys()) assert.ok(takes.has(id) || LOOPS.includes(id), `orphan clip ${id}`);
  for (const [id, def] of Object.entries(CLIP_DEFS)) {
    assert.ok(def.voices >= 1 && Math.max(def.voices, def.variants) <= 6, `${id} voices`);
    assert.ok(def.variants >= 1, `${id} variants`);
    assert.ok(def.volume > 0 && def.volume <= 1, `${id} volume`);
    assert.ok(def.cooldown >= 0 && def.refDistance > 0 && def.maxDistance > def.refDistance, `${id} spatial`);
  }
  for (const id of Object.keys(DUCK)) assert.ok(id in CLIP_DEFS, `duck ${id}`);
  // The frequent sounds rotate takes.
  for (const id of ['chop', 'hammer-clank', 'drop', 'drop-light', 'grab', 'hit', 'wolf-howl', 'wolf-growl', 'rustle']) {
    assert.ok(CLIP_DEFS[id].variants >= 2, `${id} should have variants`);
  }
});

test('audio ids do not collide with other asset registries in the shared manifest', () => {
  const keysOf = (path, name) => {
    const src = read(path);
    const start = src.indexOf(`${name} = {`);
    assert.ok(start >= 0, `${name} in ${path}`);
    const body = src.slice(start, src.indexOf('\n};', start) + 1 || undefined);
    const inline = /=\s*\{([^}\n]*)\}/.exec(body);
    if (inline && !body.includes('\n')) return inline[1].split(',').map((s) => s.trim().split(':')[0].replace(/'/g, '')).filter(Boolean);
    return [...body.matchAll(/^\s*'?([\w-]+)'?\s*[:,]/gm)].map((m) => m[1]);
  };
  const others = new Set([
    ...keysOf('../src/scene-assets/items.scene-asset.ts', 'itemAssets'),
    ...keysOf('../src/scene-assets/valley-assets.ts', 'valleyAssets'),
    ...keysOf('../src/game/ui-assets.ts', 'uiAssets'),
    ...keysOf('../src/assets.ts', 'campAssets'),
    ...(/creatureAssets = \{([^}]*)\}/.exec(read('../src/scene-assets/creatures.scene-asset.ts'))?.[1].split(',').map((s) => s.trim()) ?? []),
  ]);
  assert.ok(others.has('page') && others.has('brazier') && others.has('wolf'), 'registry key parsing works');
  for (const id of registry.keys()) assert.ok(!others.has(id), `audio id '${id}' collides with another asset id`);
});

test('positional cues carry the event position; fixed-location cues use the camp and spire', () => {
  const chop = mapEvent(ev('chop'));
  assert.deepEqual([chop.clip, chop.positional, chop.x, chop.y, chop.z], ['chop', true, P.x, P.y, P.z]);
  const stir = mapEvent(ev('stir'));
  assert.deepEqual([stir.clip, stir.x, stir.y, stir.z], ['stir', CAMP.pot.x, CAMP.pot.y, CAMP.pot.z]);
  const fuel = mapEvent(ev('fuel-added'));
  assert.deepEqual([fuel.clip, fuel.x, fuel.z], ['ignite', CAMP.fire.x, CAMP.fire.z]);
  assert.ok(fuel.volume < mapEvent(ev('fire-lit')).volume, 'fuel flare is softer than ignition');
  const beacon = mapEvent(ev('beacon'));
  assert.deepEqual([beacon.clip, beacon.x, beacon.z, beacon.refDistance], ['brazier-ignite', LANDMARKS.beacon.x, LANDMARKS.beacon.z, 12]);
  assert.equal(mapEvent(ev('beacon', { lit: false, progress: 0.5 })), null, 'the build-up is the progress-driven loop');
  const smother = mapEvent(ev('fire-smothered'));
  assert.deepEqual([smother.clip, smother.x, smother.z], ['smother', CAMP.fire.x, CAMP.fire.z]);
  const bench = mapEvent(ev('bench-set'));
  assert.deepEqual([bench.clip, bench.x, bench.z], ['bench-ready', CAMP.bench.x, CAMP.bench.z]);
  const brazier = mapEvent(ev('brazier-lit'));
  assert.deepEqual([brazier.clip, brazier.x, brazier.z], ['brazier-ignite', P.x, P.z]);
  assert.equal(mapEvent(ev('eat')).positional, false);
});

test('event details pick the right variant', () => {
  assert.equal(mapEvent(ev('strike', { valid: true })).clip, 'hammer-clank');
  assert.equal(mapEvent(ev('strike', { valid: false })).clip, 'invalid-clunk');
  assert.equal(mapEvent(ev('chop', { remaining: 0 })).clip, 'wood-split');
  assert.equal(mapEvent(ev('chop', { node: 'stump', remaining: 3 })).clip, 'wood-split');
  const heavy = mapEvent(ev('drop', { kind: 'log', hard: true }));
  const soft = mapEvent(ev('drop', { kind: 'log', hard: false }));
  assert.equal(heavy.clip, 'drop');
  assert.ok(soft.volume < heavy.volume);
  assert.equal(mapEvent(ev('drop', { kind: 'berries' })).clip, 'drop-light');
  assert.equal(mapEvent(ev('drop', { kind: 'bolt', hard: true })).clip, 'bolt-thunk');
  assert.equal(mapEvent(ev('drop', { kind: 'spear', hard: true })).clip, 'bolt-thunk');
  assert.equal(mapEvent(ev('drop', { kind: 'bolt', hard: false })).clip, 'drop-light');
  assert.equal(mapEvent(ev('thud', { kind: 'bolt' })).clip, 'bolt-thunk');
  assert.equal(mapEvent(ev('thud', { kind: 'spear' })).clip, 'bolt-thunk');
  assert.equal(mapEvent(ev('thud', { kind: 'hammer' })).clip, 'knock');
  assert.equal(mapEvent(ev('thud', { kind: 'axe' })).clip, 'knock');
  assert.equal(mapEvent(ev('bench-set', { valid: false, product: '', known: false })).clip, 'invalid-clunk');
  assert.equal(mapEvent(ev('lighter', { lit: false })).clip, 'lid-clink');
  assert.equal(mapEvent(ev('crossbow-empty')).clip, 'dry-click');
  assert.equal(mapEvent(ev('grab', { kind: 'page' })).clip, 'sfx-page');
  assert.equal(mapEvent(ev('pack', { state: 'held' })).clip, 'sfx-pack-roll');
  assert.equal(mapEvent(ev('pack', { state: 'worn' })).clip, 'snap');
  assert.equal(mapEvent(ev('harvest', { kind: 'plank' })), null, 'the stump split already sounds');
  assert.equal(mapEvent(ev('harvest', { kind: 'flint' })).clip, 'drop-light');
  assert.equal(mapEvent(ev('crafted', { learned: true })), null, 'recipe-learned plays alone');
  assert.equal(mapEvent(ev('hit', { kind: 'torch' })).clip, 'ignite');
  assert.equal(mapEvent(ev('throw', { speed: 1 })), null, 'gentle tosses are silent');
  assert.ok(mapEvent(ev('throw', { kind: 'stick', speed: 8 })).volume < mapEvent(ev('throw', { kind: 'spear', speed: 8 })).volume);
  const cues = { howl: 'wolf-howl', growl: 'wolf-growl', bite: 'wolf-bite', dissolve: 'wolf-dissolve', flee: 'deer-flee', stalk: 'wolf-pant', yelp: 'wolf-yelp' };
  for (const [cue, clip] of Object.entries(cues)) assert.equal(mapEvent(ev('creature', { cue })).clip, clip);
  const spawn = mapEvent(ev('creature', { cue: 'spawn' }));
  assert.equal(spawn.clip, 'wolf-howl');
  assert.ok(spawn.volume < mapEvent(ev('creature', { cue: 'howl' })).volume, 'the spawn call is quieter');
  assert.equal(mapEvent(ev('creature', { species: 'deer', cue: 'spawn' })), null);
  assert.ok(mapEvent(ev('creature', { species: 'rabbit', cue: 'flee' })).volume < mapEvent(ev('creature', { species: 'deer', cue: 'flee' })).volume);
  assert.ok(CLIP_DEFS['wolf-howl'].refDistance > CLIP_DEFS['wolf-bite'].refDistance, 'howls carry across the valley');
  assert.ok(CLIP_DEFS['wolf-growl'].cooldown < DANGER.pincerStagger, 'a pincer\'s second growl is heard, from its own side');
});

test('stingers and the finale sequence', () => {
  assert.equal(mapEvent(ev('phase', { phase: 'dawn' })).clip, 'dawn');
  assert.equal(mapEvent(ev('phase', { phase: 'dusk' })).clip, 'dusk');
  for (const phase of ['day', 'night']) assert.equal(mapEvent(ev('phase', { phase })), null);
  assert.equal(mapEvent(ev('stage', { stage: 0 })), null);
  assert.equal(mapEvent(ev('stage', { stage: 2 })).clip, 'stage');
  assert.equal(mapEvent(ev('sleep')).clip, 'sleep');
  assert.equal(mapEvent(ev('death')).clip, 'death');
  assert.equal(mapEvent(ev('ending')), null, 'the theme moved to the theme step');
  const steps = { 'spire-eye': 'spire-eye', dawn: 'dawn', camp: 'brazier-ignite', theme: 'ending', outpost: null, grove: null, smoke: null };
  for (const [step, clip] of Object.entries(steps)) assert.equal(mapEvent(ev('ending-step', { step }))?.clip ?? null, clip, step);
  const camp = mapEvent(ev('ending-step', { step: 'camp' }));
  assert.deepEqual([camp.x, camp.z], [CAMP.fire.x, CAMP.fire.z]);
  assert.equal(mapEvent(ev('ending-step', { step: 'theme' })).positional, false);
  assert.ok(CLIP_DEFS.dawn.cooldown >= 10, 'finale dawn and day-cycle dawn dedupe');
  assert.equal(mapEvent(ev('journey-start', { resumed: false })).clip, 'journey');
  assert.equal(mapEvent(ev('journey-start', { resumed: true })), null);
});

test('out-parameter is reused (no allocation per event)', () => {
  const out = createCue();
  assert.equal(mapEvent(ev('chop'), out), out);
  assert.equal(mapEvent(ev('hurt'), out), out);
  assert.equal(out.clip, 'player-hurt');
  assert.equal(out.positional, false);
});

test('sentry dry click is placed at the sentry; a hurt with an attacker lands on its side', () => {
  const dry = mapEvent(ev('sentry-empty', { x: 6, y: 0.8, z: -9 }));
  assert.deepEqual([dry.clip, dry.positional, dry.x, dry.y, dry.z], ['sentry-dry', true, 6, 0.8, -9]);
  assert.ok(CLIP_DEFS['sentry-dry'].maxDistance <= 40, 'a far sentry is not heard at all');
  assert.equal(mapEvent(ev('crossbow-empty')).clip, 'dry-click', 'the hand-held crossbow keeps its own click');
  const struck = mapEvent(ev('hurt', { amount: 20, cause: 'wolf', x: 4, z: -2 }));
  assert.deepEqual([struck.clip, struck.positional, struck.x, struck.z], ['player-struck', true, 4, -2]);
  assert.ok(CLIP_DEFS['player-struck'].near > 0 && CLIP_DEFS['player-struck'].near < 1, 'placed just off the head');
  assert.equal(struck.volume, mapEvent(ev('hurt', { amount: 20 })).volume, 'same level as the head-locked hurt');
  assert.equal(mapEvent(ev('hurt', { amount: 1.5, cause: 'starving' })).clip, 'player-hurt');
});

test('heartbeat rhythm shared with the vignette', () => {
  assert.equal(HEARTBEAT.on, 30);
  assert.equal(HEARTBEAT.period, 0.75);
  assert.equal(HEARTBEAT.dub, 0.36);
  const beat = CLIP_DEFS.heartbeat;
  assert.equal(beat.positional, false);
  assert.ok(beat.cooldown < HEARTBEAT.period, 'every beat plays');
  assert.ok(!registry.get('heartbeat').endsWith('.ogg'), 'a one-shot on the beat clock, not a free-running loop');
});

test('footsteps: soft takes per surface, dirt on camp, trails, shelves and banks', () => {
  for (const id of ['step-grass', 'step-dirt']) {
    assert.ok(CLIP_DEFS[id].variants >= 4, `${id} takes`);
    assert.ok(CLIP_DEFS[id].volume <= 0.6, `${id} is soft`);
    assert.ok(CLIP_DEFS[id].cooldown < STEP.minStride / STEP.walk, `${id} keeps up with a walk`);
  }
  // A walking cadence, not a scurry: ~2.4 steps/s at the 2.6 m/s locomotion speed, fewer when slower.
  assert.equal(strideFor(STEP.walk), STEP.stride);
  const rate = STEP.walk / strideFor(STEP.walk);
  assert.ok(rate > 2.2 && rate < 2.6, `${rate.toFixed(2)} steps/s at a walk`);
  assert.ok(1.8 / strideFor(1.8) <= rate, 'the slow setting steps no faster');
  assert.equal(strideFor(0.2), STEP.minStride);
  assert.equal(strideFor(9), STEP.stride);
  const far = 99;
  assert.equal(stepSurface(0, -1, far), 'step-dirt', 'camp clearing');
  assert.equal(stepSurface(-12, 3, far), 'step-grass', 'open ground');
  assert.equal(stepSurface(-12, 3, 0.4), 'step-dirt', 'on a trail');
  assert.equal(stepSurface(LANDMARKS.outpost.x, LANDMARKS.outpost.z, far), 'step-dirt', 'outpost shelf');
  assert.equal(stepSurface(LANDMARKS.spire.x, LANDMARKS.spire.z, far), 'step-dirt', 'Spire plateau');
  const bank = LANDMARKS.brook[3];
  assert.equal(stepSurface(bank.x - 1.5, bank.z, far), 'step-dirt', 'brook gravel');
  const out = createCue();
  const step = stepCue(-12, 0.1, 3, far, STEP.walk, out);
  assert.equal(step, out);
  assert.deepEqual([step.clip, step.positional, step.x, step.y, step.z], ['step-grass', true, -12, 0.1, 3]);
  assert.ok(stepCue(-12, 0, 3, far, 0.5).volume < step.volume, 'creeping is softer');
});

test('loop curves', () => {
  assert.equal(dayBedGain(0), 1);
  assert.ok(nightBedGain(0) < 1e-9);
  assert.ok(Math.abs(nightBedGain(1) - 1) < 1e-9 && dayBedGain(1) < 1e-9);
  for (const n of [0.1, 0.5, 0.9]) assert.ok(Math.abs(dayBedGain(n) ** 2 + nightBedGain(n) ** 2 - 1) < 1e-9, 'equal-power crossfade');
  assert.equal(fireLoopVolume(false, 80), 0);
  assert.ok(fireLoopVolume(true, 5) < fireLoopVolume(true, 50));
  assert.equal(fireLoopVolume(true, 100), 1);
  assert.equal(beaconBuildVolume(0, false), 0);
  assert.equal(beaconBuildVolume(0.8, true), 0, 'silent once lit');
  assert.ok(beaconBuildVolume(0.2, false) > 0 && beaconBuildVolume(0.2, false) < beaconBuildVolume(0.9, false), 'rises with progress');
  assert.ok(HEARTBEAT.off > HEARTBEAT.on, 'hysteresis');
  assert.ok(heartbeatVolume(5) > heartbeatVolume(25));
  assert.ok(heartbeatVolume(29) >= 0.45 && heartbeatVolume(1) <= 1);
});

test('nearest brook point', () => {
  const out = { x: 0, z: 0 };
  const [a, b] = LANDMARKS.brook;
  const d = nearestOnPolyline(LANDMARKS.brook, a.x - 5, a.z, out);
  assert.ok(Math.abs(d - Math.hypot(out.x - (a.x - 5), out.z - a.z)) < 1e-9);
  assert.ok(d <= 5 + 1e-9);
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  assert.ok(nearestOnPolyline(LANDMARKS.brook, mx, mz, out) < 1e-9);
  assert.ok(Math.abs(out.x - mx) < 1e-9 && Math.abs(out.z - mz) < 1e-9);
  const last = LANDMARKS.brook[LANDMARKS.brook.length - 1];
  nearestOnPolyline(LANDMARKS.brook, last.x, last.z - 50, out);
  assert.deepEqual([out.x, out.z], [last.x, last.z]);
});

test('hand sounds sit at the hand, never inside the head', () => {
  for (const [type, extra, clip] of [
    ['grab', { kind: 'stick' }, 'grab'], ['lighter', { lit: true }, 'lighter-flick'], ['lighter', { lit: false }, 'lid-clink'],
    ['reload', { charges: 3 }, 'reload-click'], ['crossbow-empty', {}, 'dry-click'],
  ]) {
    const cue = mapEvent(ev(type, { ...extra, x: 1.5, y: 1.1, z: -2 }));
    assert.deepEqual([cue.clip, cue.positional, cue.x, cue.y, cue.z], [clip, true, 1.5, 1.1, -2], `${type} ${clip}`);
    assert.ok(CLIP_DEFS[clip].refDistance <= 0.5 && CLIP_DEFS[clip].maxDistance <= 15, `${clip} is a close, small sound`);
  }
});

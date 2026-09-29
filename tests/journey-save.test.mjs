import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const save = await loadTs('src/game/save.ts');
const story = await loadTs('src/game/story.ts');

/** In-memory localStorage stand-in (the save module only touches getItem/setItem/removeItem). */
function useStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
  return map;
}

function sample(overrides = {}) {
  return {
    v: 1,
    savedAt: 1,
    game: {
      hunger: 40, health: 80, clock: 120, day: 3, stage: 1,
      objectives: 0b1011, pages: 0b11, recipes: 0b11, respawn: [-0.8, 0, -2.55],
      ended: false, deaths: 1, guide: 'intro,fire', ...overrides.game,
    },
    fire: { fuel: 50, lit: true, potA: '', potB: '', stir: 0, stew: '' },
    pack: { state: 'worn', p: [0, 0, 0], yaw: 0, lost: false },
    items: [{ uid: 'rt-1', kind: 'log', slot: '', variant: '', charges: 0, lit: false, p: [1, 0, 1], q: [0, 0, 0, 1] }],
    consumed: ['meat-camp', 'stick-camp-1'],
    nodes: [{ id: 'deadwood-1', available: false, hits: 0 }],
    beacons: [{ id: 'grove-brazier', lit: false }],
    sentries: [],
    ...overrides.top,
  };
}

test('a save round-trips through storage, including the guide lines and the consumed ledger', () => {
  useStorage();
  assert.equal(save.readSave(), null);
  assert.equal(save.hasSave(), false);
  assert.ok(save.writeSave(sample()));
  const back = save.readSave();
  assert.ok(back);
  assert.equal(back.game.guide, 'intro,fire');
  assert.deepEqual(back.consumed, ['meat-camp', 'stick-camp-1']);
  assert.equal(save.hasSave(), true);
});

test('a new journey clears the save: nothing from the old journey can be continued', () => {
  const storage = useStorage();
  save.writeSave(sample());
  save.clearSave();
  assert.equal(storage.size, 0);
  assert.equal(save.readSave(), null);
  // Clearing twice (reset path clears before and after the level reload) is harmless.
  save.clearSave();
  assert.equal(save.readSave(), null);
});

test('malformed or foreign saves read as "no save" so Continue never half-applies a journey', () => {
  assert.equal(save.parseSave(null), null);
  assert.equal(save.parseSave(''), null);
  assert.equal(save.parseSave('{not json'), null);
  assert.equal(save.parseSave(JSON.stringify({ ...sample(), v: 2 })), null);
  assert.equal(save.parseSave(JSON.stringify({ ...sample(), game: null })), null);
  assert.equal(save.parseSave(JSON.stringify(sample({ game: { day: 'three' } }))), null);
  assert.equal(save.parseSave(JSON.stringify(sample({ top: { consumed: undefined } }))), null);
  assert.equal(save.parseSave(JSON.stringify(sample({ game: { respawn: [0, 0] } }))), null);
  assert.ok(save.parseSave(JSON.stringify(sample())));
});

test('every saved entry is validated, so Continue never throws halfway through', () => {
  const bad = (top) => save.parseSave(JSON.stringify(sample({ top })));
  const item = sample().items[0];
  assert.equal(bad({ items: [{ ...item, p: [1, 0] }] }), null, 'item position must be 3 numbers');
  assert.equal(bad({ items: [{ ...item, q: [0, 0, 0, 'w'] }] }), null, 'item rotation must be 4 numbers');
  assert.equal(bad({ items: [{ ...item, uid: 7 }] }), null);
  assert.equal(bad({ items: [{ ...item, lit: 'yes' }] }), null);
  assert.equal(bad({ items: [null] }), null);
  assert.equal(bad({ consumed: ['meat-camp', 3] }), null);
  assert.equal(bad({ nodes: [{ id: 'deadwood-1', available: 'no', hits: 0 }] }), null);
  assert.equal(bad({ beacons: [{ id: 'grove-brazier' }] }), null);
  assert.equal(bad({ sentries: [{ uid: 'sentry', bolts: null }] }), null);
  assert.equal(bad({ fire: { fuel: 50, lit: true, potA: '', potB: '', stir: 0 } }), null, 'fire needs every field');
  assert.equal(bad({ pack: { state: 'worn', p: [0, 0], yaw: 0, lost: false } }), null);
  assert.equal(save.parseSave(JSON.stringify(sample({ game: { respawn: [0, 'x', 0] } }))), null);
  assert.equal(save.parseSave(JSON.stringify(sample({ game: { ended: 'no' } }))), null);
  // Fields added after v1 default when absent.
  const old = sample();
  delete old.game.deaths;
  delete old.game.ended;
  delete old.pack;
  const parsed = save.parseSave(JSON.stringify(old));
  assert.ok(parsed);
  assert.equal(parsed.game.deaths, 0);
  assert.equal(parsed.game.ended, false);
  assert.equal(parsed.pack, null);
});

test('saves from before the guide field still load', () => {
  const old = sample();
  delete old.game.guide;
  const parsed = save.parseSave(JSON.stringify(old));
  assert.ok(parsed);
  assert.equal(parsed.game.guide, undefined);
});

test('storage failures never throw into the game', () => {
  globalThis.localStorage = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('quota'); },
    removeItem: () => { throw new Error('denied'); },
  };
  assert.equal(save.readSave(), null);
  assert.equal(save.writeSave(sample()), false);
  assert.doesNotThrow(() => save.clearSave());
  delete globalThis.localStorage;
  assert.equal(save.readSave(), null);
});

test('Continue names the saved day and progress', () => {
  const s = sample();
  const summary = save.summarizeSave(s);
  assert.equal(summary.day, 3);
  assert.equal(summary.objectivesDone, 3);
  assert.equal(summary.objectivesTotal, story.OBJECTIVES.length);
  assert.equal(summary.pagesFound, 2);
  assert.equal(summary.pagesTotal, story.PAGES.length);
  assert.equal(save.continueLabel(s), `Day 3 - 3 of ${story.OBJECTIVES.length} objectives - 2 of ${story.PAGES.length} pages`);
  assert.equal(save.continueLabel(sample({ game: { ended: true, day: 5 } })), 'Day 5 - the beacon burns');
  // Font-safe: the start panel's MSDF atlases are ASCII + Latin-1.
  assert.match(save.continueLabel(s), /^[\x20-\x7e]+$/);
});

test('the start panel hook is built from the opening and fits the panel', () => {
  assert.equal(story.START.title, 'Prometheus — First Fire');
  assert.ok(story.START.hook.length >= 2 && story.START.hook.length <= 3);
  assert.ok(story.START.hook.join(' ').includes(story.OPENING.title));
  for (const line of story.START.hook) assert.ok(line.length <= 140, line);
});

test('the epilogue tally (crafted, slain) round-trips and defaults to 0 in older saves', () => {
  useStorage();
  save.writeSave(sample({ game: { crafted: 7, slain: 4 } }));
  const back = save.readSave();
  assert.equal(back.game.crafted, 7);
  assert.equal(back.game.slain, 4);
  const old = sample();
  delete old.game.crafted;
  delete old.game.slain;
  const parsed = save.parseSave(JSON.stringify(old));
  assert.equal(parsed.game.crafted, 0);
  assert.equal(parsed.game.slain, 0);
  assert.equal(save.parseSave(JSON.stringify(sample({ game: { crafted: 'many' } }))), null, 'a malformed tally is no save');
});

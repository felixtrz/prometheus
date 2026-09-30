import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/load-ts.mjs';

function withStorage(initial) {
  const store = new Map(initial ? [['prometheus.settings.v1', JSON.stringify(initial)]] : []);
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  return store;
}

test('settings default sensibly and persist changes', async () => {
  const store = withStorage();
  const m = await loadTs('src/game/settings.ts');
  assert.deepEqual({ ...m.settings }, { moveSpeed: 'normal', tunnel: 'on', turn: 'snap45', reduceFlashes: false, subtitles: true });
  let heard = 0;
  const off = m.onSettings(() => heard++);
  m.updateSettings({ moveSpeed: 'slow', turn: 'smooth' });
  assert.equal(heard, 1);
  assert.equal(JSON.parse(store.get(m.SETTINGS_KEY)).turn, 'smooth');
  off();
  m.updateSettings({ tunnel: 'off' });
  assert.equal(heard, 1, 'unsubscribed listeners stay quiet');
  assert.equal(m.MOVE_SPEED.slow < m.MOVE_SPEED.normal && m.MOVE_SPEED.normal < m.MOVE_SPEED.fast, true);
  assert.equal(m.MOVE_SPEED.fast, 3.2);
  assert.deepEqual(m.TUNNEL_STRENGTH, { off: 0, on: 0.55, strong: 0.8 });
  assert.equal(m.TURN_ANGLE.snap30, 30);
  assert.equal(m.TURN_ANGLE.snap45, 45);
});

test('old saves migrate: tunnel booleans and turn "snap"', async () => {
  const m = await loadTs('src/game/settings.ts');
  assert.deepEqual(m.parseSettings({ moveSpeed: 'slow', tunnel: false, turn: 'snap', reduceFlashes: true, subtitles: false }),
    { moveSpeed: 'slow', tunnel: 'off', turn: 'snap45', reduceFlashes: true, subtitles: false });
  assert.equal(m.parseSettings({ tunnel: true }).tunnel, 'on');
  assert.equal(m.parseSettings({ turn: 'smooth' }).turn, 'smooth');
  // Unknown values fall back to the defaults; an unset flash choice follows reduced motion.
  assert.deepEqual(m.parseSettings({ moveSpeed: 'warp', tunnel: 3, turn: 'snap90' }, true),
    { moveSpeed: 'normal', tunnel: 'on', turn: 'snap45', reduceFlashes: true, subtitles: true });
});

test('cycleSetting steps every control the same way for every UI', async () => {
  withStorage();
  // One module instance per test file: start from the defaults.
  const m = await loadTs('src/game/settings.ts');
  m.updateSettings({ ...m.DEFAULT_SETTINGS });
  const seen = (key, n) => Array.from({ length: n }, () => { m.cycleSetting(key); return m.settingText(key); });
  assert.deepEqual(seen('speed', 3), ['Fast', 'Slow', 'Normal']);
  assert.deepEqual(seen('tunnel', 3), ['Strong', 'Off', 'On']);
  assert.deepEqual(seen('turn', 3), ['Smooth', 'Snap 30°', 'Snap 45°']);
  assert.equal(m.settingText('turn', true), '45°');
  m.cycleSetting('tunnel'); m.cycleSetting('tunnel');
  assert.equal(m.settingLit('tunnel'), false, 'tunnel off reads quiet');
  const flashes = m.settings.reduceFlashes;
  m.cycleSetting('flashes');
  assert.equal(m.settings.reduceFlashes, !flashes);
  m.cycleSetting('subs');
  assert.equal(m.settings.subtitles, false);
});

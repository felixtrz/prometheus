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
  assert.deepEqual({ ...m.settings }, { moveSpeed: 'normal', tunnel: true, turn: 'snap', reduceFlashes: false, subtitles: true });
  let heard = 0;
  const off = m.onSettings(() => heard++);
  m.updateSettings({ moveSpeed: 'slow', turn: 'smooth' });
  assert.equal(heard, 1);
  assert.equal(JSON.parse(store.get(m.SETTINGS_KEY)).turn, 'smooth');
  off();
  m.updateSettings({ tunnel: false });
  assert.equal(heard, 1, 'unsubscribed listeners stay quiet');
  assert.equal(m.MOVE_SPEED.slow < m.MOVE_SPEED.normal, true);
});

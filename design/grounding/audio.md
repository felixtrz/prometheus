# Audio grounding (IWSDK @iwsdk/core 0.5.3, three 0.181.0)

Source ladder used: rung 3 (installed `node_modules/@iwsdk/core/dist/audio/*.d.ts` + the
matching `.js` for behaviour), rung 1 (`npx iwsdk reference search|examples|file`, corpus
0.5.3), rung 2 (`api-reference.md` §10). Where rung 2 and rung 3 disagree, rung 3 wins
(noted inline). Everything below was confirmed in the installed code unless marked
**UNCONFIRMED**.

Headline: `AudioSource` + `AudioSystem` give per-entity pooled `THREE.Audio` /
`THREE.PositionalAudio` (HRTF `PannerNode`) playback that follows the entity transform, with
the listener on the XR head. Loops, positional beds, per-play fades and live volume are
built in. **Not** built in: time-of-day crossfade between *different* clips, one-shots at
arbitrary positions (`AudioUtils.createOneShot` is a stub), master volume, a gesture unlock
for non-XR play, voice limiting (the distance-culling config is a no-op).

---

## (a) Mechanic grounding

| Mechanic | Class | Exact IWSDK pieces | Custom work remaining | Risks |
| --- | --- | --- | --- | --- |
| Forest-day bed (wind, birds), non-positional loop | BUILT-IN | `AudioSource{src:'amb-day', positional:false, loop:true, autoplay:true, volume:1}` on a persistent entity (or scene node) | none beyond the crossfade row | mp3 loop seam (see gotchas G10); decoded PCM RAM (G11) |
| Night bed (crickets, low wind), non-positional loop | BUILT-IN | same as above, `src:'amb-night'`, `volume:0` initially | none beyond the crossfade row | same |
| Day/night ambience crossfade (dusk 30 s, dawn 30 s, sleep skip) | CUSTOM (thin) | `AudioUtils.setVolume(entity, v)` (live, applied by `AudioSystem.updateActiveInstances` when \|Δ\|>0.01; three ramps gain with `setTargetAtTime(…,0.01)`) | `AudioDirector` maps `dayPhase` → `dayGain`/`nightGain` (equal-power) each frame; writes only when changed. Built-in `PlaybackMode.FadeRestart` / `crossfadeDuration` only crossfades a clip **with itself** on one entity, so it does not apply | none significant; keep both beds running (don't pause, see G5) |
| Campfire crackle, positional loop | BUILT-IN / CONFIGURE | `AudioSource{src:'amb-fire', positional:true, loop:true, autoplay:true, refDistance:1.5, rolloffFactor:1.5, distanceModel:'inverse'}` on the campfire scene node (or a child node). Pool container is parented to `entity.object3D`, so the `PannerNode` tracks the entity transform | volume = f(fire intensity) via `setVolume`; `AudioUtils.stop` when fire dies, `AudioUtils.play(e, 1.5)` when lit | autoplay flag self-clears after first trigger (G7) |
| Brook, positional loop | BUILT-IN / CONFIGURE | scene node with `AudioSource{positional:true, loop:true, autoplay:true, distanceModel:'linear', maxDistance:25}` | none | none |
| Beacon roar (starts at ending) | BUILT-IN | positional loop `AudioSource` on the brazier node, `autoplay:false`; `AudioUtils.play(e, 2)` | trigger from ending system | none |
| One-shot SFX at arbitrary world positions (chop, split, hammer, plop, stir, whoosh, thud, twang, thunk, hit, howl/growl/bite/dissolve, deer flee, sentry fire, …) | CUSTOM on BUILT-IN | N persistent voice entities (`world.createTransformEntity(undefined,{persistent:true})`) each with `AudioSource{positional:true, maxInstances:1, playbackMode:'restart'}`; per play: move `entity.object3D.position`, swap buffer (`_buffer` ← `AssetManager.getAudio(id)`), set `volume/refDistance/rolloffFactor/maxDistance` (all live), `AudioUtils.play(voice)` | voice allocator + priority stealing + busy-until bookkeeping in `AudioDirector`. **Do not use `AudioUtils.createOneShot`** (G1) | writes one internal field (`_buffer`) — version-pin risk (G2); HRTF cost per concurrent voice on Quest (G12) |
| Head-locked / UI one-shots (grab tick, slot snap, craft complete, invalid clunk, recipe learned, page rustle, pack roll, reload click, lighter flick, eat, bowl fill, player hurt) | CUSTOM on BUILT-IN | same voice pool but `positional:false` voices (non-positional `THREE.Audio` plays "from the listener") | allocator shared with the positional pool | none |
| Heartbeat (low health) loop | BUILT-IN | non-positional loop entity; `AudioUtils.play(e, 0.5)` / `AudioUtils.pause(e, 0.5)` (fade-out = stop, G5); volume live | health threshold logic | playbackRate is not exposed on `AudioSource` (UNCONFIRMED any public path; would need `_pool` internals) — vary volume only |
| Stings / music (sleep swell, dawn motif, ending theme, death sting) | BUILT-IN + CUSTOM ducking | non-positional entities, `playbackMode:'restart'`; `AudioUtils.play` | optional duck: scale bed gains while a sting plays (director-side multiplier) | none |
| Listener follows head in XR | BUILT-IN | `AudioSystem.init` does `this.player.head.add(new AudioListener())`; XR frames write the viewer pose into `xrOrigin.head` | none | in non-XR browser mode the head Group is **not** updated from the camera → panning is relative to the rig origin (G8) |
| Autoplay-policy unlock | PARTIAL BUILT-IN + CUSTOM | `AudioSystem` resumes `listener.context` on `renderer.xr` `sessionstart`, suspends + pauses all on `sessionend` | fallback resume on first `pointerdown`/`keydown` and on first XR `selectstart` (belt-and-braces, G6) | whether `resume()` inside `sessionstart` succeeds with `offer:'once'` on Quest Browser is UNCONFIRMED |
| Master volume / mute / settings slider | CUSTOM (thin) | three `AudioListener.setMasterVolume(v)` / `getMasterVolume()`; listener found as child of `this.player.head` (`type === 'AudioListener'`) | locate listener once in `init()`, bind to a `world.globals` signal | none |
| Voice limiting / distance culling | CUSTOM | `AudioSystem` config `enableDistanceCulling` / `cullingDistanceMultiplier` **exist but are never read** in 0.5.3 | the pool size *is* the voice cap; director skips SFX beyond an audible radius | `InstanceStealPolicy.Furthest` is broken (compares local positions, G9) |
| Asset preload | CONFIGURE | `src/assets.ts` entries `{ type: AssetType.Audio, url: url('audio/x.mp3'), priority }`; `AudioSource.src` = **manifest id** (resolved through `CacheManager.keyToUrl`) | pick priorities: beds + frequent SFX `'background'`, rare stings `'lazy'`; default (omitted) is **critical = blocks `World.create`** | a bad id/URL retries every frame (G4) |
| S16 verification ("audio event log") | CUSTOM | `AudioUtils.isPlaying(e)`, `AudioSource._isPlaying` visible via `ecs_find_entities`/`ecs_query_entity` | director appends `{t,id,pos}` to a ring buffer + `console.info('[audio] <id>')` | headless runs cannot hear loop seams / spatialization — needs one on-device listen |

---

## (b) API cheat-sheet (exact installed signatures)

All imported from `@iwsdk/core` (barrel re-exports `./audio/index.js` and all of `three`).

```ts
// dist/audio/index.d.ts
export { AudioSource, PlaybackMode, InstanceStealPolicy, DistanceModel } from './audio.js';
export { AudioSystem } from './audio-system.js';
export { AudioUtils } from './audio-utils.js';
export { AudioPool, type AudioInstance } from './audio-pool.js';

PlaybackMode        = { Restart:'restart', Overlap:'overlap', Ignore:'ignore', FadeRestart:'fade-restart' }
InstanceStealPolicy = { Oldest:'oldest', Quietest:'quietest', Furthest:'furthest' }
DistanceModel       = { Linear:'linear', Inverse:'inverse', Exponential:'exponential' }
```

### `AudioSource` fields (dist/audio/audio.js:56-106)

| Field | Type | Default | When it takes effect |
| --- | --- | --- | --- |
| `src` | `FilePath` (`fileTypes '.mp3,.wav,.ogg,.m4a,.aac'`, `subfolder 'audio'`) | `''` | loaded **once** (`_loaded` never resets); URL *or* manifest id. Empty string = never loads, play requests silently ignored |
| `volume` | Float32 | `1.0` | **live** each frame (non-fading instances, \|Δ\|>0.01) |
| `loop` | Boolean | `false` | at each new instance (`setLoop` in `createAndPlayInstance`) — not retroactive |
| `autoplay` | Boolean | `false` | one play request on first frame after load, then **sets itself to false** |
| `positional` | Boolean | **`true`** | at pool creation (fixed) |
| `refDistance` | Float32 | `1` | live |
| `rolloffFactor` | Float32 | `1` | live |
| `maxDistance` | Float32 | `10000` | live |
| `distanceModel` | Enum `DistanceModel` | `'inverse'` | pool creation only |
| `coneInnerAngle` / `coneOuterAngle` / `coneOuterGain` | Float32 | `360` / `360` / `0` | pool creation only |
| `playbackMode` | Enum `PlaybackMode` | `'restart'` | each play |
| `maxInstances` | Int8 | `1` | pool creation (= pool size, fixed) |
| `crossfadeDuration` | Float32 | `0.1` | `FadeRestart` only |
| `instanceStealPolicy` | Enum `InstanceStealPolicy` | `'oldest'` | `Overlap` only, when pool full |
| `_playRequested` `_pauseRequested` `_stopRequested` `_fadeIn` `_fadeOut` | flags | — | written by `AudioUtils`; consumed next `AudioSystem.update` |
| `_pool` `_instances` `_isPlaying` `_buffer` `_loaded` `_loading` | runtime | — | managed by `AudioSystem` (`_buffer` is read at every play → swappable) |

`PlaybackMode` semantics (audio-system.js:209-246): **Restart** stop all, start one ·
**Overlap** start another up to `maxInstances`, else steal per policy · **Ignore** no-op if
any instance exists · **FadeRestart** fade existing out over `crossfadeDuration` while new
one fades in — needs `maxInstances >= 2` or the new instance is silently dropped.

Yes: positional audio is true 3D — `THREE.PositionalAudio` (`panner.panningModel='HRTF'`,
three PositionalAudio.js:59) inside a hidden `Group` parented to `entity.object3D`
(audio-pool.js:31-39, audio-system.js:150); three updates the panner from `matrixWorld` in
`updateMatrixWorld` every render while playing.

### `AudioUtils` (dist/audio/audio-utils.d.ts)

```ts
static play(entity: Entity, fadeIn?: number): void          // seconds, linear 0→volume
static pause(entity: Entity, fadeOut?: number): void        // fadeOut>0 ⇒ fade then STOP/release
static stop(entity: Entity): void
static isPlaying(entity: Entity): boolean                   // reads _isPlaying
static setVolume(entity: Entity, volume: number): void      // clamps to [0,1]
static getVolume(entity: Entity): number
static preload(entity: Entity): Promise<void>               // polls _loaded every 16 ms
static createOneShot(world: World, src: string, options?: {
  volume?: number; positional?: boolean; position?: { x: number; y: number; z: number };
}): Entity                                                  // STUB — see G1
```

No `fade`/`setLoop`/`setSrc`/`resume`/`setPlaybackRate` exist. All methods only flip component
flags; the work happens in `AudioSystem.update` (priority 0, registered always-on in
`init/world-initializer.js:427`). Callers at priority > 0 (all our systems) get ≤ 1 frame
latency.

### `AudioSystem` (dist/audio/audio-system.d.ts)

```ts
class AudioSystem  // config: enableDistanceCulling: Boolean=true, cullingDistanceMultiplier: Float32=1.5 (both unused in 0.5.3)
// query: audioEntities { required: [AudioSource] }
// init(): listener = new AudioListener(); this.player.head.add(listener);
//         renderer.xr 'sessionstart' → context.resume() + resume session-paused instances
//         renderer.xr 'sessionend'   → pause all playing instances + context.suspend()
```

No master volume API; `listener` is TS-private. Public route: three's
`AudioListener.setMasterVolume(value: number): this` / `getMasterVolume(): number` on the
listener found under the head.

### `AudioPool<T extends Audio | PositionalAudio>` (dist/audio/audio-pool.d.ts)

```ts
constructor(listener: AudioListener, size: number, positional: boolean, parent: Object3D)
acquire(): T | null; release(audio: T): void; releaseAll(): void; dispose(): void
getActiveCount(): number; getTotalCount(): number; getAllInstances(): T[]
```

Used internally one-per-entity; not needed directly.

### Asset side (dist/asset/asset-manager.d.ts, loaders/audio-loader.js, cache-manager.js)

```ts
interface LoadableAssetManifestEntry { url: string; type: AssetType; priority?: 'critical'|'background'|'lazy'; name?: string }
AssetType.Audio = 'audio'
AssetManager.getAudio(key: string): AudioBuffer | null          // key = manifest id OR exact URL
AssetManager.loadAudio(url: string, key?: string): Promise<AudioBuffer>
AssetManager.loadAudioById(assetId: string): Promise<AudioBuffer>
```

- Preload: `preloadAssets` awaits every entry whose priority is not `'background'`/`'lazy'`
  (so **omitted = critical = blocks startup**), then fires background loads; `'lazy'` is only
  registered (id→URL) and loads on first use.
- Buffers are `AudioBuffer`s decoded via `THREE.AudioLoader` (`decodeAudioData`), cached by
  **resolved URL**; ids resolve through `CacheManager.keyToUrl`, so `AudioSource.src:'amb-fire'`
  hits the same cached buffer the manifest preloaded. Many entities sharing one id share one
  buffer.
- Formats: whatever the browser's `decodeAudioData` supports; editor picker advertises
  `.mp3,.wav,.ogg,.m4a,.aac`. Quest Browser (Chromium) decodes all five (UNCONFIRMED on-device
  for `.ogg` Opus; Vorbis is standard in Chromium).

### Usage snippets

```ts
// src/assets.ts — ids, not URLs, flow into AudioSource.src
const url = (p: string) => `${import.meta.env.BASE_URL}${p}`;
'amb-day':   { type: AssetType.Audio, url: url('audio/amb-day.ogg'),   priority: 'background' },
'amb-fire':  { type: AssetType.Audio, url: url('audio/amb-fire.ogg'),  priority: 'background' },
'sfx-chop':  { type: AssetType.Audio, url: url('audio/sfx-chop.mp3'),  priority: 'background' },
'mus-ending':{ type: AssetType.Audio, url: url('audio/mus-ending.mp3'),priority: 'lazy' },
```

```jsonc
// public/scenes/main.iwsdk.scene.json — positional loop authored on the fire node
"components": { "AudioSource": {
  "src": "amb-fire", "positional": true, "loop": true, "autoplay": true,
  "volume": 0.8, "refDistance": 1.5, "rolloffFactor": 1.5, "distanceModel": "inverse"
} }
```

```ts
// runtime beds
const day = world.createTransformEntity(undefined, { persistent: true });
day.addComponent(AudioSource, { src: 'amb-day', positional: false, loop: true, autoplay: true, volume: 1 });
AudioUtils.setVolume(day, 0.4);            // live
AudioUtils.play(beacon, 2);                // 2 s fade-in
AudioUtils.pause(heartbeat, 0.5);          // 0.5 s fade-out, then released (= stop)
// master volume
const listener = world.player.head.children.find((o) => o.type === 'AudioListener') as AudioListener;
listener.setMasterVolume(0.7);
```

---

## (c) Recommended architecture — `AudioDirector` system

One app system, **priority 40** (after gameplay at 10–30 so a frame's events are batched;
play requests are consumed by `AudioSystem` next frame, ≤ 14 ms). Owns every audio entity; no
other system touches `AudioSource` directly — gameplay calls `director.play(id, pos?)`.

### Entities (created once in `init()`, `persistent:true`, never disposed — G3)

| Role | Count | `AudioSource` config |
| --- | --- | --- |
| Beds | 2 (`amb-day`, `amb-night`) | `positional:false, loop:true, autoplay:true` |
| World loops | fire, brook, beacon | authored on scene nodes (ids `campfire-audio`, `brook-audio`, `beacon-audio`), fetched with `world.getSceneEntity(id)` |
| Positional SFX voices | 10 (start; ≤ 12 on Quest) | `positional:true, maxInstances:1, playbackMode:'restart', distanceModel:'inverse', src:<any preloaded sfx id>` |
| Head/UI SFX voices | 4 | `positional:false, maxInstances:1, playbackMode:'restart'` |
| Stings / heartbeat | 1 each | `positional:false`, heartbeat `loop:true` |

Voice entities need a loaded `src` once so `AudioSystem` creates their pool (`_loaded=1`);
after that the director swaps `_buffer` per play.

### Clip table (static data, allocated at module load)

```ts
interface ClipDef { id: string; vol: number; ref: number; roll: number; maxD: number; pri: number; spatial: boolean }
// e.g. chop {vol:.9, ref:2, roll:1.2, maxD:40, pri:2, spatial:true}; wolf-howl {vol:1, ref:8, roll:.6, maxD:200, pri:5}
```

### Sketch

```ts
export class AudioDirector extends createSystem({}, {}) {
  private voices!: Entity[]; private uiVoices!: Entity[];
  private busyUntil!: Float64Array; private voicePri!: Int8Array;   // own bookkeeping (G5/G13)
  private day!: Entity; private night!: Entity; private listener?: AudioListener;
  private log!: { t: number; id: string }[]; private logHead = 0;

  init() {
    // create beds + voices (see table); find listener under this.player.head
    // unlock fallback (G6):
    const resume = () => this.listener?.context.state !== 'running' && this.listener?.context.resume();
    window.addEventListener('pointerdown', resume); window.addEventListener('keydown', resume);
    this.cleanupFuncs.push(() => { window.removeEventListener('pointerdown', resume); window.removeEventListener('keydown', resume); });
    // also on renderer.xr 'sessionstart': session.addEventListener('selectstart', resume, { once: true })
    // master volume: effect(globals.audioMasterVolume) → listener.setMasterVolume(v); push dispose to cleanupFuncs
  }

  /** Called by gameplay systems. pos = world position or undefined for head-locked. */
  play(id: ClipId, pos?: Vector3, volScale = 1): void {
    const def = CLIPS[id]; const buf = AssetManager.getAudio(def.id);
    if (!buf) return;                                   // background asset not decoded yet
    const pool = pos ? this.voices : this.uiVoices;
    const i = this.pickVoice(pool, def.pri, now);       // free (busyUntil<now) else lowest-pri/oldest; may return -1
    if (i < 0) return;
    const v = pool[i];
    if (pos) v.object3D!.position.copy(pos);            // SyncedVector3 → Transform storage
    v.setValue(AudioSource, '_buffer', buf);            // G2: internal but typed field, read at play
    v.setValue(AudioSource, 'volume', def.vol * volScale);
    v.setValue(AudioSource, 'refDistance', def.ref);    // live-updated fields
    v.setValue(AudioSource, 'rolloffFactor', def.roll);
    v.setValue(AudioSource, 'maxDistance', def.maxD);
    AudioUtils.play(v);                                 // Restart mode: stops whatever that voice had
    this.busyUntil[i] = now + buf.duration; this.voicePri[i] = def.pri;
    this.pushLog(id);                                   // S16 evidence: ring buffer + console.info('[audio] ' + id)
  }

  update(dt: number, t: number) {
    const phase = (this.globals.dayPhase as Signal<number>).peek();  // 0..1 day→night blend
    const n = Math.sin(phase * Math.PI / 2), d = Math.cos(phase * Math.PI / 2); // equal-power
    if (Math.abs(AudioUtils.getVolume(this.day) - d * BED_DAY) > 0.005) AudioUtils.setVolume(this.day, d * BED_DAY);
    if (Math.abs(AudioUtils.getVolume(this.night) - n * BED_NIGHT) > 0.005) AudioUtils.setVolume(this.night, n * BED_NIGHT);
    // fire: AudioUtils.setVolume(fireAudio, fireIntensity) likewise; duck beds while a sting plays
  }
}
```

Notes on the sketch:
- No per-frame allocation (typed arrays, preallocated log ring, no closures in `update`).
- Out-of-range SFX (distance to head > `def.maxD`) are skipped in `play()` — this replaces the
  no-op built-in culling.
- If writing `_buffer` is rejected in review, the fully public fallback is **per-clip emitter
  sets**: for each spatial clip, K (1–3) entities with a fixed `src` and `maxInstances:1`,
  round-robin, move-then-`AudioUtils.play`. It costs ~40–60 idle `PannerNode`s instead of 10
  (idle-node CPU on Quest UNCONFIRMED) and needs no internal fields.
- Rejected: one entity per clip with `playbackMode:'overlap'` — all overlapping instances live
  under the same `object3D`, so moving the emitter drags already-playing instances with it.
- Rejected: swapping `src` + resetting `_loaded` — also internal, and costs a frame of latency
  per play (`update` returns after `loadAudio`).

---

## Gotchas (G#)

- **G1 `AudioUtils.createOneShot` is a stub.** It uses `world.createEntity()` (no Object3D, so a
  positional pool is parented to the scene origin), the `position` branch is an empty `if`,
  and nothing ever removes the entity — each call leaks an entity + audio nodes.
  (audio-utils.js:128-143; reference source `packages/core/src/audio/audio-utils.ts` has the
  same "Would need Transform component" comment.) Contradicts nothing in api-reference.md,
  which doesn't document it — do not add it.
- **G2 Buffer swap uses `_buffer`.** Declared in the public `.d.ts` schema and read fresh at
  every `createAndPlayInstance`, but underscore-prefixed/hidden; re-check on any IWSDK upgrade.
- **G3 Don't churn audio entities.** `cleanupEntity` returns early when an entity has no
  active instances, so its pool is never `dispose()`d (audio-system.js:459-477): the gain/panner
  nodes stay connected to the listener. Create voices once, `persistent:true`.
- **G4 A bad `src` retries every frame.** On load failure `_loading` resets to 0 and `_loaded`
  stays 0, so `update` calls `loadAudio` again next frame → `console.error` + fetch per frame.
  Validate ids against the manifest.
- **G5 `pause` is not a pause.** `pause(e)` without fade calls three `Audio.pause()`, which nulls
  `source.onended`, so the instance is never released: `isPlaying(e)` stays `true`, `Ignore`
  mode can never play again, `Restart` restarts from 0 (no resume API). `pause(e, fade>0)` =
  fade-out-and-release. Use volume or `stop` instead of pause for beds.
- **G6 Autoplay policy.** The `AudioListener`/`AudioContext` is created in `AudioSystem.init`
  (page load, no gesture) → `suspended`. Only XR `sessionstart` resumes it; on `sessionend` it is
  suspended again and every playing instance is paused. So: 2D browser mode is silent until
  something resumes the context (our pointer/key fallback), and sounds queued while suspended
  start together on resume. `offer:'once'` + Quest Browser resume success: UNCONFIRMED; the XR
  `selectstart` fallback covers it.
- **G7 `autoplay` self-clears.** After the first trigger `autoplay` is written to `false`; a
  stopped loop must be restarted with `AudioUtils.play`.
- **G8 Listener in non-XR mode.** `xrOrigin.head` is only written in XR frames
  (xr-input-manager.js:100); outside XR it sits at the rig origin and does not follow mouse
  look, so positional panning in 2D preview is wrong. Verify spatial audio in XR/IWER only.
- **G9 `InstanceStealPolicy.Furthest` is broken** — compares `player.head.position` (rig-local)
  to `audio.position` (always local 0,0,0 inside the pool container). Don't use.
- **G10 Loop seams.** MP3 (and AAC) carry encoder padding; `decodeAudioData` trimming varies by
  browser (UNCONFIRMED on Quest). Export beds/loops as `.ogg` (Vorbis) or `.wav`, cut on zero
  crossings; SFX can stay `.mp3` (spec's offline synth → mp3 is fine for one-shots).
- **G11 Decoded size.** Buffers decode to 32-bit float at the context rate (48 kHz on Quest):
  30 s stereo ≈ 11.5 MB RAM regardless of file format. Keep beds ≤ 30–45 s, SFX mono.
- **G12 HRTF per voice.** Every positional voice is an HRTF `PannerNode`; `panningModel` is not
  exposed on `AudioSource`. Cap concurrent positional voices (~10–12) on Quest (perf ceiling
  UNCONFIRMED — profile with the metavr trace tools).
- **G13 Session end strands one-shots.** Instances paused by `sessionend` are resumed with three's
  own `play()`, which re-attaches three's `onEnded`, not `AudioSystem`'s — so they are never
  released and `isPlaying` stays true. Track `busyUntil` yourself; `Restart` mode recovers the
  voice on its next play.
- **G14 `FadeRestart` needs `maxInstances >= 2`** (existing `camp-feedback` node is correct);
  with a full pool the new instance is silently dropped (no steal in that path).
- **G15 `setVolume` clamps to [0,1]**; writing `volume` > 1 via `setValue` is allowed (gain > 1,
  clipping risk).
- **G16 Fades run on ECS time.** Fade progress uses the system `time` (seconds); `ecs_pause`
  freezes fades while audio keeps playing — expected in debug sessions.
- **G17 URLs in scene JSON.** The existing `camp-feedback` node uses `"src": "./audio/chime.mp3"`
  (document-relative, no BASE_URL). Cache is keyed by resolved URL, so this decodes chime a
  second time next to the manifest's `/audio/chime.mp3`, and it breaks the project's "scene JSON
  holds ids, never URLs" rule. Use `"src": "camp-feedback"`. The manifest entry also has no
  `priority` → critical (blocks startup). Fine for one 4 KB chime; set `'background'` for the
  ~45 new clips.
- **G18 Positional default.** `positional` defaults to **true**; every bed/UI sound must set
  `positional:false` explicitly or it pans from the entity (or the scene origin if no Object3D).

---

## (d) Evidence

Installed declarations (rung 3):
- `node_modules/@iwsdk/core/dist/audio/index.d.ts` — export list
- `node_modules/@iwsdk/core/dist/audio/audio.d.ts` + `audio.js:56-106` — fields, defaults, fileTypes
- `node_modules/@iwsdk/core/dist/audio/audio-utils.d.ts` + `audio-utils.js` — `AudioUtils` (clamp at `setVolume`, stub `createOneShot`)
- `node_modules/@iwsdk/core/dist/audio/audio-system.d.ts` + `audio-system.js` — listener on head (`:73-74`), XR resume/suspend (`:38-69`), load/retry (`:92-100,124-143`), pool creation & fixed fields (`:145-169`), modes (`:209-246`), `_buffer` read at play (`:247-262`), live volume/spatial updates (`:308-367`), stealing (`:426-458`), cleanup early-return (`:459-477`); culling config declared `:31-33`, never read (grep)
- `node_modules/@iwsdk/core/dist/audio/audio-pool.d.ts` + `audio-pool.js:28-42` — container parented to entity Object3D
- `node_modules/@iwsdk/core/dist/asset/asset-manager.d.ts` (`LoadableAssetManifestEntry`, `getAudio`, `loadAudio`, `loadAudioById`) + `asset-manager.js:233-262` (priority handling)
- `node_modules/@iwsdk/core/dist/asset/loaders/audio-loader.js`, `asset/cache-manager.js:19-26,63-74` — id→URL resolution, URL-keyed cache
- `node_modules/@iwsdk/core/dist/init/world-initializer.js:425-428` — AudioSystem always registered, default priority 0 (`elics/lib/world.js:29`); `:561-568` update time in seconds
- `node_modules/@iwsdk/xr-input/dist/rig/xr-origin.js:39-48`, `xr-input-manager.js:100` — head pose only updated in XR
- `node_modules/@iwsdk/core/dist/transform/transform.js:40-53` — `object3D.position` is synced to Transform
- `node_modules/three/src/audio/Audio.js` (`pause()` nulls `onended`; `setVolume` uses `setTargetAtTime`), `PositionalAudio.js:59,217-244` (HRTF; panner follows `matrixWorld`), `AudioListener.js:154-167` (`get/setMasterVolume`)

Reference CLI (rung 1, corpus 0.5.3):
- `npx iwsdk reference examples '{"api_name":"AudioSource"}'` → `examples/browser-first/src/feedback.ts` (`AudioUtils.play` on `Pressed` qualify), `world-initializer.ts registerAdditionalSystems`
- `npx iwsdk reference search` for "one-shot at position", "createOneShot", "context resume user gesture", "loop crossfade" → only `audio-utils.ts`/`audio-system.ts` hits; no built-in unlock or positioned one-shot exists
- `npx iwsdk reference file packages/core/src/audio/audio-utils.ts` → source confirms `createOneShot` stub

Project (current usage):
- `src/assets.ts:19` — `'camp-feedback'` `AssetType.Audio` (no priority → critical)
- `public/scenes/main.iwsdk.scene.json` node `camp-feedback` (~line 551) — `AudioSource{src:'./audio/chime.mp3', volume:.25, maxInstances:2, playbackMode:'fade-restart'}`
- `src/camp-system.ts:52-53` — `world.getSceneEntity('camp-feedback')` + `AudioUtils.play`
- `design/GAME_SPEC.md:139-148` — required beds/one-shots; S16 verification

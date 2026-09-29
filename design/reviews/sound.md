# Review: sound design

Date: 2026-09-28. Reviewer role: game audio director. Scope: all 47 files in `public/audio/`, as of this date. This was a review only; nothing was run in the engine.

**Method.** I cannot listen, so every claim below comes from the code or from measurements.

- **Code read:**
  - `scripts/synth-audio.mjs` (every recipe)
  - `src/game/audio-assets.ts`, `audio-map.ts` and `systems/audio-system.ts`
  - `src/game/bus.ts`, plus every `bus.emit` call site in `src/game/systems/*`
  - `design/grounding/audio.md` and the Audio section of `design/GAME_SPEC.md`
  - `tests/audio-map.test.mjs`
- **Measurements:** all made with `/opt/homebrew/bin/ffmpeg` on `public/audio/*`. Scripts and images are in the scratchpad `audio-review/` folder: `loudness2.txt`, `bands.txt`, `speaker.txt`, `seam.py`, `clicks.py`, `trunc.py` and `spec-*.png` / `grid-*.png`.
  - **Loudness:** EBU R128 via `ebur128=peak=true`. Integrated loudness (I), maximum momentary loudness (M-max, a 400 ms window) and true peak. Clips were padded with 1 s of silence so that clips under 400 ms still produce a reading.
  - **DC offset:** from `astats`.
  - **Spectrum:** log-frequency spectrograms, plus the share of energy in each frequency band.
  - **Speaker translation:** loudness through a 24 dB/oct 200 Hz high-pass. This is a proxy for the Quest's built-in open-ear speakers, which reproduce very little below about 150–200 Hz.
  - **Loop seams:** checked on the decoded PCM.
  - **Clicks:** a search for truncation clicks, done by finding isolated high-frequency spikes and step discontinuities.
- **In-game level ("effective"):** the clip's loudness plus `20·log10(volume)` from `CLIP_DEFS`, or from `BED` for the beds. For positional clips this is the level inside `refDistance`.

---

## 1. Score: **6 / 10**

**Verdict: the architecture and coverage are complete and cleanly built. What it lacks is sounds that hold up on a Quest's speakers.**

The engineering is better than most shipped indie VR titles:

- **Seamless loops.** Every loop decodes to its exact sample length, and the seams show no discontinuity.
- **Clean files.** No clip clips (the highest true peak is −1.1 dBTP), and DC offset is at most 0.00065.
- **A real director system.** It has pooled per-clip emitters, cooldowns and an equal-power day/night crossfade. Stingers duck the beds. Fire loudness follows fuel. The brook emitter slides along the centreline. The heartbeat has hysteresis, the dawn motif is deferred until the sleep swell ends, and there is an autoplay unlock.
- **Full coverage.** Every clip in the spec's list exists and is mapped, except `bolt-thunk` (see P1-7).
- **A small, coherent musical identity.** One pentatonic D-major motif runs through craft-complete, recipe-learned, dawn and the ending.

What a player hears is weaker than that:

1. **The danger sounds are built from sub-bass.** Heartbeat, player-hurt, hit, death and drop have 85–97 % of their energy below 150 Hz. On the Quest's speakers they lose 10–17 dB. The heartbeat, which is the low-health warning, becomes effectively silent.
2. **The night threat has no approach audio.** A stalking wolf is silent from 32 m down to 2.2 m. Its only warning is a 0.8 s growl just before the bite.
3. **There is no variation, and the beds repeat.**
   - Every one-shot is one fixed sample at one pitch.
   - The beds are 24–32 s loops with memorable events at fixed offsets. The same owl calls at exactly 7.5 s and 22.5 s into every 32 s night loop.
4. **Several signature recipes read as synthesized:**
   - The campfire is filtered noise; its crackle is buried under the roar.
   - The chop sounds like a kick drum.
   - The wolf howl is voiced as a parallel-fourth chord.
   - The fire going out sounds like water on coals, though the fire only ever dies from lack of fuel.
5. **The beds are mono and head-locked.** In a headset they sit inside the head instead of around it.

Fixing the P0 and P1 items below would move this to about 8/10 without changing the architecture.

---

## 2. Per-clip measurements

Column key:

- **I:** integrated loudness, LUFS. For one-shots this was measured with 1 s of padding.
- **M-max:** maximum momentary loudness, LUFS. This is the useful figure for a one-shot. It under-reads clips shorter than 400 ms by about 10·log10(400/duration) dB.
- **TP:** true peak, dBTP.
- **Vol:** the game volume from `CLIP_DEFS` or `BED`.
- **Eff:** the in-game level. For beds and loops it is I + vol dB; for one-shots it is M-max + vol dB.
- **<150:** the share of the clip's energy below 150 Hz.
- **Spk:** the loss in M-max through the 200 Hz high-pass, dB.

All 47 files are mono. One-shots are MP3 at 112 kbps and 44.1 kHz; loops are Opus at 56 kbps and 48 kHz.

### Beds and loops

| Clip | Dur | I | M-max | TP | Vol | Eff | <150 | Spk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| forest-day | 32.0 | −26.5 | −20.8 | −9.3 | 0.55 | **−31.7** | 50 % | 0.3 | Half its energy is wind rumble. Birds are sparse and faint, and the same bird sequence repeats every 32 s (about 9× per 300 s day). Below the −28…−24 target. |
| night | 32.0 | −26.0 | −18.1 | −7.7 | 0.60 | **−30.4** | 38 % | 0.7 | Owls fall at fixed offsets 7.5 s and 22.5 s, so each is heard about 5× per 150 s night. A pure 2.85 kHz tree-cricket tone runs continuously for the whole loop. |
| fire-crackle | 24.0 | −23.5 | −19.5 | −4.5 | 0.35–1 | −23.5 at ≤1.5 m | 42 % | 1.2 | Only 0.3 high-band transients per second rise more than 12 dB above the floor (5 ms frames), against 16 crackles/s authored. The roar dominates (spectrogram). |
| brook | 24.0 | −23.8 | −18.6 | −5.9 | 0.75 | −26.3 at ≤4 m, about −31 at camp (21 m) | 17 % | 0.1 | The most natural recipe: modulated babble bands and bubbles. The seam is clean. |
| beacon-roar | 16.0 | −21.1 | −18.6 | −6.2 | 1.0 | −21.1 at ≤6 m | 71 % | 4.8 | Reads as a jet or waterfall; no crackle transients rise above the floor. It is not ducked under the ending theme, which it masks (P1-10). |
| heartbeat | 3.0 | −22.6 | −19.8 | −7.8 | 0.8 × 0.45–1 | −21.7 to −28.6 | **97.5 %** | **17.5** | Close to silent on the speakers. The rate is fixed at 80 bpm and never rises as health falls. |

Loop integrity:

- **Decoded lengths are exact.** The Opus pre-skip is trimmed, giving 1,536,000 / 1,152,000 / 768,000 / 144,000 samples.
- **Seams are clean.**
  - The wrap step sits between the 4th and 98th percentile of the in-loop sample-to-sample differences.
  - The second difference at the seam is below the loop's 99.9th percentile, except brook, which is marginal because a bubble lands on the wrap.
  - RMS changes by at most 1 dB across the seam.

### One-shots

| Clip | Dur | I | M-max | TP | Vol | Eff | <150 | Spk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| lighter-flick | 0.65 | −22.1 | −20.0 | −3.7 | 0.7 H | −23.1 | 3 % | 0.3 | Good: wheel teeth, then a small flame whoosh. Head-locked, though the lighter is in the hand. |
| ignite | 1.70 | −19.4 | −16.2 | −7.2 | 0.9 | −17.1 | 48 % | 1.3 | Good "whoomph" build. Also reused for fuel, torch and beacon. |
| plop | 0.40 | −22.9 | −18.9 | −1.4 | 0.8 | −20.8 | 6 % | 0.9 | Good: the pitch drops, then bubbles follow. |
| stir | 0.70 | −18.1 | −16.5 | −3.3 | 0.55 | −21.7 | 11 % | 0.5 | Fine. |
| bowl-fill | 0.84 | −15.6 | −14.0 | −2.5 | 0.7 | −17.1 | 0 % | 0.0 | Good rising "filling vessel" pitch. Too loud for a quiet action: it is louder than chop. |
| eat | 0.80 | −23.6 | −21.8 | −1.4 | 0.7 H | −24.9 | 46 % | 1.7 | Three hard-gated 120 ms crunch blocks. It plays the same crunch for stew. |
| sizzle | 1.30 | −17.7 | −16.6 | −3.2 | 0.6 | −21.0 | 1 % | 0.0 | Convincing. |
| fire-out | 1.70 | −16.8 | **−12.3** | −2.1 | 0.8 | **−14.2** | 6 % | 0.1 | The loudest cue in the game, 17 dB over the beds. It is a steam hiss, which is the wrong sound for fuel running out (P1-8). |
| hammer-clank | 1.40 | −24.3 | −18.1 | −1.3 | 0.9 | −19.0 | 27 % | 1.4 | Convincing metal ring over a wood body. The three strikes are identical (fun.md says the same). |
| craft-complete | 2.40 | −21.0 | −16.8 | −6.6 | 0.8 | −18.7 | 0 % | 0.0 | Pleasant. The bell partials are cut off at about 1.8–2.0 s, leaving faint ticks. It stacks on recipe-learned. |
| recipe-learned | 2.89 | −22.0 | −18.1 | −9.4 | 0.6 H | −22.5 | 0 % | 0.0 | Good. |
| invalid-clunk | 0.45 | −24.1 | −21.8 | −3.4 | 0.7 | −24.9 | 15 % | 5.2 | A clear "no". |
| chop | 0.70 | −20.3 | −17.9 | −3.2 | 1.0 | −17.9 | **75 %** | 6.0 | The body is a 55→125 Hz sine thump, and a 240 Hz mode rings for about 0.5 s, like a tom. The woody "tock" is weak. The same sample plays 3× per node. |
| wood-split | 0.84 | −18.7 | −16.0 | −1.1 | 0.95 | −16.4 | 23 % | 1.9 | The best impact: a crack, a fibre tear, then the halves landing. |
| rustle | 0.50 | −23.7 | −22.0 | −4.3 | 0.6 | −26.4 | 0 % | 0.0 | Good leaf texture, but a metal click (`metalClick(1600)`) sits at 0.2 s. It is also used for the plank harvest. |
| grab | 0.13 | −31.6 | −31.6 | −9.6 | 0.35 H | **−40.7** | 0 % | 0.0 | A pitched 620 Hz "tink" that sounds like a UI blip. It is attenuated twice (`level: -8` and vol 0.35), so it is buried under the beds. |
| drop | 0.55 | −22.6 | −20.3 | −6.2 | 0.8 | −22.2, or −27.4 when soft | **86 %** | **9.7** | The most frequent sound in the game. The thud nearly vanishes on the speakers, and a click sits at 0.40 s. |
| drop-light | 0.29 | −28.6 | −25.9 | −6.4 | 0.6 | −30.3, or −35.5 when soft | 1 % | 0.3 | A triple wooden tock, used for meat, berries, flint and bolts alike. Too quiet. |
| snap | 0.11 | −25.4 | −25.4 | −5.3 | 0.6 | −29.8 | 0 % | 0.0 | A fine latch click; a little quiet. |
| pack-unroll | 1.00 | −23.6 | −21.6 | −3.5 | 0.7 | −24.7 | 61 % | 4.3 | Fine. |
| pack-roll | 0.90 | −20.0 | −16.9 | −4.7 | 0.65 | −20.6 | 15 % | 0.2 | Fine. |
| page | 0.42 | −17.9 | −15.9 | −4.1 | 0.6 H | −20.3 / −23.4 | 0 % | 0.0 | A good paper "fwip". |
| spear-whoosh | 0.48 | −16.5 | −15.2 | −1.3 | 0.8 | −17.1 | 0 % | 0.0 | Good, but louder than any impact that follows it. |
| hit | 0.42 | −22.4 | −18.7 | −7.3 | 0.95 | −19.1 | **93 %** | **10.2** | A kick drum rather than flesh. The same clip plays for spear, bolt and torch. A click sits at 0.40 s. |
| crossbow-twang | 0.72 | −20.3 | −16.8 | −4.3 | 0.9 | −17.7 | 59 % | 6.6 | A 190→128 Hz "bass-guitar boing", with a weak slap from the prod (the crossbow's bow). The tail is cut at 0.70 s. |
| bolt-thunk | 0.50 | −20.4 | −16.7 | −1.6 | 0.85 | — | 20 % | 2.9 | **Orphaned: never mapped.** Nice quivering-shaft AM. Clicks at 0.30 and 0.45 s. |
| reload-click | 0.33 | −26.7 | −26.0 | −4.1 | 0.6 H | −30.4, or −37/−38 when reused | 0 % | 0.0 | Also plays as the dry-fire click (×0.4) and the lighter closing (×0.45). A ratchet is the wrong sound for both. |
| sentry-fire | 0.43 | −18.6 | −16.3 | −1.6 | 0.85 | −17.7 | 5 % | 3.2 | OK. |
| deer-flee | 1.45 | −23.3 | −19.9 | −3.0 | 0.8 | −21.8 | 47 % | 4.0 | A good receding-hooves illusion (decay plus low-pass). Rabbits reuse it at 0.45, so they gallop like deer. |
| wolf-howl | 5.75 | −18.3 | −16.5 | −6.1 | 1.0 (ref 10) | −16.5; about −25 at 40 m | 0 % | 0.1 | The contour and reverb are good. A second voice a parallel fourth below and a buzzy harmonic floor make it sound like an organ. Only one variant exists. |
| wolf-growl | 1.60 | −18.0 | −16.6 | −1.4 | 0.9 | −17.5 | 0 % | 0.4 | A formant pulse train that is too regular: an idling motor, with no breathing cycle. |
| wolf-bite | 0.40 | −21.0 | −20.3 | −1.2 | 1.0 | −20.3 | 40 % | 1.3 | A snarl, then a jaw clack with a metallic 2.5 kHz ring. A click sits at 0.24 s. |
| wolf-dissolve | 3.40 | −23.3 | −17.3 | −4.1 | 0.9 | −18.2 | 67 % | 3.7 | A nice ash and ember scatter, cut off at 0.88 s. |
| player-hurt | 0.46 | −24.2 | −20.6 | −4.7 | 0.85 H | −22.0 | **97 %** | **13.0** | A sub thump; the grunt is mixed at 0.35. On the speakers almost nothing is left. |
| sleep | 4.80 | −21.4 | −18.7 | −8.6 | 0.7 H | −21.8 | 17 % | 2.4 | A warm Dadd9 swell (D major with an added E). Good. |
| dawn | 4.38 | −18.6 | −16.2 | −6.0 | 0.6 H | −20.6 | 0 % | 0.4 | Good: a hopeful rising pentatonic line over a pad. |
| stage | 5.50 | −20.8 | −17.7 | −9.0 | 0.6–0.9 H | −20.2 | **78 %** | 6.8 | A menacing low saw cluster built on a tritone, swelling. It is mostly sub, so little survives on the speakers. |
| death | 4.60 | −21.4 | −17.6 | −8.1 | 0.9 H | −18.5 | **85 %** | **11.6** | A **click at 3.40 s**: the step is 179× the median and the level falls from −30 to −46 dBFS in one sample. On the speakers only the hiss and the glide survive. |
| ending | 25.0 | −21.1 | −18.0 | −5.4 | 0.85 H | −22.5 (I) | 35 % | 2.4 | A coherent I–vi–IV–V theme in D major with a lute-and-bell voicing. For a mythic finale its scale is small, like a music box. |
| chime (camp-feedback) | 0.44 | −13.5 | −11.9 | −1.3 | 0.25 | — | 0 % | 0.5 | **Orphaned.** A starter scene node that nothing plays. |

**Mix spread.** In-game levels run from −14.2 (fire-out) to −40.7 LUFS (grab), a spread of 26 dB.

- The beds sit at −31.7 and −30.4 LUFS-I, 2–4 dB under the brief's −28…−24 range.
- The stingers sit at −18.5 to −21.8, about 10 dB over the beds, with the beds ducked under them. That is right: they are not overpowering.
- The problems are at the extremes:
  - fire-out is too hot.
  - grab, drop-light, snap and the reused reload-click are 8–18 dB too quiet.
  - The sub-heavy danger cues collapse on the speakers.

---

## 3. Findings

Line numbers refer to the current files.

### P0: must fix before the next playtest

#### P0-1. Damage and danger feedback disappears on the Quest's built-in speakers

**Evidence (from `speaker.txt` and `bands.txt`):**

| Clip | Energy below 150 Hz | Loss through the 200 Hz high-pass |
| --- | --- | --- |
| heartbeat | 97.5 % | −17.5 dB |
| player-hurt | 97 % | −13.0 dB |
| death | 85 % | −11.6 dB |
| hit | 93 % | −10.2 dB |
| drop | 86 % | −9.7 dB |
| stage | — | −6.8 dB |
| crossbow-twang | — | −6.6 dB |
| chop | — | −6.0 dB |

- At its quietest (health just under 30) the heartbeat plays at 0.8 × 0.47. On the speakers that lands around **−46 LUFS**, which is inaudible under the night bed.
- A wolf bite from behind produces a hurt cue at about −35 LUFS on the speakers.

The causes are in the recipes:

- The heartbeat is `tone(46+34e^-t)` through `lp 520` (`synth-audio.mjs:614-616`).
- player-hurt is a 45–100 Hz thump with the voice at 0.35 (`:1048-1050`).
- `thud()` is 60–120 Hz (`:366-369`).
- hit is 55–120 Hz through `lp 700` (`:891-892`).

**Fix:** move the identity of each sound into 150 Hz–2 kHz and keep the sub as support. Small speakers render the "missing fundamental" from the harmonics.

- **heartbeat `beat()`:**
  - Final `'lp', 520` → `1400`.
  - `sat(…, 2.2)` → `3.0`.
  - Add a knock layer: `[burst(0.06, { filters: [['bp', 230, 1.4]], env: ad(0.001, 0.018), gain: 0.55 })]`.
  - Add harmonic `[4, 0.12]`.
  - Raise `HEART_VOLUME` from 0.8 to 1.0 (`audio-system.ts:52`).
  - Target a speaker loss of 6 dB or less.
- **player-hurt:**
  - Thump `45 + 55·e` → `75 + 90·e`.
  - `breathVoice` gain `0.35` → `0.8`, `f0` 170 → 190.
  - Add `burst(0.08, { filters: [['bp', 900, 1.2]], env: ad(0.0005, 0.02), gain: 0.5 })` for a flesh and cloth slap.
  - Raise the def from `H(0.85…)` to `H(1…)`.
- **hit:**
  - Tone `55 + 65·e` → `85 + 110·e`.
  - Replace `['lp', 700]` with `['bp', 450, 0.9]`.
  - Add a slap: `burst(0.03, { filters: [['bp', 1500, 1]], env: ad(0.0003, 0.01), gain: 0.5 })`.
  - The 2.5 kHz click gain goes from 0.25 to 0.45.
- **`thud()` defaults (used by drop, pack and stage):**
  - `f 60 → 85`, `drop 60 → 80`, `dirt 350 → 900`.
  - In drop, the wood modes go from `0.4` to `0.7`.
- **death:**
  - Move the drones up an octave (`55/58.27` → `110/116.5`) with harmonics `[[1,1],[2,.5],[3,.3],[4,.15]]`.
  - Keep a 55 Hz sub at 0.25.
- **stage:** the saw low-pass goes from `200 + 700·swell` to `350 + 1400·swell`. Add a tritone pair an octave up (146.8 and 207.7 Hz) at 0.2.
- **Acceptance:** re-run the high-pass measurement. No danger cue should lose more than 6 dB.

#### P0-2. Stalking wolves are silent, so VR's main threat channel is unused

**Evidence (`creature-system.ts`):**

- Howls fire only in `prowl` mode, when `dPlayer > 6`, 16–36 s apart per wolf with a 7 s global gap (`:917-931`, `:64`).
- In `stalk` mode (32 m down to 2.2 m, `:61`) a wolf emits nothing.
- The first sound of an attack is the telegraph growl, 0.8 s before the bite (`:888-895`, `rules.ts:31`).
- The `creature/spawn` cue at `:471` maps to `null` (`audio-map.ts:180`), and wolves spawn only 15 m out.

In a headset the player cannot see behind them. Wolves have to be heard before they are seen.

**Fix:**

1. **Spawn call.** `case 'spawn': return event.species === 'wolf' ? at(out, 'wolf-howl', event, 0.7) : null;`
2. **Stalk cue.** Add `'stalk'` to the creature cue union in `bus.ts:36`. In the `want === 'stalk'` branch, emit it every 2.5–4.5 s while `dPlayer < 15`, using a new `rig.stalkIn` timer.
   - Map it to a new clip, `wolf-pant`, with def `P(0.75, 2, 2, 1.1, 30, 0.8)`.
   - The recipe: four panting breaths, `breathVoice(0.22, { f0: 95, f0End: 80, voiced: 0.15, formants: [[500,3,1],[1400,4,.5],[3000,5,.25]] })`, 0.36 s apart and alternating in level, over `rustleGrains(1.4, 6, { fLo: 800, fHi: 3000 })` at 0.3 for paws in grass. Use `rms: -18`.
3. **Yelp.** Add a `yelp` cue, emitted from `combat-system.hurt()` when the species is wolf and health is above 0, and from the torch-fend branch (`:147`).
   - The recipe is a new `wolf-yelp`: a `howlVoice` with contour 900→1400→700 Hz over 0.25 s and a sharp attack.
4. **Tests.** Update the `SAMPLES`/`SILENT` table in `tests/audio-map.test.mjs`.

### P1: high value

#### P1-1. Truncation clicks inside clips

`tone()`, `modes()` and `burst()` stop hard at the end of their buffer while still decaying. Only the clip's final 40 ms gets a fade (`finish()`, `:1147-1149`).

**Measured steps (`trunc.py`):**

| Clip | Time | Step (× median) | Level before → after |
| --- | --- | --- | --- |
| death | 3.400 s | 179× | −30 → −46 dBFS, in a ducked, quiet moment |
| hit | 0.400 s | 207× | — |
| drop | 0.400 s | 235× | — |
| wolf-bite | 0.240 s | 157× | — |
| crossbow-twang | 0.704 s | 106× | — |
| wolf-dissolve | 0.879 s | 18× | — |

Also visible in the spectrograms:

- bolt-thunk at 0.30 and 0.45 s
- sentry-fire at 0.31 s
- the bell partials in craft-complete at about 1.8–2.0 s
- chop at 0.50 s

**Fix, one helper applied everywhere:**

```js
/** Raised-cosine fade over a buffer's last `s` seconds, so decaying layers never stop on a step. */
function tailFade(o, s = 0.01) { const f = Math.min(o.length, N(s)); for (let i = 0; i < f; i++) o[o.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / f); return o; }
```

- Call it:
  - at the end of `tone()` as `return tailFade(o)`
  - at the end of `modes()`
  - in `burst()` after `applyEnv`
- In `death`, render to `zeros(D + 1.2)` with tones of length `D + 1.2`, so that the 1.2 s decay reaches −35 dB before the end.

#### P1-2. The campfire loop has no audible crackle

**Evidence:**

- The event layer is mixed at 0.35 under a roar at −20 dB RMS (`:552-568`).
- In the 1.5–8 kHz band, 5 ms frames reach p99 only 9.7 dB above the median. Just **0.3 transients per second** rise more than 12 dB above the floor, against a real wood fire's several per second.
- The spectrogram shows a breathing brown-noise mass with faint ticks. The loop reads as a gas burner or wind.

**Fix in `fire-crackle`:**

- Levels:
  - `lay(roar, -20)` → `-26`
  - `lay(breath, -26)` → `-29`
  - `lay(hiss, -38)` → `-44`
  - The final `[ev, 0.35]` → `[ev, 0.9]`
- Bursty crackle:

  ```js
  const burstiness = smooth(0.45, L + 1);
  poisson(L, 30, (t) => { if (R() < 0.25 + 0.75 * Math.max(0, burstiness(t))) addWrap(ev, crackle(logRand(0.15, 1), 1200, 9000, 6), t); });
  ```

- Pops `0.8/s` → `1.4/s`.
- Add snap clusters at 0.2/s: a run of 4–9 crackles 8–40 ms apart.
- **Acceptance:** at least 4 high-band transients per second more than 12 dB above the floor.
- Make the loop 29 s rather than 24 s (see P1-4).

#### P1-3. Zero variation: every trigger plays an identical sample

- `AudioSource` exposes no `playbackRate` (grounding row "Heartbeat").
- Each clip is one deterministic render (`R = mulberry32(hashString(clip.id))`, `:1197`).
- The repeats are frequent:
  - A deadwood node plays the same chop three times.
  - Every craft plays the same clank three times.
  - Every log drop plays the same thud.
  - Every wolf howls the same howl.

**Fix: synthesize variants and let the existing round-robin rotate them.**

- **Synth:**
  - Add `const variants = (id, count, gen, opts) => { for (let k = 0; k < count; k++) oneShot(k ? `${id}-${k + 1}` : id, () => gen(k), opts); };`. The ids `chop-2`, `chop-3` automatically get their own PRNG seed.
  - Pass `k` into the recipe for about ±6 % pitch offsets, for example `[1, 0.94, 1.06][k]`.
  - Candidates: chop ×3, wood-split ×2, hammer-clank ×3, drop ×3, drop-light ×3, grab ×3, snap ×2, hit ×3, plop ×2, rustle ×3, wolf-howl ×3 (solo short, solo long, duet), wolf-growl ×3, eat ×2.
- **Assets:** add `chop-2` and `chop-3` to `audio-assets.ts`.
- **ClipDef:** add a `variants` field.
- **`audio-system.ts:139-145`:** create positional voice `k` with `src = k % variants ? `${id}-${(k % variants) + 1}` : id`. The round-robin in `playCue` then cycles variants for free, and `voices ≤ 3` keeps the test green.
- **Level jitter:** in `playCue` (`:302`), use `Math.min(1, cue.volume * (0.89 + 0.22 * Math.random()))`. That is ±1 dB with no allocation.

#### P1-4. Bed repetition: loop-length patterns with signature events

- **forest-day (32 s):** about 10 bird calls land at the same offsets every loop, so the pattern repeats about 9× per day.
- **night (32 s):** the tawny owl is at 7.5 s and the second owl at 22.5 s of every loop (`:543-544`), about 5× per 150 s night. The owl is the loudest event in the bed: 50 ms RMS peaks reach −13.6 dBFS against a −25 dBFS average.
- **fire-crackle (24 s):** heard for minutes at a time while cooking and crafting.

**Fix:**

1. **Remove the sparse signature events from the loops.**
   - Render them as one-shots: `bird-1…6` (via `birdCall()`) and `owl-1`, `owl-2` (via `owlCall()`).
   - Give `AudioSystem` 3 preallocated "spot" emitters (positional; ref 6, rolloff 0.8).
   - By day, scale the rate by `1 - night` and play a random bird every `rand(2, 7)` s, at bearing `rand(0, 2π)`, 8–35 m out and 2–8 m up.
   - By night, when `night > 0.8`, play an owl every `rand(40, 110)` s, 30–70 m out.
   - The birds then become world-anchored and never repeat in pattern, which is the biggest single upgrade to presence.
2. **Lengthen and decouple the fire.** Split it into `fire-bed` (roar, breath and hiss, 17 s) and `fire-pops` (29 s). Play them on two emitters at the same point. Their combined period is 493 s.

#### P1-5. The beds are mono and head-locked, with no envelopment

- `encode()` forces `-ac 1` (`:1180`).
- The beds play through non-positional `THREE.Audio`, so the same signal reaches both ears. In a headset it localizes inside the head.

**Fix:**

- Give `loopClip` a `stereo: true` option. `gen` returns `[L, R]`:
  - wind and leaves from independent noise per channel, sharing about 60 % of their content
  - insects and birds panned with `cos`/`sin` at `pan = rand(-0.8, 0.8)`
- `wavBuffer` interleaves the two channels, and `encode()` uses `-ac 2 -b:a 80k`.
- **Memory:** about 12 MB per decoded 32 s stereo bed (grounding G11), which is acceptable on Quest 3.
- Combined with the P1-4 spot emitters, the head-locked stereo wash plus the world-anchored events gives both envelopment and localization.

#### P1-6. Mix: the beds are low, and the one-shots span 26 dB

**Evidence:** section 2.

- The beds sit at −31.7 and −30.4 LUFS-I.
- fire-out sits at −14.2, while grab is at −40.7, drop-light at −30.3 (−35.5 when soft) and the dry-fire click at −38.
- The synth normalizes loops by *unweighted* RMS (`:1153`). Rumble-heavy beds therefore measure 2–5 LU quieter than their `rms` target implies.
- It normalizes one-shots to "the loudest 300 ms, capped at −1 dBFS peak" (`:1154-1164`). Transients hit the peak cap and then get a negative `level` trim on top:
  - grab: TP −9.6, M −31.6
  - drop-light: TP −6.4, M −25.9

**Fix:**

- **Synth:** measure loudness on a K-weighted copy, so that `rms` means LUFS: `const kw = filt(filt(x, 'hp', 60, 0.5), 'peak', 3000, 0.4, 4);`. Remove the `level: -8` on grab, or set it to −4.
- **`audio-system.ts:47`:** `BED = { day: 0.8, night: 0.85 }`. That puts day at about −28.4 and night at about −27.8 LUFS-I, inside the brief's range.
- **`CLIP_DEFS` volumes:**

  | Clip | From | To |
  | --- | --- | --- |
  | grab | 0.35 | 0.6 |
  | drop-light | 0.6 | 0.85 |
  | snap | 0.6 | 0.8 |
  | reload-click | 0.6 | 0.8 |
  | rustle | 0.6 | 0.75 |
  | eat | 0.7 | 0.8 |
  | bowl-fill | 0.7 | 0.5 |
  | spear-whoosh | 0.8 | 0.6 |
  | fire-out | 0.8 | 0.55, after the P1-8 redesign |

- **`mapEvent`:**
  - The soft-drop scale goes from 0.55 to 0.7 (`:136`).
  - `crossbow-empty` gets its own clip (P1-11) at 1.0, instead of reload-click at 0.4.
- **Goal:** everyday handling at −24…−28, work impacts at −17…−20, stingers at −18…−22, beds at −28…−26.

#### P1-7. Projectile impacts: `bolt-thunk` is orphaned and misses are silent

**Evidence:**

- `bolt-thunk` has a def (`audio-map.ts:68`) but no `mapEvent` path.
- A bolt that lands emits `drop` with kind `bolt` (`item-system.ts:310`). That maps to `drop-light`: ref 1, rolloff 1.3, max 25 m.
  - At 20 m this is about −58 LUFS. Beyond 25 m it is skipped.
  - So a missed shot makes no sound.
- A spear that sticks gets the heavy `drop` thud at ref 1.5, about −43 LUFS at 15 m.
- Hits on a deer, a wolf, or the torch shove all play the same `hit`.

**Fix, in `mapEvent`:**

```ts
case 'drop':
  if (event.kind === 'bolt' || event.kind === 'spear') return at(out, 'bolt-thunk', event, event.kind === 'spear' ? 1 : 0.8, 4);
  …
case 'hit':
  if (event.kind === 'torch') return at(out, 'ignite', event, 0.45, 1); // flame shove; the yelp comes from P0-2
  return at(out, 'hit', event, event.killed ? 1 : 0.85);
```

Add `spear-thunk` as a lower-pitched variant: modes ×0.75, `tone 210 → 150`.

#### P1-8. fire-out has the wrong semantics and is the loudest cue

**Evidence:**

- The fire only dies from fuel exhaustion (`campfire-system.ts:128-132`).
- The recipe is a white-noise steam hiss, `hp 2000 → bp 5000`, with a spectral centroid of 5.4 kHz (`:717-727`). It reads as water poured on coals.
- At an effective −14.2 LUFS it is the loudest thing in the game.

**Fix: redesign it as an ember collapse.**

- A log settling: `woodKnock(140, 0.5, 0.05)` plus `thud(0.4, { f: 70, drop: 30, tau: 0.08, dirt: 700 })` at 0.05 s.
- A few dying crackles: `poisson(1.5, …)` with rate `10·e^(−t/0.5)`.
- A soft exhale: pink noise, `lp 800`, τ 0.6.
- Hiss gain 0.7 → 0.15.
- `rms: -20`.

#### P1-9. The forest-day bed does not sound "warm and peaceful"

**Evidence:** 50 % of its energy is below 150 Hz, and the spectrogram is a yellow band under 400 Hz. The wind is `pink → lp 220…920` at −20 dB RMS (`:495-496`). Birds are 1.1–3.6 s apart and mixed at 0.42.

The overall read is an overcast, windy day.

**Fix:**

- `wind = filt(filt(pink(n), 'lp', (t) => 380 + 900 * gust(t) ** 2, 0.6), 'hp', 110)` at `lay(wind, -27)`.
- Give the leaves a baseline so that some rustle is always present: `(t) => 0.25 + 1.6 * …`.
- Bird gap: `rand(0.5, 2.4)`.
- Wet bird mix `0.42` → `0.9`, or move the birds to spot emitters (P1-4).
- Add a faint daytime insect air: `bp 5500 Q 0.7` at −40 dB.

#### P1-10. The finale is masked, and its build-up is silent

**Evidence:**

- At the spire the beacon roar plays at −21 LUFS-I with volume 1 and is never ducked. Only the beds use `DUCK` (`audio-system.ts:219-220`).
- The ending theme plays at −22.5 LUFS-I, so the broadband roar covers the pads and plucks.
- During the 3 s brazier hold ("Hold the flame steady… the Hollow are coming", `story-system.ts:170-171`), `beacon {lit:false}` maps to `null`. The climax of the game has no rising sound.

**Fix:**

- In `onEvent('ending')`, set a `loopDuck` of 0.4 for 20 s, ramping back over 6 s, and apply it in `updateBeacon` through `setVolume(this.beacon, loopDuck)`.
- Map `beacon` with `lit:false` to a new `beacon-charge` clip:
  - 3.2 s long
  - the `ignite` sweep stretched out, with rising `beacon-roar` layers
  - a sub swell into the lit frame
- Update the test at `audio-map.test.mjs:116`.

#### P1-11. Dry-fire and closing the lighter reuse the reload ratchet at inaudible levels

**Evidence:**

- `crossbow-empty` plays reload-click ×0.4, and lighter-off plays it ×0.45 (`audio-map.ts:139`, `:169`). Both land at −37…−38 LUFS.
- reload-click's three ratchet clicks plus a latch mean "reloaded". Playing it for an empty crossbow says the opposite of what happened.

**Fix:**

- Add a new `dry-click` clip: one hollow `metalClick(1500, 1, 0.02)` plus `woodKnock(300, 0.5, 0.03)`. Map it to `crossbow-empty` at 1.0.
- Add a `lid-clink` for the lighter closing: `metalClick(2800, 0.8, 0.01)` plus a 3 ms tick, at 0.8.

#### P1-12. A lit torch in the hand makes no sound

**Evidence:** no loop follows a held torch. `torch-lit` plays `ignite` once, and the fire loop exists only at the camp.

The torch is the night's key tool and the flame sits a metre from the player's ears.

**Fix:**

- Add a new 6 s `torch-flame` loop: the fire recipe with `roar lp 900`, breath at `bp 1.2 kHz`, and a 6–9 Hz flutter AM.
- Add one positional loop entity:
  - volume 0.45, ref 0.5, rolloff 1.5
  - it follows the nearest lit torch, updated in `update()` rather than the 0.25 s tick, because torches get swung
- Optional: when the torch's tip speed exceeds 3 m/s, play `spear-whoosh` ×0.5 at the tip. This needs a `swing` event or a check inside the AudioSystem.

#### P1-13. Wolf howl and growl read as synthesized

**Evidence (`howlVoice`, `:966-998`):**

- Ten harmonics with a flat `+0.06` floor at `1/k^0.9` roll-off give a buzzy, brass-like spectrum. A real howl is nearly a pure tone.
- The `hollow` layer at `0.749×` runs a fourth below in parallel, so the listener hears a chord.
- The contour is piecewise-linear (`lineEnv`), so the pitch kinks at the breakpoints.
- The 5.2 Hz vibrato is regular.
- The growl pulse train is too periodic and has no inhale.

**Fix:**

- Floor `0.06` → `0.015`, roll-off `k^0.9` → `k^1.5`, harmonics `10` → `7`.
- Delete `hollow`, or give it its own contour and delay it by 0.9 s so it is a second wolf.
- Replace `lineEnv` for the pitch contour with cosine-interpolated breakpoints.
- Replace the vibrato with `smooth(2.5)` wobble at ±0.8 %, plus one 6 % "break" dip at the peak.
- **Growl:**
  - Modulate the pulse rate with `smooth(3)` at ±25 %.
  - Sweep F1 with `bp (t) => 330 + 120·m(t)`.
  - Add a `160 Hz Q3` chest formant at −14.
  - Insert a 0.25 s inhale of rasp only.

#### P1-14. Dusk is silent, so the emotional arc has a hole

This is also immersion.md #6.

**Evidence:** `phase` maps only dawn (`audio-map.ts:185`). The slide from day into night, where the tension should come from, has no cue.

**Fix:**

- Add a new `dusk` stinger: about 4 s in D minor, a D3–A3–F4 pad under a falling pluck A4→F4→D4, with a low wind swell.
- Map it as `event.phase === 'dusk' ? head(out, 'dusk') : …` with `DUCK.dusk = [0.8, 4]`.
- From stage 1 onward, add one distant positional howl from a spot emitter.

### P2: polish

1. **Footsteps (optional, and only for smooth locomotion).** Add a quiet `step-grass` ×4 at about −30 LUFS, triggered every 0.65 m of stick-driven travel. This matches immersion.md #12.
2. **Water.** When a `drop` lands within about 1.5 m of the brook centreline, map it to a new `splash` clip built from `bubble()` clusters plus a noise slap.
3. **Material-aware landings and eating.**
   - Map by kind: meat, berries, herbs and pages get a soft `thup`; flint gets a stone `clack`; sticks keep the wood tock.
   - `eat` by kind: berries crunch, meat chews, stew slurps.
   - Rabbits get a light-thump variant instead of deer hooves.
4. **Sounds that come from the hands.** `lighter-flick`, `reload-click` and `grab` are head-locked even though their events carry positions. Make them `P(…, ref 0.6, rolloff 1.4)` so they localize to the hand. That adds 7 panner nodes.
5. **Rising heartbeat.** Render `heartbeat-fast` at 110 bpm and crossfade to it below 15 health.
6. **Stew simmer loop** at `CAMP.pot` while it holds ingredients and the fire is lit. Most camp time is spent here.
7. **Stacked chimes.** `crafted` with `learned` plays craft-complete and recipe-learned at the same instant, and the arpeggios smear. Play only recipe-learned, or delay it by 0.7 s.
8. **Leftovers:**
   - Remove `metalClick(1600)` from `rustle` (`:800`).
   - The plank harvest (`gather-system.ts:157`) should not play the foliage rustle.
   - Remove the orphaned `camp-feedback` scene node (`main.iwsdk.scene.json:1097`) and its asset, or give it a use.
9. **Master limiter.** Nothing protects the output when loud sounds pile up, for example at the ending: roar, ignite, music and beds together. `AudioListener.setFilter(ctx.createDynamicsCompressor())`, reached through the head's children (grounding (b)), with threshold −6, knee 6, ratio 8, attack 3 ms and release 150 ms.
10. **Night tree-cricket.** The continuous 2.85 kHz sine (`:537-541`) risks sounding like tinnitus. Gate it with `max(0, sin(2π·3t/L))`, which stays periodic over the loop, and drop its amplitude from 0.022 to 0.012.
11. **Brook reach.** At camp, 21 m away, the brook is as loud as the day bed (about −31 LUFS). Narrow `BROOK.on` from 45 to 32 m.
12. **UI clicks.** The Enter VR, Leave VR and New Journey buttons (`journal-system.ts:232-234`) make no sound. A `warn` toast has none either; give it a soft low chime.
13. **Latency (unconfirmed on device).** The MP3 one-shots carry about 25 ms of LAME priming (`start: 0.025` in ffprobe). If Quest Browser's `decodeAudioData` does not trim it, every one-shot lags the haptic pulse. Opus one-shots would avoid this, and they are smaller.
14. **HRTF budget.** There are 45 positional one-shot emitters plus 3 positional loops. Profile the idle PannerNode cost on Quest (grounding G12), and consider cutting rare clips to 1 voice.

---

## 4. Coverage map

**Mapped and working.** Every event in the spec's audio list has a sound. The ambience responds to game state:

- fire loudness follows fuel
- the brook emitter sits at the nearest point of the brook
- the beacon roar follows its lit state
- the heartbeat has hysteresis

**Mapped, but with the wrong clip:**

- bolt and spear landings (P1-7)
- the torch shove plays the flesh hit (P1-7)
- dry-fire and closing the lighter play the ratchet (P1-11)
- stew plays the crunch; rabbits play hooves; the plank harvest plays leaves (P2-3, P2-8)
- fire-out plays steam (P1-8)

**Silent, but should sound:**

| Moment | Priority |
| --- | --- |
| Wolf stalking or spawning | P0-2 |
| Beacon charge | P1-10 |
| Dusk | P1-14 |
| Held torch loop and swing | P1-12 |
| Wolf yelp | P0-2 |
| Footsteps | P2-1 |
| Splash | P2-2 |
| Item bounces | P2 |
| Stew simmer | P2-6 |
| Starving onset: a stomach growl in place of the toast alone | P2 |
| UI buttons | P2-12 |

**Silent on purpose, which is correct:** snap turn, toasts other than warnings, `new-game` and `spawn-item`.

---

## 5. Emotional scoring

| Beat | What plays | Read | Direction |
| --- | --- | --- | --- |
| Day, a peaceful valley | Beds only: rumble-heavy wind and sparse birds | Neutral, slightly bleak | Brighten the bed (P1-9). Add world-anchored birds (P1-4). Optionally, play a sparse two-bar camp motif from the dawn material once per day, when the fire is lit and the player has idled 60 s. |
| Dusk | Nothing | Missing | A `dusk` stinger (P1-14) and a distant howl from stage 1 onward. |
| Night | The night bed, plus the `stage` stinger when danger rises | Tension is episodic, not sustained | An adaptive night layer: a low D-Phrygian drone loop (D–Eb) whose volume follows the danger stage and the nearest wolf's distance, silent inside the fire ring. The stalk panting (P0-2) makes the threat spatial. |
| Taking damage or dying | A sub thump and a sub drone | Lost on the speakers | P0-1. Remove the death click (P1-1). |
| Dawn | Pad plus rising pentatonic plucks, deferred correctly after sleep | **Good**: relief lands | Keep. |
| Finale | The ending theme in D major, beds ducked | Pleasant but small and masked; the build is silent | Add `beacon-charge` (P1-10). Duck the roar. Layer a choir-like formant pad (breathVoice formants 700/1100/2500 over the saw pads) and a frame-drum hit on the final chord. Render it in stereo. Afterwards, crossfade into a calm "no Hollow" night bed. |

The motif identity is strong. Keep the D-major pentatonic family (A–D–E–F#–A) for anything hopeful, and derive the dread material from the same D tonic (D minor, or Phrygian with Eb). The whole score then reads as one piece.

---

## 6. Top 6 changes

1. **Make danger audible on Quest speakers (P0-1).** Re-voice heartbeat, player-hurt, hit, death, drop, stage, chop and crossbow into 150 Hz–2 kHz, and raise `HEART_VOLUME`. No danger cue should lose more than 6 dB through a 200 Hz high-pass.
2. **Give wolves an approach voice (P0-2, P1-13).** Add a spawn howl, a `wolf-pant` stalk cue every 2.5–4.5 s within 15 m, and a hurt yelp. De-synthesize the howl (no parallel-fourth voice, a steeper harmonic roll-off, a smooth contour, 3 variants) and the growl.
3. **Break the repetition (P1-3, P1-4).**
   - 2–3 synthesized variants for every frequent one-shot, rotated by the existing voice round-robin, with ±1 dB jitter.
   - Birds and owls moved out of the loops into world-anchored spot emitters.
   - The fire split into two co-prime loops.
4. **Fix the clicks and the mix (P1-1, P1-6).**
   - A `tailFade()` in `tone()`, `modes()` and `burst()`.
   - K-weighted normalization in the synth.
   - `BED` at 0.8 and 0.85.
   - Raise grab, drop-light, snap and the dry click; cut fire-out and bowl-fill.
5. **Re-voice the signature sounds (P1-2, P1-8, P1-9, P1-12).**
   - A campfire with at least 4 audible crackles per second.
   - fire-out as an ember collapse rather than steam.
   - A warm, bright day bed.
   - A held-torch flame loop.
6. **Score the arc (P1-10, P1-14, P1-5).**
   - A dusk stinger.
   - A beacon-charge riser.
   - The roar ducked under the ending.
   - Stereo beds.
   - Then the adaptive night drone from §5.

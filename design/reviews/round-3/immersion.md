# Round 3: immersion, sound and comfort

2026-09-29 · code plus `design/verify/tour` (desktop emulation, no headset). Voice clips are pending, so lines play as subtitles only.

## 1. Scores

| Area | R3 | R2 | Why |
|---|---|---|---|
| Overall presence | **8** | 7 | The shade holds still, fights stay quiet, and you hear your feet and the side of a bite. The silent voice holds it back. |
| Soundscape | **8** | 7 | Footsteps, a 16-voice pool, music stops on reset. Still dry; wrong step rate (#1). |
| Interaction SFX | **8** | 7 | Sentry click at the muzzle, directional struck cue. Hand sounds head-locked (#7). |
| Guide voice | **8** (design; not yet heard) | 6 | A threat gate, a fixed spot, world verbs. It gets left behind when you walk (#2) and ducks for silence (#3). |
| Haptics | **6** | 6 | A lub tick was added. Hover and hurt are unchanged, and starving buzzes (#4). |
| Comfort | **8** | 6 | The flash is subtle, rate-limited and dark at night; 2.6 m/s with a 0.55 tunnel. No options (#5). |
| Diegetic UI vs HUD | **7** | 6 | Buttons only in subtitles; toasts defer to the shade. `depthTest:false` remains (#8). |

## 2. Round-2 top 8: resolution check

1. **Red flash: mostly resolved.** 0.55, inner edge 0.75, `#5a0a0e` at night, a 0.6 s gap, aimed at the attacker. `night-10`: red over a third of the view, down from two-thirds. Open: directional haptics, Reduce flashes, starving (#4).
2. **Mid-combat lectures: resolved.** Lines below priority 9 are held while a wolf is within 12 m and for 6 s after a bite (`voice-lines.ts:42`). 'wolf' now follows dusk.
3. **Gaze-chasing and teleporting voice: resolved.** It glides only inside 1.0 m. This causes #2.
4. **Sentry click in your head: resolved.** `'sentry-dry'` is now positional (`audio-map.ts:88`).
5. **Triple messaging: resolved** through `covers`/`defers`; toasts wait while the shade speaks.
6. **Controller jargon: resolved.** Lines use world verbs, and `hint` is shown in subtitles only.
7. **Locomotion: mostly resolved.** 2.6 m/s, a 0.55 tunnel, 4-take steps. Options are missing, and my 0.7 m stride was wrong (#1).
8. **Heartbeat sync: resolved.** One clock, 0.75 s, the dub at 0.36, a threshold of 30, a 0.2/25 ms haptic. The duck still does not start when the shade arrives (#3).

## 3. Top remaining issues

1. **Footsteps patter at a sprint cadence.** A 0.7 m stride (`audio-map.ts:321`) at 2.6 m/s (`index.ts:57`) is 3.7 steps/s. The 0.36 s heel-toe takes (`synth-audio.mjs:1307–1309`) overlap into a scurry. My round-2 number caused this. *Fix:* set the stride to 1.1 m (2.4 steps/s), or `clamp(0.45 + 0.25·v, 0.7, 1.1)`.

2. **The shade is left behind when you walk.** It moves only if you come within 1.0 m (`guide-system.ts:125, 1071–1090`), and its voice uses ref 2.6 / rolloff 0.7 (`:382–383`). A 7 s line at 2.6 m/s ends about 18 m away, at about −14 dB and behind you. In `expedition-08` you walk past it and the robe fills a fifth of the view. *Fix:* while it speaks and the rig moves faster than 0.8 m/s, glide at up to 3 m/s to 2.6 m, ±55° off your travel direction (pace-keeping, not gaze-following). Raise `SPEAK_CLOSE` to 1.5 and dim the shade inside it.

3. **Silent subtitles duck the world.** The 'guide' event has no voiced flag (`bus.ts:64`), and `audio-system.ts:441` ducks on every line. So each 3–12 s subtitle halves the beds, fire and birds under a mute ghost. *Fix:* emit `voiced: this.usingAudio` and duck only voiced lines. Start the duck on `arriving` once the clip is ready.

4. **Starving still grunts and buzzes every 3 s, and bites are felt in both hands.** Every `hurt` pulses both hands at 0.5 + amount/40 (`survival-system.ts:84–87`). That includes starving ticks (`:213–216`), which also grunt, about 40 times from 60 health. *Fix:* give starving ticks a soft breath at −28 LUFS with a 0.2/30 ms pulse, and grunt only on every third tick. For bites, drive the attacker's side at 1.0 and the other hand at 0.35, using `aimFlash`'s camera-local x.

5. **No comfort options.** The speed is hard-coded, and there is no tunnel, turning or flash setting. *Fix:* add a saved Comfort row to the journal: speed 2.0/2.6/3.2, tunnel off/0.55/0.8, 30°/45°/smooth turning, and Reduce flashes (rim only, no pulse, a softer spire-eye fill).

6. **Dry mix, silent pot.** Tails are baked only into stingers, howls, birds and a few others; a chop or a hit at 40 m sounds close. The pot steams (`fx-system.ts:371–376`) but never simmers. *Fix:* add one shared ConvolverNode send with wet `clamp((d−4)/40, 0, 0.3)`, set in `playSpatial`. Add a `pot-simmer` loop at −32 LUFS while the fire is lit and the pot is filled.

7. **Hand sounds play inside your head, and the hover tick is hard to feel.** grab, reload, dry-click, lighter and lid are all `H()` (`audio-map.ts:52–53, 73, 85–86`), though 'grab' carries x/y/z. Hover is still 0.12/12 ms (`item-system.ts:460`). *Fix:* make them positional at the event point, `P(…, 0.5, 1, 15, …)`, and raise hover to 0.2/18 ms.

8. **Subtitles paint over nearer objects.** Both panels use `depthTest:false` (`toast-system.ts:106, 116`). Words paint over a bowl at your lips, a depth conflict; `opening-02/04` show them on the fire. *Fix:* fade the panel to 35% when a held item is nearer than 1.3 m inside its cone.

**When the clips land:** normalise them to about −18 LUFS, recheck the −6 dB duck, and play 'weak' over the heartbeat, which does not duck (`audio-system.ts:87`).

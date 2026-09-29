# Round 2: immersion, sound and comfort

2026-09-28 · code plus the tour captures (desktop emulation, not tested on a headset).

## 1. Scores

| Area | Score | Justification |
|---|---|---|
| Overall presence | **7** (R1: 6) | Night reads as a warm island, cuts fade and the finale lands. The guide and the damage overlay now break it. |
| Soundscape | **7** | Stereo beds, birds placed in the world, a positional fire and brook, a stalk pant. No footsteps or simmer, and everything is dry. |
| Interaction SFX | **7** | Almost every verb is covered, with 2–6 takes and jitter. Hand sounds are head-locked, and the sentry click is broken (#4). |
| Guide voice | **6** | HRTF voice at the mouth and a −6 dB duck, but it chases your gaze, lectures in fights and repeats the toasts. |
| Haptics | **6** | Broad coverage, but the hover tick (0.12 / 12 ms, `item-system.ts:403`) is likely too weak to feel and hurt has no direction. |
| Comfort | **6** | Snap turn, fades and no forced camera motion. The red flash is too intense (#1), and locomotion is brisk (#7). |
| Diegetic UI vs HUD | **6** | Board, wrist and toasts sit in the world, but subtitles draw `depthTest:false` over everything and repeat the voice. |

## 2. Top 8 issues

1. **The red damage flash is not "subtle" as the spec asks (GAME_SPEC.md:139).** flashStrength is 0.85 (`vignette-system.ts:80`). A 20-point bite hits that peak (`:190`), with the inner edge at r = 0.59 (`:274`). Red then covers about two-thirds of `night-10-bitten.png`. While starving it flashes again every 3 s for about 200 s (`survival-system.ts:13, 178–182`). The low-health lub-dub (`:247–250`) swells about 2.3 times a second. *Effect:* peripheral flicker, and it hides the wolf. *Fix:* set strength to 0.5 and `redInner` ≥ 0.75. Use `#5a0a0e`. Allow at most one full flash per 0.6 s. Make starving a dark rim at 0.25 and the pulse a single beat. Put the flash and haptic on the bite's side (x/z on `hurt`). Add "Reduce flashes".

2. **The shade lectures mid-combat.** The 'wolf' line fires on the first spawn or stalk (`voice-lines.ts:179, 239`), and 'hurt' and 'weak' fire on damage (`:183, :191`). `blocked()` has no threat gate (`guide-system.ts:449–451`). In `night-10` a 12 s lore line plays mid-bite. *Effect:* it drains the tension. *Fix:* block lines below priority 10 while a wolf is within 12 m or for 6 s after a `hurt`. Move 'wolf' to dusk at the fire.

3. **The shade chases the gaze, and its voice teleports.** If the player looks more than 75° away for 1.2 s, the shade relocates (`guide-system.ts:645–658`). Its blink moves `root`, which carries the PositionalAudio (`:241`), so the voice jumps sides mid-sentence. The shade also stands inside the journal board (`opening-02`, `night-09`): the board is a 0.55 m circle (`:69`) but about 1.5 m wide. *Effect:* it reads as HUD. *Fix:* while it speaks, move it only if the player is within 1.0 m. Drop the off-view move. Model the board as two circles 0.6 m apart along its yaw.

4. **The sentry's dry click plays inside your head from any distance.** `sentry-empty` maps through `at()` (`audio-map.ts:251`), but `'dry-click'` is `H(…)` (`:81`), and `fill()` copies `def.positional` (`:147`). It is head-locked and repeats every 1.5 s (`combat-system.ts:24, 436`). *Fix:* add `'sentry-dry': P(0.9, 2, 1.5, 1.1, 35, 0.3)`, or make dry-click `P(1, 2, 0.6, 1.3, 30, 0.1)` and route `crossbow-empty` through `at()`.

5. **Voice, subtitle and toast say the same thing.** Pairs: `toast-system.ts:426` and 'bowl'; `:429` and 'fire-out'; `:465` and 'dusk'; `:447` and 'respawn'; `combat-system.ts:280, 438` and the two "empty" lines. *Effect:* three panels plus a voice for one fact. *Fix:* skip the toast while a matching line is unspoken and its clip is ready.

6. **The Titan speaks controller jargon.** "squeeze the grip" (`voice-lines.ts:91`), "pull the trigger" (`:100`, `:154`), "Point at the bedroll and pull the trigger" (`:200`). *Fix:* voice world verbs ("close your hand on it"); put buttons in a subtitle-only `hint` field, never sent to TTS.

7. **Locomotion is brisk and silent.** Speed is 3.2 m/s (`index.ts:57`). comfortAssistLevel is 0.35 (`iwsdk.config.json:42`), below the IWSDK default of 0.5. No footstep clip exists. *Effect:* vection on slopes, and silent gliding. *Fix:* default to 2.6 m/s with comfort 0.55. Add journal speed and tunnel options. Add `step-grass` and `step-dirt`, four takes each, at −30 LUFS, one step per 0.7 m.

8. **The heartbeat's sound and pulse disagree.** The audio beats every 0.75 s, with its second beat at +0.27 s (`synth-audio.mjs:783–784`). The vignette beats every 0.86 s, with its second beat at +0.21 s (`vignette-system.ts:25, 248–249`). Thresholds differ too: 35 (`:16`) vs 30 (`audio-map.ts:283`). They drift apart, with no haptic. *Fix:* set BEAT to 0.75 and the second beat to phase 0.36. Use one threshold of 30, lock the pulse's phase to the loop, and add a 0.2 / 25 ms pulse on the first beat.
   Also: start the voice duck when the shade arrives (`audio-system.ts:343`), duck the birds too, and release it on `silence()`.

## 3. What improved since round 1

- **Night:** firelight reaches 8 m instead of 1.85 m, with a glow pool on the ground (`fx-system.ts:160`). The safe ring reads (`night-09`).
- **Fades** on sleep, death, respawn, the start screen and the spire flash.
- **Finale:** dawn, echo braziers, the beacon's rise and roar, a spoken farewell.
- **Wolves are audible:** spawn howl, stalk pant, yelp, dusk howl.
- **Variety:** non-repeating takes, co-prime fire layers, stereo beds, birds in the world, a torch loop, a limiter and a dusk stinger.
- **The heartbeat** now loses 6.7 dB through a 200 Hz high-pass (R1: 10–17 dB).
- **Toasts** merge to one per action. Speed dropped from 5 to 3.2 m/s.
- **A diegetic narrator** is the right call; it needs discipline (#2, #3, #5, #6).

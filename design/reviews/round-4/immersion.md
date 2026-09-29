# Round 4: immersion, sound and comfort

2026-09-29 · code plus `design/verify/tour`. Voice clips pending: subtitles only.

## 1. Scores

| Area | R4 | R3 | Why |
|---|---|---|---|
| Overall presence | **9** | 8 | Feet, hands, bites and the shade all sound from where they are. As heard today, 8: the guide is still mute. |
| Soundscape | **8** | 8 | Step cadence is right, and silent lines no longer duck. Still dry, with a silent pot (#6). |
| Interaction SFX | **9** | 8 | Hand sounds now play at the hand. Starving still grunts (#2). |
| Guide voice | **9** (design; not heard) | 8 | It keeps pace mid-line and re-forms between lines. The duck starts late (#7). |
| Haptics | **8** | 6 | Directional bites, a faint one-hand starving tick, and a hover tick you can feel. |
| Comfort | **9** | 8 | Saved speed, tunnel, flash and subtitle settings; shaders warmed up. Subtitles drift in while you walk (#1). |
| Diegetic UI vs HUD | **8** | 7 | Subtitles face the eye and fade behind held items; Comfort is on the board. The fade cone misses nearby items (#5). |

## 2. Round-3 issues: resolution check

1. **Step cadence: resolved.** A 1.1 m stride at 2.6 m/s (2.4 steps/s), 0.9 m at 1.8 m/s. Takes no longer overlap.
2. **Shade left behind: resolved.** Mid-line it glides at up to 3 m/s. A lag of about 1.1 m leaves it about 2.2 m away, roughly 80° off your travel: beside you, just outside a Quest 3's view, its voice to the side. Between lines it re-forms after 4 m walked or an 85° turn.
3. **Silent lines ducking: resolved** through `voiced`. Starting the duck on arrival was not done (#7).
4. **Starving and bites: haptics resolved.** Starving is 0.15 for 25 ms on the left hand. A bite pulses the near hand at 1.0 and the other at 0.35. **Audio: partial**, see #2.
5. **Comfort options: mostly resolved.** Missing: turning options, a fast speed, a strong tunnel, and any way to reach them away from camp (#4).
6. **Dry mix and silent pot: open.**
7. **Hand sounds and hover: resolved.** `P(…, 0.5, 1, 15)` for hand sounds; hover is 0.22 for 16 ms.
8. **Subtitles over nearer objects: mostly resolved.** The fade works for items held at arm's length (gap: #5). `night-10`: the flash leans to the attacker's side.

## 3. Top remaining issues

1. **Subtitles drift in while you walk.** The panel re-targets only after the eye moves 0.3 m, then follows at 5/s (`toast-system.ts:430–435`). At 2.6 m/s it trails by about 0.67 m, so it hangs about 0.6 m away instead of 1.3 m. The text doubles, then slides out when you stop. *Fix:* move the panel with the eye every frame (`position += eye − lastEye`); keep the lazy follow for rotation and mode only.

2. **Starving still grunts every 3 s.** 'hurt' ignores `cause` (`audio-map.ts:241–247`): 40 grunts at 0.58 from 60 health. *Fix:* for 'starving', a soft breath (or `player-hurt` at 0.25), with a grunt every third tick.

3. **Subtitles off silences the guide.** Unvoiced, the shade then says nothing, and the control `hint` lives only in the subtitle (`toast-system.ts:328`). *Fix:* while unvoiced, force it on, labelled "no voice yet". With subtitles off, show `hint` as a toast.

4. **Comfort settings are only on the camp board.** Out of reach 60 m away or in the first minute. *Fix:* add the Comfort row to the start panel and the wrist. Add a fast speed (3.2 m/s), a strong tunnel (0.8), and 30° snap / 45° snap / smooth turning (`turningMethod`/`turningAngle`).

5. **The fade cone misses nearby items.** A bowl at the mouth covers about 45° of view. The subtitle 16° above a lowered gaze falls outside the fixed 14° cone around its centre (`toast-system.ts:409`), so words paint over it while you eat. *Fix:* cone = 14° + atan(radius/distance), from the item's bounds.

6. **Dry mix, silent pot** (R3 #6). *Fix:* a shared ConvolverNode send with wet `clamp((d−4)/40, 0, 0.3)` in `playSpatial`, and a −32 LUFS `pot-simmer` loop while the pot is filled over a lit fire.

7. **The duck starts on the first word.** It begins at `speak()`; at an attack of 4/s the beds are still about 3 dB up for the first syllable. *Fix:* start `voiceUntil` when the clip is `Ready` during `arriving`, or raise the attack to 10/s.

8. **Minor.** Reduce flashes drops a bite's direction (`flashDirAmt` 0); keep it at 0.5. `sfx-page` still plays in your head (`audio-map.ts:181, 211`); play it at the hand.

**When the clips land:** normalise to about −18 LUFS; recheck the −6 dB duck at 2.2 m while pacing.

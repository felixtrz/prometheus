# Prometheus — First Fire: Verification (Phase 6)

**Date:** 2026-09-29.

**How it was verified.** vitexec 0.8 runs each scenario on a fresh page with its own Vite server and headless Chromium. Inside the page, the IWSDK dev plugin's IWER emulator stands in for a Meta Quest 3. Scripts drive the headset and controllers the way a player would: poses, squeeze, trigger, and thumbstick walking. They then read ECS state and bus events to assert the outcome.

- State writes are limited to logged **fixtures** that set up a situation, such as the clock or fuel. They never set an outcome.
- Scripts live in `vitexec/*.ts`, and the in-page harness is `vitexec/lib/*.ts`. Runners:
  - `npm run check`: isolated pages.
  - `npm run check -- --shots <dir>`: evidence screenshots.
  - `npm run check:managed -- <script> [--fresh]`: runs inside the IWSDK managed browser, over its DevTools port 9333.

## Result

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run typecheck:tools` (vite config, vitexec scripts) | clean |
| `npm test` (node unit tests) | **91 / 91 pass** |
| `npm run check`: vitexec gameplay scenarios | **6 / 6 PASS, 98 checks** (log: scratchpad `vx-iter2.log`) |
| `npm run build` | succeeds in 6.7 s. `dist/` is 21 MB, including 102 audio clips. No vitexec injection and no voice-prep page in the build. The latest strings are present. |
| Managed browser | the opening scenario passes live in the headed managed window (`npm run check:managed -- vitexec/opening.ts --fresh`, 14 checks, 68 s) |

**Scenario runs** (latest):

| Scenario | Checks | Time |
|---|---|---|
| opening | 14 | 69 s |
| survival + survival-restore (with a page reload) | 21 + 4 | 37 s |
| expedition | 22 | 194 s |
| night | 19 | 162 s |
| finale | 12 | 131 s |
| perf | 6 | 29 s |

## Success criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| S1 | The lighter lights the cold fire; fuel then falls | PASS | opening S1: the fire starts cold; holding the lighter flame at the tinder lights it; fire-lit fires once; fuel burns down |
| S2 | 2 ingredients plus stirring cook the stew; the bowl fills; eating raises hunger | PASS | opening S2: pot holds meat + mushroom; stirring cooks `meat+mushroom`; the dipped bowl fills; eating at the mouth takes hunger 66 → 100. Stew also gives a 90 s well-fed buff. |
| S3 | A matching bench set plus 3 strikes crafts the product | PASS | opening S3 (torch), expedition (spear, crossbow, bolts), night (bolts, sentry kit): "bays match X" and "three hammer strikes craft X" |
| S4 | The axe fells deadwood; forage nodes yield | PASS | expedition S4: three blows fell the deadwood, each blow lands, and it yields a log and two sticks; flint picked from the brook bed; reeds pulled for cord. World agent's check: standing trees drop 2 sticks after 3 blows. |
| S5 | Pack: unrolls low, snaps items in, rolls up to hide them, and follows the player when worn | PASS | survival S5 (8 checks), plus the sentry & pack agent's check: the handle stays put within 0.00 mm and 0.0° when the pack is dropped |
| S6 | Fuel falls; a log raises it; the fire goes out at 0 | PASS | opening (fuel falls); survival S6 (a log takes fuel 40 → 75); the dead-fire night in the balance probes |
| S7 | Starving drains health; death respawns at the bedroll; the pack is dropped | PASS | survival S7: health 0 kills; the worn pack drops where the player fell; respawn at 60 health, back at camp; death and respawn cues fire once. Starving ticks were verified by the journey agent. |
| S8 | Night changes the sky; sleep skips to dawn, sets respawn and saves | PASS | survival S8: sleeping skips to dawn (clock 480); the sleep objective completes; respawn moves to the bedroll |
| S9 | Wolves come at night, stay out of the firelight, bite away from the fire, and die to bolts and spears | PASS | night S9: 3+ wolves at stage 3; they smother the lit fire; closest wolf about 7.4–8.4 m (outside 6 m); they howl; the player is safe by the fire; a bite of −20 comes away from the fire |
| S10 | A spear hit on a deer drops meat | PASS | expedition S10: after a slow stalk (under the deer's hurry speed), a thrust kills the deer; the hit cue reports the kill; 2 meat drop |
| S11 | The crossbow fires when loaded; the count decrements; a bundle reloads | PASS | expedition S11: a bundle holds 6; touching it to the bow loads 6; the trigger fires a bolt, leaving 5; reload and twang cues fire |
| S12 | The deployed sentry fires at a wolf in range | PASS | night S12: it deploys low near the fire with 3 starter bolts, fires at the ringing wolves, and a bundle tops it up; every bolt is accounted for (4 of 5 shots hit, about 77% hit rate) |
| S13 | Picking up a page shows it and teaches its recipe | PASS | survival S13: page 2 is found and the spear recipe learned; the recipe-learned cue fires |
| S14 | A lit torch held in the Spire brazier → beacon lit, ending, wolves gone | PASS | finale: the v3 rule is a 24 s hold that must be defended, and the free hand shoots guardians. Beacon lit; ending beats `spire-eye → dawn → outpost → grove → camp → theme → smoke`; the Hollow dissolve; the epilogue tally arrives. |
| S15 | A reload restores progress | PASS | survival-restore after `page.reload()`: the world waits at the start screen with no silent resume; Continue restores objectives, pages and recipes and the meat in `pack-6` |
| S16 | Key interactions play SFX; the ambience switches between day and night | PASS | `tests/audio-map.test.mjs`: every bus event is mapped to a registered, synthesised clip or marked silent. The audio agents' runtime checks covered footsteps, the positional sentry click, heartbeat below 30 health and the day/night beds. **The voice clips for the guide are pending** (see Known gaps). |
| S17 | ≤ 200 draw calls and ≤ 250k triangles per view | PASS | perf: day 170 draws / 228k triangles, night 165 / 227k, per view. That is down from 253 / 283k before the iteration-1 optimisation. |
| S18 | Typecheck, unit tests and build pass | PASS | see Result |

## v3 play-test feedback (the 9 user items)
Round-4 progression judge: all 9 are resolved, and #7 is resolved except the voice audio. Details are in `design/reviews/round-4/progression.md`.

## Judge loop (design/reviews/round-2 → round-4)

| Judge | Round 2 | Round 3 | Round 4 |
|---|---|---|---|
| Visual (overall) | 7 | 8 | **9** |
| Gameplay (overall fun) | 6 | 7 | **8** |
| Story (overall) | 6–8 | 8–9 | **9** |
| Progression (mean) | ~6 | 7.6 | **8.4** |
| Immersion (presence) | 7 | 8 | **9** (8 as currently heard) |
| Code | 1 Critical, 7 Warnings | 0 Critical, 4 Warnings | **0 Critical**, 1 Warning (fixed) |

## Known gaps / deferred
- **Guide voice.** The 41 voice clips are not generated. Generating them needs the user's Drawcall sign-in: open https://localhost:8081/voice-prep.html and run both batches. Until then every line shows as a subtitle, and nothing is ducked for silent lines.
  - For release, consider vendoring the clips into `public/audio` (code review S10).
- **Not verified on a real Quest.** Everything above ran in emulation, so frame time, sparkle size, subtitle comfort and haptic strength need a headset pass.
- **Round-4 gameplay notes, not yet applied:**
  - the one-torch jab loses, so the hint should say "use your other hand";
  - relight the fire at 60 fuel from stage 2, so a post-death night can be survived;
  - third finale wave of 5, so a full crossbow alone doesn't trivialise it;
  - stagger the pincer's second wolf;
  - dissolve guardians when the player dies at the Spire.
- **Remaining code suggestions** (`design/reviews/round-4/code.md`): gather retry back-off, cached flame lookups, creature slot reset on level swap, flame-tip constants, dev-only debug globals, and making the CDP port opt-in.

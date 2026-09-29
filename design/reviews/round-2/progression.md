# Round 2: progression and intuitiveness

Judge: VR UX (progression). Date: 2026-09-28.

**How this was reviewed:** code and markup, the screenshots in `design/verify/tour/`, and three headless probes on an emulated Quest 3 (session scratchpad `judges/progress/probe*.ts`).

## 1. The nine complaints

| # | Complaint | Verdict | Evidence |
|---|---|---|---|
| 1 | Snap to hand; pass between hands | **Resolved** | Probe: the lighter snaps upright in either hand. The left hand shows the outline, squeezes, and takes it from the right. |
| 2 | Getting sticks; the axe can't chop trees | **Partial** | A waist swing at a big tree gave 3 chops. But 102/158 trunks (9/20 near camp) only take blows below 1.25 m (`gather-system.ts:234`). A level grip puts the blade 0.24 m above the fist, so a waist swing at a small pine gave **0 cues, silent**. Nothing says trees give sticks until the first chop. |
| 3 | Too much at the start | **Partial** | Props are trimmed, but 12 grabbables sit within 4 m. The load moved into the UI: the start panel, then a toast and a subtitle together (`opening-01`), then 35 s of speech. |
| 4 | Look-alikes, some grabbable and some not | **Partial** | Camp look-alikes are gone, and a rim plus haptic tick shows within 7.5 cm. Forage nodes still surround one real item with copies, such as boletes "matching the 'mushroom' item" (`valley-props.scene-asset.ts:153`), flint nodules and reed stems. Grabbing a copy is silent. |
| 5 | Backpack flips on drop | **Resolved (code)** | `layDown` keeps the yaw, and `handleYaw` never spins it. Not measured. |
| 6 | Sentry tracks but doesn't shoot | **Resolved** | 6 starter bolts, an armed/empty lamp, an empty toast and a guide line. The night tour shows it firing. |
| 7 | Guide audio; damage and hunger cues | **Partial** | The vignette and wrist bands are good. But the probe log says **"35 of 35 voice clips are not generated yet; the shade speaks in subtitles only."** |
| 8 | Items fall into the crate | **Resolved** | Probe: a stick dropped 35 cm over the crate rests on the straw (y 1.16), as intended. |
| 9 | New journey / refresh carries state | **Resolved** | Probe: after New journey, items, pack, axe, guide list and objectives are all back to the authored state. A refresh shows the start panel, and a save needs a two-tap erase. |

## 2. Scores

| Area | Score | Why |
|---|---|---|
| Onboarding (first 5 min) | **5** | The wake toast names the task. But the first how-to line comes about 27 s in, after silent lore, and dusk falls at 4.3 min. |
| Discoverability of recipes and resources | **5** | Flint, cord, resin, plank and cloth are named. Sticks, the spring and the second trigger never are, and unlearned recipes read "???". |
| Objective clarity | **7** | The NOW card, "Tonight:" and a correct "Next:" work. The wrist hint drops its verb ("Trigger, spring and plank."). |
| Interaction affordances | **6** | Good: hold poses, hover rim, both hammer faces strike. Weak: forage copies, the silent tree band, a one-way sentry deploy. |
| Feedback on success/failure | **7** | Vignette, vitals bands, sentry lamp, miss thuds. Tree misses are silent and there is no voice. |
| Progression curve | **7** | Danger is staged by tech (0, 1, 3, 5 wolves), the kit comes loaded, the page-5 gate is explained. A gentle ramp. |
| UI legibility in VR | **5** | Toast body is 0.61° at 1.4 m (0.43° while walking), about half the subtitle's 1.05°, yet it carries the objective. |

## 3. Top 8 issues, ranked by player confusion

**1. The guide is mute.**
- Evidence: 35/35 clips are missing. A glowing figure "talks" in silence.
- Fix:
  - Generate the clips in `voice-prep.html`.
  - Self-host them in `public/audio/voice/`.
  - Add a CI check that fails when `__prometheusGuide.clipsMissing > 0`.

**2. Swings at most trees do nothing.**
- Evidence: in 65% of trunks the band top is below 1.25 m.
- Fix, in `chopTrees`:
  1. Use `top = max(trunk.top, 1.7)`.
  2. For contact above the band, play `thud` with a 0.2 haptic.
  3. Toast once: "Swing lower, at the bare trunk."

**3. Instructions arrive late and compete.**
- Evidence: intro (12.8 s lore), then note (11 s), then grab (11.5 s). The lighter line only plays after the player grabs the lighter.
- Fix:
  - Cut the intro to about 5 s.
  - Line 2: "Your pack is on the table to your right. Take the lighter; pull the trigger and hold the flame in the logs."
  - Hold the opening toast until the intro ends.

**4. Sources are never named.**
- Evidence: `story.ts:65/67/71`.
- Fix:
  - Torch hint: "Sticks lie around camp; any tree gives more to the axe."
  - Sentry hint: "Spring in the outpost crate; a second trigger lies at the lookout."
  - Journal: show unlearned recipes as "Page at the brook" rather than "???".

**5. The shade blocks the view.**
- Evidence: it fills 25–40% of the frame at the grove, brook and meadow, during the Spire hold with a wolf near (`finale-12`), and in a bite (`night-10`). It also covers the bench in `opening-01`.
- Fix:
  - Hide the body (keep the subtitle) when a wolf is within 8 m or the beacon is in progress.
  - Re-check `CLOSE` every frame and keep 2 m or more away.
  - Use off-view angles of 55° or more in `SPOTS`.

**6. Stale guide lines.**
- Evidence: at the Spire it says "The bench knows this shape… strike the pad" (`finale-12`). `bench-valid`, `torch`, `spear` and `bolts` have no `unless` and a 40 s TTL (`voice-lines.ts:68,133`).
- Fix:
  - Set `ttl: 12` on context lines.
  - Add `unless: 'crafted-since'` / `'bench-empty'`.
  - Drop a line whose subject is more than 10 m away.

**7. Forage look-alikes.**
- Evidence: one grabbable per node. The 7.5 cm rim can't guide a search from standing.
- Fix:
  - Give the real item a 1 Hz emissive glint while `slot === 'node'`.
  - Or let a squeeze on any `HARVEST_PARTS` mesh put the item in hand.
  - Toast once per kind: "Take the one that glints."

**8. Wrist hints lose their verbs, and toasts are small.**
- Evidence: `wrist-system.ts:33` clips at 62 characters, so the wrist shows "Read the note in your pack, then take the lighter." Toast body is 2.5 units × 0.6 scale.
- Fix:
  - Author a short `wristHint` per objective, for example "Lighter: trigger, flame in the logs."
  - Set the toast scale to 0.9 (0.92° body).

**Also:**
- The crossbow still reloads by distance to its origin (`combat-system.ts:355`). Measure to `loaded-bolt` instead.
- A kit set down anywhere low deploys permanently (`combat-system.ts:120`). Let a squeeze on the base pick it back up.

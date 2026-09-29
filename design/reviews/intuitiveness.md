# Review: intuitiveness of interactions and progression

Date: 2026-09-28. The question: can a first-time player with no manual work out what to do next, and how to do it physically, with Quest controllers?

**How this was reviewed:** by reading the code, data and screenshots only. The game was not run.

- **Read:** `design/GAME_SPEC.md`; `src/game/{story,rules,catalog,recipes,bus,haptics,audio-map,components}.ts`; every system under `src/game/systems/`; `public/ui/camp-journal.uikitml`; `public/scenes/main.iwsdk.scene.json` and `modules/valley*.json` (placements); `src/scene-assets/{items,camp-props,camp-stage,camp-dressing,valley-props}.scene-asset.ts` (affordance geometry); `tests/e2e/opening.mjs`; `design/VIDEO_REVIEW.md`; the screenshots in `design/verify/v2/*.png` and the scratchpad `ui/*.png`.
- **Input facts that matter here:**
  - Near grab is a 7 cm sphere around the grip, with no hover visual (`node_modules/@pmndrs/pointer-events/dist/pointer/grab.js:5`, `node_modules/@iwsdk/xr-input/dist/pointer/grab-pointer.js:13`, "no visuals for now").
  - A grabbed object keeps the offset it had at pickup. There is no snap-to-hand pose.
  - While a hand holds something, that hand's ray is locked out.
  - The ray is drawn only when it hits an interactable. In this game that is the bedroll or the journal.
- **Heights above local ground** were computed with `terrainHeight()` from `src/game/terrain.ts`. They are listed in section 3.4.

---

## 1. Score: **5 / 10**

**Verdict:** the goals are readable but the verbs are fragile.

**What works:**
- The diegetic journal with its NOW card and hint.
- "Objective complete → Next: …" toasts that carry the hint (`toast-system.ts:168-176`).
- Failure toasts for many wrong actions: a bad pot item, a cold pot, sleeping in the day or without a fire, a full pack, an unfilled or invalid bench, placing the sentry too far away, and a fire with no wood.
- Near-complete audio coverage (`audio-map.ts:133-199`).
- Generous windows for the pot, fire, beacon and pack.
- The page reader, which opens automatically beside a held page.

**What undermines it:** three problems sit on the critical path.

- **The torch gate is a silent hidden requirement.** The hammer only counts with the polished face pointing down, and every other hit is silent.
- **Onboarding never reaches the headset.** The only opening line is shown before the player enters VR, and behind the XR spawn.
- **Release targets are tested only at the moment of release.** A log tossed onto the fire, or an item dropped into a bench bay from a little too high, lands visibly in the right place and does nothing.

Around these sit a second tier of problems:
- Undiscoverable verbs: wearing and unwearing the pack, reloading the crossbow, and which forage item is the real one.
- False affordances: the stacked woodpile billets and the decorative mushrooms and reeds.
- An objective list that stalls on "Sleep at the bedroll" through the whole day.

The design ideas are right, and most fixes are small changes to tolerances, text and feedback, not redesigns.

### Likely first 10 minutes (from the code)

| t (min) | What the player sees and does | Friction |
| --- | --- | --- |
| 0 | Enters VR at (0, 0, 0.4) facing −Z. The opening toast was spawned at load, in front of the desktop camera at (0, 2.25, 4.3) (`iwsdk.config.json:25-30`, `story-system.ts:128`, `toast-system.ts:232-239`). It sits behind the player and has faded after 3.85 s. | No instruction in the headset. The wrist says "NOW Light the campfire" with no hint, and nothing says the wrist exists. |
| 0–1 | Wanders to the journal (3.3 m away). The hint text is a 2.2 cm em (`camp-journal.uikitml:124-125` × 0.8 scale), about 0.4° from spawn, so it must be read from about 1 m. | This works once the player walks up to it. |
| 1–2 | Takes the lighter from the pack, holds the trigger and holds the flame in the logs for 1 s. | No progress cue during the dwell. Lighting then succeeds with a whoosh, flames and a toast. |
| 2–4 | Fire lit, with fuel 40 at 1/3 per second: about 2 min of burn (`components.ts:32`, `rules.ts:17`). "Burning low" appears after 75 s, while the player is gathering ingredients. The player grabs a stacked woodpile billet, which is decorative. They toss a real log onto the fire from standing height and it lies in the flames without counting. | The fire goes out mid-stir, the stir stops counting, and "The pot is cold" appears. |
| 4–8 | Dusk falls around 4.3 min. The player crafts at the bench, swings the hammer naturally, and nothing happens. There is no sound and no toast. | This is the likeliest hard stall in the game. |
| 8+ | After the torch, the NOW card reads "Sleep at the bedroll" all day (up to about 5.5 min). The "Next:" toasts keep naming it, even after the player reaches the outpost (screenshot `09-outpost.png`). | Guidance stalls. |

---

## 2. Verb-by-verb audit

Legend: **V** visual, **A** audio, **H** haptic, **T** toast. Severity is the worst outcome for a first-timer.
- **P0:** likely hard stall or silent failure on the critical path.
- **P1:** frequent confusion or a costly setback.
- **P2:** polish.

| # | Verb (code) | How it's learned | Success feedback | Near miss / failure behaviour | Likely failure mode | Sev |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Grab an item from a pack cell (`item-system.ts:49-59`) | Journal line "Squeeze near an item to grab it." (`camp-journal.uikitml:326`) | A (grab tick). No H, no hover highlight. | Silent: the 7 cm sphere must touch the mesh. | Small items (the lighter is 7.5 cm tall, and flint) need a precise reach. The player can't tell whether a prop is grabbable. | P1 |
| 2 | Put an item into a pack cell (`backpack-system.ts:176-205`) | Visual only: the cells look like pockets. | V snap, A snap, H .25. | Generous: anywhere over the mat, up to 0.6 m above it. It picks the nearest free cell. Full pack gives a T. | Occasionally lands in a different cell than aimed. | OK |
| 3 | Roll up the pack by grabbing the roll (`backpack-system.ts:57-64`) | Not taught. The roll at the mat edge suggests it. | A roll. The mat and items vanish instantly, with no H and no T. | — | An accidental grab makes all the items "disappear", which is alarming. | P2 |
| 4 | Wear the pack by releasing it at the shoulder (`backpack-system.ts:138-148`) | **Not taught anywhere.** | A (snap). No H, no T. The pack ends up out of view. | Forgiving: within 0.4 m of the anchor, or level with or behind the face and above the chest. | Never discovered. The player carries two items by hand across a 20–33 m valley. | P1 |
| 5 | Take the pack off the shoulder (`backpack-system.ts:17-18`, anchor 0.18 right / 0.3 down / 0.17 behind the head) | **Not taught.** | Same as #3. | Silent if the hand misses. The roll is mostly behind the right ear. | The player doesn't know the pack is on. They think it is lost. | P1 |
| 6 | Unroll the pack by releasing it low (`backpack-system.ts:149-167`) | Not taught, but any non-shoulder release unrolls, so it is found by accident. | A unroll, V mat. | Always succeeds. The mat is laid flat at the centre's ground height. | On slopes, cells float or sink into the terrain. Items on the ground mat need a floor reach (about 0.09 m). | P2 |
| 7 | Flick the lighter with the trigger (`campfire-system.ts:150-159`) | Journal hint "Pull the trigger". | V flame, A flick, H .2. | — | Fine. | OK |
| 8 | Hold the flame to the tinder for 1 s (`campfire-system.ts:163, 212-217`; `rules.ts:89-91`, r 0.30, y 0.22–0.86) | Journal hint. | V flames and light, A ignite, T objective and Next. **No H** on the big success. | Silent. The dwell resets whenever the tip leaves. There is no smoke or ramp during the 1 s. | The player pulls away at 0.5 s and assumes the lighter needs aiming elsewhere. | P2 |
| 9 | Feed the fire (`campfire-system.ts:93-103`, `rules.ts:94-96`, r 0.5, y < 1.0 at release) | T "Feed it wood." | A soft flare **only when the fire is lit** (`audio-system.ts:273-275`). V flame scales with fuel. No H, no fuel gauge. | **A toss, or a drop from above 1.0 m, lands in the flames and doesn't count** (`item-system.ts:294-310`). A drop inside the pot volume is rejected as "doesn't belong in the stew" (`campfire-system.ts:68-79`). | "I put a log on and it went out anyway." The stacked woodpile billets are not grabbable (`camp-dressing.scene-asset.ts:147-160`). | **P0** |
| 10 | Drop ingredients in the pot (`campfire-system.ts:61-90`, `rules.ts:65-68`, r 0.29) | Hint "Two ingredients in the pot." | V broth colour and food bits, A plop, H .3. T only after the 2nd ingredient. | Wrong item: T, clunk, and it is flung out. Good. | Fine. There's no nudge after the 1st ingredient. | P2 |
| 11 | Stir (`campfire-system.ts:244-276`: tip in an annulus 0.065–0.27 m, y 1.046–1.416, fire lit, 2 turns) | T "stir the pot with the spoon". | A per ¼ turn, V bits rotate, T when ready. No H. | Cold pot: T "Light the fire before stirring" (good). **With one ingredient, stirring is silent** (`:246`). Stirring at the centre is silent. | The fire runs out mid-stir because fuel is 2 min (#9). | P1 |
| 12 | Dip the bowl (`campfire-system.ts:179-195`, bowl origin in the pot volume) | T "Dip the bowl". | V contents, A fill, H .35, T. | — | Fine. | OK |
| 13 | Eat by bringing food to the mouth (`survival-system.ts:100-132`; `rules.ts:21-22`, 0.22 m for 0.5 s) | Hints and T. | A eat, H .3, T. | **Any edible held within 22 cm of the chin for half a second is eaten**, including the only meat and mushroom at camp. | The player inspects the meat up close, eats it, and must go foraging before objective 2 can be done. | P1 |
| 14 | Roast meat, 3 s in the flame (`campfire-system.ts:196-209`) | Only the T after eating raw meat. | V roast variant, A sizzle, H .4. | Silent during the dwell. | Rarely discovered. It's optional. | P2 |
| 15 | Place three items in the bench bays (`crafting-system.ts:47-61`; `rules.ts:71-77`: ±0.22 m in x, ±0.25 m in z, **±0.23 m in y at release**) | Hint "in the bench bays". There are four identical-looking bays (the fourth holds the pad). | V snap, A snap, H .3. **No cue when a valid or invalid set is complete** (`crafting-system.ts:74-84`). | **A release above y 1.29 m, or a toss, lands visibly in the bay but isn't registered.** A strike then says "Fill all three bays". | "There ARE three things in the bays!" | P1 |
| 16 | Strike the pad with the hammer (`crafting-system.ts:106-121`) | Hint "Strike the pad three times." **No mention of the polished face or orientation.** | A clank, H .8 per strike, T "Crafted". | **Wrong face, side of the head, peen, or a tilt over 63° gives nothing: no sound, no T.** An 8.5 cm vertical window can be skipped at more than about 6 m/s at 72 Hz. Leaving the 18 cm cylinder at any frame disarms. | The player hammers naturally, handle forward and face sideways, and gets silence. The validated pose is a controller rolled 90° pistoning vertically 22 cm right of the pad (`tests/e2e/opening.mjs:85-86`, `VIDEO_REVIEW.md:32`). | **P0** |
| 17 | Light the torch in the fire, 0.65 s (`campfire-system.ts:166-176, 220-230`) | The objective title says "…and light it". Nothing says how, before or after crafting. | V flame, A ignite, H .6, T. | Silent during the dwell. | Usually discovered, since it's natural. | P2 |
| 18 | Chop deadwood, 3 hits (`gather-system.ts:58-68, 97-110`) | Page 3 "three good swings", page 2 "deadwood in the grove". No objective. | A chop, H .9 per hit, V the log vanishes and yields drop. | The hit sphere is 0.70 m around the log's **middle**, so the splintered ends (0.75 m out) don't count. Re-arming needs the tip more than **1.02 m** from the centre. Misses are silent. | Short hacks or end chops don't count. "It only registers sometimes." | P1 |
| 19 | Split a log on the stump, 2 hits (`gather-system.ts:132-158`) | **Not taught.** The axe in the stump hints at it. | A split, H .9, V planks. | Silent. The tip must be within 0.16 m of the log centre. | Never found. It's needed only if the outpost planks are lost. | P2 |
| 20 | Forage (`gather-system.ts:173-214`) | Page 2 and 3 text, the spear hint "reeds make cord". | A rustle when taken. **No H**, no T. | Grabbing decorative mushrooms, reeds or flint is silent. Only one real item per node is grabbable. **4 of 6 node types spawn at 0.00 m above ground.** | The player tries to "pull the reeds" and fails. The actual item is a cord coil at their base. Repeated floor reaches. | P1 |
| 21 | Throw or thrust the spear (`item-system.ts:245-251`, damage only at ≥ 4 m/s; `combat-system.ts:128-139`, thrust tip over 2.5 m/s) | Hint "Walk slowly… Throw the spear at a deer." Page 4 "only our hurry". | A whoosh or hit, H on thrust, V the deer dies and drops meat, T objective. | **A throw between 2.5 and 4 m/s passes through the deer with no damage and no cue.** Deer panic within 2.5 m, so a thrust is nearly impossible. | Weak throws "hit" but don't count. | P2 |
| 22 | Fire the crossbow (`combat-system.ts:150-153, 161-178`) | The trigger verb from the lighter transfers. | V bolt, A twang, H .9, wrist count. | Empty: a faint click and H .15. **No T.** | The crossbow is crafted with 0 bolts. The first pull does nothing obvious. | P1 |
| 23 | Reload by touching a bolt bundle to the crossbow (`combat-system.ts:229-267`, within 0.28 m of the crossbow origin) | **Never taught.** The only mention is in the sentry toast. | A click, H .5, V loaded bolt, wrist count. | Silent when out of range. | "How do I load this?" | P1 |
| 24 | Deploy the sentry (`combat-system.ts:57-71`) | Hint "Set the kit down near the fire". | A clank, V unfolds, T "Touch a bolt bundle to it". | **Any** release within 10 m deploys it permanently, even an adjusting re-grip over the bench. Beyond 10 m: T. | A sentry deployed on the bench top that can't be moved. | P2 |
| 25 | Load the sentry (`combat-system.ts:243-248`, 0.55 m) | T at deploy. | A click, H .5. | Silent. | Fine. | OK |
| 26 | Sleep by pointing at the bedroll and pulling the trigger (`daynight-system.ts:82-109`) | Hint. The ray appears over the bedroll, which is a good cue. | A swell, V dawn, T respawn set. | Day, dawn or cold fire: T. Good. **A hand that is holding the torch can't ray**, and nothing says so. | The objective stalls all day (see P1-1). At night the player holds the torch and pulls the trigger on that hand. | P1 |
| 27 | Read a page (`reader-system.ts:53-100`) | Picking it up opens the reader. | V panel, A rustle, T page found and recipe learned. | — | Pages are flat paper 0.4–0.8 m above ground with no glint, so they're easy to miss in the valley. Toasts (`depthTest:false`, `toast-system.ts:55`) can draw over the reader panel. | P2 |
| 28 | Light the Spire beacon, 3 s in a 0.45 m sphere at +1.11 m (`story-system.ts:149-186`) | Hint and page 7. | V flame grows with progress, T "Hold the flame steady…", A ending. | Progress decays at 0.5/s. Visible. | Good. | OK |
| 29 | Repel a wolf with the torch (`combat-system.ts:140-149`) | Stage toast "Keep the torch close". | V wolf flees, A hit, H .7. | — | Fine. | OK |
| 30 | Recover the lost pack (`fx-system.ts:63-68`, `toast-system.ts:192-195`) | T plus an ember pillar. | V, A. | — | Good. | OK |

---

## 3. Findings

### P0: fix before anyone else plays

**P0-1. The hammer strike needs a hidden orientation, and a wrong strike is completely silent.**

Evidence:
- `crafting-system.ts:108-120`: only the −X "polished face" counts. Its world direction must satisfy y < −0.45, meaning within 63° of straight down. The face point must be armed at least 0.18 m above the pad inside an 18 cm radius. It must stay aligned every frame. It must then pass through an 8.5 cm window (`+0.025 … −0.06`) on a frame that is moving downward.
- The other end of the head is a tapered peen (`items.scene-asset.ts:585`) that reads as equally hittable.
- Objective hint `story.ts:59` and page 1 (`story.ts:10-11`) say only "strike the pad / struck three times on the bench".
- The only proven pose is a 90° rolled vertical piston (`tests/e2e/opening.mjs:85-86`). The bug fix note says "the corrected recording uses a sideways hammer" (`VIDEO_REVIEW.md:32`).
- Grabs preserve the pickup offset. The hammer is authored upright with its face pointing −X, at the player's left. So a natural forward overhand swing puts the face sideways, and gives no sound and no toast.

Fix:
1. **Accept both ends of the head.** Compute both end points (`±.123, .22, 0`). Use whichever is lower. Count a hit if that end's outward axis has `|y| > 0.35` (within about 70° of vertical).
2. **Replace the window with a plane-crossing test:** `prevY > padTop + .01 && y <= padTop + .01 && (prevY - y)/dt > 0.6 m/s`, with no lower bound. Widen the radius to 0.22 m. Arm at `padTop + 0.10` instead of 0.18. Do not disarm on a single misaligned frame; disarm only when the head leaves a 0.35 m radius.
3. **Near-miss feedback:** if the head centre enters the pad box (0.33 × 0.33 × 0.15 m above the top) moving down and the hit didn't count, play `invalid-clunk` at 0.4 volume with H .2/20 ms. After 2 such misses within 10 s, show T "Bring the flat steel face straight down onto the iron pad."
4. **Hint text:** "Stick, cloth and resin in the three bays. Bring the hammer's flat steel face down on the iron pad, three times."
5. **Strike counter:** light one of the pad's four rivets (`camp-stage.scene-asset.ts:62-63`) per valid strike. That gives 3 of 4 lit, with the last one on craft.

**P0-2. Onboarding is never delivered inside the headset.**

Evidence:
- The single opening toast fires 0.6 s after level load (`story-system.ts:121-129`). It is placed 1.4 m in front of whatever camera exists then (`toast-system.ts:232-239`). That is the desktop camera at (0, 2.25, 4.3) (`iwsdk.config.json:25-30`), so it lands about 2.5 m behind and above the XR spawn at (0, 0, 0.4) (scene `player.transform`). It fades after 3.85 s (`toast-system.ts:35-41`). "Welcome back" (`:318`) has the same problem.
- The wrist shows the title only (`wrist-system.ts:191-197`), and nothing tells the player the wrist exists.
- The journal hint is a 2.2 cm em, about 0.4° at the 3.3 m spawn distance, so it's unreadable until the player is about 1 m away.
- The controls line (`camp-journal.uikitml:326-327`) never mentions the trigger.

Fix:
1. Emit the opening sequence when `visibilityState` becomes `Visible` in XR, and 1.5 s after that, not at load. The sequence:
   - "The fire is cold. Your pack is on the table to your right."
   - "Take the lighter from the pack. Hold the trigger in the fire's logs."
   - "Your left wrist shows what to do now."
2. Pulse the left controller at .3/80 ms when that third toast shows.
3. Idle re-surface: if no objective, page or craft event occurs for 90 s, re-toast the current objective's hint. Cap this at once every 90 s.
4. Add the hint as a second line on the wrist (`wr-obj-hint`, 2 lines, about 70% of the title size).
5. Add to the journal controls: "Trigger: use a held tool (lighter, crossbow). Point + trigger: bedroll."
6. Give the lighter a slow 1 Hz emissive glint until it is first grabbed.

**P0-3. Release targets are only tested at the release instant, so tossed or high-dropped items land in the right place and do nothing.**

Evidence:
- `item-system.ts:222-232` runs the targets on release. The landing code at `:294-310` only rests the item and emits `drop`.
- The windows at the release point:
  - fire ring: y < 1.0 (`rules.ts:94-96`)
  - bay: |y − 1.06| < 0.23 (`rules.ts:72`)
  - pot: y ≤ 1.416 (`rules.ts:67`)
- A log tossed onto the fire therefore lies in the flames adding no fuel, while the "burning low" and "gone out" toasts keep asking for wood.
- A resin dropped from 35 cm above bay 2 rests inside the bay rails but has `slot: ''`, and the strike replies "Fill all three bays before striking."
- The pot volume sits over the fire centre, so a log dropped above it is rejected with "That doesn't belong in the stew." (`campfire-system.ts:68-79`) instead of feeding the fire.

Fix:
1. When an `Airborne` item comes to rest, run a landing pass through the same targets. Add an `onLand(entity, kind, at)` path in `ItemSystem`, called before `removeComponent(Airborne)`. Landing tests:
   - fire ring: r < 0.5 at any height
   - bay: footprint only, when it lands on the `bench-bays` surface
   - pot: an item passing down through the pot's rim plane inside r 0.25 is caught
   - pack cells: unchanged
2. In `releaseIntoPot`, return `false` for items that have fuel and aren't stew ingredients, so the fire target gets them.
3. Widen the fire release window to y < 1.5.

### P1: frequent confusion or costly setbacks

**P1-1. The objective list stalls on a time-gated step, and "Next:" names a stale objective.**

Evidence:
- `currentObjective` returns the first incomplete bit (`story.ts:82-85`). Objective 4, "Sleep", can only complete at dusk or night (`daynight-system.ts:88-95`).
- After the torch, which a first-timer finishes around 6–10 min, the journal, the wrist and every "Next:" toast (`toast-system.ts:174-175`) show "Sleep at the bedroll" for up to about 5.5 min of daytime.
- Screenshot `09-outpost.png` shows "Find the expedition outpost ✓" followed by "Next: Sleep at the bedroll".

Fix:
1. Add `when: 'night'` to the sleep objective. Let `currentObjective(mask, phase)` skip it during `day`/`dawn`, so it returns the next doable objective (the spear).
2. Show a secondary journal and wrist line, "Tonight: sleep at the bedroll (fire lit)".
3. On the `phase → dusk` event, toast: "Night is falling. Stay in the firelight, and sleep at the bedroll with the fire lit." Right now the dusk phase has no toast at all.

**P1-2. The fire economy is unforgiving and unreadable.**

Evidence:
- The first fire burns 120 s (fuel 40 at 1/3 per second, `components.ts:32`, `rules.ts:17`). "Burning low" appears after 75 s (`campfire-system.ts:126-129`), in the middle of the first cooking attempt, and stirring requires a lit fire.
- No fuel readout exists on the journal or the wrist.
- Fuel added to a cold fire is silent (`audio-system.ts:273-275`), and the item just vanishes.
- Six firewood billets are stacked beside the stump but are decorative (`camp-dressing.scene-asset.ts:147-160`). Only two loose logs are real.

Fix:
1. Start the fuel at 90 (4.5 min). Warn at fuel below 25 with "The fire is burning low. Logs lie by the chopping stump."
2. On `fuel-added`, always play `drop` at the fire, add a 0.3 s ember-burst scale on the embers, and H .25/30 ms on the releasing hand. When the fire is lit, keep the flare.
3. Add "Fire: n min" to the journal clock row and wrist, and show it only when under 2 min.
4. Make the woodpile a `ResourceNode` (kind `woodpile`, yields `log`, `regrowSeconds` 60) that puts a log in the hand on grab, or remove the stacked billets.

**P1-3. Burning crafting materials silently destroys progress.**

Evidence:
- Cloth (5), resin (8), cord (3), plank (15) and stick (10) all count as fuel (`catalog.ts:24-30`). Only tools are excluded (`catalog.ts:67-68`).
- There is exactly one cloth at camp, and the torch needs it.
- "Feed it wood" invites burning the two camp sticks, which the torch and the spear need.

Fix:
1. Remove `fuel` from cloth, cord, trigger and spring. Keep resin as fuel but toast "Resin burned (+8)".
2. Show a "Burned: <label>" info toast the first time each non-log kind is consumed.

**P1-4. The pack's wear and unwear verbs are undiscoverable.**

Evidence:
- No player-facing text mentions wearing the pack.
- The worn roll sits at head + (0.18, −0.3, 0.17) (`backpack-system.ts:17-18`), outside the field of view.
- The worn state has no toast and no haptic (`:146`).
- Stored items can only be added or removed while the pack is unrolled (`:178`). Every field pickup therefore costs four actions: take off, unroll on the ground (a floor reach), place, re-roll and wear.

Fix:
1. On the first roll-up, toast "Rolled up. Let go over your shoulder to wear it, or low to lay it out."
2. On the first wear, toast "Pack on your back. Reach over your right shoulder to take it off." and pulse H .3/60 ms.
3. **Allow stowing into the worn pack:** releasing any item (not a pack or sentry kit) within 0.3 m of the shoulder anchor sets `slot: pack-<first free>`, plays snap, and pulses H .25. Keep unrolling for retrieval, or let a squeeze at the shoulder with the pack worn pull out the most recently stowed item.

**P1-5. The crossbow reload is never taught, and an empty trigger pull is nearly silent.**

Evidence:
- The crossbow is crafted with 0 charges (`crafting-system.ts:162-165`).
- Firing empty gives only a 0.4-volume click and H .15 (`combat-system.ts:165-168`).
- Reloading means touching a bundle within 0.28 m of the crossbow origin (`:240`). This appears in no hint, page or toast.
- The sentry hint "load it" (`story.ts:65`) doesn't name bolts.

Fix:
1. On `crossbow-empty`, show T (throttled 10 s): "Empty. Touch a bolt bundle to the crossbow. Bolts: 2 sticks + flint at the bench."
2. On the first crossbow craft, toast the same line.
3. Measure the reload distance to the `loaded-bolt` node, not the origin, with a radius of 0.35 m.
4. Change the sentry hint to "…Set the kit down near the fire and touch bolt bundles to it."

**P1-6. Forage items are hard to find and hard to reach.**

Evidence:
- Only one real item per node exists (`gather-system.ts:204-213`), placed at the node origin. The decorative stems, nodules and mushrooms around it are not grabbable, and grabbing them is silent.
- Reeds yield a cord coil lying at their base, not the reed stems the player tries to pull.
- Heights above ground: mushrooms, herbs, reeds and flint are all at 0.00 m. The mushroom's origin is placed at ground level despite `restY` 0.149, so it is half-buried.

Fix:
1. Give the real item a subtle glint (1 Hz emissive pulse, 20% amplitude) while `slot === 'node'`.
2. Lift ground spawns to 0.12 m on a mossy stone or log cap. Place items at `origin.y + restY`.
3. Add `DistanceGrabbable` (maxDistance 1.2 m) to forage-spawned items only, so a pull toward the hand works from standing.
4. **Near-miss detector:** a squeeze-start within 0.35 m of an available node's harvest part, with no grab that frame, shows T once per node type: "Take the <label> at the base of the <node>."

**P1-7. Accidental eating.**

Evidence:
- Any edible within 0.22 m of the point 12 cm below the eye for 0.5 s is consumed (`survival-system.ts:100-115`, `rules.ts:21-22`).
- Inspecting food up close meets that condition.
- The camp holds exactly one meat and one mushroom, the objective-2 stew.

Fix:
1. Eat radius 0.14 m, dwell 0.8 s, with haptic ticks H .15 at 0.3 s and 0.6 s so the player can pull away.
2. While `eat-meal` is incomplete, raw meat and mushrooms need 1.5 s and show T "Eat it raw? Keep holding. Or cook it in the pot."

**P1-8. Bench bays give no feedback until the player strikes.**

Evidence:
- `CraftBench.match` is computed when the bays change (`crafting-system.ts:74-84`) but never shown.
- The player only learns "don't fit together" after hammering, and that toast is throttled to one per 6 s.
- There are four identical railed bays, and the fourth holds the pad (`camp-props.scene-asset.ts:260-269`).

Fix:
1. When `match` becomes a product: T "<Label> ready. Strike the pad three times." Glow the pad disc (emissive 0.6).
2. When it becomes `'!'`: T "These three don't fit together." plus a clunk, immediately.
3. Remove the rails around the pad's bay, or paint it iron so it reads as "not a bay".

**P1-9. Chopping near-misses.**

Evidence:
- The hit test is a sphere at the bounding-box centre (`gather-system.ts:58-68, 102-104`). For the 1.5 m deadwood, a hit must land within 0.70 m of the middle, which excludes the splintered end.
- Re-arming needs the tip more than 1.02 m from the centre.
- Non-counting contacts are silent.

Fix:
1. Test against a capsule along the log's long axis (radius 0.25 m).
2. Re-arm when the tip retreats more than 0.3 m from the capsule surface.
3. On a non-counting contact faster than 1 m/s, play `chop` at 0.35 volume with H .2.
4. Show one visible notch or chip decal per counted hit.

**P1-10. Grabbing gives no haptic or hover confirmation.**

Evidence:
- The grab event plays only a head-locked tick (`audio-map.ts:135`).
- `pulse()` is used at 19 call sites, none of them for grab, fire lit, pack worn, fuel, stir or harvest.
- IWSDK's grab pointer draws nothing.

Fix:
1. H .15/12 ms on grab, in the `ItemSystem` held-qualify handler.
2. H .08/8 ms when the grip sphere first enters a grabbable's bounds, using the 7 cm grab pointer's hover.
3. H .5/80 ms on `fire-lit` to the lighter hand.
4. H .1/10 ms per ¼ stir turn to the spoon hand.
5. A rising H .1→.4 ramp while in the beacon.

### P2: polish

- **Lighter dwell** (`campfire-system.ts:213-217`): add a smoke wisp and a rising H .1→.35 during the 1 s dwell, and shorten it to 0.7 s.
- **Pot prompts** (`campfire-system.ts:86-90, 245-246`): after the first ingredient, toast "One more ingredient, then stir." When stirring with fewer than two, toast "Add a second ingredient first."
- **Torch crafted but unlit:** when `crafted: torch` fires and objective 3 is incomplete, toast "Hold the torch head in the campfire to light it."
- **Spear throw threshold** (`item-system.ts:251`, `rules.ts:123`, `damageSpeed 4`): lower it to 3.0 m/s. When a spear flying under the threshold passes through a creature sphere, play `invalid-clunk` at 0.5 and toast once "Throw harder."
- **Irreversible sentry** (`combat-system.ts:57-71`):
  - Deploy only if released less than 0.6 m above `groundAt` ("set it down"). Otherwise let it fall as a kit.
  - Let a squeeze on a deployed sentry's base re-pick it, keeping its bolts.
  - Warn in the page 6 or recipe toast that it uses your crossbow. Only one trigger exists.
- **Sleep while holding the torch:** extend the hint to "…point your free hand at the bedroll and pull the trigger." If Pressed never fires while a torch is held at night within 2 m of the bedroll, toast this once.
- **Unrolling on slopes** (`backpack-system.ts:164`): sample `groundAt` at the four corners and the centre, and lay the mat at the maximum so cells never sink. Or refuse slopes above 12° with T "Find flatter ground."
- **Splitting on the stump:** add to page 3: "A log on the camp stump splits into planks in two blows."
- **Toasts over the reader:** while a page is held, offset new toasts 25° to the non-holding side, or defer them until the page is released (`toast-system.ts:55`, `depthTest:false`).
- **Pages hard to spot:** add a gentle 0.5 Hz flutter or paper glint to unread pages within 6 m.
- **Tool grip poses:** hammer, crossbow and spear keep their pickup offset, so the crossbow can shoot sideways relative to the wrist. On grab, snap these kinds to a canonical grip-relative pose:
  - crossbow: −Z forward
  - hammer: handle along grip −Z, face down at a neutral wrist. This also defuses P0-1.
  - spear: tip forward
- **Bay collisions:** a release into an occupied bay silently drops the item on top. Redirect it to the nearest free bay, as the pack does.

### 3.4 Reach and precision reference (standing adult)

Heights are local, above the ground.

| Target | Height (m) | Window | Verdict |
| --- | --- | --- | --- |
| Pot drop and stir | 1.05–1.42 | r 0.29; stir annulus 0.065–0.27 | Comfortable |
| Fire ignition and torch | 0.22–0.86 | r 0.30 | Slight bend; generous |
| Fuel release | < 1.0 | r 0.50 | **Too low for a standing drop** (P0-3) |
| Bench bays and pad | 1.00 / 1.06 | 0.44 × 0.50 m; y ±0.23; pad r 0.18 | Height good; y window tight |
| Pack on the trestle | 0.88 | cell pitch 0.46 | Good |
| Pack unrolled in the field | 0.09 | — | Floor reach |
| Worn pack | eye −0.30, 0.17 behind | roll r 0.10 | Reachable over the right shoulder only |
| Resin | 1.19–1.21 | — | Good |
| Berries | 0.70–0.72 | — | Good |
| Mushroom, herb, reed-cord, flint | **0.00** | — | Floor reach, ×4 node types |
| Pages 3–7 | 0.46–0.77 | — | OK |
| Beacon | 1.11 | r 0.45 | Good |
| Mouth (eat) | eye −0.12 | r 0.22, 0.5 s | **Too eager** (P1-7) |
| Hammer strike | pad +0.025 … −0.06 | r 0.18; face tilt ≤ 63° | **Too strict** (P0-1) |
| Crossbow reload | — | 0.28 m from the origin | Undiscoverable (P1-5) |

### 3.5 Hidden requirements: are they communicated when needed?

| Requirement | Where it's stated | At the moment of need? |
| --- | --- | --- |
| The hammer's polished face must point down | Nowhere | **No.** A wrong strike is silent. |
| Stirring needs a lit fire | Warn toast while stirring cold | Yes |
| Stirring needs two ingredients | The "Two ingredients" hint | No. Stirring with one is silent. |
| Sleep only at dusk or night, with the fire lit | Hint and toasts on attempt | Yes on attempt. **No** for the objective ordering. |
| Sleep needs a free hand for the ray | Nowhere | No |
| Bay and fire release height | Nowhere | **No.** It fails silently. |
| Wearing and taking off the pack | Nowhere | **No** |
| The crossbow needs loading, and how | Wrist "0" in orange | **No** method given |
| The spear throw must be at least 4 m/s | Nowhere | No |
| Deer flee from a hurrying player | Hint and page 4 | Yes |
| Fire fuel is limited | "Burning low" toast | Late. No gauge. |
| Sticks and planks come from chopping | Pages 2 and 3, partly | No |
| Sentry placement is permanent | Nowhere | No |

---

## 4. Top 6 changes

1. **Make the hammer strike forgiving and loud about misses (P0-1).**
   - Accept both head ends within about 70° of vertical.
   - Use a plane-crossing test with no lower bound, radius 0.22, arm height 0.10.
   - Give a clunk and haptic for non-counting pad contacts, and a toast after 2 misses.
   - Rewrite the hint to name "the flat steel face" and "the iron pad".
   - Light the pad rivets as a strike counter.
2. **Landing-aware release targets (P0-3).**
   - Re-run the fire, pot, bay and pack targets when an airborne item comes to rest.
   - Let the pot pass fuel items through to the fire.
   - Widen the fire release window to y < 1.5.
3. **Onboarding in the headset (P0-2, P1-10).**
   - Fire the opening toasts on XR session start, placed in front of the XR spawn.
   - Add the hint line to the wrist, and pulse the left controller when the objective changes.
   - Re-surface the hint after 90 s idle.
   - Glint the lighter until it is grabbed.
   - Add a grab haptic and a fire-lit haptic.
4. **Objective flow (P1-1).**
   - Skip time-gated "Sleep" during the day, with a "Tonight:" line.
   - Add a dusk toast.
   - Make "Next:" always name a doable step.
5. **Legible fire economy (P1-2, P1-3).**
   - Start fuel 90, warn at 25, and name where the logs are.
   - Give audible, visible and haptic feedback for fuel even when the fire is cold.
   - Show a fire-time readout.
   - Make the woodpile real.
   - Stop cloth, cord, trigger and spring from burning.
6. **Teach the hidden inventory and ammo verbs (P1-4, P1-5, P1-6).**
   - First-time pack toasts, plus stowing items over the shoulder into the worn pack.
   - A crossbow-empty toast that names the bolt bundle, and a wider reload radius.
   - Glint on forage items, ground spawns lifted 0.12 m, and a near-miss squeeze hint.

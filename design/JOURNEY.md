# The Journey — a guided opening (wreck → waystation → forest → camp)

Status: phase 1 (design, assets, pure rules, system skeleton). Owner: agent E.
Code: `src/game/journey.ts` (pure data and rules, unit-tested), `src/game/systems/journey-system.ts`
(skeleton, not registered), `src/scene-assets/plane-wreck.scene-asset.ts`,
`src/scene-assets/waystation.scene-asset.ts`, `src/scene-assets/journey-assets.ts` (registry),
tests `tests/journey.test.mjs`, `tests/journey-assets.test.mjs`.

## 1. The shape of it

The player no longer wakes beside a cold camp fire. They wake **in a seat of a crashed plane**,
at the grey hour before sunrise, with fire at the back of the cabin and red emergency lights
blinking along the ceiling. Prometheus' shade gets them out, and then walks them, one
interaction at a time, to the camp where the old opening (fire, stew, the note, the bench)
picks up.

| # | Beat | Teaches (one thing) | Where |
| --- | --- | --- | --- |
| 1 | Wake | walk (stick) and look | the keeper's seat, row 4 |
| 2 | The door is jammed | grab (squeeze) — the emergency axe above the door | cabin, forward door |
| 3 | Break it | swing the axe (a blow lands on contact at speed) | the door |
| 4 | Outside | the fire holds the Hollow off; holster (release at the hip) | outside the door |
| 5 | Sunrise | follow the trail and the orange markers | the crash clearing |
| 6 | The waystation | take the pack and wear it (release behind the shoulder) | outpost 1 |
| 7 | The forest | fell a tree (5 blows), pick mushrooms, store in the pack | the grove route |
| 8 | Camp | firewood into the ring, light it with the lighter (hold the trigger) | outpost 2 = the old camp |
| 9 | The stew | pot, spoon, bowl, eat (existing beats) | camp |
| 10 | The note | read page 1 → the torch, the bench (existing story onward) | camp |

**Decision: the old camp *is* outpost 2.** It already holds everything the user's
outpost 2 needs (the pot over a fire pit, the bowl and spoon, the bench, the bedroll, the
journal board), and it is wired into the code as a single place: `rules.ts CAMP` (pot, fire,
bench bays, surfaces), CampfireSystem's single `Campfire`, the guide's camp obstacles and
board sightlines, the respawn default, the page texts ("the camp bench") and the finale
("Go home. Your fire is burning."). Moving it would rewrite half the game for nothing the
player can see. What changes at camp: the fire ring starts **empty of fuel** (the player
brings the firewood), the axe and the two loose logs by the stump are gone (the axe comes
from the plane, logs from felling), the pack is not on the trestle (it is at the waystation).
The existing "Expedition Outpost" at (−4, −33) stays as it is and is called **the high
outpost** in player text, so "outpost" alone never means two places.

**Canon (for A's story text; nothing here contradicts GAME_SPEC's story):** the keeper was
being flown out of the valley on the expedition's supply plane, memory gone. Over the ridge the
engines died: no flame in this valley burns but the keeper's own, and the valley would not let
its fire leave. The wreck burns because the keeper's lighter spilled into the fuel — the only
other fire in the valley, which is why the Hollow gather round it at the last of the night,
drawn and afraid. The shade can say this later, as myth (line `wreck-myth`, optional).

## 2. The layout (world metres; LANDMARKS/valley-layout frame)

```
 z  +16 ─ P2 (-26.2,16.2) ridge          P3 (-15.2,15.8) ridge      (south ridge, beyond the wall)
    +12 ─ ...right wing tip buried...
 P1 (-35.4,8.6)   [tail]──[ FUSELAGE nose→ east ]            ← crash clearing, furrow runs west
     +4 ─          (-31)    (-26.6)  ◉seat  ▯door(-18.7,2.8) (-15.6)
     +1 ─                       markers ↖ (-19.6,0.5) (-22.4,-2.1) (-25,-3)
 P4 (-35.8,-2.6)
     -6 ─ ⛺ WAYSTATION (-27.6,-5.6)  flag (-29.4,-7.6)
     -9 ─        mushroom (-22.9,-8.6)   markers (-25.3,-8.9) (-22.8,-11.6)
    -11 ─                      GROVE (-17,-11) ── grove trail ── marker (-12.2,-11.9) ─ mushroom (-9.6,-9.9)
     -8 ─                                                   marker (-6.6,-10.6)  flag (-3.4,-8.6)
     -1 ─                                                                CAMP (0,-1)  fire (0.25,-1.9)
          x: -36 ................................................................. 0
```

- **Wreck** (`WRECK` in journey.ts): origin (−22, −0.15, 4), **yaw 0** (all four wreck nodes).
  Nose east (+X) toward camp, the door on the north side (−Z) toward the waystation. The
  plane came in low over the west ridge and ploughed a furrow west→east; the tail section
  lies broken off 9 m behind the rear break; the left wing lies upside down in the furrow;
  the right wing is broken down into the ground to the south with its engine burning.
  Cabin deck at world y 0.20. Door opening wreck-local x 2.85–3.75 (world x −19.15…−18.25),
  sill 0.35, head 2.02. Terrain here is flat (−0.47…0.04 under the fuselage); belly berms hide
  the contact.
- **Spawn** (scene `player.transform`): position **[−22.86, 0.20, 4.42]**, rotationDeg
  **[0, −90, 0]** (facing +X, down the aisle toward the EXIT sign). The keeper's seat is the
  aisle seat of the double, row 4 (wreck-local x −0.92, z 0.42); the row in front is 0.62 m
  ahead of the eyes; the aisle is to the left.
- **Emergency axe**: scene item `wreck-axe` (kind `axe`) at **[−18.7, 1.98, 2.93]**,
  rotationDeg **[−90, 0, −90]** (handle horizontal along the wall, head forward, blade down)
  on the red bracket above the door.
- **Fire ward**: WARD (−23.5, 5.2), radius 11 — the staged wolves never come inside it.
- **Watching Hollow** (WOLF_POSTS): P1 (−35.4, 8.6) y 3.7 · P2 (−26.2, 16.2) y 4.1 ·
  P3 (−15.2, 15.8) y 3.1 · P4 (−35.8, −2.6) y 4.9 — all **beyond the valley walls** (the
  player can never reach them) and up on the ridge slopes, 11–14 m out from the fire.
- **Waystation (outpost 1)**: centre (−27.6, −5.6), yaw 80° (open front east, toward the
  arriving keeper and the forest). Table `waystation-table` at (−27.0, −5.7), yaw 80°, top
  0.78 m, ItemSurface. The pack lies on it. A tall orange flag at (−29.4, −7.6) is visible
  from the wreck door (16 m).
- **Journey trail** (JOURNEY_TRAIL, for valley-layout TRAIL_CONTROL): door (−18.7, 1.9) →
  (−20.8, −0.4) → (−23.6, −2.6) → (−26.0, −4.3) waystation → (−26.4, −7.2) → (−24.6, −9.6)
  → (−21.6, −10.8) → (−18.4, −10.9) → grove (−15.2, −11), where the existing grove trail runs
  on to the main trail and camp. ≈ 50 m wreck → camp.
- **Forest**: the trail runs through standing pines from the waystation into the grove (every
  valley tree is choppable, ForestSystem). Mushrooms: the grove's three (−16, −12.9), (−19, −10.2),
  (−21.4, −15.8) plus two new patches FOREST_MUSHROOMS (−22.9, −8.6) and (−9.6, −9.9).
- **Markers** (MARKERS, one `journey-markers` asset at the scene origin): seven stakes with
  orange cloth along the route, the waystation flag and a camp flag at (−3.4, −8.6) where
  the grove trail leaves the trees.
- **Clearings** (JOURNEY_CLEAR / `journeyBlocksTree`): the crash clearing (a 5.2 m capsule
  from the tail to past the nose), the broken right wing, 1.6 m sightlines from outside the
  door to each post (through the far-pine belt too), and the waystation (r 5).

## 3. The beats

Conventions: *Trigger* is what starts the beat; *Done* is what ends it (JourneySystem
`step`; bus events are existing types unless marked NEW). Lines are the shade's (id, text,
hint = subtitle-only control words). Instructional first, myth later; his voice stays warm and
unhurried, but in the wreck he is brief and urgent (priority ≥ 9 so nothing queues in front).

### Beat 1 — Wake (step `wake`)
- **Teaches:** walking. **Where:** the seat.
- **Trigger:** `journey-begin` (fresh). The world fades in (StartSystem). The clock is held at
  `WRECK_CLOCK.start` (dawn +6 s: grey, nightness ≈ 0.9): the emergency strips and the fire
  carry the light.
- **Done:** the keeper comes within 1.8 m of the doorway (`doorDistance < DOOR.near`) → `door`.
  Grabbing the axe early skips straight to `armed`.
- **Line `wreck-wake`** (on `journey:wake+0.8`, priority 10, ttl 180, covers `key:opening`):
  "Wake, keeper. The fire is loose in here. Up, and to the door, there at the front."
  hint: "Push the left stick to walk."
- **Toast/wrist:** objective **Get out of the wreck** — wrist "The door at the front: follow the floor lights."
- **Staging:** amber floor path lights run down the aisle into the doorway; the green EXIT sign
  hangs before the door; smoke rolls under the ceiling from the burning rear.
- **Fail-safes:** `wreck-door-nudge` (on `done:wreck-wake+14`, `unless: 'near-door'`):
  "This way, keeper. Follow the lights on the floor." No damage from fire or smoke anywhere.

### Beat 2 — The door is jammed (step `door`)
- **Teaches:** grab. **Where:** the doorway, the axe on its red bracket above it.
- **Trigger:** near the door. **Done:** `grab` kind `axe` → `armed`.
- **Line `wreck-axe`** (on `journey:door`, priority 9): "Jammed. Above the door, keeper: the
  axe. Close your hand on it and take it down." hint: "Squeeze the grip to hold."
  The existing `grab` line re-targets from `done:intro+6` to `done:wreck-axe+6` (still
  `unless: 'grabbed'`).
- **Fail-safes:** the axe beckons (fx-particles, see §6). An axe dropped inside rests on the
  deck (`wreck-deck` is an ItemSurface); one thrown out through the hull while the door is shut
  returns to its bracket (JourneySystem.guardAxe).

### Beat 3 — Break it (step `armed` → `open`)
- **Teaches:** the axe swing (the same blow as trees and carcasses). **Where:** the door.
- **Rule:** DOOR — a blow lands when the blade (ITEMS.axe.tip) comes within 0.10 m of the
  panel at ≥ 1.6 m/s in the rig's frame, armed (pulled back 0.3 m since the last blow),
  0.35 s apart (creature-ai `bladeContact`, as butchering). Each blow: haptic pulse, a metal
  clank (`thud` kind `wreck-door`), the panel kicks 7° further open and shakes. **3 blows** →
  the hinge rips, the panel swings wide and topples outward onto the ground, where it lies as
  the ramp (journey `panelTear`, 0.9 s, then a heavy `drop`). The `wreck-door-blocker` loses
  its LocomotionEnvironment.
- **Why blows, not hook-and-pull:** one axe verb for the whole game (trees, carcasses, logs on
  the stump, the door); it reuses the tuned blade rule, the chop feedback and the player's
  muscle memory; a hook-and-pull would be a two-hand gesture that exists nowhere else.
- **Line `wreck-swing`** (on `grab:axe`, priority 9, `when: ['in-wreck']`, unless door open):
  "Now the door. Strike it where it is bent, hard, from the shoulder." hint: "Swing the axe into the door."
- **Line `wreck-harder`** (on `journey:door-glance`, a slow touch on the panel, once):
  "Harder, keeper. Put your weight behind it."
- **Fail-safes:** after one real blow, any contact counts once 40 s have passed
  (DOOR.lenientAfter): a player who cannot swing hard still gets out.

### Beat 4 — Outside (steps `open` → `outside`)
- **Teaches:** holstering. **Where:** outside the door, on the fallen door ramp.
- **Trigger:** the door falls (`open`): the four staged wolves rise on the ridges. **Done:**
  the keeper leaves the cabin footprint (`insideCabin` false) → `outside`; objective
  `escape` completes.
- **Line `wreck-out`** (on `journey:open+0.3`, priority 9): "Out, keeper. Into the air."
- **Line `wreck-wolves`** (on `journey:outside+1.2`, priority 9, ttl 30): "Be still. On the hills:
  the Hollow. They fear the fire at your back. While it burns, they will not come near."
- **Line `wreck-holster`** (on `done:wreck-wolves+1`, priority 8, `unless: 'axe-holstered'`):
  "Put the axe at your hip, keeper, in the empty holster beside your lighter. Keep your hands
  free." hint: "Let go of it at your right hip." (The lighter starts in `hip-left`.)
- **The Hollow and the fire** (JourneySystem, creature system read-only): the staged wolves are
  **visual-only** instances of the `wolf` asset, created by JourneySystem at the door's fall —
  no `Creature` component, so CreatureSystem's AI, spawning, combat, the guide's threat gate
  and its "dim near wolves" never see them (the shade can speak about them). Each holds its
  post, paces ±1.1 m along the ridge, faces the fire with its head turned to the keeper, and
  howls now and then (`creature` cue `howl` → the existing wolf howl). `stagedGoal` keeps it
  outside WARD (the wreck fire's reach, r 11) and ≥ 9 m from the keeper (it backs away up the
  slope). They stand beyond the valley walls, so nobody can walk up to one. The fire itself is
  **not** a `Campfire` (CampfireSystem, StorySystem and CreatureSystem each assume the camp's is
  the only one; a second would complete `light-fire` and confuse the smother/regeneration logic).
  Stage stays 0: nothing attacks, ever, before the torch.
- **Fail-safe:** the clock releases when the axe is holstered, or 28 s after stepping out.

### Beat 5 — Sunrise (step `dawn`)
- **Teaches:** way-finding (trail and markers). **Where:** the clearing.
- **Trigger:** clock ≥ WRECK_CLOCK.sunrise (≈ 20 s after release; also if the keeper runs
  > 30 m from the ward first). The four wolves crumble into the ground one after another
  (0.7 s apart, `creature` cue `dissolve`). The wreck's flames die down over the next ~5 min
  (smoke and embers linger — a landmark seen from the forest).
- **Done:** within 6 m of the waystation → `waystation` (or straight to camp → `camp`).
- **Line `wreck-dawn`** (on `journey:dawn+1`, priority 8): "The light takes them, for now. Your
  people kept an outpost near here. Follow the trail, and the orange cloth on the posts."
- **Line `myth`** (existing text and clip, re-triggered on `done:wreck-dawn+5` instead of
  `done:fire+1.5`): "I am Prometheus, or what is left of him. I stole fire to give it to
  everyone. Your people took it from everyone."
- **Line `wreck-myth`** (optional, on `done:myth+20`, priority 4): "They tried to carry you
  out, keeper. The valley let no flame leave but yours, and the engines died over the ridge."
- **Fail-safe `axe-left`** (NEW step key, once, when the axe lies loose > 12 m behind):
  "You left the axe, keeper. Go back for it. You will need it." (priority 7).

### Beat 6 — The waystation (step `waystation`)
- **Teaches:** taking the pack and wearing it. **Where:** outpost 1, the pack on the table.
- **Done:** BackpackSystem.owned (C: `pack` state `held` on first pickup; releasing always
  returns it to the back) → `forest`; objective `waystation` completes (also when the pack is
  taken up at any later time).
- **Line `waystation`** (on `journey:waystation`, priority 8): "Your pack, keeper, there on the
  table. Take it up, and put it on your back." hint: "Grab it; let go of it behind your shoulder."
- **Existing line `pack`** (on `pack:worn`), **text updated (C):** "Your pack rides on your back
  now. Reach over your shoulder to take it, pull the trigger to open it, and let go: it finds its
  way back." hint: "Squeeze the grip behind your shoulder."
- **Fail-safe `pack-left`** (NEW step key, once, > 16 m from the table without the pack):
  "Your pack, keeper. Go back to the table for it; your hands cannot carry a journey."
  Skipping it never blocks: camp still works (the wrist keeps asking).

### Beat 7 — The forest (step `forest`)
- **Teaches:** felling (ForestSystem, 5 blows), foraging, packing. **Where:** the trail
  from the waystation through the grove.
- **Done:** the keeper reaches camp (within 8 m of the fire) → `camp`; objective `forest`
  completes there. A NEW step key `forest-done` fires once when ≥ 1 log and ≥ 1 mushroom are
  carried (held, holstered or packed; polled 2×/s).
- **Line `forest`** (on `journey:forest+3`, priority 7): "The camp lies beyond this forest. On
  the way, fell a tree for firewood, and pick the mushrooms you pass." hint: "Swing the axe into a trunk."
- **Existing line `chop`** — drop its `grab:axe+0.5` trigger (the door already taught the
  swing), keep `chop`; text for felling (B's numbers): "Five strong blows fell a tree, keeper.
  Its logs are firewood; split one on the camp stump for planks."
- **Line `mushroom`** (on `harvest:mushroom`, priority 4, once): "Food for the pot. Into your pack with it."
- **Line `forest-done`** (on `journey:forest-done`, priority 5): "Enough. Now the camp: follow
  the path out of the trees, to the flag."
- **Fail-safe:** arriving without wood → `camp-no-wood` (see beat 8).

### Beat 8 — Camp, the fire (step `camp` → `done`)
- **Teaches:** fuelling the fire and the lighter (hold the trigger).
- **Done:** `fire-lit` → `done`; objective `light-fire` (existing) completes as today.
- **Line `camp`** (on `journey:camp`, priority 8): "Your people's camp. The fire is cold. Lay
  your firewood in the ring, then wake it with your lighter." hint: "Let go of a log over the stones."
- **Existing `lighter`** (on `grab:lighter`) gains `when: ['at-camp']` (the lighter now rides at
  the hip from the first second; nobody should hear "tinder under the logs" in the plane).
- **Line `camp-no-wood`** (CampfireSystem's existing "The fire needs wood first" warning is
  the trigger: a NEW key `fire:no-fuel`, once): "No wood, no fire. The trees ring the camp,
  keeper: fell one." (Loose sticks around camp also burn: a fail-safe that needs no line.)
- **Existing `intro`** is retired (its trigger `journey:new` moves to `wreck-wake`).

### Beat 9 onward — the existing story
`fire` → `ingredient` → `stir` → `bowl` → `eat` (stew = the pack's meat + a forest mushroom,
"Hearty stew"; two mushrooms make "Mushroom soup") → `note` (page 1 in the pack: the torch)
→ bench, reeds/cord, torch, the first night and the bedroll, spear, the meadow hunt and
butchering, the high outpost (pages 5–6), crossbow, sentry nights, the Spire finale. Nothing
downstream changes except the camp's starting state.

## 4. Objectives (story.ts) and saves

Proposed OBJECTIVES, in display order (the first three are new):

| id | title | hint | wrist (≤ 64) |
| --- | --- | --- | --- |
| `escape` | Get out of the wreck | Walk to the door at the front. The emergency axe hangs above it: take it and strike the door until it gives. | Axe above the door; strike the door till it gives. |
| `waystation` | Find your pack at the waystation | Follow the trail and the orange markers from the wreck. The pack lies on the waystation table: put it on your back. | Follow the markers; put on the pack from the table. |
| `forest` | Firewood and mushrooms | Through the forest to camp: fell a tree for its logs (five axe blows) and pick mushrooms on the way. | Fell a tree for logs; pick mushrooms on the way. |
| `light-fire` | Light the campfire | Lay a log in the cold fire ring. Take the lighter from your hip, hold its trigger, flame in the wood. | Log in the ring; lighter from your hip, trigger held. |
| `eat-meal` | Cook a meal and eat it | The meat from your pack and a mushroom into the pot. Stir with the spoon, dip the bowl, bring it to your mouth. | Meat and mushroom in the pot; stir, dip the bowl, drink. |
| … | (torch, sleep, spear, hunt, outpost → "Find the high outpost", crossbow, sentry, beacon: unchanged) | | |

**Save compatibility:** objective bits are array positions. Put the three new ones first (the
wrist and journal walk OBJECTIVES in order) and migrate in `parseSave`: a save without the new
field `game.opening` is from before the wreck, so `objectives = (old << 3) | 0b111` (the journey
counts as done: that keeper is already at camp). New saves write `opening: 1`.
No other save field changes: the journey replays from the objectives (`resumeStep`): no escape
→ the wreck again from the seat; escape but no pack → outside the torn door (the panel lies as a
ramp); pack but no forest → at the waystation; else the saved respawn.

`OPENING`: title "You wake to smoke and red light." body "The plane is down. Get out."
`START.fresh`: "Wake in the wreck". Page 1 (optional line for A): "…They are flying me out. If
this reaches you on the ground, the valley kept its fire."

## 5. Scene nodes (public/scenes/main.iwsdk.scene.json)

New nodes (all wreck nodes: position `[-22, -0.15, 4]`, no rotation):

| id | asset | components |
| --- | --- | --- |
| `wreck` | `plane-wreck` | — |
| `wreck-deck` | `wreck-deck` | `ItemSurface {inset .05}`, `LocomotionEnvironment` |
| `wreck-walls` | `wreck-walls` | `LocomotionEnvironment` |
| `wreck-door-blocker` | `wreck-door-blocker` | `LocomotionEnvironment` |
| `wreck-axe` | `axe` | `Item {kind: 'axe', uid: 'wreck-axe'}` at [−18.7, 1.98, 2.93], rotationDeg [−90, 0, −90] |
| `waystation` | `waystation` | at [−27.6, −0.071, −5.6], rotationDeg [0, 80, 0] |
| `waystation-table` | `waystation-table` | `ItemSurface`; at [−27.0, −0.067, −5.7], rotationDeg [0, 80, 0] |
| `journey-markers` | `journey-markers` | at the origin |
| `forest-mushroom-1/2` | `mushroom-patch` | `ResourceNode` like the grove's, at FOREST_MUSHROOMS (y = terrain) |

Changed: `player.transform` → position [−22.86, 0.20, 4.42], rotationDeg [0, −90, 0];
`game` GameState `clock` 486 (WRECK_CLOCK.start), `day` 0 (the first sunrise makes it day 1;
the wrist hides "Day 0"); `campfire` Campfire `fuel` 0; `supply-backpack` Backpack `state`
'unowned' and `pack-roll` onto the waystation table (top y ≈ 0.71); pack contents page 1, meat,
resin (the mushroom comes from the forest; reeds from the camp clumps); `item-lighter`
`slot: 'hip-left'`; remove `camp-axe`, `item-log-1`, `item-log-2`. Authoring views: `wreck-seat`
(eye [−22.86, 1.85, 4.42] → [−18, 1.7, 4.1], fov 90), `wreck-door`, `wreck-outside`
(eye [−18.7, 1.9, −0.5] → the fuselage), `waystation`. The `hero` and `spawn` views move to the
wreck; keep `camp-home` for camp.

## 6. Integration edits for phase 2 (by file)

1. `src/assets.ts`: `import { journeyAssets } from './scene-assets/journey-assets.js'` and spread `...journeyAssets`.
2. `src/index.ts`: `world.registerSystem(JourneySystem, { priority: 9.5 })`.
3. `src/game/bus.ts`: `| { type: 'journey'; step: string }` (steps: JOURNEY_STEPS plus the
   one-shot keys `axe-left`, `pack-left`, `forest-done`, `door-glance`). In JourneySystem,
   `announce()` and the four "Phase 2" comments emit it.
4. `src/game/voice-lines.ts`: `triggersOf` case `'journey'` → `journey:${step}`; the new lines of
   §3 (`wreck-wake`, `wreck-door-nudge`, `wreck-axe`, `wreck-swing`, `wreck-harder`, `wreck-out`,
   `wreck-wolves`, `wreck-holster`, `wreck-dawn`, `wreck-myth`, `axe-left`, `waystation`,
   `pack-left`, `forest`, `mushroom`, `forest-done`, `camp`, `camp-no-wood`); retire `intro`;
   re-target `grab` (`done:wreck-axe+6`), `myth` (`done:wreck-dawn+5`), `chop` (drop
   `grab:axe+0.5`), `lighter`/`lighter-close` (`when: ['at-camp']`); texts of `pack` (C) and
   `chop`. New GuideConditions `in-wreck`, `near-door`, `axe-holstered`, `pack-owned`. Then
   `node scripts/voice-urls.mjs` and generate the new clips (voice-prep.html); unchanged texts
   keep their clips.
5. `src/game/systems/guide-system.ts`: evaluate the new conditions (JourneySystem.step,
   HolsterSystem, BackpackSystem.owned); before the spot search, `shadeMark(journey.step, out)`
   (journey.ts) pins the shade in the aisle / outside the doorway during the wreck beats.
6. `src/game/story.ts` (A): OBJECTIVES, OPENING, START (§4); `outpost` title "Find the high outpost".
7. `src/game/save.ts`: the `opening` migration (§4) + tests.
8. `src/game/systems/start-system.ts`: nothing required (JourneySystem re-holds the clock on
   `journey-begin`); optionally add JourneySystem to `hold()` so the wolves freeze under the panel.
9. `src/game/fx-particles.ts`: BECKON_STEPS `escape: ['axe']`, `waystation: ['pack']`,
   `light-fire: ['log', 'lighter']`; let the loose axe on its bracket and the unowned pack roll
   beckon (today only packed items do, outside `eat-meal`).
10. `src/game/audio-map.ts` (A): `thud` kind `wreck-door` → a metal clank; `drop` kind
    `wreck-door` → a heavy thud; a positional fire loop at the wreck (reuse the campfire crackle
    at WRECK_FIRES 'rear' and 'engine', volume following the fire's `intensity`).
11. `src/scene-assets/valley-layout.scene-asset.ts` (B): `TRAIL_CONTROL.journey = JOURNEY_TRAIL`,
    `TRAIL_HALF_WIDTH.journey = .72`; `blockedForTrees` and the FAR_PINES sampler also refuse
    `journeyBlocksTree(x, z, margin)`; valley-ground paints the new trail like the others.
12. `public/scenes/main.iwsdk.scene.json` (+ the valley module if the trees live there): §5.
13. `public/ui/camp-journal.uikitml`, `subtitle.uikitml`: texts that say the lighter is in the pack (C).
14. `src/game/systems/wrist-system.ts`: hide the day label on day 0.
15. `vitexec/opening.ts`: the new opening — seat spawn, walk to the door, grab the axe, three
    blows (drive the blade into `doorGap` at speed), step out, holster, wait for the sunrise,
    the waystation pack, fell a tree / take a mushroom, camp fire. A dev hook
    `__prometheusJourney` (step, doorHits, wolves) like `__prometheusGuide`.
16. `design/GAME_SPEC.md`: the pitch, the World table (wreck, waystation), objectives 1–3.
17. Optional (keeps the light count at 2): FxSystem parks its roaming `held-light` at the
    wreck's rear fire while no lit item is held and JourneySystem.step ≤ `open`.

## 7. Budgets and look

- `plane-wreck`: 6 draws, ≈ 10.7k triangles (hull and cabin 9.3k in one draw); no lights. The
  fire's warmth and the red/amber emergency light are a baked `glow` vertex attribute added as
  emissive in the one lit material (dimmed by JourneySystem as the fire dies), plus unlit
  strips (blinking; steady with *Reduce flashes*), additive shader flames and shader smoke.
- `waystation` 1 draw (≈ 780 tris), `waystation-table` 1 (96), `journey-markers` 1 (≈ 500).
- The four staged wolves cost ≈ 4 draws each for ~40 s after the door falls, far from camp.
- Colliders (`wreck-deck`, `wreck-walls`, `wreck-door-blocker`) are invisible single meshes.

## 8. Verification (phase 2)

Phase 1 could not render through the managed editor: a new asset must be registered in
`src/assets.ts` first, which phase 1 forbids. Unit tests cover the data, colliders, surfaces,
budgets and named parts; a non-authoritative CPU raster (scratch only) was used to check the
silhouette, the cabin from the seat, the door and the waystation. Phase 2 gates:
`scene render-file` of a scratch scene with the wreck nodes (views `wreck-seat`, `wreck-door`,
`wreck-outside`, `waystation`), render stats ≤ 200 draws / 250k tris from the seat and the door,
`browser_screenshot` of the runtime (the flames, smoke and blinking lights are system-driven),
`ecs find` for the door blocker losing LocomotionEnvironment, then `vitexec/opening.ts`.

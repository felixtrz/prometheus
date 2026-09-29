# Immersion & Presence Review — Prometheus

Reviewer role: VR experience director · Date: 2026-09-28 · Scope: code as of this date (review only, nothing run).
Evidence: `design/source/*.md`, `design/GAME_SPEC.md`, `design/ARCHITECTURE.md`, every system in `src/game/systems/`,
`src/game/rules.ts`, `iwsdk.config.json`, the scene JSON, the v2 player's-eye captures (`design/verify/v2/*.png`,
emulated Quest 3 at 800×425) and the night concept `design/concept/key-moment-night.svg`.
Caveat: the captures are desktop emulation. Reach, scale and comfort still need a headset pass.

---

## 1. Score and verdict

**6 / 10: a convincing daytime valley. The emotional arc breaks exactly where the design depends on it.**

In daylight the camp feels like a real place. Tools have working tips. The pot visibly changes as you cook. Flames
grow and shrink with fuel. Deer bolt when you rush them. Wolves back away from a torch while still facing it, then
dissolve at dawn. Haptics cover most verbs, and the fire and brook are positional sound sources. That work is
well above prototype level.

Presence collapses at the three beats that carry the arc:

- **Night.** The fire's light reaches **1.85 m**, but the rule that keeps wolves away uses a **6 m** ring. On top
  of that, the moon and ambient light keep the valley bright blue-green. The concept's warm island of light in
  near-black simply does not happen (compare `12-camp-night.png` with the concept).
- **Transitions.** Sleep, death, the kill plane and respawn are all hard cuts. No fade exists anywhere in the codebase.
- **Finale.** The game ends with a 3.85 s toast. The dawn that the ending text promises never arrives, and the
  guardian wolves appear out of nowhere 7–8 m from the player.

Two constant smaller breaks sit underneath these. The player's body is a pair of white Quest controllers, even
though art.md asks for stylized hands. And the worn backpack is locked to head yaw, so it swings away when you
turn to look at it.

---

## 2. What breaks presence and what builds it

### Presence breakers (most damaging first)

| # | Breaker | Where it bites |
|---|---|---|
| B1 | Firelight ends at 1.85 m. The benches, bedroll, trestle and the player's own hands (spawn is 2.3 m from the fire) stay cold blue at night | every night, and the key moment |
| B2 | Night is too bright: foliage stays saturated green, clouds glow, there are no stars or moon | every night (`12`, `13`) |
| B3 | Hard cuts when sleep jumps the clock, and hard teleports on death and respawn | every sleep and every death |
| B4 | The finale is a toast: no sunrise, no ending in the place where you are standing, and the guardians pop in | the end of a 20–30 minute arc |
| B5 | Default Quest controllers with laser rays stand in for hands, and the wrist band is a floating card over plastic | always (`xr-camp.png`, `14`) |
| B6 | The worn pack follows head yaw, so looking over your shoulder pushes it away | every trip to store items |
| B7 | Too many toasts, and they draw over everything, including your hands and the page you are reading, because depth testing is off | constantly during crafting and cooking |
| B8 | The sun direction snaps at mid-dusk and at the start of day, and dawn light comes from the west | twice per cycle |
| B9 | Pop-in: deer spawn 14 m away in open view, wolves spawn in view, deadwood and forage items blink in and out, and landed bolts vanish | while exploring |
| B10 | You can walk through tree trunks, benches, the tent and the fire | grove, camp |

### Presence builders (keep and protect these)

- **Made by hand really is by hand.** The hammer must strike face-down, and it has to be armed above the pad first.
  The spoon's tip must travel around the pot. Food and torches ignite after you dwell in the flame. The bowl is
  eaten at the mouth (`crafting-system.ts:106-122`, `campfire-system.ts:244-276`, `survival-system.ts:100-131`).
- **Creatures react to you.**
  - Deer flee only when you hurry (`shouldFlee` uses player speed), which matches the brook page's line that the
    deer fear only our hurry.
  - Deer also flee from wolves.
  - Wolves circle the fire ring, stop to watch you and howl.
  - Wolves back-pedal from a torch while snarling, with the head still facing the flame.
  - Only one wolf attacks at a time. It warns first (0.8 s growl and crouch), and its lunge stops 0.8 m short
    of your head.
  - At dawn the wolves dissolve in a flare of embers (`creature-system.ts:812-942, 1052-1066`).
- **The fire is alive.** Flame scale, light intensity and crackle volume all follow fuel. The broth colour follows
  the ingredients, and the stew bits turn as you stir. A single light follows the held torch or lighter.
- **Audio.** The day and night ambient beds crossfade. The fire and brook are positional. A heartbeat plays below
  30 health, and a dawn motif waits for the sleep swell to finish (`audio-system.ts`).
- **Comfort basics are right.**
  - Toasts stay fixed in the world and never follow your head.
  - The wrist band is attached to the hand, and the page reader follows the page.
  - Turning is a 45° snap, and a comfort vignette of 0.35 shows while sliding.
  - Wolves telegraph before they bite.
  - The damage flash is short (0.7 s decay).
- **Haptics are wide.** Chop 0.9/60 ms, strike 0.8/45, spear 1.0/80, crossbow 0.9/70, a bite on both hands 0.9/120,
  plus cell and bay snaps, ingredient drops and eating.
- **Diegetic intent.** The journal hangs on a wooden board at camp, there is a wrist band, and pages are read
  as parchment. There is no crafting menu.

---

## 3. Findings

Priority: **P0** breaks the core emotional promise. **P1** is a frequent or clearly visible presence break.
**P2** is polish.

### P0-1 — The fire does not light the night, and the night is too bright

**Evidence**

- `src/scene-assets/camp-props.scene-asset.ts:142` creates the light as `new THREE.PointLight(0xff8a43, 2.8, 1.85, 2)`.
  The `distance` of 1.85 m windows the falloff to zero at 1.85 m. At 1.5 m the window term is already down to 0.32.
- `fx-system.ts:125` only varies the intensity (1.2–3.4). The range stays 1.85 m.
- `rules.ts:28` sets `fireSafeRadius: 6`. Wolves circle at 7–9 m (`creature-system.ts:60`).
- Distances from the fire (0.25, −1.9):

  | Object | Distance |
  |---|---|
  | Player spawn | 2.31 m |
  | Nearest bench bay | 2.14 m |
  | Trestle | 2.09 m |
  | Bedroll | 2.14 m |

  None of them receives any firelight.
- `daynight-system.ts:30-35` sets night values of moon 0.35, hemisphere 0.16 and a blue image-based light.
  `12-camp-night.png` shows the resulting grass-green midtones with only a small warm patch on the fire stones.
  `13-night-wolf.png` shows a moonlit green field with no readable wolf.
- The concept (`key-moment-night.svg`) shows near-black tree silhouettes, stars and a moon, and a warm light pool
  roughly 6 m across that reaches the bench and rim-lights the wolf.
- Page 3 describes exactly this image: "They would not cross into the glow." Today the player cannot *see* the glow.

**Fix** (no performance cost: three.js shades every point light in every lit fragment whatever its `distance`)

1. `camp-props.scene-asset.ts:142`: `new THREE.PointLight(0xff8a43, 2.8, 8, 1.6)`.
2. In `fx-system.ts:125`, scale the light by fuel and by night:
   `fire.light.intensity = lit ? (2.2 + 3.8 * strength) * (0.55 + 0.45 * night) * flicker : 0`.
   Read `night` from `nightness(GameState.clock)`.
   - At night with full fuel this gives about 6 cd.
   - At 3 m that is about 0.98 (with the window term).
   - At 6 m it is about 0.16, which is just above the dimmed moon. The pool therefore visibly ends at the safe radius.
3. `NIGHT_P` in `daynight-system.ts:30`: set these values.

   | Field | New value |
   |---|---|
   | `sunIntensity` | 0.15 |
   | `hemiIntensity` | 0.07 |
   | `hemiSky` | [.14,.18,.34] |
   | `hemiGround` | [.03,.035,.03] |
   | `iblSky` | [.05,.07,.13] |
   | `iblEquator` | [.04,.05,.09] |
   | `iblGround` | [.02,.02,.02] |
   | `domeEquator` (also the fog colour) | [.035,.05,.09] |

   The wolves' embers and eyes are unlit, so they are not tone-mapped (`toneMapped:false`). A darker night makes
   them *more* readable, not less.
4. Verify with `browser_screenshot` at night and compare to the concept. Target: ground luminance just outside
   6 m should be at most about 20% of the luminance at 3 m.

### P0-2 — The finale does not pay off

**Evidence**

- `story-system.ts:177-186`: `finale()` only sets `lit` and `ended` and emits events.
- The day/night system never handles `ended` (grep finds nothing), so if the beacon is lit at night, it stays night.
- The promises: `story.ts:73` says "The Hollow scatter into ash **with the dawn**", and GAME_SPEC:125 says
  "dawn breaks".
- Where the ending is shown:
  - The ending body text appears only on the camp board (`journal-system.ts:337-339`), 55 m away.
  - At the Spire the player gets a 3.85 s toast (`toast-system.ts:202-204`).
- There is no light at the beacon. It glows through its material only (`fx-system.ts:209-226`).
- Guardians spawn the moment beacon progress rises above 0 (`creature-system.ts:329-333, 413-436`):
  - They spawn at `wolf-anchor-spire-west` (−2.2, −58) and `wolf-anchor-spire-east` (12.6, −53.4).
  - Those anchors are 7.8 m and 7.6 m from the brazier, inside night fog's 12 m clear zone.
  - The wolves appear at full size, in view.

**Fix**

1. **Sunrise on ending.** In `DayNightSystem.update`, after reading the clock, add:
   `if (game.getValue(GameState,'ended') && (phase === 'night' || phase === 'dusk')) clock += delta * 10;`
   The player then watches about a 15 s sunrise from the ridge while the Hollow burn away.
   - Wolves already dissolve on `ended` (`creature-system.ts:579`).
   - Let the existing dawn motif play. The 24 s ending duck is already in place.
2. **Ending text at the Spire.** Reuse the parchment reader asset:
   - Anchor it at the beacon (x 5, y 7.62 + 1.1, z −52.2), turned to face the player.
   - Fade it in over 2 s, starting 1.5 s after `ending`, and hold it for 15 s.
   - Or spawn a physical "page 8" in the brazier with `ENDING` text.
3. **Beacon light.** Add a preallocated `beacon-light` PointLight node to the scene. That respects the
   "light count fixed at startup" rule.
   - Settings: intensity 0, distance 22, decay 1.5, colour #ff9a4a.
   - FxSystem ramps it to 7 with `progress` and to 9 when lit.
4. **Guardians rise from ash** instead of popping in:
   - Move both spire anchors to 14 m or more from the brazier, behind the knoll rocks.
   - Add an `emerge` mode for every wolf spawn (see P1-6).

### P1-1 — Hard cuts: sleep, death, respawn, kill plane

**Evidence**

- `daynight-system.ts:100-107`: sleep jumps `clock` to dawn and sets `forceSky`, so the sky, lights and image-based
  light swap in one frame.
- `survival-system.ts:11,58-65`: after 2.5 s of standing, `setPlayerPosition` teleports the player with no fade.
- The kill-plane respawn at `:79-81` is also a hard teleport.
- A grep for "fade" finds only toast and audio fades.

**Fix.** Give the existing camera vignette a full-screen fill:

- Shader (`vignette-system.ts:25-36`):
  - Add `uniform float uFill;`.
  - Change the output to `gl_FragColor = vec4(uColor, max(edge * uOpacity, uFill));`.
- Add `fadeTo(target, seconds)`, which animates `uFill`, and draw the plane whenever `uFill > 0`.

Use it as follows:

| Transition | Sequence |
|---|---|
| Sleep | Fade to black over 0.8 s → jump the clock under black and hold 1.2 s → fade in over 2.0 s. The sleep swell already covers it. |
| Death | Red flash → fade to black over the 2.5 s `DEATH_SECONDS` → teleport under black → fade in over 1.5 s. |
| Kill plane | Fade to black over 0.3 s → teleport → fade in over 1.0 s. |
| After respawn | Also face the player toward the fire. Check the locomotor for a yaw setter. |

### P1-2 — The player's body is two plastic controllers

**Evidence**

- Nothing replaces the controller visuals (no `visualAdapters` or `updateVisualImplementation` call in `src/`).
- `xr-camp.png` shows Quest controllers with white rays. `14-wrist-night.png` shows the wrist card floating over a
  white controller.
- art.md:37-45 asks for "stylized hands with believable proportions". The concept shows gloved hands with a leather
  cuff carrying the band.

**Fix**

1. In `src/index.ts`, after `World.create`:
   `import { AnimatedControllerHand } from '@iwsdk/core'`, then call
   `world.input.xr.visualAdapters.controller.left.updateVisualImplementation(AnimatedControllerHand)`, and the same
   for the right hand.
   - This is IWSDK's built-in visual of a hand holding a controller. Its fingers animate with trigger and squeeze.
   - It loads from the same WebXR input-profiles CDN as today's controller models (`generic-hand`).
2. Parent a small leather cuff mesh to `gripSpaces.left`, under the wrist card (`wrist-system.ts:96-99`):
   a curved strip about 0.10 × 0.07 m with a stitched rim and a brass buckle, at about 300 triangles.
   The band then reads as worn gear rather than a floating HUD.
3. Re-tune `offsetX/Y/Z` against the hand model.

### P1-3 — The worn pack is locked to head yaw

**Evidence**

- `backpack-system.ts:129-136` rebuilds the shoulder anchor every frame from the camera's forward direction, and
  `:245-248` makes the pack follow it.
- Turning your head to look over your right shoulder rotates the anchor away. The pack is always 0.17 m behind
  wherever you look.
- Looking straight down (at the mat or the ground) makes the yaw calculation (`atan2` of an almost-zero x/z vector)
  jitter, so the pack whips around.

**Fix.** Add a body-yaw estimator field, `bodyYaw`:

- Each frame, compute `headYaw` only when `|forward.y| < 0.85`.
- If `|wrap(headYaw − bodyYaw)| > 40°`, move `bodyYaw` toward it at 150°/s.
- On a snap turn, add the turn angle to `bodyYaw` directly.
- Build the anchor from a neck point (head minus 0.08 m along the body-forward direction, minus 0.12 m in y) with
  offset (0.17, −0.2, 0.12), rotated by `bodyYaw`. Use the same point for the worn-release test at `:141-142`.
- Result: glancing over the shoulder *reveals* the pack.

### P1-4 — Toasts: they overlay everything and there are too many

**Evidence: overlay and placement**

- `toast-system.ts:55` turns depth testing off (`depthTest:false`, renderOrder 20), so toasts draw over hands,
  held items and the page reader, and they show through trees.
- `:232-239` places each toast 1.4 m ahead in the look direction even while the player is moving. At 5 m/s you walk
  through it in about 0.3 s.

**Evidence: volume and bursts**

- Completing an objective produces two toasts ("… Objective complete" plus "Next: …", `:168-176`).
- Crafting the torch produces four within about 2 s: Crafted, Objective, Next, and "The Hollow stir…".
- Picking up a page produces two (page found, recipe learned) *while you are reading it*.
- Cooking adds ingredient, stir-ready and bowl-filled toasts (`campfire-system.ts:88,194`).
- There are 17 explicit `toast` emit sites plus about 12 event-driven ones.
- `09-outpost.png` shows two slate cards stacked mid-valley.

**Fix**

1. **Placement**
   - Distance = `1.4 + min(1.2, playerSpeed * 0.4)`.
   - Hide a slot while the head is within 0.7 m of it.
   - If the anchor leaves a 45° cone of the view for more than 1 s while a toast is still alive, glide it to a new
     anchor over 0.4 s (a lazy follow; still not locked to the head).
   - Keep depth testing off, but add a check: skip the frame's draw if a held page reader is inside the toast's
     screen rectangle. The simpler option is (3) below.
2. **Diet** (target: at most one toast per player action)
   - Drop "Next: …". The wrist already shows NOW. Instead, pulse the left hand at 0.2/40 ms and flash the wrist
     border for 2 s.
   - Drop "Crafted: X" when the same craft completes an objective.
   - Drop the ingredient and bowl-filled toasts. The broth colour, the bits and the audio already say it.
   - Defer "The Hollow stir…" to the next dusk (see P2-6).
3. **While a `Page` is grabbed**, queue toasts and release them when the page is let go.

### P1-5 — The sky breaks its own logic

**Evidence**

- `daynight-system.ts:181-185`: `t` clamps to 1 through dawn, so dawn light comes from the *setting* position.
- When the clock wraps to 0, the azimuth jumps from +1.2 to −1.2 rad (137°) at full intensity 1.7. Because there
  are no shadows, every lit face flips at once.
- A second snap happens at mid-dusk, when `night > .5` jumps the light to the moon position.
- `valley-kit.scene-asset.ts:31`: the cloud material has emissive #c8d4e0 × 0.7, so clouds glow pale grey on a
  navy sky (`12`, `13`).
- There is no star or moon geometry, even though the code comment at `:180` mentions a moon.

**Fix**

1. **Continuous sun path**
   - `const cycle = mod(clock, DAY_LENGTH); const t = cycle >= DAWN_CLOCK ? 0 : Math.min(1, cycle / (DAY.day + DAY.dusk));`
     so the sun rises in the east at dawn.
   - Compute separate sun and moon quaternions, then slerp between them with `w = smoothstep(.3, .7, night)` in
     place of the hard switch.
2. **Clouds.** Cache the `'Clouds'` material once, by traversing its name. Then set
   `emissiveIntensity = lerp(.7, .03, night)` and lerp its colour toward #2b3448.
   It is one shared material, so this is one write.
3. **Stars and moon.** Created once, two draw calls.
   - Stars: a dome of 600 `Points` on a 140 m hemisphere, with `sizeAttenuation:false`, size 1.6 px, `fog:false`
     and `depthWrite:false`. Opacity = `smoothstep(.4, .9, night)`.
   - Moon: a `CircleGeometry(4)` disc at 140 m along the moon direction, `MeshBasic #dfe6f2`, `fog:false`, visible
     when `night > .3`.

### P1-6 — Pop-in and pop-out

**Evidence**

- `creature-system.ts:54`: prey `minSpawnDistance 14` (day fog is fully clear to 30 m) and `despawnRange 58`
  (about 31% fogged, so still visible).
- `:64`: wolves spawn from 15 m, while night fog is clear to 12 m.
- `:455-471`: every creature appears at full scale in a single frame.
- `gather-system.ts:122` hides deadwood instantly. `:186` shows forage again instantly.
- `combat-system.ts:221`: bolts that have landed vanish after 3 s.

**Fix**

1. Spawn prey only where `dot(cameraForwardXZ, dirToSpawn) < 0.2` or the distance is over 35 m. Despawn only when
   out of view.
2. Add an `emerge` mode for wolves, the reverse of dissolve, lasting 1.2 s:
   - `scale.y` grows from 0.05 to 1.
   - Embers flare at 1.6× and settle.
   - Play a low ash hiss.

   Wolves then *form from ash* in view, which fits the lore and makes pop-in impossible.
3. Regrow resource nodes only when the player is more than 12 m away or facing away, scaling from 0 to 1 over 0.6 s.
   Deadwood shrinks out over 0.25 s as its yield bursts out.
4. Bolts stay stuck for 8 s, then sink 5 cm over 0.5 s before being removed.

### P1-7 — Locomotion speed shrinks the valley

**Evidence**

- The `slidingSpeed` default is **5 m/s**
  (`node_modules/@iwsdk/core/dist/locomotion/locomotion.js:45`), and `iwsdk.config.json` cannot set it.
- At that speed, crossing the 70 × 80 m valley takes about 15 s, and the Spire is 11 s from camp.
- The deer "hurry" threshold (1.2 m/s) trips at 24% stick deflection, so sneaking up on deer is fiddly.

**Fix.** In `src/index.ts`:
`const loco = world.getSystem(LocomotionSystem); if (loco) loco.config.slidingSpeed.value = 3;`
Keep `comfortAssistLevel` at 0.35 and snap turn at 45°. Consider 30° snap later, as a comfort option.

### P1-8 — A lit torch on the ground burns but gives no light

**Evidence**

- `fx-system.ts:160` feeds the shared light only from torches that are being held (`Grabbed`).
- `creature-system.ts:242-251` still treats any unpacked lit torch as a 3 m wolf ward.
- Planting a torch on the trail is the most natural thing to do at night, and today it creates a visible flame with
  no light: an impossible state.

**Fix.** In `updateItems`:

- If no held flame is found, use the nearest visible lit torch within 15 m of the camera, at intensity 1.4.
- A held flame still wins.
- Also put out torches when they are stored in a pack cell (`lit=false`, relight at the fire). Today a lit torch
  lies burning on a cloth mat while being ignored by the wolves.

### P1-9 — You can walk through trees, props and the fire

**Evidence**

- `LocomotionEnvironment` exists only on `ground` and `valley-bounds` (scene JSON).
- The IWSDK locomotor does collide a capsule against those meshes (`@iwsdk/locomotor/dist/physics/collision-handler`).
- `06-grove.png` has the camera inside pine foliage.
- Walking through a trunk (your eyes inside the bark) is a classic presence breaker.

**Fix.** Add a `valley-colliders` asset using the same hidden-mesh-in-a-group pattern as `makeBounds`
(`valley-props.scene-asset.ts:502-532`). It merges:

- Cylinders (r 0.35, h 3 m) at every trunk inside `WORLD_BOUNDS`.
- Boxes for the bench, trestle, tent, crate, lookout legs and the Spire rock.
- A ring collider (r 0.6 m) around the fire.

Tag it `LocomotionEnvironment`. It is one bounding-volume tree and adds no draw calls. Arm's reach still lets you
stir the pot (the pot rim is about 0.34 m from centre).

### P2 — Polish

1. **The journal board glows like a monitor at night** (`12-camp-night.png`).
   - When `nightness > .5` and the fire is out, dim the ink from #ede9da to #a9a08a and the panel background from
     #192520 to #101713.
   - Move the destructive "New journey" button and Enter/Leave VR to the back of the board so the front stays
     diegetic.
2. **Haptic gaps.** Existing coverage is good. Add:

   | Moment | Pulse |
   |---|---|
   | Grab (`item-system.ts:49-59` has none) | 0.12/10 ms |
   | Fuel added | 0.3/40 |
   | Each stir quarter-turn | 0.15/20 |
   | While dwelling in flame (lighter, torch, roast) | 0.08/15 every 0.15 s |
   | Heartbeat below 30 health | 0.25/40 on the left hand, in time with the loop |
   | Wolf growl within 4 m | 0.2/80 on both hands |

3. **Item physicality**
   - Items fall *into* rocks, logs and stumps outside the six `SURFACES` (`rules.ts:103-110`).
   - The rest pose ignores slope (`item-system.ts:197-206`).
   - Fix: add about 20 valley rest surfaces (log tops, flat rocks). Tilt the rest pose to the terrain normal, taken
     from finite differences of `terrainHeight` at ±0.1 m.
4. **Fire consistency.** Items resting inside `inFire()` should act the way held ones do. Meat roasts. An unlit
   torch lights. Fuel burns. Today raw meat can lie in the flames forever.
5. **Progress cues while dwelling.** The lighter-to-tinder wait (1 s), torch lighting (0.65 s) and roasting (3 s)
   show nothing until they finish. Add a smoke wisp at the tinder, and lerp the meat tint from raw to roast over
   the 3 s.
6. **Dusk is silent.** `audio-map.ts:185` maps only dawn.
   - For stage ≥ 1 at dusk, play one positional howl from the nearest eligible wolf anchor.
   - Show the deferred "The Hollow stir…" toast then. That turns dusk into the anticipation beat of the arc.
7. **Concept details still missing.** Rising embers above the fire (one `Points`, 24 sprites) and steam from the
   pot while stew is ready.
8. **The wrist band is always fully on.** Make it glance-to-reveal: opacity 0.35, rising to 1 when
   `dot(panelNormal, toEye) > 0.6`. Checking your wrist becomes a gesture, and the edges of your view get cleaner.
9. **The page reader floats 24 cm beside the page** (`reader-system.ts:129-141`). Consider growing the held page
   to 0.21 × 0.30 m and mounting the text on its face, so the reading happens on the page itself.
10. **Creatures walk through trees.** They only follow `terrainHeight` (`creature-system.ts:672`). Feed the P1-9
    trunk list into the existing `detour()` for prey flee and wander targets.
11. **The lost-pack marker** is a 7 m additive cylinder (`fx-system.ts:64-68`). Swap it for a column of rising
    embers and smoke that matches the fire language.
12. **No footsteps during smooth locomotion.** A soft step every 0.65 m, with separate grass and dirt sets, anchors
    the body in the world.

---

## 4. Top 6 changes

1. **Make the fire the night's light (P0-1).**
   - Fire light `distance` 1.85 → 8 and `decay` 2 → 1.6, with intensity scaled by fuel and night.
   - Moon 0.35 → 0.15, ambient 0.16 → 0.07, darker image-based light and fog.
   - The 6 m safe ring becomes visible. This is the concept's key moment, and it costs almost nothing.
2. **Let the finale land (P0-2).**
   - Run the clock ×10 to sunrise once the beacon is lit.
   - Show the ending text as parchment at the Spire.
   - Add a preallocated beacon light.
   - Guardians rise from ash at 14 m or more, instead of popping in 7 m away.
3. **Fades for every discontinuity (P1-1).** Add `uFill` to the vignette shader. Sleep: 0.8 / 1.2 / 2.0 s.
   Death and kill plane: black, then teleport, then fade in. Face the fire on respawn.
4. **Hands, not controllers (P1-2).** `updateVisualImplementation(AnimatedControllerHand)` on both hands, plus a
   leather cuff under the wrist card.
5. **A sky that obeys its own logic (P1-5).** A continuous sun path that rises in the east, a slerp between sun and
   moon, clouds that dim at night, and 600 stars plus a moon disc (two draw calls).
6. **Quiet, well-behaved notices (P1-4).**
   - At most one toast per action. The wrist and haptics carry "Next".
   - Toasts sit further away while you move and hide within 0.7 m.
   - Toasts wait while you are reading a page.

Next in line after these six:

- Body-yaw anchor for the worn pack (P1-3).
- Trunk and prop colliders (P1-9).
- 3 m/s locomotion (P1-7).
- Emerge-from-ash spawns and out-of-view prey spawning (P1-6).
- Light from a planted torch (P1-8).

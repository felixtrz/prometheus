# Visual fidelity and art-direction review: Prometheus

Reviewer role: environment and prop art director. This is a review only; no source files were changed.
Binding brief: `design/source/art.md`. References: moodboard stills `04`–`07` in `handoff/IWA-S02E01-Editor-Bundle/02-reference-stills/`, and `design/concept/key-moment-night.svg`.
Evidence: runtime player-eye captures in `design/verify/v2/*.png` (800×425), plus the scratchpad lineups (`items-*.png`, `creatures-*.png`, `world-*.png`, `ui/final-*.png`, `before/`, `after/`). Line references are to the current tree.

---

## 1. Score and verdict

**6.5 / 10.** The camp is on-brief. The world around it and the night are one pass behind, and creature anatomy is the weakest stream.

- **Camp (day):** this is the strongest part of the build. It matches the "Campfire Checkpoint Grounding" moodboard frame very closely: tripod, pot, fire ring, slotted bench, unrolled pack and a trail leading the eye to the Spire (compare `world-hero.png` and `world-camp-north.png` with `06-campsite`). The props follow art.md's "construction detail" rule: joinery, straps, brackets, nail heads and bindings.
- **Rest of the world:** it holds together at a glance. Layering is good: camp props up close, then pines, broadleafs, the lookout and the Spire, then fogged mountains. Three problems remain:
  - The ground reads as a flat, airbrushed lime plane.
  - The mid-ground pines are a single repeated silhouette.
  - A few finale surfaces look like placeholders (the Spire steps).
- **Night:** it reads as night, but the campfire does not anchor it. The fire's light reaches only **1.85 m**. The bench, pack and journal sit in cold dark while the unlit journal panel glows brighter than they do. A carried torch lights 7 m, so a torch outshines the campfire.
- **Creatures:** the ash-wolf concept (charcoal hide with ember cracks) is strong and ties into the fire theme. The execution has proportion errors in both the wolf and the deer, and no creature has any grounding shadow.

---

## 2. Per-area notes

### Camp (`camp-props`, `camp-stage`, `camp-dressing`)
- **Working:**
  - The first visual pass paid off. `before/workbench.png` has pixel-noise "plaid" wood; `after/workbench.png` has soft, low-frequency grain, which art.md asks for.
  - Bench (`camp-props.scene-asset.ts:156-236`), trestle and journal board are structurally clear with physical detail at the right scale.
  - The dressing pieces (bedroll, lantern rock, log seat, woodpile) add story without clutter.
  - Baked contact blobs under the camp props ground them well (`woodland.scene-asset.ts:94-103`).
- **Weak:**
  - The fire-ring stones are 12 near-identical geodesic balls: `IcosahedronGeometry(.17,1)` with ±5% noise (`camp-props.scene-asset.ts:95-104`). They read as grey soccer balls rather than the "faceted natural rocks" art.md calls for. This is the object at the centre of every camp view (`world-spawn.png`, `04-camp-home.png`).
  - The flame tongues are good stylised shapes, but they have no warm spill or halo at night (see Lighting).

### Items (`items.scene-asset.ts`)
- **Working:**
  - This is the richest stream. The axe, crossbow, sentry kit, spear, cloth roll, stew bowl, log and plank all have readable silhouettes and genuine construction detail (`items-lineup.png`, `items-turret.png`).
  - The palette (`items.scene-asset.ts:498-507`) harmonises with the camp timber and iron.
- **Weak:**
  - The **crafting hammer reads as a camcorder or drill.** It has a 22 cm iron block with a trumpet-flared black cone on one end (`items.scene-asset.ts:582-585`; `items-wall-tools.png`, `world-camp-north.png`).
  - The lit **torch flame is an opaque orange cone** that stays locked to the shaft. Lying on the ground, it points sideways like a traffic cone or rocket nozzle (`01-camp-day.png`, crop around the fire).
  - Scale jumps between items look inconsistent:
    - Mushroom cap is 0.29 m wide, the meat cut is 0.33 m long, the lighter is 5 cm and the flint is 10 cm (`items-rest.png`, `items-wall-food.png`).
    - In the pack, the mushroom overflows its 0.24 m cell and the lighter is a speck (`03-pack-trestle.png`).
  - The roast meat's grill marks are flat black bars (`items-wall-food.png`), which look like placeholders.

### Creatures (`creatures.scene-asset.ts`)
- **Working:**
  - The rabbit is well proportioned and charming.
  - The wolf's ember cracks and eyes read well at night (`creatures-lineup-night.png`).
  - The single-draw rigid skinning is the right call for performance.
- **Wolf problems:**
  - Stilt legs: straight 0.6 m cylinders with no canine elbow or hock angle.
  - The hind thigh is a separate oval pod hanging below the back line.
  - The tail is thick (10 cm diameter) and droops 0.35 m, with an ember crack at the tip. From the side it reads as a second head.
  - The muzzle is a thin tube ending in a ball nose (`creatures-wolf-close.png`, `creatures-lineup-side.png`).
- **Deer problems:** the torso is only 1.0 m long on 0.86 m legs, which gives a leggy, stilted look. The upper forelegs read as separate cylinders at the chest (`creatures-lineup.png`).
- **All creatures:** none has a contact shadow, so they float (`creatures-lineup.png`, `08-brook.png`).
- **Verification gap:** `13-night-wolf.png` contains no wolf. Brightening the frame 2.5× shows only terrain. Night wolf readability at gameplay distance is therefore unverified.

### Valley regions (`valley-*`, `woodland`)
- **Trail and open ground:**
  - The ground is vertex-coloured on a 0.8 m grid with smooth shading (`valley-ground.scene-asset.ts:47-169`). Grass is flat lime with no mid-frequency detail, and trail edges blur over about 1 m.
  - The moodboard ground is a faceted triangle mosaic with crisp trail edges (`06-campsite`, `07-workbench-view`). This is the biggest "placeholder-looking" surface because it fills 40–60% of every frame (`07-meadow.png`, `10-spire.png`, `world-outpost.png`).
- **Pines:**
  - All in-valley pines are one geometry, scaled uniformly by 0.8–1.25 (`valley-props.scene-asset.ts:548`; `valley-layout.scene-asset.ts:193-203`). Mid-ground stands read as rows of the same star (`07-meadow.png`, `08-brook.png`, `world-valley-overview.png`).
  - The GLB pines in the camp and grove add bare orange "tentacle" branches under the canopy (`06-grove.png`, `world-grove-resin.png`). That is a different pine language from the procedural pines beside them.
- **Grove:** good mood, with ferns, moss mounds, litter and roots. The resin scar is a pale beige oval that reads like a sticker or egg (`world-grove-resin.png`).
- **Meadow and brook:**
  - Layering here is the best in the valley.
  - The water meets the bank with no wet or foam edge.
  - Reeds sit on a raised dark-brown disc that reads as a pancake (`world-brook-bridge.png`, `08-brook.png`).
  - Broadleaf crowns (`0x8cbf3f`/`0xa3cc4d`) share the hue and value of the meadow grass (`0x9dcb46`) and merge into hillsides (`07-meadow.png`).
- **Outpost:** reads clearly: tent, crate with emblem, banner and lookout tower. It is a good mid-ground landmark (`09-outpost.png`, `world-outpost.png`).
- **Spire:**
  - The monolith is a strong far-distance anchor, visible from camp along the trail axis. This is excellent composition.
  - The **stone steps are plain grey boxes**: `BoxGeometry(1.2,.7,.5)` in `0x8f959a` with 5% wobble (`valley-regions.scene-asset.ts:493-501`). One riser juts about 0.3 m and the top step buries into the slope (`10-spire.png`, `world-spire.png`). They are placeholder-grade at the game's finale.
- **Horizon:** the snow-capped massifs, fogged treeline ribbon and puffy clouds are coherent with the moodboard.

### Day and night lighting (`daynight-system.ts`, `fx-system.ts`)
- **Day:** a warm sun (`[1,.89,.72]`, 1.7), cool hemisphere fill and linear fog at 30–120 m give good aerial perspective. It matches the "Open Wilderness Light" research frame.
- **Night:** the brightness is playable (mean luma 36/255 against 114 by day) and navy reads as night. However:
  1. **The fire barely lights the camp.** `PointLight(0xff8a43, 2.8, 1.85, 2)` at `camp-props.scene-asset.ts:142`, modulated to at most about 3.4 in `fx-system.ts:125`. In `12-camp-night.png` the warm pool stops at the ring stones, and the benches, pot underside and pack stay cold. The torch's `held-light` has distance 7 m at intensity 1.8 (`main.iwsdk.scene.json` node `held-light`; `fx-system.ts:164`), so a torch lights a larger area than the campfire. This inverts the brief's "campfire as emotional anchor".
  2. **The unlit journal panel glows.** Its pixels are identical by day and night (`#25352d`), and at night it is lighter than the surrounding world (`#131826`) (`12-camp-night.png`). It reads as a TV screen in the woods.
  3. **Clouds glow at night.** `mats.cloud` has a constant `emissiveIntensity .7` (`valley-kit.scene-asset.ts:31`) that the day/night system never dims (`12-camp-night.png`, `13-night-wolf.png`).
  4. **No moon, no stars, and silhouettes are lost.**
     - Night fog uses the horizon colour (`daynight-system.ts:197`) at 12–60 m, so treelines dissolve into the horizon instead of cutting out against it.
     - The ground stays saturated green (`#2b4324` in `13-night-wolf.png`), which gives a "day-for-night" look.
     - The "Ominous Twilight" moodboard frame and `key-moment-night.svg` both rely on a lighter horizon band behind dark silhouettes.
- **Hurt vignette:** `14-wrist-night.png` shows red covering about 70% of the view. `smoothstep(0.5, 1.12, r)` at `vignette-system.ts:33` combined with a 0.85 flash strength is heavy for VR comfort.

### UI (`public/ui/*.uikitml`)
- **Working:**
  - The palette (dark green `#192520`, brass `#cba875`, cream `#ede9da`) belongs to the leather-and-brass world.
  - The page reader (parchment) and toasts are clean and legible (`ui/final-page-reader.png`, `ui/final-toast.png`).
  - The wrist HUD is compact and clear (`ui/final-wrist-hud.png`).
- **Journal weaknesses:**
  - Diegesis: it is a rounded-corner dark "app" screen nailed to a board. That is acceptable by day but wrong at night (see Lighting).
  - Legibility: at 0.8 scale the objective list em is 2.0 cm. At a 2.3 m reading distance that is about 0.5°, with cap height near 0.35°, which is marginal on Quest 3.
  - Contrast: objective items `#8c9d8c` on `#25352d` measure 4.5:1. Locked recipes and pages `#6f7f72` measure **3.05:1**, which fails small-text contrast.
- **Controllers:** the default white controller model (`14-wrist-night.png`) does not follow art.md's "stylized hands" direction.

### Consistency between the streams
| Pair | Mismatch | Evidence |
|---|---|---|
| Grove mushroom patch vs mushroom item | Patch has red fly-agaric caps `0xb5452e`, r 7 cm (`valley-props.scene-asset.ts:134`). Item is a brown bolete `0xc27a4a→0x8f4128`, cap 29 cm (`items.scene-asset.ts:719-721`). You pick a small red toadstool and receive a giant brown porcini. | `world-grove-resin.png`, `items-wall-food.png` |
| Berry bush vs berries item | Bush has bright red faceted `0xb0203a` (`valley-props.scene-asset.ts:167`). Item has dark purple smooth bilberries `0x4a1230→0x8f2c56` (`items.scene-asset.ts:986`). | `world-berry-bush.png`, `items-wall-flat.png` |
| Camp shading vs item shading | Camp uses `flatShading:true` faceting; items and creatures are smooth. This is acceptable because hero items should read softer, but keep rocks and terrain faceted. | `03-pack-trestle.png` |
| GLB pines vs procedural pines | Different branch language (bare tentacle limbs vs clean tiers). | `06-grove.png` |
| Legacy props | `camp-props.scene-asset.ts:350-526` still builds the old box-meat, ball-mushroom, hammer, torch and other props at import time in **both realms**. They are unused: `assets.ts` imports only campfire, bench and backpack. | code |

---

## 3. Findings

Priority key: P0 breaks the brief or reads wrong in every session. P1 is a clear quality gap. P2 is polish.

### P0

**P0-1: The campfire is not the night's light anchor.**
- Evidence:
  - `12-camp-night.png`: warm light ends at the ring, and the benches, pack and journal are cold.
  - `camp-props.scene-asset.ts:142` sets distance 1.85.
  - `fx-system.ts:125` caps intensity at about 3.4.
  - The `held-light` torch light reaches 7 m.
- Fix:
  - Set `fireGlow` to `new PointLight(0xff9448, 6, 5.5, 2)`.
  - In `fx-system.ts:125`, scale by nightness: `intensity = lit ? (1.5 + 5.5 * strength * lerp(.3, 1, nightness(clock))) * flicker : 0`. Read the clock once per frame from `GameState` with no allocation.
  - Drop `held-light` to distance 4, intensity 1.6, so the fire always out-lights a torch.
  - Add a cheap "light pool": one ground disc under the fire, radius 3.2 m, `MeshBasicMaterial` with a 32 px radial-gradient alpha map, colour `#ff8a3c`, `AdditiveBlending`, `depthWrite:false`, opacity `0.28 × nightness × strength`. That is one draw.
  - When lit at night, set the pot `iron` emissive to `#3a1a0a` (the same pattern as broth, `fx-system.ts:133`).
- Cost: a larger light range costs nothing extra in forward shading, and the disc adds one small transparent draw.

**P0-2: The unlit journal panel is the brightest non-fire element at night.**
- Evidence: `12-camp-night.png`. The panel reads `#25352d` both day and night, while the world around it is `#131826`.
- Fix: on phase change (JournalSystem already detects it at `journal-system.ts:405-409`), swap the journal colours:
  - Root background `#192520 → #0e1512`
  - Card `#25352d → #151f1a`
  - Body text `#ede9da → #bdb7a6`
  - Brass accents `#cba875 → #9c8157`
  - Restore at dawn. This is event-driven with no per-frame work.
  - Also add a small hanging lantern to the board top-left, reusing the lantern from `camp-dressing.scene-asset.ts:92-104` with its `glow` `MeshBasicMaterial`, so the panel's readability at night is motivated.

### P1

**P1-1: The hammer head silhouette reads as a camcorder.**
- Evidence: `items-wall-tools.png`, `world-camp-north.png`, `items.scene-asset.ts:582-585`.
- Fix:
  - Change the head box `[.22,.105,.115]` to `[.16,.078,.084]`.
  - Replace the flared `cyl(.03,.05,.09)` with a tapering peen: `cyl(.04, .022, .065, 10, C.ironDark)` at `[.113,.22,0]`, rot z π/2. After rotation the wide end sits against the head.
  - Move the striking face to `box([.014,.086,.092])` at x −.087.
  - Update the hammer tip in `src/game/catalog.ts` to the new face (x ≈ −.094).

**P1-2: The fire-ring stones read as geodesic balls.**
- Evidence: `world-spawn.png`, `04-camp-home.png`, `camp-props.scene-asset.ts:95-104`.
- Fix:
  - Use `IcosahedronGeometry(1,0)` with ±22% vertex noise plus 2–3 random plane cuts, using the same technique as `makeFlint` (`items.scene-asset.ts:849-886`).
  - Vary scale per stone: x .18–.27, y .10–.15, z .15–.21. Sink them to y = .06.
  - Mix in 3 smaller filler stones.
  - Colour inner faces with per-face soot: `#3d3a36` where the normal points at the fire; outer faces `#7b7d76`/`#6d706b`/`#858278`.
  - The triangle count goes down.

**P1-3: The ground reads as airbrushed, placeholder lime.**
- Evidence: `07-meadow.png`, `10-spire.png`, `world-outpost.png`, `valley-ground.scene-asset.ts:142-169`.
- Fix (matches the moodboard's faceted terrain):
  - After building the index, call `groundGeometry.toNonIndexed()`.
  - Set each triangle's three vertex colours to their average × `(1 + .05 × (hash(tri) − .5) × 2)`, using ±3% inside the camp patch.
  - Set `floorMaterial.flatShading = true`.
  - Tighten trail edges from `smooth(1.12,.72,…)` to `smooth(1.0,.86,…)`.
  - Cost: about 3× vertex memory for one draw; check `groundStats`. Alternatively add a 64 px grey "clump" detail map with world-XZ UVs repeating every 2.5 m.

**P1-4: Wolf anatomy (stilts, detached thigh, tail that reads as a second head).**
- Evidence: `creatures-wolf-close.png`, `creatures-lineup-side.png`, `creatures.scene-asset.ts:454-535`.
- Fix:
  - Legs and body:
    - Body bone and leg pivots down 0.06 m (paws stay at y 0), giving a shoulder height of about 0.70 m.
    - Torso loft `halfLength .44 → .5`.
    - Foreleg elbow at z .20, paw at z .27, for a slight forward cant.
    - Hind hock at z −.45, cannon angled forward to a paw at z −.36 (the canine Z-shape).
    - Thicken the upper legs: r `.056 → .068` front, `.04 → .052` hind.
  - Thigh: `thighR [.046,.125,.085] → [.06,.15,.11]`, centre `[.058,.63,-.31]` so it overlaps the flank by about 30%.
  - Tail: radii `.045/.052 → .03/.036`, end at `[0,.47,-.72]`. Move the ember crack from the tip to mid-tail around `[0,.6,-.58]`.
  - Head: muzzle radii `.034/.018 → .042/.028`, and add a lower-jaw wedge (`spike` flattened .4) from `[0,.73,.55]` to `[0,.72,.68]`.

**P1-5: The deer's short torso makes it leggy.**
- Evidence: `creatures-lineup.png`, `creatures.scene-asset.ts:345-400`.
- Fix:
  - Torso loft `halfLength .5 → .6`, centre z −.05.
  - Front leg pivots and geometry z `.27 → .33`; hind `−.3 → −.38`.
  - Add a shoulder-mass blob on each foreleg bone at `sx(s,[.075,.8,.31])`, r `[.07,.17,.12]`, to bridge leg into chest.
  - Leg-to-body ratio moves from .86:1.0 to .86:1.2.

**P1-6: Creatures have no grounding.**
- Evidence: `creatures-lineup.png`, `08-brook.png`.
- Fix:
  - Add one root-space (not bone-bound) quad per rig: `PlaneGeometry` rotated −π/2 at y .012 with a 32×32 radial-gradient alpha `DataTexture`, `MeshBasicMaterial{color:0x000000, transparent, opacity:.35, depthWrite:false}`, shared across species.
  - Sizes: deer 0.55×1.2 m, wolf 0.45×1.0 m, rabbit 0.2×0.3 m.
  - In the dying sink (`creature-system.ts:671`), fade opacity with `progress`.
  - Cost: one small draw per creature.

**P1-7: Night sky and silhouette read.**
- Evidence: `12-camp-night.png`, `13-night-wolf.png`, `daynight-system.ts:30-35,197`.
- Fix:
  - Add `fog` to `Palette` so night fog is darker than the horizon:
    - Night: `domeEquator [.11,.15,.26]` (`#1c2642`), `fog [.04,.06,.11]` (`#0a0f1c`).
    - Moon `sun [.62,.72,1]` at .45.
    - `hemiGround [.05,.05,.08]`.
  - Add a moon (`CircleGeometry(2.2)`, `MeshBasic #e9eef7`, `fog:false`, 90 m out along −sunDir at night) and 200 stars (`Points`, `sizeAttenuation:false`, size 1.5 px, `#cfd8ff`, opacity = nightness). Two draws total.
  - Treelines then cut out against a lighter band, as in `key-moment-night.svg`.

**P1-8: Clouds glow at night.**
- Evidence: `12-camp-night.png` (cloud at 540,50), `valley-kit.scene-asset.ts:31`.
- Fix: in DayNightSystem's throttled dome block (`daynight-system.ts:144-151`), set `mats.cloud.emissiveIntensity = lerp(.7, .04, night)` and lerp `mats.cloud.color` from `#f2f5f8` to `#3a4460`. Export `mats` for this, or pass the material through the horizon asset.

**P1-9: Torch and lighter flames follow the shaft instead of pointing up.**
- Evidence: `01-camp-day.png` (torch lying at the fire).
- Fix: in `fx-system.ts:153-172`, after `flicker()`:
  - `object.getWorldQuaternion(this.q).invert(); flame.quaternion.premultiply(this.q)`.
  - Preallocate `this.q = new Quaternion()` in `init()`.
  - Keep the ±0.035 rad wobble.
  - Also give the torch outer flame a 3-stop vertex gradient (`#ffe296` base, `#ff9529`, `#e0521c` tip) and opacity .8 so it stops reading as a cone.

**P1-10: The Spire steps look like placeholders.**
- Evidence: `10-spire.png`, `world-spire.png`, `valley-regions.scene-asset.ts:493-501`.
- Fix:
  - Replace the grey boxes with `mossyRockGeometry(seed, 1, .3)` scaled `[1.25, .32, .6]`.
  - Solve y so every riser is a constant 0.17 m and the top step is flush with the plateau.
  - Let moss (`#7a9a3c`) take upward faces.
  - Add a dry-grass tuft (`GRASS.dry`) at both ends of each step.

**P1-11: Resource nodes do not match the items they yield.**
- Evidence: see the consistency table above.
- Fix:
  - Mushroom patch caps: use the item gradient (`#c27a4a` rim → `#8f4128` centre, specks `#f1e6cc`) with cap r `.08–.11`. Scale the mushroom item to 0.7 (cap ≈ 0.20 m, which also fits the 0.24 m pack cell).
  - Bush berries: use the item colours (`#4a1230→#8f2c56`) with `SphereGeometry(1,7,5)` at r .018.

**P1-12: Mid-ground pine repetition.**
- Evidence: `07-meadow.png`, `08-brook.png`, `valley-props.scene-asset.ts:548`.
- Fix:
  - Build three `valleyPine` variants:
    - tiers 4/5/6
    - baseRadius 1.3/1.6/1.9
    - height 5.0/5.6/6.4
    - seeds 3/9/17
  - Pick a variant by `hash(x,z)`.
  - Scale non-uniformly: sy .85–1.3, sxz .85–1.15 independently.
  - Bake two canopy tints (±8% value) so there are six prototypes.
  - Each prototype still lowers to one `InstancedMesh`, so this adds about 5 draws.

### P2

- **P2-1: Journal legibility and contrast.**
  - In `camp-journal.uikitml:170,215,227`, set `.jr-item-text` size `2.5 → 3.0` and colour `#8c9d8c → #a9b8a8` (≈6.3:1).
  - Set locked `.jr-recipe-*` and `.jr-page` colour `#6f7f72 → #8e9c8f` (≈4.6:1).
  - Or raise the panel scale from 0.8 to 0.9 in the scene JSON (the board is 1.42 m wide, so it fits).
- **P2-2: Hurt vignette intrudes too far** (`14-wrist-night.png`). Change `vignette-system.ts:33` to `smoothstep(0.62, 1.15, r)` and the default `flashStrength .85 → .6`.
- **P2-3: The lighter is too small to read in the pack** (`03-pack-trestle.png`). Scale `makeLighter` by 1.35 (case 0.049×0.068 m). Update `LIGHTER_TIP` from `.075` to `.101` in `fx-system.ts:9` and in the catalog.
- **P2-4: Broadleaf crowns merge with the meadow** (`07-meadow.png`). Paint crowns by normal in `valley-kit.scene-asset.ts:180`, reusing `paintByNormal`: top `#b4d65c`, side `#6d9a35`, under `#4a6f2a`. Optionally shift `grassB` from `0x9dcb46` to `0x93bf4a`.
- **P2-5: Bare GLB pine limbs** (`06-grove.png`). Darken the `pine-1`/`pine-2` branch material to `#5a4330` at load, or hide the lowest bare-branch meshes.
- **P2-6: Reeds sit on a mud "pancake"** (`world-brook-bridge.png`). Sink the base by 0.04 m and fade its rim to wet sand `#6f6250`.
- **P2-7: The brook has no wet edge.** Add a 0.25 m strip of `#dfe9ea` at 0.35 opacity, or vertex-paint the water mesh's bank-adjacent vertices lighter.
- **P2-8: The resin scar reads as a sticker** (`world-grove-resin.png`). Change the pale oval to amber-brown `#b7772c`, add a raised bark lip ring (r +0.02 m, `#4f3a2a`), and keep the drips.
- **P2-9: Roast meat grill marks are flat black bars** (`items.scene-asset.ts:684`). Use `#3a2212` at 0.004 m depth, indented rather than raised, and soften their ends by tapering.
- **P2-10: Delete the unused legacy prototypes** in `camp-props.scene-asset.ts:350-526`. They are built in both the runtime and editor realms on every import.
- **P2-11: The controllers do not match art.md's "stylized hands".** At minimum, tint the stock controller meshes to leather `#6e4b34` with brass `#c99a4a` accents. Longer term, ship a stylised gloved hand.
- **P2-12: Night ground stays too green** (`#2b4324`). This is mostly handled by the P1-7 moon and hemisphere changes. If it persists, lerp the terrain material's `color` multiplier to `#b8c4e0` by nightness. That is one uniform write in the throttled block.

---

## 4. Top 6 changes

1. **Make the fire the night's anchor (P0-1):** range 5.5 m, night-boosted intensity, a 3.2 m additive light-pool disc, a glowing pot underside, and a torch dimmer than the fire. One file plus one small draw.
2. **Night-proof the journal and sky (P0-2, P1-7, P1-8):**
   - Swap the journal to dim colours on phase change and add a board lantern.
   - Dim clouds at night.
   - Separate fog from the horizon colour; add a moon and stars.
3. **Fix the creature anatomy and ground them (P1-4, P1-5, P1-6):**
   - Wolf: canine leg angles, merged thigh, slimmer tail with the ember moved off the tip.
   - Deer: body lengthened by 0.2 m.
   - A blob shadow under every creature.
   - Re-shoot `13-night-wolf.png` with a wolf at 8–15 m.
4. **Facet the terrain (P1-3):** non-indexed ground, per-triangle colour jitter, flat shading and crisper trail edges. Together these match the moodboard ground.
5. **Replace the three silhouettes that read wrong (P1-1, P1-2, P1-10):** hammer peen and proportions, faceted fire-ring stones, rock steps at the Spire.
6. **Unify resources with items and break up the pines (P1-11, P1-12):** matching mushroom and berry art in the world and in the hand, and three pine variants with non-uniform scale and tint.

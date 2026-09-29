# Prometheus — Architecture (v2: full story arc)

Existing-app delta on the first playable (archived plan: `archive/first-playable/ARCHITECTURE.md`).
Keep the Vite plugin, `virtual:iwsdk-project`, the world config and the camp placement. Replace
the camp-* systems with the game systems below. Add no runtime npm dependencies.

## Ground rules (every stream)

- Three.js from `@iwsdk/core` only. `npx tsc --noEmit` must pass before hand-back.
- Queries, never entity arrays. No allocation in `update()`: scratch vectors are class fields.
  Use `signal.peek()` in update. Push every subscription teardown into `this.cleanupFuncs`.
- Vec3 component fields: read and write through `getVectorView`; `setValue` throws on them.
- Runtime instances: `const obj = await this.world.assets.instantiate(id)` →
  `this.world.createTransformEntity(obj)`. Remove with `entity.dispose({ disposeResources: false })`
  (plain `dispose()` frees shared prototype resources).
- The light count is fixed at startup: never add or remove lights at runtime.
- Asset modules are evaluated in two realms (runtime and editor): deterministic, no World/DOM.
- Scene JSON references manifest ids only. Components listed in `src/components.ts`.
- Sub-agents never start dev servers or install packages. The main agent owns `src/index.ts`,
  `src/components.ts`, `src/assets.ts`, `public/scenes/main.iwsdk.scene.json` and `iwsdk.config.json`.

## Shared contracts (main agent; stable, read-only for other streams)

| File | Contents |
| --- | --- |
| `src/game/components.ts` | Item, Airborne, Campfire, CraftBench, Backpack, ResourceNode, Creature, CreatureSpawn, Sentry, Page, Beacon, Bedroll, LostPack, FireVisual, GameState |
| `src/game/bus.ts` | typed `bus.emit/on/onAny`: every semantic event in the game. Requests: `spawn-item` |
| `src/game/catalog.ts` | item kinds → asset id, food/stew/fuel values, rest pose, tool tip offsets, variants |
| `src/game/recipes.ts` | bench recipes (bit = index), stew values/names |
| `src/game/story.ts` | PAGES, OBJECTIVES, ENDING, stage tables |
| `src/game/rules.ts` | camp geometry, survival/danger tuning, day cycle (`phaseAt`, `nightness`, `DAY`) |
| `src/game/terrain.ts` | `terrainHeight(x,z)`, `noise`, `smooth`, `LANDMARKS`, `WORLD_BOUNDS` (the world stream refines them; keys and signatures are stable) |

## Streams and file ownership

| Stream | Owner | Files |
| --- | --- | --- |
| Core gameplay | main | `src/game/systems/{item,backpack,campfire,crafting,gather,combat,survival,story,daynight,fx}-system.ts`, `src/game/save.ts`, `src/game/haptics.ts`, camp-props, camp-stage, camp-dressing |
| Items | items agent | `src/scene-assets/items.scene-asset.ts` (exports `itemAssets`) |
| World | world agent | `src/game/terrain.ts` (values), `src/scene-assets/woodland.scene-asset.ts`, `src/scene-assets/valley-*.scene-asset.ts`, `src/scene-assets/valley-assets.ts` (`valleyAssets`), `public/scenes/modules/valley*.iwsdk.scene.json`, `public/models/*` |
| Creatures | creature agent | `src/scene-assets/creatures.scene-asset.ts` (`creatureAssets`), `src/game/systems/creature-system.ts` |
| Audio | audio agent | `scripts/synth-audio.mjs`, `public/audio/*`, `src/game/audio-assets.ts` (`audioAssets`), `src/game/systems/audio-system.ts` |
| UI | UI agent | `public/ui/*.uikitml`, `src/game/ui-assets.ts` (`uiAssets`), `src/game/systems/{journal,wrist,toast,reader,vignette}-system.ts` |

The main agent merges `public/scenes/modules/*.json` nodes into `main.iwsdk.scene.json` and
registers each stream's record in `src/assets.ts` and its systems in `src/index.ts`.

## Systems (lower priority runs first)

| System | Pri | Queries | Purpose |
| --- | --- | --- | --- |
| DayNightSystem | −0.5 | GameState, Bedroll+Pressed | Clock, sun/moon, hemisphere, fog, dome, throttled IBL, sleep |
| ItemSystem | 10 | Item, Item+Grabbed, Airborne | Holder-hand bookkeeping, release dispatch to targets, ballistic drop/throw, resting, `spawn-item` |
| BackpackSystem | 11 | Backpack, Item slot pack-* | worn / held / unrolled, cells, shoulder anchor, lost-pack marker |
| CampfireSystem | 12 | Campfire, held Items | fuel, lighter/torch ignition, pot ingredients, stir, bowl dip, roasting, torch lighting |
| CraftingSystem | 13 | CraftBench, Items in bays, held hammer | recipe match, strikes, product spawn, recipe learning |
| GatherSystem | 14 | ResourceNode, held axe | chop deadwood, split logs on the stump, forage regrowth |
| CombatSystem | 15 | Airborne(damage), Creature, held spear/crossbow/torch/bolts, Sentry | projectile hits, thrusts, crossbow fire/reload, sentry aim/fire, torch contact |
| CreatureSystem | 16 | Creature, CreatureSpawn | spawn by day/night/stage, AI (graze/flee/prowl/stalk/telegraph/bite/retreat/dissolve), part animation, meat drops |
| SurvivalSystem | 17 | GameState, held food | hunger/health, eating at mouth, `hurt` events, death → drop, respawn, kill plane |
| StorySystem | 18 | GameState, Page, Beacon | pages, objectives, danger stage, beacon/ending, save/load, new game |
| FxSystem | 25 | FireVisual, Items(lit), Beacon | flames, fire light by fuel, held-light, stew/bowl visuals, beacon/echo glow, pack marker |
| JournalPanelSystem / WristHud / Toast / Reader / Vignette | 35–39 | GameState, Items | UI surfaces |
| AudioSystem | 40 | GameState, Campfire, Beacon | beds, positional loops, one-shot voices from bus events |

## Scene contract (`public/scenes/main.iwsdk.scene.json`)

| Node id | Components | Notes |
| --- | --- | --- |
| `game` | GameState | group node, singleton |
| `campfire` | Campfire, FireVisual | pot + fire; `CAMP.pot/fire` geometry |
| `crafting-bench` | CraftBench | bays `CAMP.slotOffsets`, pad `CAMP.work` |
| `supply-backpack` | Backpack | the unrolled mat; its roll handle is `pack-roll` (Item kind 'pack', OneHandGrabbable) |
| `camp-bedroll` | Bedroll, RayInteractable | sleep target |
| `held-light` | PointLight (intensity 0) | moved by FxSystem to the lit torch/lighter |
| `item-*` | Item {kind, uid}, OneHandGrabbable | uid = node id. Pages add Page {index} |
| resource nodes | ResourceNode | forage nodes spawn their `yields` at the node (± small offsets); deadwood needs 3 axe hits |
| creature anchors | CreatureSpawn | meadow deer/rabbits, wolf approach anchors (minStage) |
| `spire-beacon`, `*-brazier` | Beacon {role} | finale + echo braziers |

## Asset contracts

**Items** (`itemAssets`): one parentless prototype per catalog asset id. Origin at the grip
centre; long tools run along +Y toward the working end, matching `catalog.ts` `tip` offsets
(report any change). Named children: `torch-flame` (torch), `flame` (lighter), `raw`/`roast`
(meat), `bowl-contents` (stew-bowl), `kit`/`deployed` (+`turret`, `muzzle`) (sentry-kit),
`loaded-bolt` + `muzzle` (crossbow). Budget per item ≤ 1.5k tris, ≤ 4 draws.
**Creatures** (`creatureAssets`): 'deer', 'rabbit', 'wolf': origin at ground between the feet, facing
+Z. Named parts `body`, `head`, `leg-fl`/`leg-fr`/`leg-bl`/`leg-br` (pivot at the hip), `tail`,
and wolf `eyes` / `embers` (emissive, per-entity cloned material).
**Valley** (`valleyAssets`): ground (indexed, LocomotionEnvironment), environment batches split
by region for culling, landmark assets, resource-node visuals, beacon brazier (`beacon-flame`
child hidden by default), far-pine single-Mesh prototype for instanced patterns.

## Milestones

| M | Demo | Assertions |
| --- | --- | --- |
| M0 | first playable baseline (done) | tsc, 4 tests, runtime clean |
| M1 | Opening at camp: flick lighter → fire; stew in bowl → eat; torch via generic bays | S1, S2, S3 (ecs queries) |
| M2 | Backpack worn/unrolled; hunger/health; day/night + sleep; death → respawn with dropped pack | S5, S6, S7, S8 |
| M3 | Valley: grove, meadow/brook, outpost, spire; chop + forage; pages 3–7; save/load | S4, S13, S15, S17 |
| M4 | Creatures + combat: deer/rabbits, spear, crossbow, bolts, sentry, wolves by stage | S9, S10, S11, S12 |
| M5 | Finale + UI + audio: beacon ending, journal/wrist/reader/toasts, AudioDirector | S14, S16 |
| M6 | Review polish: fun, visual fidelity, intuitiveness, immersion, sound, story reviews applied | reviews recorded |
| Mfinal | Phase 6 full run | S1–S18 |

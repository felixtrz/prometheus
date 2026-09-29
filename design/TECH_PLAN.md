# Prometheus — Technical grounding (v2)

Authority: installed `@iwsdk/core` 0.5.3 declarations and JS, plus the `iwsdk reference`
corpus (ready). Domain evidence, signatures and snippets are in `grounding/`:
[input-interaction](grounding/input-interaction.md), [audio](grounding/audio.md),
[environment](grounding/environment.md), [entities-ui](grounding/entities-ui.md).
The first-playable grounding is archived in `archive/first-playable/TECH_PLAN.md`.

## World config (unchanged except where noted)

`xr.mode vr, offer once`, `canvasPointerEvents`, `locomotion {useWorker, snap turn,
browserControls}`, `grabbing: true`, `physics: false`, `spatialUI horizon`. The scene
root gains `environment.fog` (linear, colour matched to the dome equator).

## Mechanics → IWSDK

| Mechanic | Class | IWSDK pieces | Custom work | Risks |
| --- | --- | --- | --- | --- |
| Near grab/carry | BUILT-IN | OneHandGrabbable, Grabbed, GrabSystem.getHolderHand/forceRelease | Record the holder hand on qualify (null after release) | Removing OneHandGrabbable while held leaves the handle: forceRelease first |
| Drop/throw | CUSTOM | — (physics off, no hand velocity) | ItemSystem samples held world positions (4-frame ring), integrates Airborne gravity against `terrainHeight` + camp surfaces | Emulator gives no pose velocity; sampling works |
| Backpack worn/unrolled | CUSTOM | createTransformEntity, object3D reparenting | BackpackSystem: states, 3×3 cells, shoulder anchor from `this.camera` world pose | Follower is lazy, not rigid: don't use it |
| Trigger actions (lighter, crossbow) | BUILT-IN | `input.xr.gamepads[hand].getButtonDown/Pressed(InputComponent.Trigger)` | Map holder hand → gamepad | The trigger is free while holding (pointer locks on grab) |
| Haptics | CUSTOM | raw WebXR `gamepad.hapticActuators[0].pulse` | tiny helper | Unverified on device |
| Click bedroll (sleep) | BUILT-IN | RayInteractable + Pressed qualify | — | Works for mouse too |
| Respawn | BUILT-IN | `LocomotionSystem.setPlayerPosition(v)` | kill plane below y −5 | `player.position` writes are overwritten |
| Walk the valley | CONFIGURE | LocomotionEnvironment on the ground mesh | Boundary: tall invisible walls or steep terrain > 57°, indexed geometry | Capsule radius 0.5 m; walkable meshes need indexed geometry with matching attributes |
| Ground height | CUSTOM | — | `src/game/terrain.ts terrainHeight()` (analytic) | Must match the ground mesh exactly |
| Runtime items / creatures | BUILT-IN | `await world.assets.instantiate(id)` + `world.createTransformEntity(obj)` | ItemSystem.spawnItem; pool bolts | Dispose clones with `dispose({disposeResources:false})` or `destroy()`, never plain `dispose()` |
| Day/night sky | BUILT-IN + CUSTOM | DomeGradient / IBLGradient on `world.activeLevel.value` + `_needsUpdate` | DayNightSystem at priority −0.5: dome ~12 Hz during transitions only; IBL quantised 1/16 steps, ≥1 s apart | IBL rebuild allocates ~6 MB: never per frame |
| Sun/moon/fog | BUILT-IN | DirectionalLightComponent / HemisphereLightComponent (read every frame), `world.scene.fog` colour/near/far | Reuse the sun as the moon | Never change the light count (recompiles every material) |
| Fire/torch light | BUILT-IN | Campfire PointLight (in asset) + one `held-light` PointLight node created at start | FX moves `held-light` to the lit torch, intensity 0 otherwise | Fixed light count |
| Beacon/lantern glow | CUSTOM | per-entity cloned material, animate emissive | FxSystem | Don't dispose shared materials |
| Far forest | CONFIGURE | Scene pattern → InstancedMesh (bare single-Mesh prototype) | Procedural single-mesh far pine, sector patterns | GLB pines never instance: limit near GLBs |
| Audio beds + SFX | BUILT-IN + CUSTOM | AudioSource (positional default, preloaded by manifest id), AudioUtils | AudioDirector: 2 beds crossfaded by nightness, positional loops (fire, brook, beacon), fixed voice entities per clip | createOneShot leaks; pause without fade sticks; context resumes only on XR start |
| Journal / wrist / reader / toast | BUILT-IN | UIKitML assets, `world.assets.instantiate<UIKitMLAsset>`, setProperties | Pooled panels; the wrist panel is parented to `world.playerSpaceEntities.gripSpaces.left` | Class names are global: prefix per panel; setProperties allocates, so only call it on change |
| New game | BUILT-IN | `world.loadLevel(world.activeLevelId)` or reset in place | StorySystem resets state in place (simpler: no stale caches) | Cached scene objects go stale on reload |
| Save | CUSTOM | localStorage (no IWSDK helper) | `prometheus.save.v1`, stable uids | The managed browser profile is temporary: reload test only |
| Creatures | CUSTOM | createTransformEntity, queries | CreatureSystem (AI + procedural part animation) | Keep entity count small (≤ 12 creatures) |

Reinvention audit: grabbing, ray clicks, locomotion/teleport, audio spatialisation, the sky
dome and IBL all use built-ins. The custom pieces (ballistics, backpack, AI, day/night
driver) have no IWSDK equivalent while physics is off; physics was rejected for
predictability and Quest cost `[ASSUMED]`.

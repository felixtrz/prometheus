# Grounding — Environment, Lighting, Day/Night, Render Budget

IWSDK 0.5.3 (`@iwsdk/core` 0.5.3, `elics` 3.4.2, `super-three` 0.181.0). Every claim below
was checked against the installed `dist/**/*.js|d.ts` (rung 3) unless it is marked
**UNCONFIRMED**. Spec hooks: M16 day/night (day 5 min, dusk 30 s, night 2.5 min,
dawn 30 s), M17 sleep→dawn, M21 beacon + valley braziers relight, S17 hero views
≤ 200 draw calls and ≤ 250k triangles, art: no post-processing, no dynamic shadows.

---

## (a) Mechanic grounding table

| Mechanic | Class | Exact IWSDK pieces | Custom work | Risks |
| --- | --- | --- | --- | --- |
| Sky colour over the cycle (M16) | BUILT-IN + CUSTOM driver | `DomeGradient` {`sky`,`equator`,`ground`: Color RGBA, `intensity`: Float32, `_needsUpdate`: Boolean (default true)} on the **level root**; `EnvironmentSystem` (priority 0) queries `[DomeGradient, LevelRoot]` | `DayNightSystem` writes colours via `getVectorView`, then `setValue(DomeGradient,'_needsUpdate',true)` | `intensity` 0 is read as 1 (`getValue(...) \|\| 1.0`), so never animate it to 0. Darken the colours instead. The flag is cleared in a **microtask** after `await`, so a write made *after* EnvironmentSystem, on a frame where it just processed, is lost (see §c). Each update allocates 3 `Array.from` + 1 object for `userData`. |
| Ambient/reflection light over the cycle | BUILT-IN + CUSTOM cadence | `IBLGradient` (same fields) on the level root, which writes `scene.environment` | Same driver, **throttled** | Every `_needsUpdate` runs `PMREMGenerator.fromScene()`: a 6-face 256² cube render, a blur chain and a **new 768×1024 RGBA16F render target** (the old one is disposed). The new env texture identity forces `needsProgramChange` on every PBR material (`materialProperties.envMap !== envMap`). Per-frame use is too expensive. `intensity` is applied **twice** (gradient colours ×I and `scene.environmentIntensity = I`), so the effective value is I². It affects only MeshStandard/Physical materials. |
| Sun direction/colour/intensity | BUILT-IN + CUSTOM writes | `DirectionalLightComponent` (id `DirectionalLight`) on scene node `sun`; `LightSystem` (priority 0) re-reads **every frame** (`readLightSpec` plus a `JSON.stringify` signature diff) and needs no flag. The light emits along the node's local −Z, and `syncTransform()` runs each frame. | Write `color`/`intensity`, and rotate `sun` via `entity.object3D.quaternion` | Name trap: `DirectionalLight`/`PointLight` imported from `@iwsdk/core` are the **Three classes**. Use `DirectionalLightComponent` etc. Light colours are read as **sRGB** (`setRGB(...,SRGBColorSpace)`), although scene-format.md says linear. Built-in per-light per-frame stringify allocation, so keep the light count small. |
| Ambient fill | BUILT-IN | `HemisphereLightComponent` on node `ambient-fill` {`skyColor`,`groundColor`,`intensity`}. It ignores the transform (fixed world-up). | Lerp the colours and intensity | same as above |
| Moon | CUSTOM (reuse) | Reuse the **same** `sun` DirectionalLight, retinted and re-aimed at night | none beyond the palette | Adding or removing a light, or hiding a light's ancestor, changes the Three light hash (`state.version++`), which **recompiles every lit material** and causes a hitch. |
| Fog | CONFIGURE + CUSTOM tween | Scene JSON root `environment.fog`: `{type:'linear', color:'#rrggbb', near, far}` \| `{type:'exponential', color, density}`. `LevelSystem` installs `scene.fog` at level load (`applySceneEnvironment`). | Mutate `world.scene.fog.color/near/far` each frame (uniforms only) | Assigning a **new** `Fog` object or flipping null↔fog causes a program change for every `fog:true` material, so author it in JSON and mutate it. The gradient dome is a `ShaderMaterial` with no fog, so keep the fog colour equal to the dome's `equator×intensity`. Validation: linear `near < far`, colour `^#[0-9a-fA-F]{6}$`. |
| Tone mapping / exposure | CONFIGURE | Scene JSON `environment.toneMapping` (`none\|linear\|reinhard\|cineon\|aces`), `exposure` (≥0). Otherwise Three's default is `NoToneMapping`. | none (keep `none`) | `toneMappingExposure` does nothing under `none`. Changing the tone-mapping type at runtime recompiles. The dome shader has no tonemapping/colorspace chunk, so enabling tone mapping makes the sky and scene diverge. |
| Shadows | CONFIGURE (keep off) | `environment.shadows`, `environment.shadowMapType` (`basic\|pcf\|pcf-soft`) plus light `castShadow`/`shadowMapSize` | none | A light's `castShadow` does nothing unless `environment.shadows: true` (`renderer.shadowMap.enabled` is false by default). The spec says no dynamic shadows. |
| Render config | CONFIGURE | `iwsdk.config.json` `world.render`: **only** `fov`, `near`, `far`, `stencil`, `camera` (closed schema). Current values: near 0.03, far 160. | Keep `far` above fog `far` + margin | Foveation, framebuffer scale and frame rate are **not** in config (see the next row). |
| XR perf knobs | CUSTOM (tiny) | Three `WebXRManager`: `world.renderer.xr.setFoveation(0..1)` (default **1.0**, applied at session start), `setFramebufferScaleFactor(x)` (default 1.0, **pre-session only**, warns while presenting), `world.session?.updateTargetFrameRate(72\|90)` | Optional `visibilityState` subscriber | IWSDK sets none of these. Foveation is already at max by default. |
| Perf budget | none built-in | No IWSDK numeric budget exists. Spec S17 is ≤ 200 calls / ≤ 250k tris. Meta (native guidance): Quest 3 < 200 draw calls, < 1.5M tris; Quest 2 < 100 / < 750k at 13.8 ms. | Measure with runtime `scene_get_render_stats` / `browser_screenshot` | Browser/emulator numbers are not headset proof. WebXR adds browser overhead, so plan well under the native numbers. |
| Far pine belt (cheap) | BUILT-IN lowering + CUSTOM asset | A scene `pattern` whose prefab root is `{content:{type:'asset'}}` with no children, components or constraints **and** whose asset resolves to a bare `Mesh` with **0 children** is lowered to one `InstancedMesh` (`lowerPatternContent`) | New procedural single-Mesh far-pine asset (1 vertex-coloured material, so 1 draw call) | **GLTF assets never instance**: the registry returns `gltf.scene` (a Group). `pine-1.glb`/`pine-2.glb` are 1 mesh with 2 primitives, so a Group of 2 meshes: 2 calls and about 3.6–3.9k tris per placement. Today's 36 explicit pines are about 72 calls and 137k tris. Scatter ignores terrain height. InstancedMesh culls as **one** bounding sphere. Scene limit is 10 000 expanded instances. |
| Show/hide at runtime | BUILT-IN | `Visibility` {`isVisible`: Boolean=true} + `VisibilitySystem` (binds `object3D.visible` ↔ component), or plain `object3D.visible` | none | In scene JSON use node `"visible": false`. A `Visibility` entry in node `components` is **stripped** by the importer (`withoutIntrinsicVisibility`). Hiding a subtree that contains a light causes a recompile hitch. |
| LOD | NOT BUILT-IN | No IWSDK LOD component/system. Three `LOD` is re-exported from `@iwsdk/core` and auto-updates in `projectObject`. | Avoid. Use near GLB pines, a far instanced low-poly belt, and fog | LOD as a manifest prototype is **UNCONFIRMED** (clone, and bounds include all levels). |
| Lit beacons / braziers (M21) | CUSTOM | Asset-level `MeshStandardMaterial` `emissive`/`emissiveIntensity` | On `qualify`: `mesh.material = mesh.material.clone()` once per placement (the pattern already used in `camp-visual-system.ts`), then animate uniforms. Dispose the owned clone in `cleanupFuncs`. | Placements share prototype geometry and materials: mutating in place relights **every** instance. Never `entity.dispose()` a placed asset (it disposes the shared resources). Going from `emissiveMap` null to set recompiles, but colour and intensity changes don't. Don't add a PointLight per beacon. |
| Campfire glow | EXISTING | Raw Three `PointLight` inside the `campfire` prototype (`camp-props.scene-asset.ts:140`), animated in `CampVisualSystem` | Keep animating `intensity` only (0 is fine when the fire is out) | Never toggle `visible` or remove it. That changes the light count and recompiles. |

---

## (b) API cheat-sheet (installed signatures)

```ts
// all from '@iwsdk/core'
DomeGradient / IBLGradient : Component<{
  sky: Color /*RGBA*/; equator: Color; ground: Color;
  intensity: Float32; _needsUpdate: Boolean /*default true*/ }>
EnvironmentSystem            // priority 0; picks FIRST entity of [DomeTexture|DomeGradient, LevelRoot]
LevelRoot                    // marker; LevelSystem adds it to each loaded root
world.activeLevel: Signal<Entity>       // loaded root after World.create resolves
world.getSceneEntity(nodeId: string): Entity | undefined
world.requireSceneEntity(nodeId: string): Entity      // throws
world.getSceneObject<T extends Object3D>(nodeId): T | undefined
world.scene: Scene; world.renderer: WebGLRenderer; world.session?: XRSession

AmbientLightComponent     ('AmbientLight')     color=[1,1,1,1], intensity=1 (min 0)
HemisphereLightComponent  ('HemisphereLight')  skyColor=[1,1,1,1], groundColor=[.1,.1,.1,1], intensity=1
DirectionalLightComponent ('DirectionalLight') color, intensity, shadowCameraSize=10, + shadow set
PointLightComponent       ('PointLight')       color, intensity(cd)=1, distance=0, decay=2, + shadow set
SpotLightComponent / RectAreaLightComponent    (see light-components.js)
// shadow set: castShadow=false, shadowMapSize enum '256'|'512'|'1024'|'2048'='1024',
//             shadowBias=0, shadowNormalBias=0, shadowRadius=1, shadowCameraNear=.1, shadowCameraFar=100
LightSystem                  // priority 0, re-reads every light every frame

Visibility : Component<{ isVisible: Boolean = true }>
entity.getVectorView(C, key): Float32Array  // cached per entity; ONLY way to touch Color/Vec
entity.setValue(C, key, v)                  // THROWS on Vec2/3/4/Color; range-checks min/max
```

**Root environment edit (the minimal correct form):**

```ts
const root = world.activeLevel.value;              // or cache from a [DomeGradient, LevelRoot] query
root.getVectorView(DomeGradient, 'sky').set([0.02, 0.03, 0.07, 1]);
root.setValue(DomeGradient, '_needsUpdate', true); // scalar → setValue OK
```

Note: the `EnvironmentSystem` JSDoc example `root.setValue(DomeTexture, 'rotation', [...])` would
**throw** in elics 3.4.2 (rotation is a Vec3). Use `getVectorView`.

**Light edit (no flag needed):**

```ts
const sun = world.requireSceneEntity('sun');
sun.getVectorView(DirectionalLightComponent, 'color').set([1, 0.62, 0.38, 1]); // sRGB-interpreted
sun.setValue(DirectionalLightComponent, 'intensity', 0.9);                   // min 0 enforced
sun.object3D!.quaternion.setFromEuler(euler); // euler order 'YXZ': (−elevation, azimuth, 0); emits along −Z
```

**Fog (authored once in `public/scenes/main.iwsdk.scene.json`, root level, closed object):**

```json
"environment": {
  "fog": { "type": "linear", "color": "#9ecbdc", "near": 22, "far": 95 },
  "toneMapping": "none",
  "shadows": false
}
```

```ts
const fog = world.scene.fog as Fog;               // mutate, never replace
fog.color.setRGB(r, g, b, SRGBColorSpace);        // match dome equator×intensity (source-derived)
fog.near = 8; fog.far = 45;
```

**Far pine belt: one draw call.** The asset (new file, e.g. `src/scene-assets/far-pine.scene-asset.ts`)
must export a **parentless bare `Mesh`**. The project's own `paint()` + `batchStatic()` produces it
when every part shares one vertex-coloured material:

```ts
import { ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import { batchStatic, paint } from './static-batch.js';
const farPineMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 1 });
const src = new Group();
const trunk = new Mesh(paint(new CylinderGeometry(.08, .14, 1.2, 5), 0x4a3322), farPineMaterial);
trunk.position.y = .4;                      // pivot sunk ~0.2 m to hide terrain mismatch
src.add(trunk);
[[1.2, 1.1, 2.0], [2.2, .85, 1.7], [3.1, .6, 1.4]].forEach(([y, r, h]) => {
  const tier = new Mesh(paint(new ConeGeometry(r, h, 6), 0x2f4a2c, .15), farPineMaterial);
  tier.position.y = y; src.add(tier);
});                                          // ≈ 60 tris per tree
const farPine = batchStatic(src).children[0] as Mesh;
farPine.removeFromParent();                  // registry rejects parented prototypes
export default farPine;                      // register as 'far-pine' in src/assets.ts
```

Scene JSON (a prefab plus patterns; the prefab root must have **no** children, components or constraints):

```json
"resources": { "prefabs": [
  { "id": "far-pine", "root": { "id": "far-pine-root",
      "content": { "type": "asset", "asset": "far-pine", "castShadow": false, "receiveShadow": false } } }
] },
"nodes": [
  { "id": "far-pines-north", "framingRole": "support",
    "transform": { "position": [0, 0, -40] },
    "content": { "type": "pattern", "prefab": "far-pine",
      "distribution": { "type": "explicit", "transforms": [
        { "position": [-12.4, 1.8, 0.3], "rotationDeg": [0, 37, 0], "scale": 1.3 },
        { "position": [-9.1, 2.2, -1.7], "rotationDeg": [0, 112, 0], "scale": 1.1 }
      ] } } },
  { "id": "far-pines-east-ridge", "framingRole": "support",
    "transform": { "position": [34, 3, -20] },
    "content": { "type": "pattern", "prefab": "far-pine",
      "distribution": { "type": "scatter", "count": 180, "seed": 7,
        "algorithm": "pcg32-box-rejection-v1", "collision": "skip",
        "region": { "type": "box", "size": [10, 0, 60] },
        "variation": { "scale": [0.8, 1.5], "yawDeg": [0, 360] } } } }
]
```

- The scatter box is **centred on the pattern node**. `size[1]: 0` keeps it flat. Scatter is
  terrain-blind, so for the undulating valley floor prefer `explicit` with Y precomputed from
  `woodlandTerrainHeight(x,z)` (generate the list offline) and use scatter only on flat or
  hidden ridge bands.
- Split the belt into 4–6 sector patterns so each `InstancedMesh`'s single bounding sphere can be
  frustum-culled. Each sector costs 1 call.
- A pattern of the existing `pine-1`/`pine-2` GLBs **will not** instance. Keep those only as the
  ~6 near "identity" trees.

**Visibility:**

```ts
entity.object3D!.visible = false;                         // works with or without Visibility
entity.setValue(Visibility, 'isVisible', false);          // if the component is present
```

---

## (c) Recommended day/night implementation

**One CUSTOM system: `DayNightSystem`.** Register it with `{ priority: -0.5 }`, which runs after
built-in input/grab/physics (−5…−1) and **before** `EnvironmentSystem`/`LightSystem` (0). Written
values then apply in the same frame, and the async `_needsUpdate` clear race can't drop a
write. The existing app systems (15/25/35) run *after* EnvironmentSystem. If the driver is placed
there instead, never raise `_needsUpdate` on two consecutive frames.

Input: normalized cycle time from the game-state owner (a signal or component). Derive
`night ∈ [0,1]` with smoothstep across dusk and dawn: 0 through the 5 min day, a 30 s ramp,
1 through the 2.5 min night, and a 30 s ramp back. Also derive `sunElev`/`sunAz` across the day
arc. Sleep (M17) jumps time, so snap everything and **force** one IBL regen.

Cache on `qualify` (`this.queries.sky.subscribe('qualify', e => this.root = e, true)` with
`required: [DomeGradient, IBLGradient, LevelRoot]`, and `disqualify` clears it). Also cache the
`getVectorView` handles for `sun`/`ambient-fill`, a `YXZ` `Euler`, and a `Fog` reference in
`init()`. Lerp keyframe palettes into the cached `Float32Array` views with no allocation.

| Channel | What to lerp | Cadence | Cost |
| --- | --- | --- | --- |
| Sun (`sun` DirectionalLightComponent) | `color`, `intensity`; quaternion from (elev, az). At night swap to moon colour/intensity and a moon direction. | every frame (or 30 Hz) | uniforms only |
| Fill (`ambient-fill` HemisphereLightComponent) | `skyColor`, `groundColor`, `intensity` | every frame | uniforms only |
| Fog (`world.scene.fog`) | `color` (= dome equator×I, sRGB), `near`, `far` | every frame while `0<night<1` | uniforms only |
| Dome (`DomeGradient`) | `sky`, `equator`, `ground` (keep `intensity` ≥ 0.05, better fixed at 1) | ~10–15 Hz while ramping; none on plateaus | uniform setHex + small alloc |
| IBL (`IBLGradient`) | `sky`, `equator`, `ground` **only**. Keep `intensity` constant because the I² quirk makes animating it confusing. | quantize `night` to 1/16 steps, regen only when the step changes **and** ≥ 1 s has passed (≤ 16 regens per 30 s ramp, 0 on plateaus, never consecutive frames) | PMREM regen + env-texture swap: the expensive channel. On-device cost **UNCONFIRMED**, measure it. |
| Beacons/braziers | owned-material `emissive`/`emissiveIntensity` | every frame (flicker) | uniforms only |
| Campfire | existing PointLight `intensity` | every frame | uniforms only |

Starting palettes. `day` equals the current authored scene values. The others are **art
placeholders**, tune them in the headset:

| Key | Day (authored) | Dusk/Dawn | Night |
| --- | --- | --- | --- |
| dome sky / equator / ground | .10,.36,.68 / .62,.80,.87 / .32,.38,.20 | .20,.22,.45 / .95,.55,.32 / .22,.18,.14 | .012,.02,.05 / .04,.06,.10 / .015,.02,.015 |
| IBL sky / equator / ground (I=0.8 fixed) | .53,.68,.81 / .72,.77,.65 / .28,.34,.17 | .45,.40,.50 / .80,.55,.40 / .22,.20,.14 | .06,.08,.16 / .05,.06,.10 / .02,.025,.02 |
| sun colour / intensity | 1,.89,.72 / 1.7 | 1,.58,.34 / 0.9 | moon .55,.65,1 / 0.25 |
| hemi sky / ground / intensity | .69,.82,1 / .33,.40,.18 / 0.30 | .70,.55,.55 / .25,.22,.15 / 0.22 | .20,.25,.45 / .05,.06,.05 / 0.12 |
| fog near / far | 25 / 110 | 18 / 80 | 8 / 45 |

The warm fire against the cool night comes from the unchanged campfire PointLight and the emissive
flames, as the art direction asks. Adding no lights at night keeps the light hash stable, so no
recompiles occur.

Render budget plan: 1 directional + 1 hemisphere + the campfire point (plus at most 1
preallocated finale light at intensity 0), `toneMapping: none`, shadows off, fog-limited
view distance, and the far forest as 4–6 instanced sectors. Verify S17 with runtime
`scene_get_render_stats` at the hero/spawn views at day **and** night. It is a runtime (system-driven)
check, so use `browser_screenshot`, not `scene_screenshot`.

---

## (d) Evidence

- `node_modules/@iwsdk/core/dist/environment/{dome-gradient,ibl-gradient,environment-system}.d.ts|.js`:
  fields, `|| 1.0`, async `processBackground`/`processIBL` with post-`await` flag clear,
  `pmrem.fromScene` per IBL update, `environmentIntensity = intensity`, uniform-only dome update,
  `Array.from` userData.
- `node_modules/@iwsdk/core/dist/environment/gradient-environment.js`: colours ×intensity; the dome
  `ShaderMaterial` has no fog/colorspace/tonemapping chunks, `depthTest:false`, `renderOrder -1e9`.
- `node_modules/three/src/extras/PMREMGenerator.js:109-148,286-300`: `fromScene` size 256,
  `_allocateTargets()` 768×1024 HalfFloat per call.
- `node_modules/three/src/renderers/WebGLRenderer.js:2266,2322-2328`: program change on
  lights-hash version, `envMap` identity, fog identity. `renderers/webgl/WebGLLights.js:455-468`
  (hash/version). `WebGLRenderer.js:1742` (invisible objects and their lights are skipped).
- `node_modules/@iwsdk/core/dist/lighting/{light-components,light-system,light-binding}.js`:
  component ids/defaults/min, per-frame `readLightSpec` + `JSON.stringify`, sRGB `applyColor`,
  −Z aim, hemisphere world-up.
- `node_modules/@iwsdk/core/dist/init/world-initializer.js`: core registration order
  (Environment → Light → Level at priority 0), feature priorities, renderer setup (antialias,
  multiview, SRGB output, no tone mapping/shadows/foveation calls), `render` options used.
- `node_modules/elics/lib/world.js:29-45` (priority insert and tie order),
  `elics/lib/entity.js:50-125` (`setValue`/`getValue` throw on vectors; cached `getVectorView`).
- `node_modules/@iwsdk/core/dist/ecs/world.d.ts:139-146,265-266`: scene lookup API.
- `node_modules/@iwsdk/core/dist/level/level-system.js`: `activeLevel` swap, root `LevelRoot`,
  `applySceneEnvironment`. `level/level-scene-environment.js`: fog/toneMapping/exposure/shadows.
- `node_modules/@iwsdk/scene-composition/dist/types.d.ts:405-422` (`SceneFog`, `SceneEnvironment`),
  `schema.js:473-510` (closed env schema, hex colour), `validation.js:380` (near<far),
  `expansion.js` (scatter centred box, `MAX_SCENE_PATTERN_INSTANCES = 10000`).
- `node_modules/@iwsdk/core/dist/level/level-scene-object.js:205-252,345-351`: InstancedMesh
  lowering conditions. `asset/asset-manager.js` `instantiate()` returns `gltf.scene` for GLTF.
- `node_modules/@iwsdk/core/dist/level/level-scene-json-importer.js:131,149-154`: `Visibility`
  stripped from node components. `visibility/visibility.js`: `object3D.visible` binding.
- `node_modules/@iwsdk/core/dist/schemas/iwsdk-project.v1.schema.json` `$defs/render`
  (fov/near/far/stencil/camera only).
- `node_modules/three/src/renderers/webxr/WebXRManager.js:43-49,287-295,545,921`:
  foveation/framebuffer defaults and pre-session restriction.
- `public/models/pine-{1,2}.glb`: parsed with 1 mesh, 2 primitives, 2 materials, 3945/3644 tris.
- Project: `src/camp-visual-system.ts:33` (material clone-per-placement pattern, fire light
  intensity animation), `src/scene-assets/static-batch.ts` (`paint`, `batchStatic`),
  `src/index.ts` (app priorities 15/25/35), `.claude/rules/assets-and-manifest.md`.
- `npx iwsdk reference search/examples` for DomeGradient: only EnvironmentSystem internals, no
  SDK day/night example (so it is CUSTOM). Fog/LOD/foveation hits are all Three deps, not IWSDK.
- Meta docs: `documentation/web/webxr-perf-bp.md` (limit lights, avoid shadows, stagger updates),
  `resources/device-optimization-comparison.md` (Quest 3 < 200 calls / < 1.5M tris; Quest 2
  < 100 / < 750k; 13.8 ms at 72 Hz).

**UNCONFIRMED:** on-Quest cost of one IBL regen; whether the program re-acquire after an env swap
always hits the program cache (expected, since the key is unchanged); how the dome displays colours
(source says raw values, no sRGB conversion) and so the exact fog↔dome match, which needs a
`browser_screenshot`; whether UIKit panel materials take fog (they are near, so the impact is low);
LOD as a manifest prototype.

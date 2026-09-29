# Grounding — Entity lifecycle, runtime assets, UI panels, persistence

Installed: `@iwsdk/core` 0.5.3, `elics` 3.4.2, `@pmndrs/uikit` 1.0.76, `@drawcall/uikitml` 0.1.8,
`three` (super-three) 0.181.0. Everything below was checked against the installed
`node_modules/@iwsdk/core/dist/**` (d.ts and JS). Snippets in section (b) were typechecked with `tsc` against the
installed declarations (a scratch probe, strict mode, with negative `@ts-expect-error` checks). Items marked
**UNCONFIRMED** are inferred from source and still need a runtime check (`browser_screenshot`, `ecs_find_entities`).

## Corrections to curated docs (read first)

| Curated claim | Installed 0.5.3 reality | Evidence |
| --- | --- | --- |
| CLAUDE.md: "`entity.destroy()` leaks GPU memory, use `entity.dispose()`" | `dispose()` defaults to `disposeResources: true` and disposes **every geometry, material and texture in the tree**. Clones from `world.assets.instantiate` / `getGLTF` **share** these with the prototype and all other instances. For manifest clones, use `entity.dispose({ disposeResources: false })` (the same as `destroy()`). LevelSystem itself tears levels down with `destroy()`. UIKitML documents are disposed automatically either way. | `ecs/entity.js:64-69`, `ecs/world.js:61-78`, `level/level-system.js:179-186`, `.claude/rules/assets-and-manifest.md` |
| api-reference §7: System has `createTransformEntity()` | Exists at runtime (`ecs/system.js:69`), but it is **not declared** in `ecs/system.d.ts`, so `this.createTransformEntity()` is a TS error. Use `this.world.createTransformEntity(...)`. | tsc probe |
| api-reference: `import { signal } from '@preact/signals-core'` | Not a direct dependency of this app. `@iwsdk/core` re-exports `signal, effect, computed, batch, untracked, Signal, ReadonlySignal`. | `dist/index.d.ts` |
| CLAUDE.md: `setValue` on Color throws | IWSDK patches `setValue` for **Color** fields (it accepts hex number, `'#rrggbb'`, THREE.Color, or an RGB/RGBA array). **Vec2/Vec3/Vec4** still throw, so use `getVectorView`. | `ecs/entity.js` (setValueWithColorCoercion), `elics/lib/entity.js:71-80` |
| api-reference: "Supported AssetTypes: GLTF, Audio, Texture, HDRTexture" | `AssetType.UIKitML` also exists. Manifest entries may also be bare parentless `Object3D` prototypes. | `asset/asset-manager.d.ts:29-43` |

## (a) Mechanic grounding

| Mechanic | Class | Exact IWSDK pieces | Custom work | Risks |
| --- | --- | --- | --- | --- |
| Spawn items at runtime (meat drop M10, logs/planks M8, crafted products M7, bolts, forage respawn M9, stew bowl) | BUILT-IN + CUSTOM | `await world.assets.instantiate(id)` (Object3D prototype → `SkeletonUtils.clone`; GLTF → fresh `gltf.scene` clone), then `world.createTransformEntity(obj, { parent?, persistent? })` and `addComponent(OneHandGrabbable / RayInteractable / game comps)` | `ItemSpawner` helper: a stable string `itemId` component, per-kind component setup, optional pool | `instantiate` is **async** even for Object3D prototypes, so do not await inside `update()`; use `.then()` or pre-warm a pool. The clone allocates, so it is event-driven only. |
| Despawn (eaten food, consumed ingredients, burned fuel) | BUILT-IN | `entity.dispose({ disposeResources: false })` | release a pool slot, or dispose | The default `dispose()` frees **shared** prototype GPU resources. It causes a re-upload/recompile hitch and can break other instances. Entity objects are **pooled and recycled** by elics, so never keep an `Entity` reference after disposing it (check `entity.active`). |
| Look up scene-authored props (bedroll, pot, bench bays, brazier, journal) | BUILT-IN | `world.getSceneEntity(nodeId)` / `requireSceneEntity`, `world.getSceneObject<T>(nodeId)` / `requireSceneObject` | none | Lookups search only the **active level + player rig**, and only authored nodes (`userData.iwsdkSceneNodeId`). Runtime-spawned entities have no node id, so query them with your own id component. |
| Backpack 3×3 cells (M2) | CUSTOM on BUILT-IN parenting | `packEntity.object3D.attach(item.object3D)` (keeps the world pose; `Transform.parent` updates automatically through the parent setter hook) or `createTransformEntity(obj, { parent: packEntity })`; `Types.Entity` field for the back-reference | `PackSystem`: cell snap (local offsets), `StoredIn{pack: Entity, cell: Int8}`, and on grab of a stored item re-attach it to `world.activeLevel.value.object3D` | `OneHandGrabbable` has **no `detachOnGrab`** (only DistanceGrabbable does), so a grabbed stored item stays parented to the pack until you re-attach it. Grab handles do compensate for the parent matrix (`grab/handles.js:122-140`). `destroy` does **not** cascade: disposing the pack leaves child entities, which TransformSystem re-parents to the level root with a console warning. Dispose the children first. |
| Worn pack follows the player (M2) | BUILT-IN parenting + small CUSTOM | parent to `world.playerEntity` (persistent XR origin, moved by locomotion) with `persistent: true`, or `Follower{target: world.player.head, behavior: PivotY}` | yaw-follow of head (PivotY) if parented to `playerEntity` | Follower lerps with `tolerance`/`maxAngle` slack, so its feel for a worn pack is **UNCONFIRMED** |
| Wrist band (left controller) | BUILT-IN | **Option A (authored):** a top-level scene node with `"parent": {"type":"player-space","target":"left-grip"}` (targets `player, camera, head, left/right-target-ray, left/right-grip`), level-owned, found by `getSceneObject`. **Option B (code):** `createTransformEntity(hud, { parent: world.playerSpaceEntities.gripSpaces.left, persistent: true })`. Add `ScreenSpace` for a browser HUD, which moves back under the grip in XR. | `WristSystem`: text updates on change only | Transform offset/rotation relative to the grip needs runtime tuning (**UNCONFIRMED** values). Don't add `RayInteractable` to a display-only HUD, because the left ray would hover it constantly. Set `object3D.pointerEvents = 'none'`. When ScreenSpace has moved the document to the camera, `entity.object3D.visible = false` does **not** hide it, so hide via `hud.document.visible` or the root `setProperties({display:'none'})`. |
| Field journal (camp, world space) | BUILT-IN (exists) | scene node + `RayInteractable` + `requireSceneObject<UIKitMLAsset>` + `requireElementById` + `setProperties` | extend the existing `CampPanelSystem` pattern | UIKit class names and `#id` styles live in **one global StyleSheet** (`Object.assign(StyleSheet, ast.stylesheet)`, `ui/uikitml.js:104`). `.title`/`.row` in two .uikitml files collide, so prefix classes per panel (`jr-`, `wr-`, `pg-`, `ts-`). |
| Journal lists (recipes, pages n/7, objectives) | CONFIGURE | predeclared slots with stable ids in UIKitML, toggled with `setProperties({ display })` / `classList.add/remove` | slot binding code | Creating UIKit elements at runtime (`new UIKit.Text(...)` + `.add`) is **UNCONFIRMED**: `UIKitDocument` indexes ids at construction, so new elements are not reachable by `getElementById`. Use fixed slots. |
| Page reader (panel beside a held page) | BUILT-IN + CUSTOM | one pooled `instantiate<UIKitMLAsset>('page-reader')`, re-parented by `pageEntity.object3D.add(readerObj)` or `reader.setValue(Transform,'parent', pageEntity)`; `GrabSystem.getHolderHand(entity)` picks the side | `PageReaderSystem` on `Grabbed` qualify/disqualify for page entities | Whether a child panel becomes part of the page's grab/pointer surface is **UNCONFIRMED**. Set `readerObj.pointerEvents='none'`. Long text wraps inside a fixed `width`, but the layout cost of large text on Quest is **UNCONFIRMED**. |
| Toasts (1.4 m ahead, fade after 3 s, not head-locked) | BUILT-IN + CUSTOM | pooled UIKitML instances; place once from `world.camera.getWorldPosition/getWorldDirection`; fade with `root.setProperties({ opacity })` (an inherited uikit property) | `ToastSystem`: pool of 2–3, queue, timer, fade | Every `instantiate` re-parses the UIKitML AST and preloads fonts, so pool at init. `setProperties` allocates (object spread), so step the fade at about 10 Hz, not per frame. How opacity renders on text is **UNCONFIRMED**. |
| Damage / starving vignette | CUSTOM | a persistent entity parented to `world.playerSpaceEntities.head` (XR) or `world.cameraEntity` | vignette mesh/shader, intensity from signals | Camera/head-attached content in XR and browser parity are **UNCONFIRMED** (possible one-frame lag), so verify with `browser_screenshot` in XR. |
| Lost pack at the death spot (M15) | CUSTOM on BUILT-IN | `instantiate('backpack')` + `createTransformEntity` + re-`attach` carried items | `DeathSystem` | same dispose/cascade rules as the pack |
| Save / continue / autosave (M22, M17) | CUSTOM | none: **IWSDK has no storage helper** (the only `localStorage` use in core is the scene-understanding anchor UUID) | `SaveSystem`: `localStorage` JSON keyed by stable ids | See §Persistence: the managed dev browser uses a **temporary profile**. |
| "New journey" | BUILT-IN option or CUSTOM | **A:** `await world.loadLevel(world.activeLevelId)` (activeLevelId is `'./scenes/main.iwsdk.scene.json'`) reloads the scene JSON, destroys all `LevelTag` entities (authored + runtime non-persistent), re-applies the environment and the authored player transform, and keeps the XR session. **B:** in-place reset through `world.getSystem(X)?.reset()` (the current `CampSystem` pattern). | A: every system must re-resolve scene objects on `world.activeLevel.subscribe(...)` and reset persistent entities (wrist HUD, worn pack) by hand. B: a reset function per system. | A: systems that cache scene objects in `init()` (like `CampPanelSystem`) go **stale**. The load is staged, so **new entities qualify before old ones are destroyed** and "first entity of query" singletons can pick the old one. Expect an environment/IBL regen hitch. Avoid `location.reload()` in VR (it ends the session). |
| Shared game state (hunger, health, stage, day phase, objectives, bolts) | BUILT-IN | `signal/computed/effect` from `@iwsdk/core`, stored in `world.globals`; or a singleton state component (the existing `CampState`) | a typed accessor module (`game-state.ts`) | `world.globals` is untyped (`{[k:string]: unknown}`), so wrap it. Use `.peek()` in `update()`. |
| Pause on headset blur | BUILT-IN | `world.visibilityState` (`NonImmersive / Hidden / Visible / VisibleBlurred`), `system.stop()/play()` / `isPaused` | subscribe once in a controller system | — |
| Day/night sky (M16), level root access | BUILT-IN | `world.activeLevel.value` = level-root Entity; `setValue(DomeGradient,'sky', '#hex')` + `setValue(DomeGradient,'_needsUpdate', true)` | owned by the environment/day-night domain | Put environment components on the level root only. IBL regen cost per update is **UNCONFIRMED** (throttle it). |

## (b) API cheat-sheet (installed signatures)

### World (`ecs/world.d.ts`)

```ts
world.assets: RenderableAssetRegistry            // manifest-backed
world.assets.instantiate<T extends Object3D = Object3D>(id: string): Promise<T>
world.assets.has(id) / hasRenderable(id) / kind(id) / bounds(id)
world.createTransformEntity(object?: Object3D, parentOrOptions?: Entity | { parent?: Entity; persistent?: boolean }): Entity
world.getSceneObject<T extends Object3D = Object3D>(nodeId: string): T | undefined
world.requireSceneObject<T>(nodeId): T          // throws
world.getSceneEntity(nodeId: string): Entity | undefined
world.requireSceneEntity(nodeId): Entity        // throws
world.activeLevel: Signal<Entity>; world.activeLevelId: string
world.loadLevel(url?: string): Promise<void>;   world.loadSceneDocument(doc): Promise<void>
world.getActiveRoot(): Object3D;  world.getPersistentRoot(): Object3D
world.sceneEntity, world.playerEntity, world.playerHeadEntity, world.cameraEntity: Entity
world.playerSpaceEntities: { head; raySpaces:{left,right}; gripSpaces:{left,right}; indexTipSpaces:{left,right} } // all persistent Entities
world.visibilityState: Signal<VisibilityState>; world.xrEnabled: boolean
world.globals: { [key: string]: unknown }       // elics World
world.registerSystem(Cls, { priority?: number, configData?: Partial<config> }): this
world.getSystem(Cls): Sys | undefined; world.unregisterSystem(Cls); world.hasSystem(Cls)
world.onXRFrame(cb: (frame, delta, time) => void): () => void
```

`createTransformEntity` semantics (`ecs/world.js`): with no parent it goes under the **active level root** (or under the scene when `persistent: true`). Non-persistent entities get `LevelTag` and are destroyed on `loadLevel`. Every entity gets `Transform` + `Visibility`. `object3D.position/quaternion/scale/visible/parent` become synced accessors. Re-parenting through `parentObj.add(obj)` / `.attach(obj)` updates `Transform.parent` automatically (`transform/transform.js` parent setter).

### Entity (`ecs/entity.d.ts`, `elics/lib/entity.d.ts`)

```ts
entity.addComponent(C, initialData?) / removeComponent(C) / hasComponent(C)   // auto-registers C
entity.getValue(C, 'k') / setValue(C, 'k', v)   // Vec* → getVectorView(C,'k'); Color OK via IWSDK patch
entity.dispose(options?: { disposeResources?: boolean /* default true */ }): void
entity.destroy(): void                          // == dispose({ disposeResources:false })
entity.active: boolean; entity.index: number; entity.generation: number
entity.object3D?: Object3D                      // .pointerEvents = 'none' | 'auto' (pmndrs pointer-events)
```

```ts
// Spawn a manifest clone (Object3D prototype or GLTF) at runtime
const obj = await this.world.assets.instantiate('meat');
const e = this.world.createTransformEntity(obj);           // level-owned
e.object3D!.position.copy(dropPoint);
e.addComponent(OneHandGrabbable).addComponent(CampItem, { kind: 'meat' });
// Synchronous GLTF alternative (critical assets are preloaded before World.create resolves)
const pine = AssetManager.getGLTF('pine-1');               // fresh clone; { shared: true } = cached
// Despawn a manifest clone: keep shared GPU resources
e.dispose({ disposeResources: false });
```

```ts
// Parenting: stash in a pack cell, keep the world pose, then snap
pack.object3D!.attach(item.object3D!);                   // Transform.parent → pack
item.object3D!.position.set(cx, cy, cz);                 // local cell offset
// Take it out on grab
this.queries.held.subscribe('qualify', (it) => {
  if (it.hasComponent(StoredIn)) { this.world.activeLevel.value.object3D!.attach(it.object3D!); it.removeComponent(StoredIn); }
});
```

### UIKitML (`ui/uikitml-asset.d.ts`, `ui/document.d.ts`, `@pmndrs/uikit` Component)

```ts
class UIKitMLAsset extends Group {
  readonly assetId: string; readonly document: UIKitDocument;
  getElementById<T extends Component = Component>(id): T | null;
  requireElementById<T>(id): T;   dispose(): void;
}
UIKitDocument: getElementById, requireElementById, getElementsByClassName, querySelector(All),
               rootElement, setTargetDimensions(w,h), clearTargetDimensions(), computedSize, dispose()
Component (UIKit.Text etc.): setProperties(p) /* merges into inline props, allocates */,
               resetProperties(p), classList.add/remove, addEventListener('click', fn)
```

```ts
// Code-owned extra panel (manifest id registered in src/assets.ts as AssetType.UIKitML)
const hud = await this.world.assets.instantiate<UIKitMLAsset>('wrist-band');   // needs features.spatialUI (on)
const hudEntity = this.world.createTransformEntity(hud, {
  parent: this.world.playerSpaceEntities.gripSpaces.left, persistent: true,
});
hud.position.set(0, 0.03, 0.06); hud.rotation.set(-Math.PI / 2, 0, 0); hud.scale.setScalar(0.3); // tune: UNCONFIRMED
hudEntity.addComponent(ScreenSpace, { width: '360px', height: '180px', bottom: '20px', left: '20px', zOffset: 0.2 });
const hunger = hud.requireElementById<UIKit.Text>('wr-hunger');
hunger.setProperties({ text: '65 / 100' });               // only when the value changes
hud.document.rootElement.setProperties({ display: 'none' }); // hide in both XR and ScreenSpace
```

```jsonc
// Authored alternative: top-level scene node attached to the left grip (level-owned)
{ "id": "wrist-band", "parent": { "type": "player-space", "target": "left-grip" },
  "content": { "type": "asset", "asset": "wrist-band" },
  "transform": { "position": [0, 0.03, 0.06], "rotationDeg": [-90, 0, 0], "scale": 0.3 } }
```

- **Manifest id vs URL:** `world.assets.instantiate(id)` takes a **manifest id**. The legacy `PanelUI{config}` component accepts a URL or a manifest key (`AssetManager.loadUIKitML(urlOrKey)`), but the iwsdk-ui skill says not to use it for app panels, and its documents are not `UIKitMLAsset`s.
- **Clicks:** add `RayInteractable` to the panel entity (the InputSystem collects the descendants of `RayInteractable` entities). ScreenSpace documents are routed to canvas pointer events (`input/canvas-pointer-system.js:57`). `PokeInteractable` gives touch/poke.
- **ScreenSpace** (`ui/screenspace-component.d.ts`): `width,height,top,bottom,left,right: string` (CSS), `zOffset: number`. A number for a CSS field is a TS error. Outside XR the document is re-parented under `world.camera`; in XR it moves back to the entity.
- **Follower** (`ui/follow-component.d.ts`): `target: Object3D` (not an Entity), `offsetPosition: Vec3`, `behavior: FollowBehavior.FaceTarget|PivotY|NoRotation`, `maxAngle, tolerance, speed`.
- **Show/hide:** `entity.object3D.visible` is synced to the `Visibility.isVisible` component (queryable with `where: [eq(Visibility,'isVisible',true)]`). This does not work for a document under ScreenSpace (see above).
- **Fonts:** `@font-face { src: url(...) }` is resolved **relative to the .uikitml URL** (`ui/uikitml.js:27-39`), so local TTFs work: put them in `public/fonts/` and use `src: url("../fonts/DMSans-Regular.ttf")` from `public/ui/*.uikitml`. They load through UIKit's `TTFLoader` (MSDF generated in a worker, and the first load costs time). Offline bundled MSDF families (no network, no TTF) can be used directly as `font-family`: `inter` (default), `crimson-text, fira-code, inconsolata, lato, libre-baskerville, merriweather, montserrat, nunito, open-sans, playfair-display, poppins, raleway, roboto, source-code-pro, space-mono, work-sans` (`@drawcall/uikitml/dist/fonts.js`). `crimson-text`/`libre-baskerville`/`merriweather` suit a journal and pages.
- **Update ordering:** `PanelUISystem` (priority −3.8) ticks all UIKit documents. Text set at priority 35 lays out on the next frame, which is fine.

### Signals, globals, systems (`ecs/system.d.ts`, `elics/lib/world.d.ts`)

```ts
createSystem<S, Q>(queries?: Q, schema?: S)  // schema fields → this.config.<k>: Signal<T>
System members: world, queries, config, globals, player, playerEntity, playerHeadEntity, input, scene,
  camera, renderer, visibilityState, xrManager, xrFrame, cleanupFuncs, isPaused, priority,
  init(), update(delta,time), play(), stop(), createEntity()
```

```ts
import { signal, computed, effect, Signal } from '@iwsdk/core';
// index.ts, after World.create and before registerSystem
world.globals.game = { hunger: signal(65), health: signal(100), stage: signal(0), phase: signal('day') };
// in a system
const g = this.globals.game as { hunger: Signal<number> };
const h = g.hunger.peek();                               // hot path
this.cleanupFuncs.push(g.hunger.subscribe((v) => this.setText('wr-hunger', `${Math.round(v)}`)));
// commands between systems
this.world.getSystem(CampSystem)?.reset();
```

- **Priorities** (lower runs first; equal priorities keep registration order): Locomotion −5, Input −4, PanelUI −3.8, ScreenSpace −3.75, CanvasPointer −3.5, Grab −3, Physics −2, Transform/Visibility/Level/Environment/Light/Audio/Follow 0, XRLayer +1. App: input 0–9, sim 10–19 (CampSystem 15), visual 20–29, UI 30+ (CampPanel 35).
- `init()` runs synchronously inside `registerSystem`. `World.create` awaits the initial `loadLevel`, so scene lookups in `init()` work for the **first** level only.
- **Communication:** components + queries for per-entity state, tag components for one-shot events (the consumer removes the tag), signals in `world.globals` for global scalars and UI binding, and `world.getSystem(X)?.method()` for imperative commands. Config signals are for tuning.

### Persistence

- There is no IWSDK storage API, so use `localStorage` (synchronous, about 5 MB). Wrap it in `try/catch` (quota/private mode). Use a namespaced, versioned key (`prometheus:save:v1`) and `JSON.stringify` only on save events (sleep, objective, 60 s), never per frame. Save **stable ids** (scene node ids + your own `itemId` strings) and never entity indices, which are pooled and recycled. Never touch storage in `src/assets.ts`/`src/components.ts` (they are evaluated in the editor realm too).
- **Managed dev browser:** it is launched with Playwright `chromium.launchPersistentContext('')`. The empty user-data dir means a **temporary profile** (`@iwsdk/vite-plugin-dev/dist/index.js:19460`). `localStorage` survives page reloads (`browser_reload_page`) and in-place Vite restarts, but is **wiped when the managed browser is relaunched** (`dev down`/`dev up`). Headless mode uses a fresh `newContext` each launch. The editor stores its own keys in the same browser (and likely the same origin, **UNCONFIRMED**), so namespace yours. Verifying "continue" means saving, then `browser_reload_page`, then checking the restore. On Quest Browser, storage persists per origin (host + port).

## (c) Evidence

- `node_modules/@iwsdk/core/dist/ecs/world.d.ts` (World API) and `ecs/world.js` (createTransformEntity, getSceneObject traversal, release hook disposing `iwsdkDisposeAsset`/resources)
- `node_modules/@iwsdk/core/dist/ecs/entity.d.ts`, `ecs/entity.js` (dispose default, Color setValue patch); `node_modules/elics/lib/entity.js` (destroy, vector setValue throws), `elics/lib/entity-manager.js` (entity pooling), `elics/lib/world.d.ts`/`world.js` (registerSystem priority/init, getSystem, globals)
- `node_modules/@iwsdk/core/dist/ecs/system.d.ts` / `system.js` (System members; runtime-only `createTransformEntity`)
- `node_modules/@iwsdk/core/dist/asset/asset-manager.d.ts` / `.js` (RenderableAssetRegistry.instantiate, getGLTF clone, default `critical` preload)
- `node_modules/@iwsdk/core/dist/init/world-initializer.js` (UIKitML instantiate hook ~L600, system priorities ~L380-555, initial level load ~L136)
- `node_modules/@iwsdk/core/dist/transform/transform.js` (parent sync, default re-parent + warning)
- `node_modules/@iwsdk/core/dist/visibility/visibility.js` (visible ↔ Visibility)
- `node_modules/@iwsdk/core/dist/level/level-system.js` (staged loadLevel, destroy-based teardown, activeLevel), `level/level-scene-json-importer.js` (player-space attachments), `project/paths.js` (level URL `./scenes/...`)
- `node_modules/@iwsdk/scene-composition/dist/types.d.ts:354-405` (`ScenePlayerSpaceParent`, targets), `validation.js:429` (top-level only)
- `node_modules/@iwsdk/core/dist/ui/{uikitml-asset,document,uikitml,ui,screenspace,screenspace-component,follow-component,panel-components}.{d.ts,js}`
- `node_modules/@pmndrs/uikit/dist/components/component.js:258-271` (setProperties merge), `properties/inheritance.d.ts` (opacity inherited); `node_modules/@drawcall/uikitml/dist/fonts.js` (bundled font families)
- `node_modules/@iwsdk/core/dist/grab/handles.js:61,122-140`, `grab/distance-grabbable.js:110` (detachOnGrab only on DistanceGrabbable), `grab/grab-system.d.ts:379,404`
- `node_modules/@iwsdk/core/dist/input/state-tags.d.ts` (RayInteractable/PokeInteractable), `input/canvas-pointer-system.js:57`
- `node_modules/@iwsdk/core/dist/scene-understanding/scene-understanding-system.js:355` (only core localStorage use); `node_modules/@iwsdk/vite-plugin-dev/dist/index.js:19440-19470` (managed browser profile)
- `npx iwsdk reference search` (RenderableAssetRegistry.instantiate; no storage helper found), `npx iwsdk reference examples {"api_name":"createTransformEntity"}`
- Existing app patterns: `src/camp-panel-system.ts` (scene panel lookup, visibilityState, getSystem), `src/camp-system.ts` (`object3D.pointerEvents`), `public/scenes/main.iwsdk.scene.json` (`camp-journal` + `RayInteractable`)

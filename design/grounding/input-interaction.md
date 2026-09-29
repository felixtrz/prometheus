# Grounding — Input & Interaction (IWSDK 0.5.3)

Installed versions checked: `@iwsdk/core` 0.5.3, `@iwsdk/xr-input` 0.5.3, `@iwsdk/locomotor` 0.5.3, `iwer` 2.4.0 (emulator).
Signatures come from the installed `.d.ts` files (rung 3). Behavior claims come from the installed `.js` next to them.
Usage patterns come from `npx iwsdk reference search|examples|file` (rung 1). Anything not proven by those sources is marked **UNCONFIRMED**.

Project context (from `iwsdk.config.json`): `grabbing: true`, `physics: false`, `locomotion` on (`useWorker`, snap turn, `enableJumping: false`, `browserControls: true`), `spatialUI` on (so `Follower`/`FollowSystem` are registered), `input.canvasPointerEvents: true`, `handTracking: false`.

---

## (a) Mechanic grounding table

| Mechanic | Class | Exact IWSDK pieces | Custom work remaining | Risks |
|---|---|---|---|---|
| Pick up / hold / carry items (near) | BUILT-IN | `OneHandGrabbable` (+ `TwoHandsGrabbable` for two-handed), SDK-owned `Grabbed` tag, `GrabSystem` (priority -3). Grab = **squeeze**, sphere radius **0.07 m** around the grip space | None. Only game logic that reacts to `Grabbed` qualify/disqualify | Grab needs a raycastable `Mesh` in the subtree (dev warning otherwise). Invisible meshes are still grabbable, so use `object3D.pointerEvents='none'` to disable (camp-system already does this) |
| Which hand holds item X | BUILT-IN | `GrabSystem.getHolderHand(entity): 'left'\|'right'\|null` | Cache the result in the `Grabbed` **qualify** callback, because it returns `null` once released | Two-hand grab always reports `'left'`. A mouse/screen pointer reports `null` |
| Held item follows the hand's pose each frame | BUILT-IN | `this.player.gripSpaces[hand]` (`Group`), or `world.playerSpaceEntities.gripSpaces[hand]` (Entity) | None to read it. `getWorldPosition/getWorldQuaternion` into preallocated temps | Grip spaces update **only inside an XR session**. In the browser they stay at the rig origin |
| Pull the trigger while holding (lighter spark, crossbow fire) | BUILT-IN input + CUSTOM system | `this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)`, `getButtonValue` (analog), `getButtonUp`. While a grab is held the MultiPointer locks on the grab pointer, so the trigger does **not** click ray targets | A `ToolInputSystem` (priority > -4) that routes the holding hand's buttons to tool actions | Other-hand trigger still clicks RayInteractables. Right A = jump binding (jumping is disabled in this project) |
| Tool snaps to a canonical hand pose (crossbow aligned to controller) | CUSTOM | `OneHandGrabbable` keeps whatever grab offset the player picked up with. There is no "snap/attach pose" option (no `detachOnGrab`/`returnToOrigin` on one-hand) | A system running **after** GrabSystem (priority > -3) that overwrites `object3D` pose from `gripSpaces[hand]` × offset while `Grabbed`, then re-applies the last pose in the disqualify callback | **UNCONFIRMED at runtime**: the handle writes its own pose again on release (`outputState.end → apply`), so without the re-apply the item visibly jumps at release |
| Force-drop (death, reset, cutscene) | BUILT-IN | `GrabSystem.forceRelease(entity): void` (safe no-op if not held). `Grabbed` is removed on the **next** GrabSystem update | Wait one or two frames before resetting transforms (camp-system does `resetFrames = 2`) | Removing `OneHandGrabbable` does **not** remove the internal `Handle`, so a held item keeps following the hand. Always `forceRelease` first |
| Controller haptics | CUSTOM (thin wrapper) | No IWSDK haptic API (reference search found none). Use WebXR `StatefulGamepad.gamepad.hapticActuators[0].pulse(value, ms)` (typed by `@types/webxr`) | A tiny `pulse(hand, intensity, ms)` helper | Quest runtime support: **UNCONFIRMED here** (standard WebXR; IWER emulates it, recorded as `lastPulse`). Returns a Promise, so call it on events, not every frame |
| Throw / release velocity | CUSTOM (physics off) or CONFIGURE (physics on) | Physics off: nothing built in. Physics on: `features.physics: true` + `PhysicsBody{state: PhysicsState.Dynamic}` + `PhysicsShape`. PhysicsSystem drives a `Grabbed` body with `HP_Body_SetTargetQTransform`, so Havok carries the hand velocity on release. `PhysicsManipulation{linearVelocity}` is a one-shot override | Physics off: sample the held object's world position per frame (EMA or ring buffer in a component), then launch a custom ballistic `Projectile` on `Grabbed` disqualify | `XRPose.linearVelocity` is **not** provided by IWER, so velocity from poses cannot be emulator-tested. Physics-on throw feel is **UNCONFIRMED** (reading code only). Physics adds a roughly 2 MB Havok WASM |
| Telekinetic / remote pull | BUILT-IN | `DistanceGrabbable` + `MovementMode.{MoveTowardsTarget,MoveFromTarget,MoveAtSource,RotateAtSource}`, `returnToOrigin`, `detachOnGrab`, `moveSpeedFactor`, `targetPositionOffset`. Uses **trigger** via the ray | None | The three grabbable components are mutually exclusive per entity (one `Handle`). `movementMode`/`returnToOrigin`/`detachOnGrab` are read once, at handle creation |
| Click a plain 3D mesh (XR ray + desktop mouse) | BUILT-IN | `RayInteractable` (needs `Transform` → any `createTransformEntity`/scene node) → SDK adds and removes `Hovered`/`Pressed`. Mouse works through `CanvasPointerSystem` (enabled because `canvasPointerEvents: true`). Subscribe with `{required:[X, Pressed]}` qualify | None | Mouse forwarding stops during an XR session (`activeDuringXR: false`). `Pressed` is cleared on `pointerleave` too. `Interactable` is a deprecated alias |
| Desktop mouse on held items | Partly BUILT-IN | Mouse targets only `rayDescendants` = `RayInteractable` ∪ `DistanceGrabbable` | If desktop grabbing matters, use DistanceGrabbable for desktop or a custom pick | `OneHandGrabbable` is **not** mouse-targetable (it is only in `grabDescendants`). Adding `RayInteractable` too might allow a mouse drag via the handle: **UNCONFIRMED** |
| Keyboard fallback for game verbs | BUILT-IN | `this.input.keyboard.getKeyDown/getKeyPressed/getKeyUp(code)`, or `this.input.actions.addBindings([...])` + `getButtonDown(action)` to merge XR and keyboard bindings | Choose the key map | Actions have no per-hand query, so name them per hand (`tool.fire.right`) |
| Desktop mouse-look / keyboard turn | CUSTOM | `browserControls` gives WASD/arrows move (relative to camera yaw), Space jump, and browser-gamepad sticks. There is **no** mouse look and **no** keyboard turn | Copy the SDK example `examples/browser-first/src/mouselook.ts` (pointer lock, `player.rotateY`, camera pitch) | The project's browser camera sits at local `[0,2.25,4.3]` (third-person-ish). Decide FPS vs overview |
| Wrist HUD / item worn on a controller | BUILT-IN (parenting) | `world.createTransformEntity(obj, { parent: world.playerSpaceEntities.gripSpaces.left, persistent: true })`, or scene JSON top-level node `"parent": {"type":"player-space","target":"left-grip"}` | Choose the local offset/rotation | Only moves in XR (grip not tracked in the browser). Non-persistent children get a `LevelTag` and die on level change |
| Head-locked / tag-along HUD | BUILT-IN | `Follower{target, offsetPosition, behavior: FollowBehavior.{FaceTarget,PivotY,NoRotation}, maxAngle=30, tolerance=0.4, speed=1}` + `FollowSystem` (registered via spatialUI) | Tune `speed`/`tolerance`/`maxAngle` | Lazy follow: it only re-targets past 0.4 m or 30°, then lerps with `delta*speed` (overshoots if `speed*delta > 1`). **PivotY ignores the Y component of `offsetPosition`**. The first sync writes a world position into **local** `position`, so parent at scene/level root. `player.head` does not update outside XR, so target `world.camera` to work in both modes |
| Worn backpack (body-anchored, yaw-only) | CUSTOM (small) | Pieces: `player.head`/`camera` world pose, or Follower PivotY on an empty parent with the backpack as a child at local y offset (works around the PivotY Y-drop) | ~15-line `BodyAnchorSystem`: position = head + yaw-rotated offset, y = head.y − k | Follower lag may feel floaty for a worn object |
| Respawn at campfire | BUILT-IN + CUSTOM | `world.getSystem(LocomotionSystem)?.setPlayerPosition(v: Vector3)` updates the locomotor (immediate `position` copy + worker teleport) and `player.position`. Yaw: write `player.rotation.y` directly (TurnSystem uses `player.rotateY`) | Compensate the room-scale head offset and head yaw in XR. Call `forceRelease` on held items first | **Do not** write `player.position` while locomotion is on: `LocomotionSystem.update` overwrites it every frame from the locomotor |
| Fall-out-of-world detection | CUSTOM | The engine resets only when `y > 100` (to `(0,2,0)`). There is no lower bound | `if (player.position.y < KILL_Y) respawn()` | Without this, walking off the terrain edge falls forever |
| Invisible boundary walls | CONFIGURE | `LocomotionEnvironment{type:'static'}` on an entity whose subtree holds invisible meshes. `processEnvironment` traverses **all** meshes regardless of `visible`. The capsule-vs-triangle shapecast blocks the player | Author tall indexed boxes (or vertical planes) in a scene-asset | The top face of a box is a **teleport target** (valid if normal.y > 0.7), so make walls tall or use planes. Ray clicks are not blocked by walls (the ray only tests interactables) |
| Slopes / steps | BUILT-IN (fixed) | Walkable if the surface-normal angle is < `maxSlope = 1 rad` (≈57°). Capsule radius **0.5 m**, segment y 0.5→1.5. Ground probe starts +0.5 m and reaches 0.61 m. Not configurable (`LocomotorConfig` only exposes `initialPlayerPosition, updateFrequency, rayGravity, maxDropDistance, jumpHeight, jumpCooldown, useWorker`) | Author terrain under 57°. Keep passages ≥ 1 m wide | Max step height is **UNCONFIRMED** (no explicit step; the rounded capsule plus float spring probably climbs about 0.3–0.5 m ledges). Test in the emulator |
| Ground height under a point (item drops, spawn placement) | CUSTOM | No public query. `Locomotor.requestHitTest` is async and sits behind `private locomotor` | Best: evaluate the same analytic height function the terrain scene-asset uses. Fallback: `Raycaster` down against the ground mesh (Mesh.raycast is BVH-accelerated after `computeBoundsTree()`) | The BVH typings (`computeBoundsTree`, `firstHitOnly`) may not be visible to the app's tsc: **UNCONFIRMED**, may need a cast |
| Merging walkable geometry | CONFIGURE | `LocomotionEnvironment` merges every mesh under the entity with `mergeGeometries` | Put collision on a dedicated group of **indexed** geometries with the **same attribute set** | Mixed indexed/non-indexed geometry or differing attributes throws, and the SDK only logs `Failed to add environment to locomotion engine` (silent fall-through) |

---

## (b) API cheat-sheet

System members (from `ecs/system.d.ts`): `this.player: XROrigin`, `this.playerEntity`, `this.playerHeadEntity`, `this.input: InputManager`, `this.camera: PerspectiveCamera`, `this.world`, `this.scene`, `this.visibilityState`, `this.cleanupFuncs`.
Everything below is importable from `@iwsdk/core`, which re-exports `@iwsdk/xr-input` and `@iwsdk/locomotor`.

### 1. Grabbing

```ts
// grab/one-hand-grabbable.d.ts (defaults from .js)
OneHandGrabbable { rotate: Boolean=true; rotateMin: Vec3=[-Inf,-Inf,-Inf]; rotateMax: Vec3=[Inf,Inf,Inf];
                   translate: Boolean=true; translateMin: Vec3=[-Inf..]; translateMax: Vec3=[Inf..] }
// grab/two-hands-grabbable.d.ts — the one-hand fields plus scale: Boolean=true; scaleMin/scaleMax: Vec3
// grab/distance-grabbable.d.ts — the two-hand fields plus
//   movementMode: Enum=MovementMode.MoveTowardsTarget  ('MoveFromTarget'|'MoveTowardsTarget'|'MoveAtSource'|'RotateAtSource')
//   returnToOrigin: Boolean=false; detachOnGrab: Boolean=false; moveSpeedFactor: Float32=0.1
//   targetPositionOffset: Vec3=[0,0,0]; targetQuaternionOffset: Vec4=[0,0,0,1]
Grabbed  // tag, SDK-managed: added while handle.inputState.size>0, removed in GrabSystem.update
class GrabSystem {                     // config: useHandPinchForGrab: Boolean=false
  forceRelease(entity: Entity): void;
  getHolderHand(entity: Entity): 'left' | 'right' | null;
}
```
The limits are in the object's **parent** space (they feed `@pmndrs/handle` HandleStore options). The handle reads rotate/translate/limits live through vector views. DistanceGrabbable's mode fields are read once.

Holder hand plus per-frame grip pose. Store the hand in a component field, not a Map, per the project's query conventions:
```ts
export class HeldToolSystem extends createSystem({ held: { required: [Tool, Grabbed] } }) {
  private gripPos = new Vector3(); private gripQuat = new Quaternion();
  init() {
    const grab = this.world.getSystem(GrabSystem);
    this.cleanupFuncs.push(
      this.queries.held.subscribe('qualify', (e) => e.setValue(Tool, 'hand', grab?.getHolderHand(e) ?? 'none')),
      this.queries.held.subscribe('disqualify', (e) => { if (e.active && e.hasComponent(Tool)) e.setValue(Tool, 'hand', 'none'); }),
    );
  }
  update() {
    for (const e of this.queries.held.entities) {
      const hand = e.getValue(Tool, 'hand');
      if (hand !== 'left' && hand !== 'right') continue;
      const grip = this.player.gripSpaces[hand];            // Group; XR-only pose
      grip.getWorldPosition(this.gripPos); grip.getWorldQuaternion(this.gripQuat);
    }
  }
}
```
`Tool.hand` is a custom `Types.Enum` `{None:'none',Left:'left',Right:'right'}`.

### 2. Controller buttons while holding

```ts
// xr-input/dist/gamepad/stateful-gamepad.d.ts + stateful-button-axes-device.d.ts
this.input.xr.gamepads: Record<'left'|'right', StatefulGamepad | undefined>   // undefined outside XR / no gamepad
enum InputComponent { Trigger='xr-standard-trigger', Squeeze='xr-standard-squeeze', Touchpad='xr-standard-touchpad',
  Thumbstick='xr-standard-thumbstick', A_Button='a-button', B_Button='b-button', X_Button='x-button', Y_Button='y-button',
  Thumbrest='thumbrest', Menu='menu' }
getButtonPressed(id: string): boolean; getButtonDown(id): boolean; getButtonUp(id): boolean;
getButtonValue(id): number; getButtonTouched(id): boolean;
getSelectStart(): boolean; getSelectEnd(): boolean; getSelecting(): boolean;           // select = trigger
getAxesValues(id): {x:number;y:number}|undefined; getAxesState(id): AxesState|undefined;
getAxesEnteringUp/Down/Left/Right(id): boolean; getAxesLeavingUp/...(id): boolean;     // threshold axesThreshold=0.8
readonly gamepad: Gamepad; readonly inputSource: XRInputSource; readonly handedness: XRHandedness;
```
Quest Touch Plus layout (from `generated-profiles.js`): left has trigger, squeeze, thumbstick, x, y, thumbrest, menu. Right has trigger, squeeze, thumbstick, a, b, thumbrest.
The state is refreshed in `InputSystem.update` (priority -4), so read it from systems with priority > -4.

```ts
const pad = this.input.xr.gamepads[hand];
if (pad?.getButtonDown(InputComponent.Trigger)) this.fire(e, hand);           // crossbow shot
const squeeze = pad?.getButtonValue(InputComponent.Trigger) ?? 0;              // lighter: analog 0..1
if (pad?.getButtonDown(InputComponent.B_Button)) this.reload(e);               // right-hand face button
const stick = pad?.getAxesValues(InputComponent.Thumbstick);                   // {x,y} or undefined
```
Reserved by the defaults: left stick = move, right stick x = snap turn, right stick `AxesState.Down` (raw axis y > 0.8, which in WebXR means pulled toward the user; hold to aim, release to commit) = teleport, right A = jump (disabled here), squeeze = grab.

Keyboard/browser fallback (`input/stateful-keyboard.d.ts`, `input/input-actions.d.ts`):
```ts
if (this.input.keyboard.getKeyDown('KeyF')) this.fire(e, 'right');             // KeyboardEvent.code strings
// or one action that merges XR trigger and keyboard:
this.input.actions.addBindings([
  { source: 'xrGamepad', kind: 'button', action: 'tool.fire.right', handedness: 'right', button: InputComponent.Trigger },
  { source: 'keyboard',  kind: 'button', action: 'tool.fire.right', code: 'KeyF' },
]);
if (this.input.actions.getButtonDown('tool.fire.right')) { /* ... */ }
```
`InputActionManager`: `addBinding/addBindings/removeBinding/clearBindings/getBindings`, `getButtonPressed/Down/Up(action)`, `getAxis1D`, `getAxis2D(action, out?)`, `getAxis1DEnteringPositive/Negative(action, threshold?)`. Keyboard binding kinds are only `axis2d` and `button`, so there is no keyboard axis1d turn.
Browser gamepad: `this.input.browserGamepads[i]` (`StatefulBrowserGamepad`, `BrowserGamepadButton.South` etc.).

### 3. Haptics (no IWSDK wrapper)

```ts
// @types/webxr: interface Gamepad { readonly hapticActuators: readonly GamepadHapticActuator[] }
//               interface GamepadHapticActuator { pulse(value: number, duration: number): Promise<boolean> }
private pulse(hand: 'left' | 'right', intensity: number, ms: number): void {
  const actuator = this.input.xr.gamepads[hand]?.gamepad.hapticActuators?.[0];
  if (actuator) void actuator.pulse(intensity, ms).catch(() => {});
}
// e.g. this.pulse(hand, 0.8, 40) on a crossbow shot; this.pulse(hand, 0.3, 15) per flint strike
```
`lib.dom` also has `gamepad.vibrationActuator.playEffect('dual-rumble', {...})`. Its support on Quest Browser is **UNCONFIRMED**, so prefer `pulse`.

### 4. Player rig, poses, release velocity

```ts
// xr-input/dist/rig/xr-origin.d.ts
class XROrigin extends Group {
  readonly head: Group;                                   // updated only in XR (updateHead(frame, refSpace))
  readonly raySpaces / gripSpaces / secondaryRaySpaces / secondaryGripSpaces / indexTipSpaces: { left: Group; right: Group };
}
// ecs/world.d.ts
world.playerEntity; world.playerHeadEntity; world.cameraEntity;
world.playerSpaceEntities: { head; raySpaces:{left;right}; gripSpaces:{left;right}; indexTipSpaces:{left;right} } // Entities
```
- World pose: `this.player.gripSpaces.right.getWorldPosition(this.v)` / `.getWorldQuaternion(this.q)`. Aim direction = target-ray −Z: `this.dir.set(0,0,-1).applyQuaternion(rayWorldQuat)`.
- Viewer position in **both** XR and browser: `this.camera.getWorldPosition(this.v)` (camp-system already does this). `player.head` is frozen outside XR.
- If a controller has no gripSpace, the grip copies the ray pose.

Release velocity without physics (CUSTOM, allocation-free). `ThrowTrack` has `prev: Vec3`, `vel: Vec3`, `primed: Boolean`:
```ts
update(delta: number) {
  if (delta <= 0 || delta > 0.1) return;                        // ignore hitches
  for (const e of this.queries.held.entities) {                 // { required: [ThrowTrack, Grabbed] }
    e.object3D!.getWorldPosition(this.p);
    const prev = e.getVectorView(ThrowTrack, 'prev'), vel = e.getVectorView(ThrowTrack, 'vel');
    if (e.getValue(ThrowTrack, 'primed')) for (let i = 0; i < 3; i++)
      vel[i] = vel[i] * 0.5 + ((this.p.getComponent(i) - prev[i]) / delta) * 0.5;   // EMA
    prev[0] = this.p.x; prev[1] = this.p.y; prev[2] = this.p.z; e.setValue(ThrowTrack, 'primed', true);
  }
}
// held.subscribe('disqualify', e => { read vel → add custom Projectile; reset primed=false })
```
With physics (`features.physics: true`): `PhysicsBody{state: PhysicsState.Dynamic}` + `PhysicsShape` + `OneHandGrabbable`. While `Grabbed`, the body is driven by a Havok target transform and keeps its velocity on release. `PhysicsManipulation{force, linearVelocity, angularVelocity}` is a one-shot, auto-removed. `PhysicsSystem.setBodyTransform(entity, pose, opts?)` teleports a body.
`XRPose.linearVelocity` exists in the typings, but IWER's `XRFrame.getPose` never sets it, so it cannot be verified in the emulator.

### 5. RayInteractable + Hovered + Pressed (plain meshes, XR ray and mouse)

```ts
// input/state-tags.d.ts
RayInteractable, PokeInteractable, Hovered, Pressed   // Interactable = deprecated alias of RayInteractable
export class ClickSystem extends createSystem({
  clicked: { required: [Lever, Pressed] },             // Lever = your component on a RayInteractable mesh entity
}) {
  init() {
    this.cleanupFuncs.push(this.queries.clicked.subscribe('qualify', (e) => this.activate(e)));
  }
}
entity.addComponent(RayInteractable);                  // or scene JSON "RayInteractable": {}
```
- InputSystem query is `[RayInteractable, Transform]`. On qualify it builds a BVH for the subtree, sets `pointerEvents='auto'`, and wires `pointerenter/leave/down/up` → `Hovered`/`Pressed`.
- XR: trigger (select) on the right or left ray. Desktop: `CanvasPointerSystem` (priority -3.5) forwards DOM events from the canvas with `pointerType 'screen-mouse'` to `rayDescendants` only.
- Both paths create the same tags, so one system handles both.

### 6. Follower / attaching things to the player

```ts
// ui/follow-component.d.ts (defaults from .js)
FollowBehavior = { FaceTarget: 'face-target', PivotY: 'pivot-y', NoRotation: 'no-rotation' }
Follower { target: Object(Object3D, required); offsetPosition: Vec3=[0,0,0]; behavior: Enum=PivotY;
           maxAngle: Float32=30; tolerance: Float32=0.4; speed: Float32=1; needsPositionSync: Boolean=true; _followTarget: Vec3 }
entity.addComponent(Follower, { target: this.world.camera, offsetPosition: [0, -0.25, -0.7],
                                behavior: FollowBehavior.FaceTarget, speed: 8, tolerance: 0.15, maxAngle: 20 });
// scene JSON: "Follower": { "target": { "type": "player-space", "target": "camera" }, ... }  (resolved to object3D)
```
Rigid attach to a controller (wrist HUD, lighter holster):
```ts
const hud = this.world.createTransformEntity(hudObject, { parent: this.world.playerSpaceEntities.gripSpaces.left, persistent: true });
hudObject.position.set(0, 0.03, 0.08); hudObject.rotation.set(-Math.PI / 2, 0, 0);
// scene JSON top-level node: "parent": { "type": "player-space", "target": "left-grip" }
// targets: player | camera | head | left-target-ray | right-target-ray | left-grip | right-grip
```

### 7. Locomotion, respawn, walls, ground height

```ts
// locomotion/locomotion.d.ts
class LocomotionSystem { setPlayerPosition(position: Vector3): void; }   // config signals: slidingSpeed, turningMethod,
//   turningAngle, turningSpeed, comfortAssist, rayGravity, maxDropDistance, jumpHeight, jumpCooldown, enableJumping, ...
LocomotionEnvironment { type: Enum('static'|'kinematic') = 'static' }    // EnvironmentType.STATIC / KINEMATIC
```
Respawn (allocate the temps in `init`/fields):
```ts
respawnAt(x: number, groundY: number, z: number, yaw: number): void {
  const grab = this.world.getSystem(GrabSystem);
  for (const e of this.queries.held.entities) grab?.forceRelease(e);
  if (this.world.session) {                               // cancel room-scale offset + head yaw in XR only
    this.euler.setFromQuaternion(this.player.head.quaternion, 'YXZ');
    this.player.rotation.set(0, yaw - this.euler.y, 0);
    this.off.set(this.player.head.position.x, 0, this.player.head.position.z).applyQuaternion(this.player.quaternion);
  } else { this.player.rotation.set(0, yaw, 0); this.off.set(0, 0, 0); }
  this.target.set(x - this.off.x, groundY, z - this.off.z);
  this.world.getSystem(LocomotionSystem)?.setPlayerPosition(this.target);
}
// fall guard in update(): if (this.player.position.y < -20) this.respawnAt(...campfire)
```
Invisible boundary wall (scene-asset or code). The locomotor includes hidden meshes:
```ts
const wall = new Mesh(new BoxGeometry(40, 8, 0.4), new MeshBasicMaterial()); wall.visible = false;
wall.position.set(0, 4, -20);
// add to a group that carries LocomotionEnvironment (scene JSON "LocomotionEnvironment": {}) — BoxGeometry is indexed with position/normal/uv like other primitives
```
Ground height: prefer the terrain's own height function. Fallback raycast:
```ts
this.origin.set(x, 50, z); this.caster.set(this.origin, this.down); this.hits.length = 0;
this.caster.intersectObject(this.world.requireSceneObject('ground'), true, this.hits);
const y = this.hits.length ? this.hits[0].point.y : null;
```
Locomotor engine constants (`@iwsdk/locomotor/dist/core/engine.js`): capsule r=0.5, segment y 0.5→1.5, `maxSlope=1` rad, `floatHeight=0.01`, `maxWalkSpeed=3`, gravity 9.81, velocity cap 20. Reset only when `y>100`.

---

## (c) Evidence paths (all under `/Users/felixz/Projects/prometheus/node_modules/`)

- Grab: `@iwsdk/core/dist/grab/{one-hand-grabbable,two-hands-grabbable,distance-grabbable,grabbed,grab-system,handles,grab-helpers,grab-warnings}.d.ts/.js`
  - `grab-system.js`: handle init; `pointerEventsType` deny ray/grab; no Handle cleanup when a grabbable is removed.
  - `grab-helpers.js`: `findHolderHand` returns null when `inputState` is empty.
- Handle internals: `@pmndrs/handle/dist/store.js` (update applies only on move; `cancel`/`releasePointer` → `apply`).
- Grab radius: `@pmndrs/pointer-events/dist/pointer/grab.js` (`radius ?? 0.07`).
- Mouse pointer type: `@pmndrs/pointer-events/dist/forward.js` (`screen-` prefix).
- Input: `@iwsdk/core/dist/input/{input-manager,input-system,canvas-pointer-system,input-actions,state-tags,stateful-keyboard,stateful-browser-gamepad}.d.ts/.js`
- XR input: `@iwsdk/xr-input/dist/gamepad/{stateful-gamepad,stateful-button-axes-device,generated-profiles}`, `xr-input-manager.{d.ts,js}` (pose update only in session), `pointer/multi-pointer.{d.ts,js}` (priority touch>grab>ray; selection lock), `rig/xr-origin.{d.ts,js}`
- Haptics typings: `@types/webxr/index.d.ts:270-289`. Emulator: `iwer/lib/gamepad/Gamepad.js` (`pulse` records `lastPulse`), `iwer/lib/frameloop/XRFrame.js` (`getPose` has no velocity).
- Physics throw path: `@iwsdk/core/dist/physics/physics-system.js:~261` (`Grabbed` → `HP_Body_SetTargetQTransform`), `physicsManipulation.d.ts`
- World and rig: `@iwsdk/core/dist/ecs/{world,system}.d.ts`, `ecs/world.js` (`createTransformEntity` parenting), `init/world-initializer.js` (system priorities; `playerSpaceEntities`; spatialUI registers `Follower`/`FollowSystem`; `maintainScenePointers`)
- Follower: `@iwsdk/core/dist/ui/{follow-component,follow}.{d.ts,js}`
- Scene player-space parenting: `@iwsdk/scene-composition/dist/types.d.ts:354-382`, `@iwsdk/core/dist/level/{level-player-rig,level-component-applier}.js`
- Locomotion: `@iwsdk/core/dist/locomotion/{locomotion,locomotion-environment,teleport,turn,locomotion-input-provider}.{d.ts,js}`, `@iwsdk/locomotor/dist/core/{locomotor,engine}.{d.ts,js}`, `physics/{ground-detector,collision-handler,physics-utils}.js`
- BVH raycast patch: `@iwsdk/core/dist/runtime/three.js`
- Reference CLI (warm):
  - search "controller haptic pulse" → only `@types/webxr` hits, no SDK wrapper
  - search "ground height…" / "track controller velocity…" → no public API
  - examples `Pressed` → `examples/poke/src/robot.ts`, `examples/browser-first/src/feedback.ts`
  - file `examples/browser-first/src/mouselook.ts` → custom mouse-look pattern

## UNCONFIRMED (verify in the emulator or on device before relying on it)

1. Quest Browser honoring `hapticActuators[0].pulse()` (standard, and emulated by IWER; not tested on device here).
2. Snap-to-hand override: whether it looks clean at release.
3. Physics-on throw feel via the target-transform velocity.
4. Mouse drag of `OneHandGrabbable` when `RayInteractable` is also added.
5. Locomotion max step height.
6. BVH typings (`computeBoundsTree`, `firstHitOnly`) being visible to the app's `tsc`.
7. `vibrationActuator.playEffect` support.
8. `XRPose.linearVelocity` on Quest.

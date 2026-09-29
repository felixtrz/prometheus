# First Fire — verification

Follow-up: the [interaction video review](VIDEO_REVIEW.md) records all implemented interactions and the visual fixes made after this initial verification. Use its linked final clips for the current appearance and hammer behavior.

Verified 2026-09-16 against IWSDK 0.5.3 with the managed desktop browser, IWER Quest 3 controller emulation and an Apple M4 Pro GPU. This establishes the prototype's behavior in emulation; it does not establish native Quest frame rate or physical ergonomics.

## Checks

| Check | Result / evidence |
| --- | --- |
| `npx tsc --noEmit` | Passed before runtime testing and after implementation. |
| `npm test` | 4/4 passed: pot boundaries, matching material bays, stir angle wrapping/stationary/jump rejection, fire ignition volume. Tests transpile the actual pure TypeScript rules. |
| `npm run build` | Passed. Vite reported a large SDK bundle and upstream Zod PURE annotation warnings; no build failure. |
| Editable scene | Flat 56-node document; schema and capability validation passed; no diagnostics, dirty state or conflict. |
| Runtime | Ready, no runtime error, expected source/runtime hashes matched. Runtime screenshots separately confirm the application; editor rendering alone was not used to prove gameplay. |
| Ingredients | Near-squeeze grabs moved meat and mushroom; release inside the pot produced ingredient mask 3. |
| Stirring | A stationary spoon left stir progress unchanged; circular tip movement reached 4π and produced stew. |
| Craft placement | Stick, cloth and resin snapped into their respective bays. Cloth in the wrong bay returned home. Accepted material could not be grabbed again. |
| Hammer | Three lift/down strokes progressed 1 → 2 → 3 and revealed the torch. Holding the hammer down did not add strikes. |
| Ignition | Holding the torch head in the campfire lit it; the visible flame persisted after moving away. |
| Eating | Bringing the held bowl to the head set stewEaten and restored nourishment to 100. |
| Availability | Hidden torch could not be grabbed. Hidden/consumed items explicitly disable pointer events to account for SDK grab-handle lifetime. |
| Reset | Journal ray button cleared progress and returned supplies. Reset while holding the spoon released it and returned it to its home transform. |
| Movement | Left-stick motion moved the player about 1.19 m horizontally while staying supported by the walkable surface. |
| Journal | Isolated preview and in-world panel inspected; recipe guidance, progress, nourishment, XR controls and reset are connected. |

Interactions above used emulated controller poses and buttons, followed by ECS observations, rather than injecting completion state. Tests were pinned to the runtime tab; the managed workspace exposes editor and runtime clients with separate command targets.

## Evidence

- [Controller loop observations](verify/interaction-evidence.json)
- [Reset, movement and final scene state](verify/final-evidence.json)
- [Camp hero render](verify/camp-hero.png)
- [Runtime XR view](verify/xr-camp.png)
- [Runtime after movement](verify/xr-moved.png)
- [Journal preview](verify/journal.png)

The full cooking/crafting/eating loop was exercised before the final bowl staging adjustment and visibility-sample hardening. The final regression pass covered ingredient acceptance, hidden-item availability, reset while holding a tool, locomotion and scene/runtime readiness. Visibility-loss sample clearing was reviewed in code, not tested by deliberately interrupting a native headset session.

The final scene document hash is `sha256:8defcfc585b7efbefb047e185579b7c314e3c49f479327f5dfffccb751018ce5`; the runtime hash is `sha256:f997a9c0cb107816c5108328801c803af642ee2ec3febdab3bfd6d8bb9123d37`.

## Rendering and remaining work

The hero editor view recorded 172 draw calls and 195,133 triangles. The final editor state recorded 152 calls and 140,763 triangles from its current view, with zero shadow casters. These are view-dependent editor counts, including authored objects that gameplay may hide. They are not headset performance measurements. Static material batching, local pine GLBs and no dynamic shadows/postprocessing keep this first stage relatively simple.

Native Quest testing must still validate reach distances, grip/tool orientation, movement comfort and sustained frame time. The UI font currently loads from Google Fonts. The development screenshot tool emitted one nonblocking renderer-resize warning while XR was presenting.

This milestone intentionally uses recover-to-home releases instead of rigid-body drops. Backpack carrying/storage, persistence, gathering, hunger depletion, death, enemies and story remain outside this slice. The source GLTS assets are preserved; the runtime uses adapted geometry/materials plus a supply stand to keep items reachable.

# Round 2: code review (iwsdk-project-code-reviewer)

Static review of the round-2 changes. The reviewer ran `tsc` (clean) and `npm test` (52/52); no browser session, so frame figures are estimates. Saved by the orchestrator from the agent's report.

**Counts: 1 Critical · 7 Warning · 15 Suggestion.**

## Critical
- **C1: ItemSurface yaw sign.** `item-system.ts` `registerSurface` stores `yawDeg: -yaw / DEG`, but `groundAt` (and `rules.ts surfaceHeight`) expect `+θ`. Rotated props therefore get a footprint mirrored by 2θ. That covers 8 of 9 authored surfaces (outpost crate/table/box/barrel/stack, grove stump, brook rock, spire ledge). Items near their edges fall through, or hover over air. Fix: `yawDeg: yaw / DEG`, and add a node test with a rotated surface.

## Warnings
- **W1: always-live point lights.** held-light, beacon-light and fire-glow sit at intensity 0 but are still evaluated in every lit fragment, alongside the sun and hemisphere lights. Keep at most 2 dynamic point lights: move one "flame light" between the fire, the torch and the lighter, and drive the beacon with emissive+halo only. Don't toggle `visible` without pre-compiling the shader variants.
- **W2: saves capture held and airborne items mid-air** (`story-system.ts` save ~326–339, apply ~411–423). After Continue they float. Fix: in apply, `launch()` any unsupported loose item; or project held and airborne items onto the ground when saving.
- **W3: `grabbing: true` is unused** (`iwsdk.config.json`), so GrabSystem and the handle patches still run. Set it to false, then re-verify the ray UI.
- **W4: first-use shader compile stalls** on the hover outline, the shade `ShaderMaterial`, the vignette and the sentry lamp/halo/tip materials. Fix: `renderer.compileAsync` a warm-up group after level load.
- **W5: per-frame allocations and hot getters.**
  - backpack: `shoulderAnchor()` returns an object; the `mat`/`handle` getters iterate every frame.
  - story: the `state` getter; `runEnding` builds arrays and closures every frame.
  - start: an iterator plus a redundant clock write.
  - combat: Map destructuring in `update`.
  - gather/combat: `getSystem` calls every frame.
- **W6: `playwright` is imported by `vite.config.ts` but not declared.** It is only hoisted from vite-plugin-dev. Add it to devDependencies (^1.58.2).
- **W7: `StartSystem.sequence` has no timeout.** A hung `loadLevel` freezes the world with no recovery. Fix: race it against 15 s; on failure, toast, return to `waiting` and show the panel again.

## Suggestions (summary)
- **S1:** cap runtime `rt-` items (~120; tree harvests add up; elics capacity is 1000).
- **S2:** the inverted-hull outline cracks on flat-shaded items. Use welded, smoothed shell normals, or scale about the centre.
- **S3:** `candidate()` calls `getWorldScale` per item per hand every frame. Cache the scale, and pre-cull with the last `matrixWorld` translation.
- **S4:** the shade is transparent DoubleSide, so 3 draws with overdraw. Try `forceSinglePass`; replace `noise3` with a texture lookup.
- **S5:** the guide stalls if the shade fails to load (fade never rises). Treat a missing root as shown; dispose the cloned embers geometry; fix the analyser disconnect.
- **S6:** voice clips depend on generate.drawcall.ai, and zod/sha256 end up in the runtime bundle. Precompute URLs, vendor the clips into `public/audio` for release, and gate `resolveClips` to DEV.
- **S7:** stale pooled Entity refs (combat bolts map, gather forage map, item pendingDispose). Compare `generation`, or use tag components.
- **S8:** async spawns can land in a new level across a `loadLevel` swap. Guard with the `activeLevel` captured before the await.
- **S9:** `parseSave` is shallow, so `applySave` can half-apply. Validate each entry; use a try/catch per section.
- **S10:** `bus.emit` has no per-listener try/catch.
- **S11:** the CDP port is on by default (make it opt-in); vitexec meta on the LAN; add a tsconfig for `vite.config`, `tests` and `vitexec`.
- **S12:** GameState has 13 fields (consider splitting).
- **S13:** gather builds trunks lazily on the first swing; `armed`/`splitHits` are never pruned.
- **S14:** the ending theme and stingers keep playing after `new-game`.
- **S15:** held-item release relies on the button-up edge. Use a level-based check (`!getButtonPressed`) and release on blur.

## Verified fine
- dispose semantics (`disposeResources:false`; no `destroy`)
- persistent panels don't duplicate across resets
- per-entity maps cleaned on disqualify/level change
- the InstancedMesh trunk reading is correct
- the vitexec plugin is inert in `vite build`
- no `from 'three'` imports, no `scene.add`/`Raycaster`/raw loaders
- `.peek()` in `update`

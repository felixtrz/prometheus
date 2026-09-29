# Round 3: code re-review (iwsdk-project-code-reviewer)

Static review. The reviewer confirmed:
- `tsc` is clean and 76/76 tests pass.
- `vite build` succeeds: main chunk 6.97 MB (1.83 MB gzip).
- `@drawcall/generate` and `@noble` are absent from the bundle.

The orchestrator saved this from the agent's report.

**Critical: none.**

## Round-2 findings

| Status | Findings |
|---|---|
| Fixed | C1, W1, W2, W3, W6, W7, S1, S3, S4, S5, S9, S10, S13, S14, S15 |
| Mitigated | S2 (outline cracks) |
| Partly fixed | W4 (shader warm-up), W5 (per-frame lookups), S6 (voice host and resolve), S7 (`pendingDispose` and gather forage generation), S8 (`spawnItem` and gather level guard) |
| Unchanged | S11 (CDP opt-in, tsconfig coverage), S12 (GameState fields) |

## Warnings
1. **CreatureSystem never sees DayNightSystem.** Creature is registered before DayNight, and `init()` runs inside `registerSystem`, so `daynight` stays undefined. As a result the finale darkness never reaches the wolves' glow. Fix: look it up lazily in `update()`, or register DayNight first.
2. **FxSystem pushes material-dispose closures into `cleanupFuncs` on every level load** (`captureFire`, `captureBeacon`). The previous level's clones stay pinned, and the `spire-eye` clone is never disposed. Fix: keep the clones per level and dispose them on disqualify and on level change.
3. **Shader warm-up is still partial.** These materials compile on first use: ground glow, flames, torch flame, beacon flame and halo, spire eye, lost-pack beam, the sentry lamp/halo/tips, and the instanced pines. Fix: call `renderer.compileAsync(world.scene, world.camera)` after the level activates (after `instancePines`) and on XR sessionstart. It traverses hidden objects too.
4. **Per-frame `getSystem` calls and singleton lookups** in gather :180, campfire :209, fx :324, guide :1191, daynight :268, crafting :39/108 and creature :301. Fix: cache them lazily (`??=`), or use qualify/disqualify subscriptions.

## Suggestions
1. Finale guardians dissolve at dawn if the hold crosses into dawn. Exempt guardians from the dawn dissolve.
2. `pendingDispose` should check generation. `spawnItem` and the gather spawn should guard against a level swap.
3. The gather forage spawn has no `.catch`/`.finally`, so a rejection stalls the node for good. The `spawn-item` handler and `dropAt` have the same gap.
4. Journey-scoped flags survive New journey:
   - campfire: `warned`, `lowFuelWarned`, `smotherAnnounced`
   - combat: `emptyHints`, `sentryEmptyTaught`
   - creature: `pendingAt` keys
   - item: `sampleCount`

   Fix: reset them on `journey-begin` or on level change.
5. StartSystem: a second choice made after a timeout can start a second `resetWorld` while the first is still running. Track one in-flight reset.
6. The restored pack can be re-laid late, from an async spawn's `.then`. Fix: `Promise.all` the spawns, then call `pack.load` once, before `journey-begin`.
7. `StorySystem.save()` runs JSON and `localStorage` on the frame thread. Coalesce the writes with `requestIdleCallback`.
8. Small allocations:
   - `ParticlePool.emit` allocates a jitter closure per particle.
   - The per-frame `beacon` event during the hold should be throttled.
9. The outline comment says the 1.03× scale is about the mesh centre; it is about the mesh's origin. Fix the comment, or scale about the bounding centre.
10. Voice clips: gate `resolveClips` to DEV, and vendor the clips into `public/audio` for release.
11. Tooling:
    - make the CDP port opt-in
    - add a tsconfig for `vite.config`, `tests` and `vitexec`
    - the playwright monkey-patch is fragile (dev-only)
12. Unit-test the oriented footprint maths from `registerSurface` as a pure function (a C1 regression guard).

## Verified fine
- The audio pool's `_buffer` swap works with IWSDK 0.5.3's AudioSystem timing.
- The footstep rig-only travel and the shared heartbeat phase are correct.
- The reach-cache bound is valid.
- `unify()` is sound.
- The guide's threat-gate requeue works.
- Safe bus dispatch is in place.
- The start `stop()`/`play()` pairing is correct.
- The asset manifest is pure.
- `.peek()` is used in update paths.

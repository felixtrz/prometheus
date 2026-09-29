# Round 4: code re-review (iwsdk-project-code-reviewer)

The orchestrator saved this from the agent's report.

**Checks:**
- `tsc` clean, including `tsconfig.tools.json`.
- 91/91 tests pass.
- `vite build` succeeds: main chunk 7.00 MB (1.84 MB gzip), with no `@drawcall`/`@noble` in the bundle.
- Framework rules hold (no `three` imports, no `scene.add`, no `destroy`). Feature flags match the scene.

**Critical: none. Warning: 1** (fixed by the orchestrator after the review). **Suggestions: 14.**

## Round-3 findings
- **Fixed:** W1 (DayNight first), W2 (per-owner clones), W3 (compileAsync warm-up), S1, S2, S4, S5, S6, S7, S8, S9, S12.
- **Partly fixed:**
  - W4: guide `getSystem` per frame and fx `getObjectByName` per frame. The guide lookup is now cached by the orchestrator.
  - S3: the `spawnItem` try/catch is now added by the orchestrator.
  - S11: CDP is still default-on; `tests/*.mjs` are untyped.
- **Not fixed:** S10 (voice clips load from generate.drawcall.ai in production).

## Warning (fixed)
1. The guide's beacon-slip state (`beaconPeak`/`beaconLast`) survived New journey. A fresh journey could hear "Let go and it cools…" before touching the brazier. Fix applied: reset both on `new-game` and `journey-begin`.

## Suggestions
1. Unhandled rejections in the item spawn paths. **Applied:** a try/catch in `spawnItem` covers every caller.
2. Gather retries a failing forage node every 0.5 s. Back off to ~10 s with a `retryAt` map.
3. Per-frame `getSystem` in guide `animate()`. **Applied** (cached). Journal and wrist do it at 5 Hz.
4. Per-frame `getObjectByName` for torch flame, lighter flame and loaded bolt in fx. Cache them per entity.
5. `groundShadow` makes ~95 `terrainHeight` calls per frame with ~19 creatures. Skip it for stationary wolves, or refresh every 3rd frame.
6. Creature slot state (`attackers`, `pincerWolves`…) should also reset on level swap. `liveNightWolves()` is dead code, and `stats` is not reset per journey.
7. A `warmShaders` sync throw would escape `update`. **Applied:** try/catch.
8. Flame-tip constants are duplicated in story, fx and campfire. Import them from the catalog.
9. Voice clips come from generate.drawcall.ai in production. Gate `resolveClips` on DEV and vendor the clips into `public/audio` for release, or accept the dependency.
10. Debug globals (`__prometheusGuide`, `__prometheusAudioLog`, `__prometheusAudioState`) ship in production. Gate them on DEV.
11. Seed `reduceFlashes` from `prefers-reduced-motion`. **Applied.** Add a unit test for `settings.ts`.
12. Well-fed is not saved across Continue. Keep as a design choice, or persist it.
13. Tooling: make the CDP patch opt-in; `tests/*.mjs` and `scripts/*.mjs` are outside the tools tsconfig.
14. GameState has 13 fields. Consider splitting.

## Verified sound
- creature press and pincer state machines, and the generation guards
- story `beaconRate`, async `applySave`, coalesced saves, stats and epilogue
- start single in-flight reset
- sentry lead and spread
- survival haptic side maths and well-fed lifecycle
- daynight shaken sleep and finale dark
- fx owner-keyed clones and beacon shader flames
- vignette reduce-flashes unsubscribe
- toast subtitle placement
- guide repositioning and stale cut
- journal settings, stats and epilogue ids
- audio stride, voiced duck and hand-positioned voices
- item generation-checked dispose, level guard and footprints
- `settings.ts` and `surface-math.ts`
- `index.ts` locomotion wiring

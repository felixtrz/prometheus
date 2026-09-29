# Prometheus — First Fire: Handoff

*2026-09-29. A Quest 3 VR survival game built on IWSDK 0.5.3 (Immersive Web SDK). Three.js comes via `@iwsdk/core`.*

You wake beside a cold fire in a valley whose every flame went out. The loop:
- relight the camp;
- cook, craft (torch, spear, crossbow, bolts, sentry) and survive the Hollow wolves at night;
- read the lost expedition's seven pages;
- carry fire to the Spire beacon and hold it against the guardians.

Prometheus' shade, an ember-lit ghost, speaks the first-time guidance. A run takes about 20–30 minutes.

## Status at handoff

| | |
|---|---|
| Typecheck (`npx tsc --noEmit`, `npm run typecheck:tools`) | clean |
| Unit tests (`npm test`) | 94 / 94 pass |
| Gameplay scenarios (`npm run check`, vitexec) | **6 / 6 PASS, 98 checks** on this exact state (see Scenario results) |
| Production build (`npm run build`) | succeeds, 21 MB `dist/` |
| Judge scores (round 4, `design/reviews/round-4/`) | visual 9, gameplay 8, story 9, progression 8.4, immersion 9 (8 as heard), code 0 Critical |
| Spec success criteria S1–S18 | all PASS (`design/VERIFICATION.md`), except that the guide voice is pending |

**Iteration 3 was stopped mid-flight** at the user's request. Its partial changes are in this commit; they typecheck and pass the unit tests. What landed:
- **Balance:**
  - `FINALE.graceSeconds` 1 (a jab with the beacon torch is free);
  - finale `waveSizes` [2, 3, 5];
  - `pincerStagger` 0.35 s;
  - a stronger post-death relight (`SURVIVAL.respawnFuelSmother`).
- **Guide:** the torch line is split into `torch` + `torch-lit`, with related text tweaks in `voice-lines.ts` and `story.ts`.
- **Visual:** part of the brazier/beacon fuel-bed rework in `valley-props.scene-asset.ts`, and `fx-particles.ts`.
- **Orchestrator:**
  - a `turn: 'snap' | 'smooth'` setting wired into locomotion (`src/index.ts`);
  - `tests/settings.test.mjs`;
  - a wider hover rim for sheet items such as pages (`item-system.ts`).

Not done from iteration 3:
- a turning chip in the comfort UI (the setting exists, but no UI writes it yet);
- the shade kept inside the headset FOV;
- the subtitle following while walking and avoiding the journal;
- subtitles-off hints;
- the simmer loop;
- the single-beckoning-item rule;
- signpost pictograms;
- the Spire eye look;
- guardians dissolving when the player dies at the Spire (partial at best);
- the remaining code suggestions.

See `design/reviews/round-4/*.md` for each item's evidence and proposed fix.

### Scenario results
Handoff run of `npm run check`, on this exact commit:

| Scenario | Checks | Time |
|---|---|---|
| opening | 14 | 69 s |
| survival + restore | 21 + 4 | 37 s |
| expedition | 22 | 197 s |
| night | 19 | 162 s |
| finale | 12 | 131 s |
| perf | 6 | 30 s |

- **Finale** with iteration 3's 2/3/5 waves: 10 guardians rose, 8 were slain with the scenario's 8-bolt crossbow, and the player took 1 bite (lowest health 80).
- **Perf:** 170 draws / 230k tris per view by day, 155 / 226k at night.

## Run it

```bash
npm install
npm run dev
```

- `npm run dev` runs `iwsdk dev up`: the managed Chromium window, editor plus runtime, at https://localhost:8081.
- For a headless managed browser, use `npx iwsdk dev restart --headless`; `--headed` to see it.
- `npx iwsdk dev status` reports readiness (`browserCommandReady: true`).
- **Guide voice (needs you):** open https://localhost:8081/voice-prep.html in a normal browser, sign in to Drawcall, and run both batches. That generates 41 lines via `@drawcall/generate` (voice Charon). Until then every line plays as a subtitle only.
  - URLs are precomputed in `src/game/voice-urls.ts` by `node scripts/voice-urls.mjs`. Changing any line's text changes its URL, so regenerate after text edits.
  - For a release build, consider vendoring the clips into `public/audio` (code review S10).

## Test it (vitexec)

Gameplay checks run *inside* the page. `vitexec/*.ts` scripts drive the IWER Quest 3 emulator the way a player would: poses, squeeze and trigger, and thumbstick walking. They assert against ECS state and bus events. Fixture writes (the clock, fuel) are logged and never fake an outcome.

| Command | What it does |
|---|---|
| `npm run check` | every scenario, each on a fresh isolated page (`tests/vitexec-run.mjs`, config `tests/vitexec.config.ts`: its own dep cache, no HMR or watching) |
| `npm run check -- opening night` | selected scenarios. Available: `opening`, `survival` (+ reload + restore), `expedition`, `night`, `finale`, `perf` |
| `npm run check -- --shots design/verify/tour` | evidence screenshots from the `shot()` calls |
| `npm run check -- --record` | MP4s into `design/verify/vitexec/` |
| `npm run check:managed -- vitexec/opening.ts --fresh` | runs inside the IWSDK managed browser (the app iframe), over the DevTools port 9333 that `vite.config.ts` adds. With a headed browser you can watch it play. |

- Harness: `vitexec/lib/harness.ts` (boot, enterXR, move, grab, bring, turnHeld, locomote, approach, clickAt, shot…), `vitexec/lib/camp.ts` (bench and fire routines), `vitexec/lib/journey.ts` (the start panel).
- Parallel runs: give each its own `VITEXEC_CACHE_DIR=node_modules/.vite-vx-<name>`.
- The runner bounds readiness at 3 min and each scenario at 12 min. Long waits need a stale-log check: one unguarded wait once sat on a hung runner for hours.

## Where things are

- **`design/`:**
  - `GAME_SPEC.md`: mechanics M1–M22, story canon incl. the shade, success criteria S1–S18
  - `ARCHITECTURE.md`, `TECH_PLAN.md`, `PIPELINE.md` (the phase log, milestone and iteration log, retro)
  - `VERIFICATION.md`: per-criterion evidence
  - `reviews/round-1..4/`: judge reports (visual, gameplay, story, progression, immersion, code)
  - `verify/tour*/`: screenshots per round
- **Code (`src/`):**
  - `index.ts`: system registration. DayNight is first; others look it up in `init()`.
  - `game/components.ts`: `Item`, `Held`, `ItemSurface`, `GameState`…
  - `game/bus.ts`: typed events. Adding one means mapping it in `audio-map.ts` and `tests/audio-map.test.mjs`.
  - `game/{rules,recipes,story,catalog,voice-lines,settings,surface-math,terrain}.ts`
  - `game/systems/*-system.ts`: one system per file.
- **Key contracts:**
  - **ItemSystem** owns grabbing: squeeze-to-snap hold poses from `catalog.ts` `hold`, hand transfer, the hover rim, release targets, ballistic drops, `ItemSurface` props. Never use IWSDK `Grabbed`/`OneHandGrabbable` (grabbing is off in `iwsdk.config.json`).
  - **StartSystem** gates the world until New journey / Continue. `StorySystem.resetWorld()` / `applySave()` handle reset and restore.
  - **settings.ts** holds comfort settings: walk speed, tunnel, turn, reduce flashes, subtitles. The journal card writes them; `index.ts`, the vignette and the toast system read them.
  - **Performance budget:** ≤ 200 draws and ≤ 250k tris per view; 2 point lights, never a changing light count. `npm run check -- perf` enforces it.

## Next steps (priority order)
1. Generate the voice clips (above), then run a real Quest 3 pass. It has only been verified in emulation: check frame time, sparkle and subtitle legibility, and haptic strength.
2. Re-run `npm run check`, and settle the finale kit vs `waveSizes` (see Scenario results).
3. Finish iteration 3's open items, listed above with fixes in `design/reviews/round-4/`.
4. Code-review suggestions: see `design/reviews/round-4/code.md`. In particular:
   - make the CDP port opt-in;
   - DEV-gate the debug globals;
   - back off gather retries;
   - cache flame lookups.

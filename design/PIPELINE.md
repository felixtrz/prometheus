# Prometheus — Pipeline State (v2: full story arc)

Requirement change 2026-09-28: the user asked for the full game from the GDD (fun,
visually appealing, SFX, story), reviewed by sub-agents on fun, visual fidelity,
intuitiveness, immersion, sound and story. The first-playable pipeline is archived in
`archive/first-playable/PIPELINE.md`; its build is this pipeline's M0 baseline.

| Phase | Status | Artifact | Notes |
| --- | --- | --- | --- |
| 0 Preflight | done | Capabilities below | |
| 1 Ideation | done | GAME_SPEC.md | 4 axes answered by user; the rest [ASSUMED], then "don't ask more questions" |
| 2 Design | done | deck.html, concept/layout.svg, concept/key-moment-night.svg | 19-slide deck; valley map at 12 px/m; night concept |
| 3 Grounding | done | TECH_PLAN.md ← grounding/*.md | input, audio, environment, entities/UI |
| 4 Architecture | done | ARCHITECTURE.md | streams + contracts; [ASSUMED] approval (autonomous) |
| 5 Build | done (M0–M6) + v3 feedback round | src/, milestone log | core systems (main) + items/world/creatures/audio/UI agents; v3: hold/guide/start/world/sentry agents |
| 6 Verify | done | VERIFICATION.md, vitexec/*.ts | S1–S18 PASS; vitexec 98 checks; build OK. Gap: guide voice clips need the user's Drawcall sign-in |
| 7 Ship | done (local build) | design/reviews/round-2..4/, dist/ | judge /loop stopped after 2 iterations: every judge ≥ 8, no Critical |

## Capabilities (Phase 0)

- Interactive questions: yes, but user said "don't ask any more questions" → autonomous
- Sub-agents: yes (Agent tool; background). The main agent owns the dev server
- Slide/HTML preview: Artifact tool + local files
- Image generation: none → hand-authored SVG
- iwsdk CLI 0.5.3 · reference: ready · Node 26.4 · ffmpeg available (audio encode)
- Runtime verify: managed browser connected, browserCommandReady true (port 8081); headless since v3 (`npx iwsdk dev restart --headless`), DevTools port 9333 (opened by the `dev:runtime` script) for vitexec
- Gameplay testing: vitexec 0.8 (`npm run check`, tests/vitexec-run.mjs) inside the one managed browser's runtime iframe, driving the IWER emulator in-page; scenarios run serially, each on a cleared, reloaded runtime
- Drawcall canvas: CLI credentials rejected (Unauthorized); local GLTS/GDD snapshots used

## Milestone Log

- M0 2026-09-28: first-playable baseline adopted. tsc clean, 4/4 tests, runtime renders,
  console clean. Visual iteration in progress: texture mipmaps, bench palette, trestle
  and striking block detail, camp dressing module (bedroll, lantern rock, log seat,
  woodpile) restored from the source GLTS. Brief: scratchpad iteration-2-brief.md.

- M1–M6 2026-09-28: full story arc built by stream agents (items, world, creatures, audio, UI, story);
  6 sub-agent reviews (design/reviews/*.md, round 1) applied; CLI-emulator e2e harness proved flaky.
- v3 2026-09-29 (user play-test feedback, 9 items): switched testing to vitexec; custom hold
  system (snap poses, hand transfer, hover rim), choppable trees + loose sticks, look-alike
  cleanup, ItemSurface props, simpler camp, start screen + reset fix, Prometheus' shade guide
  (TTS via @drawcall/generate, pending the user's sign-in), damage/hunger feedback, loaded
  sentries, pack drop keeps handle and yaw. vitexec suite: opening 14, survival 21+4,
  expedition 22, night 19, finale 11 checks, all PASS; perf (S17) FAILS at ~253 draws /
  283k tris per eye.
- Judge round 2 (design/reviews/round-2/): visual 7, gameplay 6, story 6–8, progression 5–7,
  immersion 7, code 1 Critical / 7 Warning / 15 Suggestion.
- Loop iteration 1 (done 2026-09-29): 4 fix agents (guide & narrative, balance & systems, visual/world/perf,
  audio & comfort) + orchestrator (C1 surface yaw, constant-width hover rim, grab-search
  caching, level-based release, runtime item cap, outline warm-up, grabbing off, comfort
  0.55 / 2.6 m/s, playwright devDependency, safe bus dispatch, directional hurt event).
  Result: tsc clean, 76/76 unit tests, vitexec suite 97 checks all PASS (opening, survival,
  expedition, night, finale, perf). S17 now passes: 172 draws / 226k tris per view by day,
  158 / 225k at night (was 253 / 283k); 2 point lights. Finale: 24 s hold, 8 guardians,
  passive hold 100 → 40 health, 0 deaths. Runner hardened after a 6 h stall (bounded
  readiness, 12-min scenario watchdog, no-watch/no-HMR test config).
- Judge round 3 (design/reviews/round-3/): visual 8 (UI 6), gameplay 7, story 8–9 (all ≥ 8),
  progression 7–8, immersion 8 (haptics 6), code 0 Critical / 4 Warning.
- Loop iteration 2 (done 2026-09-29): agents A (finale must be defended, sleep-after-death, stage-3
  flanks, sentry spread, journey-flag resets, save coalescing), B (subtitle placement,
  compass-free directions, story polish, comfort settings panel, well-fed/epilogue UI, footstep
  stride, voiced-only duck), C (objective sparkle in pack, beacon/brazier look, cord visibility,
  compileAsync warm-up, per-level material clones, reduce-flashes vignette). Orchestrator:
  settings module + locomotion wiring, DayNight registered first, pure footprint maths + C1
  regression test, generation-checked disposal, level-guarded spawns, hover tick, tooling
  typecheck (tsconfig.tools.json).
  Result: tsc + tools typecheck clean, 91/91 unit tests, vitexec 98 checks all PASS. Finale
  now needs defending (passive hold dies ~25 s; defended with the crossbow: 8/8 guardians,
  0 bites, 24 s). Stage-3 pincers (2 wolves ~160° apart), 60 s no-sleep after death, sentry
  ~77% hit rate. Perf 170 draws / 228k tris per view (day). vitexec/finale.ts replaced by the
  active-defence scenario (agent A).
- Judge round 4 (design/reviews/round-4/): visual 9, gameplay 8, story 9, progression 8.4,
  immersion 9 (8 as heard), code 0 Critical / 1 Warning (fixed). Loop stop condition met.
  Final: tsc + tools clean, 91/91 unit tests, vitexec 98 checks PASS, `npm run build` OK.
  VERIFICATION.md written.

## Retro (v3 feedback round)

- Testing inside the page (vitexec + IWER) beat CLI-emulator round trips: grabs, walks and
  two-hand moves became deterministic, and scenarios now walk every trip with the thumbstick.
- A test server that watches files reloads pages under running scripts; checks must run as
  snapshots (no HMR, no watch), and every wait needs a staleness watchdog — one unguarded wait
  sat on a hung runner for six hours.
- Judges with measurements (probes, pixel diffs, per-draw breakdowns) produced fixable
  findings; judges scored against their previous round converged in two iterations.
- Contracts first (Held, ItemSurface, bus events, settings.ts) let 3–4 agents work in parallel
  with disjoint files and almost no merge friction.
- Next: generate the voice clips (user sign-in), a real-Quest pass, and the round-4 gameplay
  tuning notes listed in VERIFICATION.md.
- Iteration 3 (user asked to continue past the stop condition, 2026-09-29): agents A (jab grace,
  post-death relight 60, 3rd wave 5, pincer stagger, guardians dissolve on death, code S5/S6/S8),
  B (torch-line split, beacon/lighter wording, note due-time, shade inside FOV, subtitle
  walking/upright/journal avoidance, subtitles-off hints, comfort chips incl. turn away from
  camp, simmer loop, starving grunt, voice duck on arrival, DEV-gated debug globals),
  C (single beckoning item, fork signpost pictograms, ember lumps, Spire eye, gather back-off,
  cached flame lookups). Orchestrator: `turn` setting (snap/smooth) wired to locomotion,
  settings unit test, sheet-item hover rim (widened shell + polygon offset).
- Handoff 2026-09-29: iteration 3 stopped mid-flight by request; partial changes kept (they
  typecheck, 94/94 unit tests). Final `npm run check`: 6/6 PASS, 98 checks (finale with 2/3/5
  waves: 10 guardians, 8 slain, 1 bite; perf 170 draws / 230k tris).

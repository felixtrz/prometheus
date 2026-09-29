# Prometheus — First Fire

A Quest 3 VR survival story: relight a dead valley's fires, craft, survive the Hollow
at night and carry fire to the Spire, guided by Prometheus' shade. Built with IWSDK
0.5.3, from the Drawcall **VR Survival Crafting — Visual Moodboard** GDD (original
design snapshots in `design/source/`).

**Start with [HANDOFF.md](HANDOFF.md)**: status, how to run and test (vitexec), where
things are, and next steps.

```sh
npm install
npm run dev
```

The CLI opens one managed workspace with Runtime and Editor views. Enter VR to
use a headset or the built-in Quest emulator. Squeeze near an object to grab it.
Left stick moves; right stick snap-turns.

1. Take the meat and mushroom from the supply pack; release both into the pot.
2. Grab the spoon and circle its tip in the broth for roughly two turns.
3. Take the finished bowl from the pack and bring it to your mouth.
4. Place stick, cloth and resin into the first three bench bays, left to right.
5. Tilt the hammer sideways and strike the fourth bay's pad with its metal face three times.
6. Pick up the torch and hold its head in the fire until it lights.

The journal shows progress and provides **Reset camp**. Invalid releases return
items to their supply positions. This is an interaction prototype: full physics,
persistent inventory, hunger depletion, death, gathering, enemies and story are
future milestones. Native headset performance and ergonomic tuning remain to be tested.

```sh
npm run typecheck
npm test
npm run build
npm run dev:down
```

`iwsdk.config.json` owns scene/world configuration. The shared asset manifest
contains deterministic parentless prototypes; scene JSON owns placement; custom
components are system-free; gameplay uses ECS queries and the built-in grab
system. Three.js imports come from `@iwsdk/core`. No raw GLTF loaders, dynamic
shadows or postprocessing are used.

See `design/GAME_SPEC.md` for prototype assumptions, `design/ARCHITECTURE.md` for
the implementation map, and `design/VERIFICATION.md` for test evidence.

The [video gallery](design/verify/videos/index.html) and
[visual review](design/VIDEO_REVIEW.md) cover every implemented interaction.

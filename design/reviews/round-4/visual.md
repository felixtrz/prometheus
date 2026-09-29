# Visual review, round 4: Prometheus — First Fire

Judge: VR art director (review only).

**Evidence:** `design/verify/tour/` against `tour-round3/`, plus my own emulated Quest 3 captures (scratchpad `judges4/visual/`, ~6.4 px/°):
- `sub-level` and `sub-fire`, with pose readouts.
- `shade-walk`, sampled every 0.25 s.
- `h-page-on`/`off`, diffed.
- `beckon.mp4` from 2.7 m.
- `hurt-reduced`/`hurt-normal`, `wrist-fed` and `endcard`.

**Draw calls:** 180 per view at spawn.

## 1. Scores

| Area | R3 | R4 | Why |
|---|---|---|---|
| Overall | 8 | **9** | No P0 or P1 left; what remains is polish. |
| Cohesion | 8 | **9** | Warm stones, a warm iron crown, a dark ash bed; the white controllers remain. |
| Grabbable vs scenery | 7 | **8** | Key items beckon from the pack and pages glow; the page hover rim is still a sliver. |
| Camp first impression | 7 | **8** | The subtitle leans toward the shade, off the fire pit (`opening-01`). |
| The shade | 8 | **9** | 2.2 m or more while speaking; it paces 110–134° off the view. |
| UI panels | 6 | **8** | The subtitle faces the eye at ~1°; the comfort card, wrist row and end card are on-style. |
| Lighting and night | 8 | **8** | Held. |
| VFX | 7 | **8** | Soft shader flames, directional bite, gentle reduce-flashes rim; the ember lumps read flat. |

## 2. Round-3 issues

| # | Issue | Status | Evidence |
|---|---|---|---|
| 1 | Subtitle on the target, shrinking | **Resolved** | Gaze −49.5°, panel −33.5° at 1.30 m, square to the eye, over the pot rather than the logs; a level gaze puts it at −15°. |
| 2 | Flat items and sparkle | **Partial** | Glints over the packed lighter every ~2 s, readable at 2.7 m; the page lift reads (`night-11`). The hover rim still changes only 46 px (42 in R3). |
| 3 | Beacon details | **Resolved** | Soft tongues thin at 1.6 m (`finale-13`); flame-plate crown; dark bed. |
| 4 | Grey brazier stones | **Resolved** | Pebble tones (`expedition-05`). |
| 5 | Shade crowding | **Resolved** | 2.21 m minimum while walking; `expedition-08` shows only a hand at the edge of a 121° frame. |
| 6 | Crooked subtitle | **Partial** | The shear is gone; a perspective tilt remains (issue 2). |

**Reduce flashes:** the red area is 0% (14.4% in normal mode), and the edges only darken by 15 luminance.

## 3. Remaining issues, ranked

**1. The subtitle paints over nearer geometry (P2).**
- **Evidence:** the depth test is off (`toast-system.ts:118`). In `opening-04` a tripod leg about 0.7 m away shows *behind* text that sits at 1.3 m, a stereo conflict.
- **Fix:**
  - Extend `heldVeil` to the world: raycast eye → panel on each re-target.
  - On a hit nearer than 1.3 m, pull the panel to the hit minus 0.15 m (minimum 0.8 m) and rescale it to keep 1°.
  - Otherwise fade it to `SUB_HELD_FADE`.

**2. The subtitle tilts 7–12° with the shade beside you (P2).**
- **Evidence:** `expedition-05` and `opening-04`; `sub-fire`, which has no side offset, is level.
- **Cause:** `object.lookAt(this.eye)` (`toast-system.ts:360, 436`) plus the 12° `SUB_SIDE` yaw. The panel's level edge is no longer square to a lowered view.
- **Fix:** take the yaw from the gaze (`atan2(look.x, look.z) + π`) and only the pitch from the eye, via `rotation.set(pitch, yaw, 0, 'YXZ')`. At 12° off, that costs 2% foreshortening.

**3. The page hover rim is still a sliver (P2).**
- **Evidence:** the orange shows only on the left edge and one corner (`h-page-z`).
- **Cause:** the clip-space push follows the page's up and down normals (`item-system.ts:50-53`), and the hull's underside sits inside the mat.
- **Fix:** for items whose thinnest bound is under 5 mm, pulse a per-item emissive clone from 0.26 to 0.55 on hover, synced to the `OUTLINE` sine.

**4. The beacon's ember lumps read as flat coins (P3).**
- **Evidence:** eight uniform peach octagons (`finale-12` crop).
- **Cause:** flattened dodecahedra (y ×0.6) on the full-strength coal material (`valley-props:676`).
- **Fix:**
  - Raise y to ×0.9.
  - Vertex-tint so only a third glow fully; give the rest dark crust with an ember edge.
  - Drop the beacon coal emissive to ~0.7 and add a flicker.

**5. The new journal labels are the smallest text in the game (P3).**
- **Evidence:** `.jr-stat-label` and `.jr-chip-label` are 1.6 units at scale 0.8. That is 1.3 cm, ~0.52° at 1.4 m (`endcard-z`).
- **Fix:** raise both to 2.1, matching `.jr-eyebrow`, and tighten `.jr-stat` padding.

**6. The Spire eye reads as a candy swirl (P3).**
- **Evidence:** the orange spiral disc crowns the ending (`finale-13`).
- **Cause:** `sin(a * 7 + r * 9)` (`valley-regions:705`).
- **Fix:** drop the `r * 9` term to get rays, not a spiral, and add a slow noise flicker and a small additive halo.

**7. White stock controllers (P3, carried over).**
- **Evidence:** they are the brightest objects in every hand shot, and the wrist band hangs off them.
- **Fix:** tint them warm charcoal `#3a322c` with an ember accent, or use hands.

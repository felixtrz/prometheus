# Visual review, round 3: Prometheus — First Fire

Judge: VR art director (review only).

**Evidence:** `design/verify/tour/` against `tour-round2/`, plus my own emulated Quest 3 captures (scratchpad `judges3/visual/`; about 6.3 px/°):
- `h-mush-*` and `h-page-*`: hover rim on/off, diffed pixel by pixel.
- `sparkle.mp4`: 8 s beside the loose stick.
- `sub-level`, `sub-fire` and `shade-night`.

**Draw calls:** 172 per view at spawn, within budget.

## 1. Scores

| Area | R2 | R3 | Why |
|---|---|---|---|
| Overall | 7 | **8** | Every round-2 P0 moved; subtitle placement and finale detail remain. |
| Cohesion | 7 | **8** | Amber eyes, a warm beacon, warm stones; white controllers and grey brazier stones remain. |
| Grabbable vs scenery | 5 | **7** | The rim reads on solid items; pages barely show it, and the sparkle is faint. |
| Camp first impression | 6 | **7** | One panel at wake-up, not four (`opening-01`); the subtitle still sits on the fire pit. |
| The shade | 5 | **8** | 2.4–3 m away, eyes clamped, robe fading to wisps: a presence, not an obstacle (`shade-night`). |
| UI panels | 6 | **6** | Toasts fixed (body text about 0.95°); the subtitle regressed when you look down. |
| Lighting and night | 8 | **8** | Held; the dusk hold into a dawn ending adds an arc. |
| VFX | 5 | **7** | Beacon, bite flash and day fire fixed; the sparkle is faint and the fuel bed reads as a plate. |

## 2. Round-2 top 8

| # | Issue | Status | Evidence |
|---|---|---|---|
| 1 | Grabbables | **Partial** | Crisp 3–4 px rim on the mushroom (736 px changed); the page changes only 42 px; the sparkle is two ~3 px specks. |
| 2 | Look-alikes | **Resolved** | Warm stones of 12 cm+, a leather roll, charred logs (`night-11`); one leftover, issue 4. |
| 3 | Shade in sightlines | **Resolved** | Spots 2.4–3.8 m out, sightlines refused, pitch fade visible (`expedition-05`). |
| 4 | White eyes | **Resolved** | Amber in every shot. |
| 5 | Crystal beacon | **Resolved** | Transparent layered tongues; the plinth is no longer blown out (`finale-12`). |
| 6 | Bite flash | **Resolved** | Red area 68% → 21%; edge luminance 53 → 34, centre 27; directional (`night-10`). |
| 7 | Text panels | **Partial** | Toasts are bigger and wait for the shade; the subtitle has new failures. |
| 8 | Day fire | **Resolved** | The disc is gone; the flame shows through the logs (`opening-04`). |

## 3. Remaining issues, ranked

**1. The subtitle lands on what you look at, and shrinks (P0).**
- **Evidence:**
  - Looking at the fire, the panel sits 2.02 m away and 1.55 m below the eye, on the ground among the logs (`sub-fire`).
  - It is a vertical panel seen from 50° above, so its text is about 0.43° tall.
  - Its width against round 2: 100 vs 300 px (`opening-02`), 83 vs 180 (`expedition-05`), 86 vs 228 (`expedition-06`).
  - With a level gaze it covers the fire bed and the night flames (`sub-level`, `shade-night`): the fire is 22–27° down.
- **Cause:** `toast-system.ts:353-369` clamps at `SUB_MAX_DOWN` 50°, keeps `SUB_DISTANCE` horizontal and only yaws the panel.
- **Fix:**
  - Place it at 1.3 m along the view ray and pitch it to face the eye (`rotation.set(pitch, yaw, 0, 'YXZ')`).
  - When the gaze is more than 25° down, put it 16° above the gaze.
  - With a level gaze, set `SUB_DROP` 0.5 → 0.35 (15°) and offset it 12° toward the shade. This clears the pot and the fire, and ties the words to the speaker.

**2. Flat items get no rim, and the sparkle is faint (P1).**
- **Evidence:**
  - The page's hull lies inside the mat and fails the depth test.
  - The sparkle is two 2.5 cm cream dots for 0.42 s, lost on dirt and pale wood.
  - The lighter, meat and mushroom are in `pack-N` slots, so they never sparkle (`fx-system.ts:507`), yet they are the first three tasks.
- **Fix:**
  - In `item-system.ts` `showOutline()`, when a mesh's thinnest bound is under 5 mm, pulse a warm emissive (`#ffb347`, 0.25–0.45) on a per-item material clone.
  - Sparkle (`fx-particles.ts:154`): size .025 → .045, count 2 → 3, colour `#ffd27a`, life .42 → .6.
  - Include the `pack-*` slots.

**3. Finale beacon details (P1).**
- **Fuel bed:**
  - **Evidence:** the pale ash disc on the glowing coal material (`valley-props:504`; emissive 1.4 at `fx-system.ts:590`) reads as a flat peach plate (`finale-12`).
  - **Fix:** put the disc on `mats.solid` in `#2e2622` and set the emissive to 0.9.
- **Close-up flames:**
  - **Evidence:** at 1.6 m, the 2.2× tongues fill about 60% of the frame and read as paper cards (`finale-13`).
  - **Fix:** in `updateBeacons`, multiply tongue opacity by `.45 + .55 * smoothstep(1.2, 3.0, viewerDistance)`.
- **Rim crown:**
  - **Evidence:** the curled rim tongues read as black claws at dusk.
  - **Fix:** warm iron `#4a3a32` with an ember top edge (`valley-props` ~491).

**4. Blue-grey brazier stones (P2).**
- **Evidence:** each echo brazier has eight 11–16 cm faceted stones in `#8f959a`/`#7a8086` (`valley-props:441`), the flint palette (`expedition-05`).
- **Fix:** use the pebble tones `#a08a6c`/`#8c7a62`/`#b09a7a` (`valley-kit:188`).

**5. The shade crowds the periphery while you walk (P2).**
- **Evidence:** its robe fills the lower-left fifth of the frame, about 1 m away (`expedition-08`).
- **Fix:** `guide-system.ts:125-126`, `SPEAK_CLOSE` 1.0 → 1.6 and `SPEAK_BACKOFF` 2.0 → 2.6.

**6. The sheared subtitle box looks crooked (P3).**
- **Evidence:** the italic shear tilts the whole panel, which reads as rolled about 8° off-axis (`expedition-08`).
- **Fix:** `SUB_SHEAR` 11° → 6° (`toast-system.ts:105`), or shear only the text.

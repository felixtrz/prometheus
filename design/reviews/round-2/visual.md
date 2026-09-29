# Visual review, round 2: Prometheus — First Fire

Judge: VR art director (review only; no source files changed).

**Evidence:** tour shots in `design/verify/tour/`, round 1 shots in `design/verify/v2/`, and my own emulated Quest 3 captures (scratchpad, not committed):
- `s-hover-on` / `s-hover-off`: one frame with the outline on and off, diffed pixel by pixel.
- `s-ground-on`: the loose stick on the camp dirt.
- `s-wrist`: the wrist HUD and the first view without the shade.

## 1. Scores

| Area | Score | Justification |
|---|---|---|
| Overall | **7** | Night and camp are clearly better; the finale, the shade and hover feedback are weak. |
| Art-direction cohesion | **7** | One language, broken by the shade's white eyes, the yellow beacon and stock white controllers. |
| Grabbable vs scenery | **5** | Deadwood and choppable trunks fixed the worst case, but nothing marks grabbables at a distance and the outline is 1–2 px. |
| Camp first impression | **6** | Props trimmed (`s-wrist` vs `v2/01`), but the first 3 s stack the shade, subtitle, toast and journal (`opening-01`). |
| The shade | **5** | Strong concept, but at 1.45–2.2 m it fills about 14% of the frame and blocks the journal and trestle (`night-09`, `s-hover-on`). |
| UI panels | **6** | Start panel and wrist HUD are fine; the subtitle covers the fire and toast text (about 0.45°) is illegible. |
| Lighting and night mood | **8** | Stars, dim clouds, night journal, lantern and ground pool: the fire anchors the night (`night-09`). |
| VFX | **5** | Night flames and embers are good; day fire, finale beacon and bite flash are not. |

## 2. Top 8 issues

**1. Grabbables are hard to read, even up close.**
- **Evidence:** in the hover on/off pixel diff, the mushroom's outline is a 1–2 px pale rim. The hovered page changes **zero** pixels.
- **Cause:**
  - `item-system.ts:41-44` pushes a `BackSide` hull 7 mm along the normals, in pale `#ffd08a` that barely stands out on tan wood.
  - A page is two faces 1.2 mm apart, so its hull stays hidden.
- **Fix:**
  - Push the hull in clip space so the outline is a constant 3 px, colour `#ffb347` at 0.9.
  - Add a +0.3 warm emissive lift on the hovered item.
  - For flat items, draw a 1.08× copy behind the item.
  - Extend the forage glint (`fx-system.ts:336`) to any loose item within 3 m, every 3–4 s.

**2. Look-alikes remain.**
- **Pebbles vs flint:**
  - 18 blue-grey faceted chips of 5–7 cm (`woodland.scene-asset.ts:73-78`, `valley-kit:165`) read as flint (`s-ground-on`).
  - Fix: remove them, or keep only warm half-buried stones of 12 cm or more.
- **Pack roll vs log:**
  - The brown pack roll with its spiral end (`items:1348`) reads as a log's growth rings (`opening-start-panel-new`).
  - Fix: drop the spiral, flatten the roll to an oval, use tan leather `#9a6a42` and add a strap loop.
- **Fire logs vs log item:**
  - The fire logs (`camp-props:119-131`) are larger copies of the log item.
  - Fix: char them along their full length.

**3. The shade stands too close and in the sightlines.**
- **Cause:** `guide-system.ts:62-73` places it at 1.6–2.2 m (`CLOSE` 1.45), clear of props but not of sightlines, so it hazes over what it overlaps.
- **Fix:**
  - Spots at 2.4–3.0 m, `CLOSE` 1.9, angles of 35° or more.
  - Reject spots within 0.6 m of the line from the eye to the journal, the current objective or the held item.
  - Fade to 0.3 when head pitch is below −30°.
  - Scale 1.1 → 1.0.

**4. The shade's eyes and palm ember clip to white.**
- **Cause:** the eye tint `[1,.84,.5]` (`ghost:241`) times `uGlow` 1.15 and a talk boost of up to 1.4 passes 1.0 with `toneMapped:false`, so the eyes read white.
- **Fix:**
  - Clamp the kind-1 colour to `vec3(1,.62,.25)`.
  - Set `uGlow` to 0.9 by day (`guide-system:734`).
  - Body alpha ramp `smoothstep(0,.55,y)` → `(.2,.9,y)`, so the lower robe fades to wisps.

**5. The finale beacon looks like yellow crystal (`finale-12/13`).**
- **Cause:**
  - The flames are opaque `MeshStandard` cones (`valley-props:343`, `valley-kit:30`) with a further emissive boost (`fx-system:372`).
  - The beacon light at 9 (`:378`) blows the plinth out to cream.
  - The ten iron rim cones read as thorns.
- **Fix:**
  - Reuse the campfire's transparent layered tongues (`camp-props:83-85,138-144`) scaled ×2.2.
  - Light 9 → 4.5, raised 1.5 m.
  - Replace the rim cones with 8 short curled tongues.

**6. The bite flash brightens the night periphery.**
- **Evidence:** `night-10` is 57% red, with edge luminance 52 against 27 at the centre.
- **Cause:** flat `#b0121a` (`vignette-system.ts:20`) composited "over" at 0.85, with the inner edge reaching 0.59 (`:274`).
- **Why it matters:** the flicker-sensitive periphery makes this a comfort risk.
- **Fix:**
  - Lerp the red toward `#5a0a0e` by nightness.
  - Flash strength 0.65.
  - Inner edge 0.7 or more.

**7. Text panels compete with each other and cover the fire.**
- **Cause:**
  - The opaque, no-depth-test subtitle sits 1.3 m out and 16° down (`toast-system.ts:76-85`): right on the pot while the task is "light the fire" (`opening-02/03`).
  - Toasts at 2.0 m (`:57`) and scale 0.6 (`:146`) have body text of about 1.5 cm.
- **Fix:**
  - `SUB_DROP` 0.5, panel alpha 0.8.
  - Hold toasts while the shade speaks.
  - Toast scale 0.8, far distance 1.6 m, body font 2.9.

**8. The daytime campfire reads as orange plastic (`opening-02/04`).**
- **Cause:** the `MeshBasic` `#ff6b1e` core disc, r 0.37–0.42 (`camp-props:115`), dominates the view from above, and the tongues (`:144`) hide behind the logs.
- **Fix:**
  - Core disc r 0.24 in `#d2521c`.
  - Put the glow on the coals.
  - Tongue heights ×1.35 by day.

## 3. Clearly improved since round 1

- **Night:** round 1's P0-1, P0-2, P1-7 and P1-8 are resolved; the fire now owns the night.
- **Camp decluttered:** the kettle, the loose torch and the lying hammer are gone. The dressing file now bans look-alikes (`camp-dressing:1-6`).
- **Deadwood:** an uprooted 2.1 m trunk, never mistaken for a billet; every trunk is choppable, one learnable rule.
- **Round 1 silhouette fixes landed:** faceted ring stones, a forged hammer head, and an upright torch flame.
- **Also:** a clear start panel; faceted hills and varied pines in the valley.

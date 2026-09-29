# Interaction video review — 2026-09-16

All 13 final clips were captured from the application's actual renderer at a fixed 1280 × 720 viewport, with title and live ECS status strips added outside the viewport. The MP4 exports are 1280 × 840 at 30 fps. They are silent visual verification recordings from desktop Quest 3 emulation, not native headset footage.

Open the [video gallery](verify/videos/index.html) to play each clip. The [export manifest](verify/videos/manifest.json) records duration, size and decoded frame information. Every MP4 passed a complete decode check.

## Final review

Visual inspection used frames extracted throughout each recording at 1–2 fps, with an additional 8 fps inspection around hammer contact. Contact sheets sit beside each clip; the interaction state assertions were checked independently. No gameplay completion state was injected. Controller movement, grip, trigger and thumbstick inputs drove the actions. Enter VR used browser pointer events aimed at the projected real journal button.

| Clip | What was checked | Result |
| --- | --- | --- |
| [01 Ingredients](verify/videos/01-ingredients.mp4) | Both pickup/release paths and the pot stay visible; meat and mushroom pieces appear in the broth. | Pass; ingredients 2/2. |
| [02 Stirring](verify/videos/02-stirring.mp4) | Spoon tip circles inside the pot; food moves with stirring; cooked broth changes color. Stationary hold precedes movement. | Pass; stationary progress unchanged, then 100%. |
| [03 Eating](verify/videos/03-eating.mp4) | Bowl rises to the mouth and lowers empty, with a closed wooden bottom and controller clear of its contents. | Pass; nourishment 65 → 100. |
| [04 Material placement](verify/videos/04-material-placement.mp4) | Stick, cloth and resin settle in their distinct bays; shaft lies flat. | Pass; materials 3/3. |
| [05 Hammering](verify/videos/05-hammering.mp4) | Downward metal face contacts the pad while the handle remains above the bench; a pause at contact does not repeat a strike. | Pass; three strokes reveal the torch. |
| [06 Torch ignition](verify/videos/06-torch-ignition.mp4) | Head enters the flame from the side; the torch is lifted clear and remains lit in view. | Pass; flame persists after contact ends. |
| [07 Journal reset](verify/videos/07-journal-reset.mp4) | Completed journal resets through a controller ray click while a spoon is held. | Pass; held tool released and progress cleared. |
| [08 Invalid release](verify/videos/08-invalid-release.mp4) | Misplaced mushroom returns to the visible supply pack after release. | Pass; no ingredient accepted. |
| [09 Wrong bay](verify/videos/09-wrong-bay.mp4) | Cloth released in the stick bay is rejected; camera then shows its restored supply position. | Pass; material count remains zero. |
| [10 Locomotion](verify/videos/10-locomotion.mp4) | Lateral movement and return preserve floor support and a readable horizon. | Pass. |
| [11 Snap turning](verify/videos/11-snap-turn.mp4) | Separate left/right inputs produce stable discrete turns. | Pass. |
| [12 Leave VR](verify/videos/12-leave-vr.mp4) | Journal ray click returns to the browser hero view. | Pass; session inactive. |
| [13 Enter VR](verify/videos/13-enter-vr.mp4) | Browser pointer click on the journal enters the controller view. | Pass; session active. |

## Defects found and corrected

1. **Ingredients vanished without pot feedback.** Added distinct meat/mushroom pieces driven by the accepted ingredient mask, and gentle rotation tied to stirring progress.
2. **The bowl stayed full after eating.** Preserved a named contents group and hide it on `stewEaten`; reset restores it.
3. **Empty bowl revealed a hole.** Closed the lathed bowl's bottom with matching wood geometry. Recorded a rim grip instead of putting the controller through the food.
4. **Hammer handle crossed the bench.** Replaced head-center detection with a downward-facing metal-face contact point against the pad's actual top. Tightened the contact region and clarified the journal instruction. The corrected recording uses a sideways hammer, with three separated strokes.
5. **The accepted shaft stayed upright.** Replaced a lazy synced-Euler write with a direct quaternion write. The new placement recording confirms the shaft lies across its bay.

The initial diagnostic captures are retained in `verify/videos/round-1/`. Interim framing, grip and bowl inspections are in `round-2/`. An initial separate-renderer recording omitted UIKit text; final clips use only the real application's renderer. A below-bowl grip and a grip inside the mushroom stem missed their surfaces; the final input fixtures target the rim and cap respectively. These were recording fixture corrections, not completion-state shortcuts.

## Reproduce

```sh
npx tsc --noEmit
VITE_CAMP_CAPTURE=1 npx iwsdk dev up --ai-mode agent --screenshot-width 1280 --screenshot-height 720
```

Read the current runtime `_tab` from an IWSDK MCP result and set `CAMP_TAB` and `CAMP_GENERATION` for each script invocation. Run `node tests/record-interactions.mjs MODE` in this order:

`ingredients`, `stir`, `eating`, `materials`, `hammer`, `torch`, `reset`, `invalid`, `wrong-bay`, `movement`, `turn`, `exit`, `enter`.

Then run `python3 tests/process-videos.py` to export seekable MP4s and verify decoding. Stop with `npx iwsdk dev down`. The capture transport is opt-in, loopback-only, and excluded from production runtime code; it neither inserts completion state nor substitutes a scene renderer.

The first playable's recover-to-home behavior remains intentional. Native Quest reach, comfort and sustained performance still require headset testing. This review establishes the visible behavior of the current emulated interactions.

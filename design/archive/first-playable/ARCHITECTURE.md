# Prometheus — First playable architecture

Existing-app delta: keep Vite plugin and virtual project module; replace starter scene/manifest/system registrations. Add no runtime package dependencies. Preserve original scaffold files unless replaced by the new app entry points.

## Ownership and files

- `src/camp-components.ts`: system-free CampItem, CampState, FireVisual components.
- `src/camp-rules.ts`: pure geometric/recipe rules, independently testable.
- `src/camp-system.ts`: release acceptance, stir travel, hammer strokes, ignition, eating and reset.
- `src/camp-visual-system.ts`: camp/torch flame motion and progress material state.
- `src/camp-panel-system.ts`, `public/ui/camp-journal.uikitml`: instructions and progress.
- `src/scene-assets/camp-props.scene-asset.ts`: campfire, empty bench, empty backpack and tool/item prototypes adapted from supplied design.
- `src/scene-assets/woodland.scene-asset.ts`: coherent woodland/terrain/staging inspired directly by source environment.
- `public/scenes/main.iwsdk.scene.json`: editable flat composition, collision floor, independent objects and spawn.
- `src/assets.ts`, `src/components.ts`, `src/index.ts`: shared registry and explicit registrations.

## State

CampItem: kind string, home Vec3, accepted bool; tool tip offset is determined by kind. CampState: ingredients bitmask, materials bitmask, stir radians, hammer count, stew ready/eaten, torch crafted/lit, hunger. Use ECS state for observable behavior and a change signal for UI. Held items query includes Grabbed; accepted objects remain in ECS with visibility/interactivity managed explicitly.

## Milestones

- M0 baseline: typecheck, runtime nonblank, XR starts (done).
- M1 visual stage: imported/adapted props and woodland; editor validation and runtime screenshot; all items separately queryable.
- M2 cooking: physical grab/release acceptance and stir motion creates stew; invalid release recovers; stationary spoon does not advance.
- M3 torch: slots accept matching ingredients, hammer movement produces torch; fire contact lights it, exit keeps flame.
- M4 integration: instructions, reset, eating feedback, production build, focused review and evidence.

The design source supplies the visual gate; no replacement moodboard is needed. User authorized the first-playable scope. Assumptions are recorded in GAME_SPEC.md. Delivery is a local build, with no publishing or remote design edits.

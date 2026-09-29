# Prometheus — First playable

Source: Drawcall Design, **VR Survival Crafting — Visual Moodboard**, read 2026-09-16 using `npx drawcall design`. Original documents and GLTS sources are preserved in `design/source/`.

## Scope

User selected **campfire cooking + torch crafting** as the first milestone. Build a peaceful camp clearing from the authored GLTS reference. Use the campfire, slotted workbench and unrolled backpack modeling language. Preserve warm wood, iron, canvas, grass, layered trees and distant landmarks. Standalone VR is the eventual target; desktop XR emulation verifies behavior here.

Hands-on loop: take meat and a mushroom from the supply area → release them into the pot → move the spoon around inside the pot → collect a finished stew. Take stick, cloth and resin → place in the matching physical bench bays → hammer the assembly → pick up the torch and hold its head in the campfire.

## Prototype assumptions

- [ASSUMED] Quest 3 controllers, squeeze to grab; smooth movement and snap turning. Hand tracking remains unconfirmed.
- [ASSUMED] One meat + one mushroom, about two circular stirs, yields stew. A held stew brought near the head restores hunger.
- [ASSUMED] Stick + cloth + resin and three deliberate hammer strokes produce a torch. Brief fire contact ignites it.
- [ASSUMED] Items return to their supply location after an invalid release. This first interaction prototype does not need full rigid-body simulation.
- [ASSUMED] Camp supplies are renewable; a reset action permits repeat testing. Hunger is a demonstrator, with no starvation/death rules yet.
- Persistence, death drops, backpack carrying/storage, gathering, animals, combat, generated world, story and recipe discovery remain future milestones. The backpack here is the source visual and supply staging surface.

## Observable acceptance criteria

1. Campfire, bench, supply backpack, tools and woodland render in editor and runtime with no blocking errors.
2. XR starts, floor supports movement, near squeeze grabs move independent tools/items.
3. Correct released ingredients are accepted once; incorrect placements recover.
4. Stirring requires spoon movement in the pot; stationary holding does not progress cooking. Completion produces stew.
5. Matching materials snap into bench bays; three distinct hammer strokes create one grabbable torch.
6. Torch ignition requires fire contact; a lit torch stays lit after leaving the fire.
7. Reset clears progress and returns supplies. Typecheck and production build pass.

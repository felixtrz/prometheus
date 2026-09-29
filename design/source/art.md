# Art Style & Visual Direction

This section records visual decisions established during the moodboard and GLTS prototyping work. These are newer decisions than the original GDD draft, where visual style was still listed as unresolved.

## Rendering target

The art direction must be achievable on a standalone VR headset. Visual quality should come from strong modeling, silhouettes, materials, composition, and selective detail rather than desktop-class rendering features.

- Target **stylized mid-poly**, not an intentionally faceted low-poly look.
- Avoid ambient-occlusion-heavy shading as a defining visual feature.
- Use simple direct and ambient lighting appropriate for standalone VR.
- Use inexpensive local lights selectively when they have clear gameplay or visual value, such as the campfire glow.
- Prefer soft blob or baked-looking shadows for trees and other environment elements instead of expensive detailed dynamic shadows.
- Avoid volumetric effects and other costly post-processing as part of the core look.

## Modeling language

Increasing polygon roundness alone is not the desired route to quality. Assets should gain richness through meaningful form and construction detail.

- Use deliberate silhouette design and moderate geometry density.
- Keep manufactured objects structurally clear, with mostly crisp forms and selective bevels/chamfers where physically appropriate.
- Add visible construction detail such as joinery, straps, buckles, bindings, seams, fasteners, brackets, planks, handles, rims, and attachment points.
- Natural objects may use more irregular or faceted planes where appropriate, such as rocks and split wood.
- Avoid making every edge or object uniformly rounded.
- Asymmetry, wear cues, and functional parts should create visual richness without compromising readability in VR.

## Materials

Materials may add detail when they fit the asset and remain lightweight enough for the target hardware.

- Prefer stylized, low-frequency material variation over photorealistic micro-detail.
- Wood grain, bark, cloth weave, leather variation, stone variation, and similar surface cues are appropriate where they strengthen the modeled form.
- Materials should support good modeling rather than compensate for weak geometry.
- Normal detail should be restrained; avoid relying on AO maps for the look.
- Maintain clear material separation so objects remain readable at headset resolution.

## VR hands and interaction readability

Hands should communicate presence and interaction without aiming for photorealistic anatomy.

- Use stylized hands with believable proportions and smooth enough anatomy to avoid a blocky polygon-demo appearance.
- Interaction objects must be large and legible enough for VR grabbing and placement.
- Physical interaction affordances should be visible in the object design itself where possible.
- Crafting uses explicit physical component slots rather than abstract floating UI.
- The backpack opens or unrolls into a physical item grid with one object per cell.

## Environment direction

The world environment should receive the same art-direction attention as hero interaction props.

- Ground, vegetation, trees, rocks, authored landmarks, distant tree belts, mountains, and sky should form one coherent visual language.
- Avoid a highly detailed hero prop placed inside a visibly placeholder-like environment.
- Use layered detail: strong foreground forms, readable midground vegetation and landmarks, and simplified but intentionally designed distant silhouettes.
- Keep foliage density and geometry practical for standalone VR while avoiding visibly empty or generic terrain.

## Tone

The opening world should feel peaceful, tactile, and inviting, with a subtle sense of mystery. Later danger should be communicated through creatures, environmental state, palette, and composition rather than simply making nighttime much more dangerous.

Warm local light from campfires and crafted objects can contrast with cooler environmental light. The campfire should remain an important visual and emotional anchor.

## Reference-image workflow

Generated 2D concept images should be grounded in implementable game assets rather than defining unconstrained geometry first.

1. Research fitting reusable assets and materials.
2. Build or compose the idea as GLTS at plausible game scale.
3. Create important reusable objects as separate GLTS asset frames when useful.
4. Iterate on the GLTS previews until the underlying assets and scene are visually convincing.
5. Only then use the GLTS previews and relevant asset frames as references for generated concept imagery.

The GLTS scene is therefore the production-grounded source of truth; generated images are presentation and exploration references built on top of it.

## Still open

- Exact color palette and palette rules.
- Final character/creature style.
- Exact visual influence to take from *Don’t Starve* beyond its role as a named reference.
- Final UI/HUD visual language.
- Exact target headset and resulting production budgets for geometry, textures, lights, and draw calls.
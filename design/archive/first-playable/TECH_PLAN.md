# Prometheus — Technical grounding

Installed authority: `@iwsdk/core` 0.5.3 declarations, local reference search (GrabSystem, OneHandGrabbable), scene capability hash `sha256:f304c4c96672cb69691b1ee6e3cdbcb87328635ed630642090a5697c5b37ae54`.

| Mechanic | Classification | Implementation |
| --- | --- | --- |
| Controller grab | BUILT-IN | OneHandGrabbable + GrabSystem; observe SDK-owned Grabbed tag; forceRelease for resets |
| Movement | CONFIGURE | locomotion with a LocomotionEnvironment floor, smooth translation and snap turn |
| Ingredient/material acceptance | CUSTOM | CampItem query; release transition validates item kind and target proximity, then updates CampState |
| Stirring | CUSTOM | held spoon query; tip world position, constrained angular travel in pot; reject jumps and stationary holds |
| Hammering | CUSTOM | held hammer head world position; downward threshold crossing with rearm height and cooldown |
| Ignition | CUSTOM | held torch tip in fire volume for a short dwell; persistent component state and visual flame |
| Progress/readable instructions | BUILT-IN + CUSTOM | manifest UIKitML, stable node/element IDs, reactive state presentation; clicks for XR entry/reset |
| Scene | BUILT-IN + ADAPT | deterministic parentless prototypes adapted from supplied GLTS; native scene composition; imported market GLBs via manifest |
| Feedback | BUILT-IN | AudioSource on a transform entity, AudioUtils.play; no raw loaders |

World features: VR controller prototype, grabbing on, spatialUI Horizon on, locomotion on, physics off. No dynamic shadows or postprocessing. Root DomeGradient/IBLGradient and limited direct lighting. Static scene keeps camp, bench and backpack separate. All tools/items are separate authored entities.

No raw GLTFLoader or TextureLoader. Retain remote source references; copy selected model assets into public storage. Procedural material fallback can preserve warm wood/canvas form while external textures are migrated later. No manually tracked entity arrays. System priority: gameplay 15, animation 25, UI 35. Mutable vectors use getVectorView; scratch vectors allocated once. Subscriptions register teardown. Asset prototypes never depend on World/DOM.

Risks: stock Drawcall content has many individual meshes and high-frequency terrain facets; batch static material groups and smooth terrain where appropriate. Browser/emulated XR evidence does not prove native Quest performance. Exact recipes and reach tuning remain prototype assumptions.

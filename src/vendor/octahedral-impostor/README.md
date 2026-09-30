# octahedral-impostor (vendored)

- Source: https://github.com/agargaro/octahedral-impostor (MIT, © 2025 Andrea Gargaro, see `LICENSE`)
- Commit: `ca0046a` ("fix: update render order for mesh children and improve material handling in texture atlas")
- Not published on npm, so `src/` is copied here.
- Used by `src/game/systems/forest-system.ts`: it bakes the GLB pines into atlases and draws the far trees as instanced impostors.

## Local changes

1. **Imports.** `three` is replaced by `@iwsdk/core`, which re-exports it (the project must never import `three` directly). The `.glsl` files are imported with Vite's `?raw` suffix instead of `vite-plugin-glsl`. The entry `index.ts` no longer re-exports the GLSL modules.
2. **Typing.** Upstream augments three's `Material` interface with `declare module 'three'`. That augmentation is replaced by an `ImpostorMaterial<T>` intersection type and an `isImpostorMaterial()` guard. Upstream's `any` casts and implicit-`any` index writes are typed so the files pass the project's `strict` tsc.
3. **Stereo (WebXR).** `octahedral_impostor_shader_vertex.glsl` derives the eye from `inverse(viewMatrix)` instead of reading the `cameraPosition` uniform:
   - under `OVR_multiview`, three turns `viewMatrix` into `viewMatrices[VIEW_ID]`, but `cameraPosition` stays one uniform (the XR array camera's centre);
   - with this change each eye picks, blends and projects its own sprites.
4. **Matrix order.** The same shader now computes the local eye with `inverse(modelMatrix * instanceMatrix * impostorTransform)`. Upstream used `inverse(instanceMatrix * impostorTransform * modelMatrix)`, which is only right while the mesh's own world matrix is the identity.
5. **Map chunk.** `octahedral_impostor_shader_map_fragment.glsl` no longer starts with the comment `//#include <map_fragment>`:
   - the material inserts that chunk first, then replaces the first `#include <map_fragment>` with `diffuseColor *= blendedColor;`;
   - so the replace hit the comment, and three's own map sampling stayed in;
   - with three r181 every impostor then showed the whole atlas tiled over its quad.
6. **Baking (`createTextureAtlas.ts`):**
   - The renderer's pixel ratio, viewport and scissor are never changed. Changing the pixel ratio resizes the canvas, which three refuses mid-XR-session. Each sprite view is set through the render target's own `viewport`/`scissor` instead.
   - The previous render target (the XR framebuffer mid-session) is restored instead of `null`.
   - `renderer.xr.enabled` is off during the bake, so three does not swap in the XR camera.
   - Mipmaps are generated once, after the last view, instead of after each of the N² views.

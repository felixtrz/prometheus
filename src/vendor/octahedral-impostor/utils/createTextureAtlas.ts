import { GLSL3, LinearFilter, LinearMipmapLinearFilter, LinearSRGBColorSpace, NearestFilter, NearestMipMapNearestFilter, ObjectSpaceNormalMap, OrthographicCamera, ShaderMaterial, Sphere, TangentSpaceNormalMap, UnsignedByteType, Vector2, WebGLRenderTarget } from '@iwsdk/core';
import type { IUniform, Mesh, MeshStandardMaterial, Object3D, Texture, WebGLRenderer } from '@iwsdk/core';
import { computeObjectBoundingSphere } from './computeObjectBoundingSphere.js';
import { hemiOctaGridToDir, octaGridToDir } from './octahedronUtils.js';

import fragmentShader from '../shaders/atlas_texture/octahedral_atlas_fragment.glsl?raw';
import vertexShader from '../shaders/atlas_texture/octahedral_atlas_vertex.glsl?raw';

// Local change: the renderer's pixel ratio, viewport and scissor are never touched (a
// pixel-ratio change resizes the canvas, and three refuses that while an XR session is
// presenting). Each view is placed with the render target's own viewport/scissor instead,
// and the previous render target (the XR framebuffer mid-session) and xr.enabled are restored.
type OldRendererData = { renderTarget: WebGLRenderTarget; oldTarget: WebGLRenderTarget | null; oldXR: boolean; oldClearAlpha: number };

/**
 * Parameters used to generate a texture atlas from a 3D object.
 * The atlas is created by rendering multiple views of the object arranged in a grid.
 */
export interface CreateTextureAtlasParams {
  /**
   * The WebGL renderer used to render the object from multiple directions.
   */
  renderer: WebGLRenderer;
  /**
   * Whether to use a hemispherical octahedral projection instead of a full octahedral one.
   * Use this to generate views covering only the upper hemisphere of the object.
   */
  useHemiOctahedron: boolean;
  /**
   * The 3D object to render from multiple directions.
   * Typically a `Mesh`, `Group`, or any `Object3D` hierarchy.
   */
  target: Object3D;
  /**
   * The full size (in pixels) of the resulting square texture atlas.
   * For example, 2048 will result in a 2048×2048 texture.
   * @default 2048
   */
  textureSize?: number;
  /**
   * Number of sprite cells per side of the atlas grid.
   * For example, 16 will result in 16×16 = 256 unique views.
   * @default 16
   */
  spritesPerSide?: number;
  /**
   * A multiplier applied to the camera's distance from the object's bounding sphere.
   * Controls how far the camera is placed from the object when rendering each view.
   * @default 1
   */
  cameraFactor?: number;
}

export interface TextureAtlas {
  /**
   * The WebGL render target used to render the object from multiple directions.
   */
  renderTarget: WebGLRenderTarget;
  /**
   * The albedo texture containing the rendered views of the object.
   * Each sprite cell contains a unique view from a different direction.
   */
  albedo: Texture;
  /**
   * The normal and depth map texture.
   * Contains normals and depth information for each sprite cell.
   * This can be used for lighting and depth effects.
   */
  normalDepth: Texture;
}

const camera = new OrthographicCamera();
const bSphere = new Sphere();
const coords = new Vector2();
const userDataMaterialKey = 'ez_originalMaterial';

export function createTextureAtlas(params: CreateTextureAtlasParams): TextureAtlas {
  const { renderer, target, useHemiOctahedron } = params;

  if (!renderer) throw new Error('"renderer" is mandatory.');
  if (!target) throw new Error('"target" is mandatory.');
  if (useHemiOctahedron == null) throw new Error('"useHemiOctahedron" is mandatory.');

  const atlasSize = params.textureSize ?? 2048;
  const countPerSide = params.spritesPerSide ?? 16;
  const countPerSideMinusOne = countPerSide - 1;
  const spriteSize = atlasSize / countPerSide;

  // with some models, the bounding sphere was not accurate so we rercompute it
  computeObjectBoundingSphere(target, bSphere, true);

  const cameraFactor = params.cameraFactor ?? 1;
  updateCamera();

  const { renderTarget, oldTarget, oldXR, oldClearAlpha } = setupRenderer();
  overrideTargetMaterial(target);

  for (let row = 0; row < countPerSide; row++) {
    for (let col = 0; col < countPerSide; col++) {
      renderView(col, row);
    }
  }

  restoreRenderer();
  restoreTargetMaterial(target);

  return {
    renderTarget,
    albedo: renderTarget.textures[0],
    normalDepth: renderTarget.textures[1]
  };

  function overrideTargetMaterial(target: Object3D): void {
    target.traverse((mesh) => {
      if ((mesh as Mesh).material) {
        const material = (mesh as Mesh).material as MeshStandardMaterial | MeshStandardMaterial[];
        mesh.userData[userDataMaterialKey] = material; // TODO use map instead
        const overrideMaterial = Array.isArray(material) ? material.map((mat) => createMaterial(mat)) : createMaterial(material);
        (mesh as Mesh).material = overrideMaterial;
      }
    });
  }

  function createMaterial(material: MeshStandardMaterial): ShaderMaterial {
    const hasMap = !!material.map;
    const hasAlphaMap = !!material.alphaMap;
    const hasNormalMap = !!material.normalMap;
    const hasBumpMap = !!material.bumpMap;
    const hasDisplacementMap = !!material.displacementMap;
    const hasAlphaTest = material.alphaTest > 0;

    const uniforms: { [uniform: string]: IUniform } = {
      diffuse: { value: material.color },
      opacity: { value: material.opacity }
    };

    // From MeshBasicMaterial

    if (hasAlphaTest) {
      uniforms['alphaTest'] = { value: material.alphaTest };
    }

    if (hasMap) {
      uniforms['map'] = { value: material.map };
      uniforms['mapTransform'] = { value: material.map!.matrix };
    }

    if (hasAlphaMap) {
      uniforms['alphaMap'] = { value: material.alphaMap };
      uniforms['alphaMapTransform'] = { value: material.alphaMap!.matrix };
    }

    // From MeshNormalMaterial and MeshDepthMaterial

    if (hasNormalMap) {
      uniforms['normalMap'] = { value: material.normalMap };
      uniforms['normalScale'] = { value: material.normalScale };
      uniforms['normalMapTransform'] = { value: material.normalMap!.matrix };
    }

    if (hasBumpMap) {
      uniforms['bumpMap'] = { value: material.bumpMap };
      uniforms['bumpScale'] = { value: material.bumpScale };
      uniforms['bumpMapTransform'] = { value: material.bumpMap!.matrix };
    }

    if (hasDisplacementMap) {
      uniforms['displacementMap'] = { value: material.displacementMap };
      uniforms['displacementScale'] = { value: material.displacementScale };
      uniforms['displacementBias'] = { value: material.displacementBias };
      uniforms['displacementMapTransform'] = { value: material.displacementMap!.matrix };
    }

    const defines: Record<string, string> = {};

    if (hasMap || hasAlphaMap || hasNormalMap || hasBumpMap || hasDisplacementMap) {
      defines['USE_UV'] = '';
    }

    const shaderMaterial = new ShaderMaterial({
      uniforms,
      defines,
      vertexShader,
      fragmentShader,
      glslVersion: GLSL3,
      transparent: material.transparent,
      side: material.side,
      alphaHash: material.alphaHash,
      depthFunc: material.depthFunc,
      depthWrite: material.depthWrite,
      depthTest: material.depthTest,
      blending: material.blending,
      blendSrc: material.blendSrc,
      blendDst: material.blendDst,
      blendEquation: material.blendEquation,
      blendSrcAlpha: material.blendSrcAlpha,
      blendDstAlpha: material.blendDstAlpha,
      blendEquationAlpha: material.blendEquationAlpha,
      premultipliedAlpha: material.premultipliedAlpha,
      alphaToCoverage: material.alphaToCoverage,
      blendAlpha: material.blendAlpha,
      blendColor: material.blendColor,
      colorWrite: material.colorWrite,
      forceSinglePass: material.forceSinglePass,
      vertexColors: material.vertexColors,
      precision: material.precision,
      visible: material.visible
    });

    // three's program parameters carry these flags; the public type does not list them.
    shaderMaterial.onBeforeCompile = (parameters) => {
      const shader = parameters as unknown as Record<string, unknown>;
      if (hasMap) {
        shader.map = true;
        shader.mapUv = 'uv';
      }

      if (hasAlphaMap) {
        shader.alphaMap = true;
        shader.alphaMapUv = 'uv';
      }

      if (hasNormalMap) {
        shader.normalMap = true;
        shader.normalMapUv = 'uv';
        shader.normalMapTangentSpace = material.normalMapType === TangentSpaceNormalMap;
        shader.normalMapObjectSpace = material.normalMapType === ObjectSpaceNormalMap;
      }

      if (hasBumpMap) {
        shader.bumpMap = true;
        shader.bumpMapUv = 'uv';
      }

      if (hasDisplacementMap) {
        shader.displacementMap = true;
        shader.displacementMapUv = 'uv';
      }

      shader.flatShading = material.flatShading;
      shader.alphaTest = hasAlphaTest;
    };

    return shaderMaterial;
  }

  function restoreTargetMaterial(target: Object3D): void {
    target.traverse((mesh) => {
      if (mesh.userData[userDataMaterialKey]) {
        (mesh as Mesh).material = mesh.userData[userDataMaterialKey];
        delete mesh.userData[userDataMaterialKey];
      }
    });
  }

  function renderView(col: number, row: number): void {
    // Local change: mipmaps are generated once, after the last view, not after every view.
    const last = col === countPerSideMinusOne && row === countPerSideMinusOne;
    for (const texture of renderTarget.textures) texture.generateMipmaps = last;

    coords.set(col / (countPerSideMinusOne), row / (countPerSideMinusOne));

    if (useHemiOctahedron) hemiOctaGridToDir(coords, camera.position);
    else octaGridToDir(coords, camera.position);

    camera.position.setLength(bSphere.radius * cameraFactor).add(bSphere.center);
    camera.lookAt(bSphere.center);

    const xOffset = (col / countPerSide) * atlasSize;
    const yOffset = (row / countPerSide) * atlasSize;
    renderTarget.viewport.set(xOffset, yOffset, spriteSize, spriteSize);
    renderTarget.scissor.set(xOffset, yOffset, spriteSize, spriteSize);
    renderer.setRenderTarget(renderTarget);
    renderer.render(target, camera);
  }

  function updateCamera(): void {
    camera.left = -bSphere.radius;
    camera.right = bSphere.radius;
    camera.top = bSphere.radius;
    camera.bottom = -bSphere.radius;

    camera.zoom = cameraFactor;
    camera.near = 0.001;
    camera.far = bSphere.radius * 2 + 0.001;

    camera.updateProjectionMatrix();
  }

  function setupRenderer(): OldRendererData {
    const oldTarget = renderer.getRenderTarget();
    const oldXR = renderer.xr.enabled;
    const oldClearAlpha = renderer.getClearAlpha();

    const renderTarget = new WebGLRenderTarget(atlasSize, atlasSize, { count: 2, generateMipmaps: true });
    renderTarget.scissorTest = true;

    const albedo = 0;
    const normalDepth = 1;

    renderTarget.textures[albedo].minFilter = LinearMipmapLinearFilter;
    renderTarget.textures[albedo].magFilter = LinearFilter;
    renderTarget.textures[albedo].type = UnsignedByteType;
    renderTarget.textures[albedo].colorSpace = LinearSRGBColorSpace;
    // renderTarget.textures[albedo].colorSpace = renderer.outputColorSpace;

    renderTarget.textures[normalDepth].minFilter = NearestMipMapNearestFilter;
    renderTarget.textures[normalDepth].magFilter = NearestFilter;
    renderTarget.textures[normalDepth].type = UnsignedByteType; // because is packed
    // renderTarget.textures[normalDepth].type = HalfFloatType; // TODO parametric
    renderTarget.textures[normalDepth].colorSpace = LinearSRGBColorSpace;

    // Rendering with xr.enabled while a session presents would swap in the XR camera.
    renderer.xr.enabled = false;
    // Binding it now allocates the mip chain (generateMipmaps is still true).
    renderer.setRenderTarget(renderTarget);
    renderer.setClearAlpha(0);

    return { renderTarget, oldTarget, oldXR, oldClearAlpha };
  }

  function restoreRenderer(): void {
    renderer.setRenderTarget(oldTarget);
    renderer.xr.enabled = oldXR;
    renderer.setClearAlpha(oldClearAlpha);
  }
}

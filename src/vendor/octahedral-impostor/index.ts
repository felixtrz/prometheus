// Vendored from https://github.com/agargaro/octahedral-impostor (MIT), commit ca0046a.
// See README.md for the local changes. The GLSL chunks are imported by the modules
// below (Vite `?raw`), so this entry exports only the TypeScript API.
export * from './core/octahedralImpostor.js';
export * from './core/octahedralImpostorMaterial.js';

export * from './utils/computeObjectBoundingSphere.js';
export * from './utils/createTextureAtlas.js';
export * from './utils/exportTextureFromRenderTarget.js';
export * from './utils/octahedronUtils.js';

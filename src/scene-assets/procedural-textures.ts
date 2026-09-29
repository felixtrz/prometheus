import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping, SRGBColorSpace } from '@iwsdk/core';

/**
 * DataTexture defaults to nearest sampling without mipmaps, which reads as blocky
 * "voxel" grain up close and shimmers in a headset at distance.
 */
export function smoothSampling(texture: DataTexture, anisotropy = 4): DataTexture {
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

export type GrainOptions = {
  /** Deeper ridges for bark rather than planed timber. */
  bark?: boolean;
  /** Streaks run along U (box-mapped planks) instead of along V (cylinders). */
  alongU?: boolean;
  repeat?: [number, number];
};

/** Low-frequency, stylized grain. Neutral grey so material colour sets the hue. */
export function woodTexture({ bark = false, alongU = false, repeat }: GrainOptions = {}): DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      // Streak coordinate varies across the grain; wobble varies along it.
      const across = alongU ? row : column;
      const along = alongU ? column : row;
      const grain = Math.sin(across * .62 + Math.sin(along * .11) * 1.8);
      const fine = Math.sin(across * 2.7 + along * .13) * .35;
      const knot = Math.sin(Math.hypot((across - 25) * .5, (along - 32) * .15) * 2);
      const value = Math.round(208 + grain * (bark ? 23 : 12) + fine * 12 + knot * 5);
      const i = (row * size + column) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  const [u, v] = repeat ?? (bark ? [1.2, 1.8] : alongU ? [1, 1.5] : [1.5, 1]);
  texture.repeat.set(u, v);
  texture.colorSpace = SRGBColorSpace;
  return smoothSampling(texture);
}

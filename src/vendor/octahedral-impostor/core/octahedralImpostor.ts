import { Material, Matrix4, Mesh, PlaneGeometry, Sphere } from '@iwsdk/core';
import { computeObjectBoundingSphere } from '../utils/computeObjectBoundingSphere.js';
import { createOctahedralImpostorMaterial, isImpostorMaterial } from './octahedralImpostorMaterial.js';
import type { CreateOctahedralImpostor, ImpostorMaterial } from './octahedralImpostorMaterial.js';

export class OctahedralImpostor<M extends Material = Material> extends Mesh<PlaneGeometry, ImpostorMaterial<M>> {
  constructor(materialOrParams: ImpostorMaterial<M> | CreateOctahedralImpostor<M>) {
    let material: ImpostorMaterial<M>;
    if (isImpostorMaterial(materialOrParams)) {
      material = materialOrParams as ImpostorMaterial<M>;
    } else {
      const params = materialOrParams as CreateOctahedralImpostor<M>;
      const sphere = computeObjectBoundingSphere(params.target, new Sphere(), true); // TODO compute it once

      const scale = sphere.radius * 2;
      const translation = sphere.center.clone();
      params.transform = new Matrix4().makeScale(scale, scale, scale).setPosition(translation);

      material = createOctahedralImpostorMaterial(params);
    }

    super(new PlaneGeometry(), material);
  }

  public override clone(): this {
    const impostor = new OctahedralImpostor(this.material);
    impostor.scale.copy(this.scale);
    impostor.position.copy(this.position);
    return impostor as this;
  }
}

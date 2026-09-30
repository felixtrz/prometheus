/**
 * Small visual cues shared by BackpackSystem and HolsterSystem: a canvas text label
 * (the hover hint by a hand, a stack count on a pack slot) and the warm glow colour
 * the item outline uses, pulsing the same way.
 */
import { CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';

export const CUE_COLOR = 0xffb347;
/** 0..1 pulse shared by the slot glow, the holster rings and the hint (matches the item rim's rate). */
export const cuePulse = (elapsed: number) => .5 + .5 * Math.sin(elapsed * 6);

/** Additive-looking glow: transparent, unlit, never fogged, drawn over what it sits on. */
export function glowMaterial(opacity = .6): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: CUE_COLOR, transparent: true, opacity, depthWrite: false, fog: false, side: DoubleSide, toneMapped: false,
  });
}

/**
 * A text quad drawn on a canvas. `set` redraws only when the text changes, so a label
 * can be set every frame without cost. Pale text on a dark pill; plain ASCII.
 */
export class TextLabel {
  readonly mesh: Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: CanvasTexture;
  private readonly material: MeshBasicMaterial;
  private readonly pill: boolean;
  private text = '\u0000';

  constructor(width: number, height: number, pixels = 64, pill = true) {
    this.pill = pill;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(pixels * width / height);
    this.canvas.height = pixels;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.material = new MeshBasicMaterial({
      map: this.texture, transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(width, height), this.material);
    this.mesh.renderOrder = 10;
    this.mesh.raycast = () => {};
    this.mesh.visible = false;
  }

  set(text: string): void {
    if (text === this.text) return;
    this.text = text;
    const context = this.canvas.getContext('2d');
    if (!context) return;
    const { width, height } = this.canvas;
    context.clearRect(0, 0, width, height);
    if (!text) return;
    context.font = `600 ${Math.round(height * .56)}px system-ui, sans-serif`;
    const textWidth = Math.min(width - 4, context.measureText(text).width + height * .7);
    if (this.pill) {
      const x = (width - textWidth) / 2, r = height * .45;
      context.fillStyle = 'rgba(26, 18, 12, 0.78)';
      context.beginPath();
      context.roundRect(x, height * .05, textWidth, height * .9, r);
      context.fill();
      context.strokeStyle = 'rgba(255, 179, 71, 0.85)';
      context.lineWidth = Math.max(2, height * .05);
      context.stroke();
    }
    context.fillStyle = '#fff4e0';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, width / 2, height * .53, width - 8);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

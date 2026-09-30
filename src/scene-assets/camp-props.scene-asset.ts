/**
 * Adapted from the project's authored Drawcall GLTS campfire, bench and backpack.
 * Source snapshots: design/source/*.glts. Shared by runtime and editor.
 * All prototypes are deterministic, parentless, and contain no lifecycle hooks.
 */
import * as THREE from '@iwsdk/core';
import { smoothSampling, woodTexture } from './procedural-textures.js';
import { unify } from './static-batch.js';

type Position = [number, number, number];
const geo = <T extends THREE.BufferGeometry>(value: T): T => value;
const mat = <T extends THREE.Material>(value: T): T => value;

/** Reduce opaque static geometry to one draw per material, retaining named parts. */
function batchStatic(root: THREE.Group): THREE.Group {
  root.updateMatrixWorld(true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const batches = new Map<THREE.Material, THREE.Mesh[]>();
  const visit = (object: THREE.Object3D) => {
    // Named children are gameplay/animation contracts; preserve their whole subtree.
    if (object !== root && object.name) return;
    if (object instanceof THREE.Mesh && !Array.isArray(object.material) && !object.material.transparent) {
      const batch = batches.get(object.material);
      if (batch) batch.push(object);
      else batches.set(object.material, [object]);
    }
    for (const child of object.children) visit(child);
  };
  visit(root);
  let batchIndex = 0;
  for (const [material, meshes] of batches) {
    const wantsColor = (material as THREE.MeshStandardMaterial).vertexColors === true;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    for (const mesh of meshes) {
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      const matrix = new THREE.Matrix4().multiplyMatrices(inverseRoot, mesh.matrixWorld);
      geometry.applyMatrix4(matrix);
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      const p = geometry.getAttribute('position');
      const n = geometry.getAttribute('normal');
      const uv = geometry.getAttribute('uv');
      const c = geometry.getAttribute('color');
      // A mirrored transform flips the winding: swap two corners so faces stay outward.
      const flip = matrix.determinant() < 0;
      for (let k = 0; k < p.count; k++) {
        const i = flip ? k - (k % 3) + [0, 2, 1][k % 3] : k;
        positions.push(p.getX(i), p.getY(i), p.getZ(i));
        normals.push(n.getX(i), n.getY(i), n.getZ(i));
        uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
        if (wantsColor) colors.push(c ? c.getX(i) : 1, c ? c.getY(i) : 1, c ? c.getZ(i) : 1);
      }
      mesh.removeFromParent();
      geometry.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (wantsColor) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `static-${batchIndex++}`;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  return root;
}

/** Paint every vertex of a geometry from its local position (low-poly colour variation). */
function tintBy<T extends THREE.BufferGeometry>(geometry: T, paint: (x: number, y: number, z: number, out: THREE.Color) => void): T {
  const p = geometry.getAttribute('position');
  const colors = new Float32Array(p.count * 3);
  const out = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    paint(p.getX(i), p.getY(i), p.getZ(i), out);
    colors[i * 3] = out.r; colors[i * 3 + 1] = out.g; colors[i * 3 + 2] = out.b;
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Fire ring, charred logs, tripod and pot. Everything static folds into two draws (a
 * vertex-coloured solid and the textured tripod bark); the contracts stay separate:
 * `broth` (FxSystem tints it), `food-bits`, `embers` (the glowing coal bed, shown while
 * lit) and `flame-0..3` (transparent tongues FxSystem flickers).
 */
function makeCampfire(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Campfire and hanging pot';
  const barkMap = woodTexture({ bark: true });
  // The two materials everything static folds into.
  const solids = mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, flatShading: true }));
  solids.name = 'Campfire solids';
  const barkWood = mat(new THREE.MeshStandardMaterial({ vertexColors: true, map: barkMap, roughness: .95, flatShading: true }));
  barkWood.name = 'Campfire tripod bark';
  // Source tints (folded into vertex colours by unify below).
  const bark = mat(new THREE.MeshStandardMaterial({ color:0x95623f }));
  const barkDark = mat(new THREE.MeshStandardMaterial({ color:0x6a4631 }));
  const cutDark = mat(new THREE.MeshStandardMaterial({ color:0x7b5439 }));
  const rope = mat(new THREE.MeshStandardMaterial({ color:0xb0935b }));
  const iron = mat(new THREE.MeshStandardMaterial({ color:0x30363a }));
  const ironEdge = mat(new THREE.MeshStandardMaterial({ color:0x525a5f }));
  const soot = mat(new THREE.MeshStandardMaterial({ color:0x202326 }));
  const stew = mat(new THREE.MeshStandardMaterial({ color:0x5b2e1d, roughness:.55 }));
  const stewBitA = mat(new THREE.MeshStandardMaterial({color:0xb3652d}));
  const stewBitB = mat(new THREE.MeshStandardMaterial({color:0xc99b57}));
  const ash = mat(new THREE.MeshStandardMaterial({ color:0x8c8580 }));
  const coal = mat(new THREE.MeshStandardMaterial({ color:0x332821 }));
  const flameA = mat(new THREE.MeshBasicMaterial({ color:0xff8a22, transparent:true, opacity:.9, depthWrite:false, side:THREE.DoubleSide, forceSinglePass:true }));
  const flameB = mat(new THREE.MeshBasicMaterial({ color:0xffd75a, transparent:true, opacity:.95, depthWrite:false, side:THREE.DoubleSide, forceSinglePass:true }));
  const flameC = mat(new THREE.MeshBasicMaterial({ color:0xfff2b0, transparent:true, opacity:.98, depthWrite:false, side:THREE.DoubleSide, forceSinglePass:true }));
  const stoneMats = [0x6d706b,0x7b7d76,0x5f645f,0x858278].map(c=>mat(new THREE.MeshStandardMaterial({color:c})));
  const stoneSoot = mat(new THREE.MeshStandardMaterial({color:0x4a4a47}));

  function cyl(rt:number,rb:number,h:number,seg:number,pos:[number,number,number],m:THREE.Material,parent:THREE.Object3D=root){const mesh=new THREE.Mesh(geo(new THREE.CylinderGeometry(rt,rb,h,seg)),m);mesh.position.set(...pos);parent.add(mesh);return mesh;}
  function chamfer(size:[number,number,number],_r:number,pos:[number,number,number],m:THREE.Material,parent=root){const mesh=new THREE.Mesh(geo(new THREE.BoxGeometry(size[0],size[1],size[2])),m);mesh.position.set(...pos);parent.add(mesh);return mesh;}
  function cylinderBetween(a:THREE.Vector3,b:THREE.Vector3,r:number,m:THREE.Material,segments=7){const mesh=new THREE.Mesh(geo(new THREE.CylinderGeometry(r,r,a.distanceTo(b),segments)),m);mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());root.add(mesh);return mesh;}

  // Fire ring: faceted, irregular river stones of varied size; some sooted, so the ring reads as used.
  for(let i=0;i<12;i++){
    const a=i/12*Math.PI*2; const g=geo(new THREE.IcosahedronGeometry(.17,1));
    const p=g.attributes.position as THREE.BufferAttribute;
    const seed=i*2.37+.7;
    for(let v=0;v<p.count;v++){
      // Position-based lumps keep shared corners welded (no cracks) and give each stone its own shape.
      const vx=p.getX(v), vy=p.getY(v), vz=p.getZ(v);
      const lump=1+.24*Math.sin(vx*14+seed)*Math.cos(vz*12-seed*.8)+.12*Math.sin(vy*18+seed*1.9);
      p.setXYZ(v,vx*lump,Math.max(-.075,vy*lump*.8),vz*lump);
    }
    g.computeVertexNormals();
    const stone=new THREE.Mesh(g,i%4===1?stoneSoot:stoneMats[i%stoneMats.length]);
    const r=.58+(i%3)*.025; stone.position.set(Math.cos(a)*r,.1+(i%2)*.02,Math.sin(a)*r);
    stone.scale.set(.9+((i*7)%5)*.09,.62+((i*3)%4)*.08,.85+((i*5)%3)*.1);
    stone.rotation.set(.12*Math.sin(i*1.3),a*.35+i*.9,.1*Math.cos(i*2.1)); root.add(stone);
  }

  // Ash bed and cold charcoal under the logs.
  cyl(.50,.54,.03,10,[0,.08,0],ash);
  const coals: [number, number, number, number][] = [];
  for(let i=0;i<10;i++){const a=i/10*Math.PI*2;const r=.20+(i%2)*.035;coals.push([Math.cos(a)*r,Math.sin(a)*r,.055+(i%3)*.009,a]);}
  for(const [x,z,s] of coals){const c=new THREE.Mesh(geo(new THREE.DodecahedronGeometry(s,0)),coal);c.position.set(x,.17,z);c.scale.y=.58;root.add(c);}

  // Glowing bed (named, shown while lit): a small dim core and coals that glow from beneath,
  // one unlit vertex-coloured draw. Replaces the bright plastic-looking disc.
  {
    const embers = new THREE.Group(); embers.name = 'embers'; embers.visible = false; root.add(embers);
    const emberMat = mat(new THREE.MeshBasicMaterial({ vertexColors: true }));
    emberMat.name = 'Campfire embers';
    const hot = new THREE.Color(0xd2521c), deep = new THREE.Color(0x6e1f0c), bright = new THREE.Color(0xff8a3a), dark = new THREE.Color(0x2a140c);
    const parts: THREE.BufferGeometry[] = [];
    const core = tintBy(new THREE.CylinderGeometry(.24,.26,.03,10).toNonIndexed(),(x,_y,z,out)=>{out.copy(hot).lerp(deep,Math.min(1,Math.hypot(x,z)/.26)*.8);});
    parts.push(core.translate(0,.1,0));
    for(const [x,z,s,a] of coals){
      // Glowing underside and cracks, dark crust on top, just proud of the cold coal.
      const g=tintBy(new THREE.DodecahedronGeometry(s*1.04,0),(vx,vy,vz,out)=>{const k=Math.max(0,Math.min(1,(vy/s+.35)*1.2+.25*Math.sin(vx*90+vz*70+a)));out.copy(bright).lerp(dark,k);});
      g.scale(1,.58,1).rotateY(a).translate(x,.17,z);
      parts.push(g);
    }
    for(let i=0;i<7;i++){const a=i*2.4+.3,r=.08+(i%3)*.05;parts.push(tintBy(new THREE.DodecahedronGeometry(.03,0),(_x,vy,_z,out)=>{out.copy(bright).lerp(hot,vy>0?.6:0);}).scale(1,.6,1).translate(Math.cos(a)*r,.12,Math.sin(a)*r));}
    const merged = new THREE.BufferGeometry();
    const pos: number[] = [], col: number[] = [];
    for (const part of parts) {
      const p = part.getAttribute('position'), c = part.getAttribute('color');
      for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); col.push(c.getX(i), c.getY(i), c.getZ(i)); }
      part.dispose();
    }
    merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    merged.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    merged.computeBoundingSphere();
    const bed = new THREE.Mesh(merged, emberMat);
    bed.name = 'ember-bed';
    embers.add(bed);
  }

  // Two crossed logs, burnt through: charcoal with ash-grey crazing and black cut ends, so they
  // never read as the sawn 'log' item.
  const charcoal = (x: number, y: number, z: number, out: THREE.Color) => {
    const craze = Math.abs(Math.sin(y * 31 + Math.atan2(z, x) * 5)) * Math.abs(Math.sin(y * 13 - Math.atan2(z, x) * 3));
    out.setHex(0x221c19).lerp(new THREE.Color(0x5e5750), craze > .72 ? .55 : 0).multiplyScalar(.9 + .2 * Math.sin(y * 47 + x * 9));
  };
  for(const [rotY,z] of [[Math.PI/4,.025],[-Math.PI/4,-.025]] as [number,number][]){
    const log=new THREE.Mesh(geo(tintBy(new THREE.CylinderGeometry(.105,.125,1.0,8,4).toNonIndexed(),charcoal)),solids); log.rotation.z=Math.PI/2; log.rotation.y=rotY; log.position.set(0,.23,z); root.add(log);
  }
  // A third, smaller split log leaning in, charred the same way.
  {
    const split=new THREE.Mesh(geo(tintBy(new THREE.CylinderGeometry(.07,.08,.62,8,3,false,0,Math.PI).toNonIndexed(),charcoal)),solids);
    split.rotation.set(0,1.1,Math.PI/2+.45); split.position.set(.10,.30,.18); root.add(split);
    const face=new THREE.Mesh(geo(tintBy(new THREE.PlaneGeometry(.15,.62,1,3).toNonIndexed(),(_x,y,_z,out)=>{out.setHex(0x2c2420).multiplyScalar(.85+.3*Math.abs(Math.sin(y*40)));})),solids);
    face.rotation.copy(split.rotation); face.rotateY(Math.PI/2); face.position.copy(split.position); root.add(face);
  }

  // Flames: four lathe tongues rising clear of the logs, gently animated (FxSystem).
  let flameIndex = 0;
  function flame(profileScale:number,x:number,z:number,h:number,m:THREE.Material,rot=0){
    const pts=[new THREE.Vector2(.11*profileScale,0),new THREE.Vector2(.18*profileScale,.10*h),new THREE.Vector2(.14*profileScale,.35*h),new THREE.Vector2(.07*profileScale,.68*h),new THREE.Vector2(.018*profileScale,.95*h),new THREE.Vector2(0,h)];
    const f=new THREE.Mesh(geo(new THREE.LatheGeometry(pts,7)),m);f.position.set(x,.22,z);f.rotation.y=rot;f.name = `flame-${flameIndex++}`;root.add(f);return f;
  }
  flame(1.05,0,0,.58,flameA); flame(.78,-.10,.035,.50,flameB,.3); flame(.74,.11,-.03,.45,flameA,-.4); flame(.55,-.02,.01,.36,flameC,.9);
  // The camp's one fixed point light (the second dynamic light is FxSystem's roaming flame light).
  const fireGlow = new THREE.PointLight(0xff8a43, 2.8, 1.85, 2);
  fireGlow.position.set(0, .58, .02);
  fireGlow.castShadow = false;
  fireGlow.name = 'fire-glow';
  root.add(fireGlow);
  // Tripod of debarked poles, lashed at the apex, feet outside the ring.
  const apex=new THREE.Vector3(0,1.90,0);
  const footRadius=1.06;
  const tripodOffset=-0.35;
  for(const [baseA,side] of [[-Math.PI/2,-1],[Math.PI/6,1],[Math.PI*5/6,1]] as [number,number][]){
    const a=baseA+tripodOffset;
    const foot=new THREE.Vector3(Math.cos(a)*footRadius,.03,Math.sin(a)*footRadius);
    cylinderBetween(foot,apex,.037,barkDark,10);
    const mid=foot.clone().lerp(apex,.43); const peg=cyl(.018,.024,.12,6,[mid.x,mid.y,mid.z],bark); peg.rotation.z=.65*side; peg.rotation.y=-a;
    // stubby cut branch nubs make each pole a real found stick rather than a dowel
    const nub=foot.clone().lerp(apex,.68); const n=cyl(.012,.018,.07,6,[nub.x,nub.y,nub.z],bark); n.rotation.z=-.9*side; n.rotation.y=a*.5;
  }
  for(let i=0;i<5;i++){const lash=new THREE.Mesh(geo(new THREE.TorusGeometry(.098+i*.004,.010,4,12)),rope);lash.rotation.x=Math.PI/2;lash.position.set(0,1.79-i*.017,0);root.add(lash);}
  for(const rz of [-.55,.55]){const tie=cyl(.009,.009,.24,5,[0,1.76,0],rope);tie.rotation.z=rz;}

  // Iron chain from the lashing down to an S-hook that carries the bail.
  for(let i=0;i<6;i++){
    const link=new THREE.Mesh(geo(new THREE.TorusGeometry(.024,.006,4,8)),ironEdge);
    link.scale.y=1.35; link.rotation.y=i%2?Math.PI/2:0; link.position.set(0,1.75-i*.042,0); root.add(link);
  }
  const hook=new THREE.Mesh(geo(new THREE.TorusGeometry(.052,.010,4,10,Math.PI*1.45)),ironEdge);hook.rotation.z=Math.PI*.78;hook.position.set(0,1.505,0);root.add(hook);

  // Cast-iron pot with soot band, riveted lugs and an upward bail hanging from the hook.
  const profile=[new THREE.Vector2(.245,-.18),new THREE.Vector2(.29,-.17),new THREE.Vector2(.34,-.10),new THREE.Vector2(.355,.04),new THREE.Vector2(.345,.14),new THREE.Vector2(.325,.18)];
  const potBody=new THREE.Mesh(geo(new THREE.LatheGeometry(profile,10)),iron);potBody.position.y=.99;root.add(potBody);
  const sootBand=new THREE.Mesh(geo(new THREE.TorusGeometry(.285,.022,4,10)),soot);sootBand.rotation.x=Math.PI/2;sootBand.position.y=.84;root.add(sootBand);
  const rim=new THREE.Mesh(geo(new THREE.TorusGeometry(.335,.022,4,10)),ironEdge);rim.rotation.x=Math.PI/2;rim.position.y=1.17;root.add(rim);
  cyl(.305,.305,.012,10,[0,1.158,0],soot);
  cyl(.275,.275,.008,10,[0,1.166,0],stew).name = 'broth';
  const foodBits = new THREE.Group();
  foodBits.name = 'food-bits';
  foodBits.visible = false;
  root.add(foodBits);
  for(let i=0;i<6;i++){
    const bit=new THREE.Mesh(geo(new THREE.IcosahedronGeometry(.038,0)),i%2?stewBitB:stewBitA);
    bit.name = i % 2 ? 'mushroom-piece' : 'meat-piece';
    bit.position.set(Math.cos(i*Math.PI/3)*.14,1.184,Math.sin(i*Math.PI/3)*.14);
    foodBits.add(bit);
  }
  for(const x of [-.345,.345]){
    chamfer([.07,.085,.085],.010,[x,1.11,0],ironEdge);
    for(const dz of [-.025,.025]) cyl(.011,.011,.012,6,[x+(x<0?-.036:.036),1.11,dz],iron).rotation.z=Math.PI/2;
  }
  const bail=new THREE.Mesh(geo(new THREE.TorusGeometry(.345,.015,5,18,Math.PI)),ironEdge);bail.position.y=1.12;root.add(bail);
  // wooden grip on the bail top so a VR hand has an obvious place to grab
  const grip=cyl(.024,.024,.16,8,[0,1.465,0],cutDark);grip.rotation.z=Math.PI/2;

  // Fold every tint into the two shared materials; the broth keeps its own (FxSystem tints it).
  unify(root, barkWood, (m) => m !== bark && m !== barkDark);
  unify(root, solids, (m) => m === barkWood || m === stew || m instanceof THREE.MeshBasicMaterial);
  return batchStatic(root);
}

function makeBench(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Slotted crafting bench';

  // Planks, aprons and rails are long in X, so their grain streaks along U;
  // legs stand in Y and keep the default along-V grain.
  const plankMap = woodTexture({ alongU: true });
  const legMap = woodTexture({ repeat: [1, 1.2] });
  // Warm stained timber matching the GLTS bench, not the earlier grey-beige.
  const texturedWood = (color: number, roughness = .84, map = plankMap) =>
    mat(new THREE.MeshStandardMaterial({ color, map, roughness, flatShading: true }));

  const woodA = texturedWood(0xbd8150, 0.80);
  const woodB = texturedWood(0xa96f44, 0.86);
  const woodDark = texturedWood(0x7f5132, 0.92);
  const woodLeg = texturedWood(0x7f5132, 0.92, legMap);
  const woodEdge = texturedWood(0xc68d58, 0.80);
  const slotBase = mat(new THREE.MeshStandardMaterial({ color: 0x4a3c33, roughness: 0.98 }));
  const slotRail = mat(new THREE.MeshStandardMaterial({ color: 0xb08853, roughness: 0.90 }));
  const metalDark = mat(new THREE.MeshStandardMaterial({ color: 0x484f54, roughness: 0.72, metalness: 0.08 }));
  const iron = mat(new THREE.MeshStandardMaterial({ color: 0x363c40, roughness: 0.76, metalness: 0.12 }));
  function chamfer(size: [number, number, number], _radius: number, pos: [number, number, number], material: THREE.Material, parent = root) {
    const m = new THREE.Mesh(geo(new THREE.BoxGeometry(size[0], size[1], size[2])), material);
    m.position.set(...pos); parent.add(m); return m;
  }
  function box(size: [number, number, number], pos: [number, number, number], material: THREE.Material, parent = root) {
    const m = new THREE.Mesh(geo(new THREE.BoxGeometry(...size)), material);
    m.position.set(...pos); parent.add(m); return m;
  }
  function cyl(rt: number, rb: number, h: number, seg: number, pos: [number, number, number], material: THREE.Material, parent = root) {
    const m = new THREE.Mesh(geo(new THREE.CylinderGeometry(rt, rb, h, Math.min(seg, 8))), material);
    m.position.set(...pos); parent.add(m); return m;
  }

  // Worktop: three substantial planks, crisp overall with tiny edge breaks.
  for (const [z, material, y, rz] of [
    [-0.31, woodB, 0.86, -0.004],
    [ 0.00, woodA, 0.868, 0.003],
    [ 0.31, woodB, 0.858, -0.002],
  ] as [number, THREE.Material, number, number][]) {
    const p = chamfer([2.48, 0.13, 0.285], 0.014, [0, y, z], material);
    p.rotation.z = rz;
  }
  // End battens and underside apron.
  for (const x of [-1.20, 1.20]) chamfer([0.11, 0.16, 0.91], 0.012, [x, 0.80, 0], woodEdge);
  for (const z of [-0.43, 0.43]) chamfer([2.28, 0.13, 0.095], 0.012, [0, 0.70, z], woodDark);

  // Legs with square feet and visible pegged joinery.
  for (const x of [-0.98, 0.98]) for (const z of [-0.34, 0.34]) {
    chamfer([0.17, 0.78, 0.17], 0.012, [x, 0.40, z], woodLeg);
    chamfer([0.23, 0.07, 0.23], 0.012, [x, 0.035, z], woodB);
    const peg = cyl(0.018, 0.018, 0.012, 12, [x + (x < 0 ? -0.086 : 0.086), 0.73, z], woodEdge);
    peg.rotation.z = Math.PI / 2;
  }
  // Lower stretchers and shelf planks.
  for (const z of [-0.35, 0.35]) chamfer([1.92, 0.09, 0.095], 0.010, [0, 0.29, z], woodDark);
  for (const z of [-0.16, 0.16]) chamfer([1.86, 0.065, 0.28], 0.010, [0, 0.315, z], z < 0 ? woodA : woodB);
  // Side cross braces.
  for (const x of [-1.02, 1.02]) {
    const b1 = box([0.065, 0.065, 0.72], [x, 0.44, 0], woodEdge); b1.rotation.x = 0.78;
    const b2 = box([0.065, 0.065, 0.72], [x, 0.44, 0], woodEdge); b2.rotation.x = -0.78;
  }

  // Four explicit crafting bays built as real rails around a shallow base.
  const slotCenters = [-0.83, -0.28, 0.28, 0.83];
  for (const x of slotCenters) {
    chamfer([0.46, 0.026, 0.54], 0.008, [x, 0.974, 0], slotBase);
    chamfer([0.50, 0.038, 0.032], 0.008, [x, 1.003, -0.292], slotRail);
    chamfer([0.50, 0.038, 0.032], 0.008, [x, 1.003,  0.292], slotRail);
    chamfer([0.032, 0.038, 0.59], 0.008, [x - 0.251, 1.003, 0], slotRail);
    chamfer([0.032, 0.038, 0.59], 0.008, [x + 0.251, 1.003, 0], slotRail);
    // tiny metal registration pins communicate snap points without UI
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.012, 0.012, 0.016, 10, [x + sx * 0.205, 1.026, sz * 0.247], iron);
  }

  // Iron corner brackets and nail heads make the bench feel assembled, not molded.
  for (const x of [-1.17, 1.17]) for (const z of [-0.40, 0.40]) {
    chamfer([0.07, 0.035, 0.15], 0.006, [x, 0.917, z], metalDark);
    cyl(0.013, 0.013, 0.010, 10, [x, 0.939, z], iron);
  }
  for (const x of [-0.92, -0.46, 0, 0.46, 0.92]) {
    for (const z of [-0.37, 0.37]) cyl(0.012, 0.012, 0.010, 10, [x, 0.936, z], iron);
  }

  // Two draws: every plank, rail and fitting on the plank grain; the legs on their own grain.
  const planks = mat(new THREE.MeshStandardMaterial({ vertexColors: true, map: plankMap, roughness: .85, flatShading: true }));
  planks.name = 'Bench planks and fittings';
  const legs = mat(new THREE.MeshStandardMaterial({ vertexColors: true, map: legMap, roughness: .92, flatShading: true }));
  legs.name = 'Bench legs';
  unify(root, legs, (m) => m !== woodLeg);
  unify(root, planks, (m) => m === legs);
  return batchStatic(root);
}

/**
 * The backpack's slot panel: the canvas sheet that unrolls, upright, from the pack held in a
 * hand (BackpackSystem). Origin at the centre of its top edge (the roll it hangs from), facing
 * +Z; nine pockets on a 18 cm grid, centres at x -.18/0/.18 and y -.13/-.31/-.49.
 */
function makeBackpack(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Backpack slot panel';
  // Procedural low-frequency weave and leather grain: cheap, stylized, no photoreal microdetail.
  function weaveTexture(base:[number,number,number], contrast=10, size=64, repeat:[number,number]=[6,4]){
    const data=new Uint8Array(size*size*4);
    for(let y=0;y<size;y++) for(let x=0;x<size;x++){
      const i=(y*size+x)*4; const warp=(x%8<2?contrast:0)+(y%8>=4&&y%8<6?contrast*.65:0); const n=((x*7+y*11)%7)-3;
      data[i]=Math.max(0,Math.min(255,base[0]+warp+n)); data[i+1]=Math.max(0,Math.min(255,base[1]+warp*.82+n)); data[i+2]=Math.max(0,Math.min(255,base[2]+warp*.62+n)); data[i+3]=255;
    }
    const t=new THREE.DataTexture(data,size,size,THREE.RGBAFormat); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(repeat[0],repeat[1]); t.colorSpace=THREE.SRGBColorSpace; return smoothSampling(t);
  }
  const canvasMap=weaveTexture([176,176,176],12,64,[2,2]);
  const canvas=mat(new THREE.MeshStandardMaterial({color:0x9c826a,map:canvasMap,roughness:.97}));
  const pocket=mat(new THREE.MeshStandardMaterial({color:0x7d6750,map:canvasMap,roughness:.98}));
  const binding=mat(new THREE.MeshStandardMaterial({color:0xc9a86f,roughness:.94}));
  const leather=mat(new THREE.MeshStandardMaterial({color:0x6b4a34,roughness:.9}));
  const brass=mat(new THREE.MeshStandardMaterial({color:0xc4954f,roughness:.55,metalness:.22}));
  function box(size:[number,number,number],pos:Position,m:THREE.Material){const mesh=new THREE.Mesh(geo(new THREE.BoxGeometry(...size)),m);mesh.position.set(...pos);root.add(mesh);return mesh;}
  function rod(radius:number,length:number,pos:Position,m:THREE.Material){const mesh=new THREE.Mesh(geo(new THREE.CylinderGeometry(radius,radius,length,9)),m);mesh.position.set(...pos);mesh.rotation.z=Math.PI/2;root.add(mesh);return mesh;}
  const cols=[-.18,0,.18], rows=[-.13,-.31,-.49];
  // The sheet, bound at the edges, rolled at the top and weighted at the bottom.
  box([.58,.6,.008],[0,-.31,-.004],canvas);
  for(const x of [-.29,.29]) box([.018,.6,.012],[x,-.31,-.002],binding);
  rod(.028,.62,[0,0,0],leather);
  rod(.014,.6,[0,-.61,0],leather);
  for(const x of [-.31,.31]) { rod(.03,.012,[x,0,0],brass); rod(.016,.012,[x,-.61,0],brass); }
  // Nine pockets: a darker backing, a stitched lip along the bottom and binding up the sides.
  for(const x of cols) for(const y of rows){
    box([.16,.16,.006],[x,y,.004],pocket);
    box([.165,.022,.016],[x,y-.08,.01],binding);
    for(const sx of [-1,1]) box([.01,.16,.01],[x+sx*.082,y,.006],binding);
    for(const sx of [-1,1]) { const pin=new THREE.Mesh(geo(new THREE.CylinderGeometry(.006,.006,.008,8)),brass); pin.rotation.x=Math.PI/2; pin.position.set(x+sx*.07,y-.08,.02); root.add(pin); }
  }
  // Two draws: canvas and bindings on the weave; leather and brass on their own.
  const canvasAll=mat(new THREE.MeshStandardMaterial({vertexColors:true,map:canvasMap,roughness:.97})); canvasAll.name='Pack canvas';
  const leatherAll=mat(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8,metalness:.1})); leatherAll.name='Pack leather and fittings';
  unify(root,canvasAll,(m)=>m!==canvas&&m!==pocket&&m!==binding);
  unify(root,leatherAll,(m)=>m===canvasAll);
  return batchStatic(root);
}

export const campfire = makeCampfire();
export const bench = makeBench();
export const backpack = makeBackpack();

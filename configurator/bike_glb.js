import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildWheel, mat } from './bike.js';

const cache = new Map();

export function loadGlb(url) {
  if (!cache.has(url)) {
    cache.set(url, new GLTFLoader().loadAsync(url).then((gltf) => {
      gltf.scene.traverse((o) => {
        if (o.isMesh) o.geometry = toCreasedNormals(o.geometry, THREE.MathUtils.degToRad(40));
      });
      return gltf.scene;
    }));
  }
  return cache.get(url);
}

const SUPERMOTO_R = 0.3; // 17in rim + street tire

function brakeKit(color) {
  const g = new THREE.Group();
  const m = mat(color, { metal: 0.8, rough: 0.3 });
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.04), m);
  caliper.position.set(-0.1, 0.05, 0.05);
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.012), m);
  bracket.position.set(-0.06, 0.1, 0.045);
  const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.004, 48), mat('#c9c9cf', { metal: 0.9, rough: 0.3 }));
  rotor.rotation.x = Math.PI / 2;
  rotor.position.z = 0.04;
  g.add(caliper, bracket, rotor);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return g;
}

export async function createGlbBike(spec) {
  const src = await loadGlb(spec.glb);
  const root = new THREE.Group();
  const model = src.clone(true);
  const frameMat = mat('#0c0c0e', { metal: 0.0, rough: 0.75 });
  const wheelMat = mat('#0e0e10', { metal: 0.1, rough: 0.85 });
  // Scanned/exported STLs often aren't closed shells; render both sides so open edges don't look hollow.
  const solidMat = mat('#1a1a1d', { metal: 0.15, rough: 0.6 }).clone();
  solidMat.side = THREE.DoubleSide;
  const wheels = {};
  let meshes = 0;
  model.traverse((o) => { if (o.isMesh) meshes++; });
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    const isWheel = o.name.startsWith('wheel');
    o.material = isWheel ? wheelMat : meshes === 1 ? solidMat : frameMat;
    if (isWheel) wheels[o.name.endsWith('front') ? 'front' : 'rear'] = o;
  });
  root.add(model);

  const swap = new THREE.Group();
  const brake = new THREE.Group();
  root.add(swap, brake);

  const api = {
    root,
    setFrameColor() {},
    dispose() {}, // geometry is shared through the cache
    setSlot(slot, variant = 'stock', color = null) {
      if (slot === 'rims') {
        swap.clear();
        const stock = variant === 'stock';
        for (const k of ['front', 'rear']) {
          wheels[k].visible = stock;
          if (stock) continue;
          const w = buildWheel(SUPERMOTO_R, 'street', 'forged', color || '#d9d9de');
          w.position.copy(wheels[k].position);
          w.position.y = SUPERMOTO_R;
          w.traverse((o) => { if (o.isMesh) o.castShadow = true; });
          swap.add(w);
        }
        return swap;
      }
      if (slot === 'brakes') {
        brake.clear();
        if (variant !== 'stock') {
          const kit = brakeKit(color || '#222226');
          kit.position.copy(wheels.rear.position);
          brake.add(kit);
        }
        return brake;
      }
      return new THREE.Group();
    }
  };
  return api;
}

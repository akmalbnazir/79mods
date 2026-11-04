import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildRim, mat } from './bike.js?v=release-finishes-31';

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

function splitWheelRegions(model, profiles) {
  model.updateMatrixWorld(true);
  const geometries = [];
  const meshes = [];
  model.traverse((object) => { if (object.isMesh) meshes.push(object); });
  for (const mesh of meshes) {
    const source = mesh.geometry;
    const positions = source.attributes.position;
    const index = source.index;
    const faces = { frame: [], front: [], rear: [] };
    const points = Array.from({ length: 3 }, () => new THREE.Vector3());
    const count = index ? index.count : positions.count;
    for (let offset = 0; offset < count; offset += 3) {
      const vertices = points.map((point, corner) => {
        const vertex = index ? index.getX(offset + corner) : offset + corner;
        point.fromBufferAttribute(positions, vertex).applyMatrix4(mesh.matrixWorld);
        return vertex;
      });
      const side = ['front', 'rear'].find((side) => {
        const profile = profiles[side];
        return points.every((point) => Math.abs(point.z - profile.center[2]) <= profile.tireHalfWidth
          && Math.hypot(point.x - profile.center[0], point.y - profile.center[1]) <= profile.outerRadius);
      });
      faces[side || 'frame'].push(...vertices);
    }
    const geometryForFaces = (vertices) => {
      const geometry = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(source.attributes)) {
        const values = new attribute.array.constructor(vertices.length * attribute.itemSize);
        for (let offset = 0; offset < vertices.length; offset++) {
          const vertex = vertices[offset];
          for (let component = 0; component < attribute.itemSize; component++) {
            values[offset * attribute.itemSize + component] = attribute.array[vertex * attribute.itemSize + component];
          }
        }
        geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized));
      }
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      geometries.push(geometry);
      return geometry;
    };
    mesh.geometry = geometryForFaces(faces.frame);
    for (const side of ['front', 'rear']) {
      if (!faces[side].length) throw new Error(`Unable to split ${side} wheel for ${mesh.name}`);
      const wheel = mesh.clone();
      wheel.name = `wheel_${side}`;
      wheel.geometry = geometryForFaces(faces[side]);
      mesh.parent.add(wheel);
    }
  }
  return geometries;
}

function stockTire(wheel, center, innerRadius, profile) {
  const source = wheel.geometry;
  const positions = source.attributes.position;
  const index = source.index;
  const attributes = Object.entries(source.attributes).filter(([name]) => name !== 'normal');
  const output = Object.fromEntries(attributes.map(([name]) => [name, []]));
  output.normal = [];
  const hardwareFaces = [];
  const readVertex = (i) => {
    const point = new THREE.Vector3().fromBufferAttribute(positions, i);
    const world = point.clone().applyMatrix4(wheel.matrixWorld);
    const values = Object.fromEntries(attributes.map(([name, attr]) => [
      name, Array.from({ length: attr.itemSize }, (_, j) => attr.array[i * attr.itemSize + j])
    ]));
    values.normal = new THREE.Vector3().fromBufferAttribute(source.attributes.normal, i).toArray();
    return { world, values };
  };
  const radius = (v) => Math.hypot(v.world.x - center.x, v.world.y - center.y);
  const intersect = (a, b) => {
    const d = b.world.clone().sub(a.world);
    const x = a.world.x - center.x, y = a.world.y - center.y;
    const aa = d.x * d.x + d.y * d.y;
    const bb = 2 * (x * d.x + y * d.y);
    const cc = x * x + y * y - innerRadius * innerRadius;
    const discriminant = Math.sqrt(Math.max(0, bb * bb - 4 * aa * cc));
    const roots = [(-bb - discriminant) / (2 * aa), (-bb + discriminant) / (2 * aa)];
    const t = roots.find((r) => r >= -1e-8 && r <= 1 + 1e-8);
    if (t === undefined) throw new Error(`Invalid tire bead intersection for ${wheel.name}`);
    const values = Object.fromEntries(Object.entries(a.values).map(([name, value]) => [
      name, value.map((n, j) => THREE.MathUtils.lerp(n, b.values[name][j], t))
    ]));
    values.normal = new THREE.Vector3().fromArray(values.normal).normalize().toArray();
    return { world: a.world.clone().lerp(b.world, t), values };
  };
  const count = index ? index.count : positions.count;
  for (let i = 0; i < count; i += 3) {
    const triangle = [0, 1, 2].map((j) => readVertex(index ? index.getX(i + j) : i + j));
    if (profile) {
      // This scan includes fork fragments outside the rubber and print supports inside it.
      const axial = triangle.map((v) => v.world.z - center.z);
      if (axial.every((z) => z > profile.tireHalfWidth)
        || axial.every((z) => z < -profile.tireHalfWidth)) {
        hardwareFaces.push(...[0, 1, 2].map((j) => index ? index.getX(i + j) : i + j));
      }
      if (triangle.some((v) => Math.abs(v.world.z - center.z) > profile.tireHalfWidth)) continue;
      const centroid = triangle.reduce((sum, v) => sum.add(v.world), new THREE.Vector3()).multiplyScalar(1 / 3);
      if (triangle.every((v) => Math.abs(v.world.z - center.z) < profile.width * 0.3)
        && Math.hypot(centroid.x - center.x, centroid.y - center.y) < innerRadius + 0.005) continue;
    }
    const polygon = [];
    for (let j = 0; j < 3; j++) {
      const a = triangle[j], b = triangle[(j + 1) % 3];
      const outsideA = radius(a) >= innerRadius, outsideB = radius(b) >= innerRadius;
      if (outsideA) polygon.push(a);
      if (outsideA !== outsideB) polygon.push(intersect(a, b));
    }
    for (let j = 1; j < polygon.length - 1; j++) {
      for (const vertex of [polygon[0], polygon[j], polygon[j + 1]]) {
        for (const [name, values] of Object.entries(vertex.values)) output[name].push(...values);
      }
    }
  }
  if (!output.position.length) throw new Error(`Unable to isolate the stock tire for ${wheel.name}`);
  const geometry = new THREE.BufferGeometry();
  for (const [name, values] of Object.entries(output)) {
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(
      values, name === 'normal' ? 3 : source.attributes[name].itemSize
    ));
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const tire = wheel.clone();
  tire.name = `${wheel.name}_stock_tire`;
  tire.geometry = geometry;
  tire.visible = false;
  if (hardwareFaces.length) {
    const hardwareGeometry = source.clone();
    hardwareGeometry.setIndex(hardwareFaces);
    const hardware = new THREE.Mesh(hardwareGeometry, wheel.material);
    hardware.name = `${wheel.name}_brake_and_axle`;
    hardware.castShadow = hardware.receiveShadow = true;
    tire.add(hardware);
  }
  wheel.parent.add(tire);
  return tire;
}

export async function createGlbBike(spec) {
  const src = await loadGlb(spec.glb);
  const root = new THREE.Group();
  const model = src.clone(true);
  const splitGeometries = spec.splitWheelRegions ? splitWheelRegions(model, spec.wheelPreview) : [];
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
    if (!spec.preserveMaterials) o.material = isWheel ? wheelMat : meshes === 1 ? solidMat : frameMat;
    if (isWheel) wheels[o.name.endsWith('front') ? 'front' : 'rear'] = o;
  });
  root.add(model);

  const swap = new THREE.Group();
  const brake = new THREE.Group();
  root.add(swap, brake);
  root.updateMatrixWorld(true);
  const wheelCenters = Object.fromEntries(
    Object.entries(wheels).map(([side, wheel]) => {
      const profile = spec.wheelPreview?.[side];
      const bounds = new THREE.Box3().setFromObject(wheel);
      return [side, profile
        ? new THREE.Vector3(...profile.center)
        : root.worldToLocal(bounds.getCenter(new THREE.Vector3()))];
    })
  );
  const tires = {};
  if (spec.stockRimRadius || spec.wheelPreview) {
    for (const [side, wheel] of Object.entries(wheels)) {
      const center = root.localToWorld(wheelCenters[side].clone());
      const profile = spec.wheelPreview?.[side];
      tires[side] = stockTire(wheel, center, profile?.rimRadius || spec.stockRimRadius, profile);
    }
  }

  function clearRims() {
    swap.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    swap.clear();
  }

  const api = {
    root,
    setFrameColor() {},
    dispose() {
      clearRims();
      for (const geometry of splitGeometries) geometry.dispose();
      for (const tire of Object.values(tires)) {
        tire.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      }
    },
    setSlot(slot, variant = 'stock', color = null) {
      if (slot === 'rims') {
        const stock = variant === 'stock';
        if (!stock && (!tires.front || !tires.rear)) {
          throw new Error(`Stock-tire rim preview is not configured for ${spec.id}`);
        }
        clearRims();
        for (const k of ['front', 'rear']) {
          if (!wheels[k]) continue;
          wheels[k].visible = stock;
          if (tires[k]) tires[k].visible = !stock;
          if (stock) continue;
          const profile = spec.wheelPreview?.[k];
          const rimRadius = profile?.rimRadius || spec.stockRimRadius;
          const w = buildRim(rimRadius - 0.014, variant, color || '#d9d9de', profile?.width);
          w.position.copy(wheelCenters[k]);
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

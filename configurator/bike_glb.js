import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildRim, mat } from './bike.js?v=release-finishes-31';
import { guardPaintMaterial } from './guard_paint.js';

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

export function guardFootprints(spec) {
  const profile = spec.frameGuardPreview;
  const transform = ([x, y]) => new THREE.Vector2(x * profile.scale[0] + profile.offset[0], y * profile.scale[1] + profile.offset[1]);
  return {
    frame: {
      outline: [
        [-0.166, 0.38], [-0.174, 0.401], [-0.15, 0.434], [-0.089, 0.547],
        [-0.012, 0.655], [0.186, 0.742], [0.21, 0.735], [0.209, 0.711],
        [0.155, 0.596], [0.086, 0.42], [0.066, 0.409], [-0.132, 0.371]
      ].map(transform),
      holes: [
        [[-0.047, 0.56], [0.008, 0.625], [0.151, 0.687], [0.116, 0.594]],
        [[-0.111, 0.416], [-0.063, 0.499], [0.103, 0.54], [0.06, 0.443]]
      ].map((hole) => hole.map(transform)),
      fasteners: [[-0.153, 0.399, 0.005], [0.193, 0.721, 0.004]],
      surface: [[-0.155, 0.41], [-0.1, 0.53], [-0.03, 0.64], [0.07, 0.68], [0.17, 0.715], [0.17, 0.64], [0.12, 0.53], [0.075, 0.445], [-0.07, 0.55]].map(transform)
    },
    swingarm: {
      outline: [
        [-0.16, 0.402], [-0.203, 0.408], [-0.273, 0.443], [-0.3, 0.45],
        [-0.32, 0.445], [-0.394, 0.399], [-0.53, 0.304], [-0.553, 0.3],
        [-0.594, 0.295], [-0.601, 0.271], [-0.558, 0.272], [-0.535, 0.28],
        [-0.4, 0.321], [-0.304, 0.36], [-0.248, 0.379], [-0.165, 0.388]
      ].map(transform),
      holes: [
        [[-0.242, 0.406], [-0.28, 0.424], [-0.3, 0.426],
          [-0.343, 0.403], [-0.318, 0.389], [-0.28, 0.393]],
        [[-0.361, 0.387], [-0.4, 0.369], [-0.531, 0.291],
          [-0.404, 0.342], [-0.37, 0.362]],
        [[-0.554, 0.289], [-0.588, 0.287], [-0.59, 0.278], [-0.56, 0.279]]
      ].map((hole) => hole.map(transform)),
      fasteners: [[-0.153, 0.399, 0.005]],
      surface: [
        [-0.19, 0.399], [-0.27, 0.435], [-0.3, 0.44], [-0.36, 0.415],
        [-0.4, 0.389], [-0.48, 0.345], [-0.54, 0.298], [-0.57, 0.281],
        [-0.4, 0.325], [-0.32, 0.358], [-0.27, 0.38]
      ].map(transform)
    }
  };
}

function fittedGuardDepth(triangles, footprint, side, depth, bikeId, section) {
  const hit = new THREE.Vector3();
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, -side));
  const samples = footprint.surface.map((point) => {
    ray.origin.set(point.x, point.y, side);
    let fitted = -Infinity;
    for (const triangle of triangles) {
      if (ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, hit)) {
        fitted = Math.max(fitted, side * hit.z);
      }
    }
    if (!Number.isFinite(fitted)) {
      // The low-resolution scan misses narrow rails; constrain interpolation to nearby outer faces.
      let nearest = Infinity;
      const target = new THREE.Vector3(point.x, point.y, side * depth[1]);
      for (const triangle of triangles) {
        triangle.closestPointToPoint(target, hit);
        const distance = Math.hypot(hit.x - point.x, hit.y - point.y);
        if (distance < nearest) {
          nearest = distance;
          fitted = side * hit.z;
        }
      }
      if (nearest > 0.025) throw new Error(`Unable to fit molded ${section} guard on ${bikeId}, side ${side}`);
    }
    return { point, depth: fitted };
  });
  const cells = new Map(), cellSize = 0.015;
  for (const triangle of triangles) {
    const projected = new THREE.Triangle(...[triangle.a, triangle.b, triangle.c].map((point) => new THREE.Vector3(point.x, point.y, 0)));
    const bounds = new THREE.Box3().setFromPoints([projected.a, projected.b, projected.c]).expandByScalar(cellSize);
    const outer = Math.min(depth[1], Math.max(side * triangle.a.z, side * triangle.b.z, side * triangle.c.z));
    for (let x = Math.floor(bounds.min.x / cellSize); x <= Math.floor(bounds.max.x / cellSize); x++) {
      for (let y = Math.floor(bounds.min.y / cellSize); y <= Math.floor(bounds.max.y / cellSize); y++) {
        const key = `${x},${y}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push({ projected, triangle, depth: outer });
      }
    }
  }
  const fittedPoints = new Map();
  return (point) => {
    const key = `${point.x.toFixed(7)},${point.y.toFixed(7)}`;
    if (fittedPoints.has(key)) return fittedPoints.get(key);
    let total = 0, weights = 0;
    for (const sample of samples) {
      const weight = 1 / (point.distanceToSquared(sample.point) + 0.0001);
      total += sample.depth * weight;
      weights += weight;
    }
    let fitted = total / weights;
    const target = new THREE.Vector3(point.x, point.y, 0);
    let localDepth = -Infinity, nearest = Infinity;
    for (const sample of cells.get(`${Math.floor(point.x / cellSize)},${Math.floor(point.y / cellSize)}`) ?? []) {
      const distance = sample.projected.closestPointToPoint(target, hit).distanceTo(target);
      if (section === 'swingarm') {
        const weights = sample.projected.getBarycoord(hit, new THREE.Vector3());
        const local = side * (sample.triangle.a.z * weights.x + sample.triangle.b.z * weights.y + sample.triangle.c.z * weights.z);
        // Fit sloping rails at this location, not at a triangle's highest corner.
        if (distance < nearest - 0.000001) {
          nearest = distance;
          localDepth = local;
        } else if (distance <= nearest + 0.000001) {
          localDepth = Math.max(localDepth, local);
        }
      } else {
        fitted = Math.max(fitted, sample.depth - distance * 0.4);
      }
    }
    if (section === 'swingarm') {
      if (nearest > 0.025 || !Number.isFinite(localDepth)) throw new Error(`Unsupported lower guard surface on ${bikeId}, side ${side}, at ${point.x},${point.y}`);
      fitted = localDepth;
    }
    fittedPoints.set(key, fitted);
    return fitted;
  };
}

function moldedGuardGeometry(shape, surfaceDepth, side, section) {
  const bevel = 0.0012, thickness = 0.006;
  const extruded = new THREE.ExtrudeGeometry(shape, {
    depth: thickness, bevelSize: bevel, bevelOffset: -bevel,
    bevelThickness: bevel, bevelSegments: 2, curveSegments: 12, steps: 1
  });
  const { shape: contour, holes } = shape.extractPoints(12);
  const boundaries = [contour, ...holes];
  const positions = [], faceKinds = [];
  const boundaryDistance = (point) => {
    let nearest = Infinity;
    for (const boundary of boundaries) for (let i = 0; i < boundary.length; i++) {
      const a = boundary[i], b = boundary[(i + 1) % boundary.length];
      const edge = new THREE.Vector2().subVectors(b, a);
      if (edge.lengthSq() < 1e-16) continue;
      const t = THREE.MathUtils.clamp(new THREE.Vector2().subVectors(point, a).dot(edge) / edge.lengthSq(), 0, 1);
      nearest = Math.min(nearest, point.distanceTo(a.clone().addScaledVector(edge, t)));
    }
    return nearest;
  };
  const emit = (triangle, level, kind) => {
    if (level) {
      const [a, b, c] = triangle;
      const ab = a.clone().lerp(b, 0.5), bc = b.clone().lerp(c, 0.5), ca = c.clone().lerp(a, 0.5);
      for (const child of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]) emit(child, level - 1, kind);
      return;
    }
    const mapped = triangle.map((vertex) => {
      const point = new THREE.Vector2(vertex.x, vertex.y);
      const front = THREE.MathUtils.clamp((vertex.z + bevel) / (thickness + 2 * bevel), 0, 1);
      const ridge = Math.min(section === 'frame' ? 0.004 : 0.003, boundaryDistance(point) * 0.65);
      const clearance = section === 'swingarm' ? 0.0005 : -0.003;
      return new THREE.Vector3(point.x, point.y, side * (surfaceDepth(point) + clearance + vertex.z + bevel + ridge * front));
    });
    if (side < 0) mapped.reverse();
    for (const point of mapped) {
      positions.push(point.x, point.y, point.z);
      faceKinds.push(kind);
    }
  };
  const source = extruded.attributes.position;
  for (const group of extruded.groups) for (let i = group.start; i < group.start + group.count; i += 3) {
    const triangle = [0, 1, 2].map((corner) => new THREE.Vector3().fromBufferAttribute(source, i + corner));
    const kind = group.materialIndex === 1 ? 2 : triangle[0].z > 0 ? 1 : 0;
    emit(triangle, section === 'frame' ? 3 : 2, kind);
  }
  extruded.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // The utility welds at 0.01 units; use millimeters so small bevels stay distinct.
  geometry.scale(1000, 1000, 1000);
  const smooth = toCreasedNormals(geometry, THREE.MathUtils.degToRad(35));
  smooth.scale(0.001, 0.001, 0.001);
  geometry.dispose();
  smooth.setAttribute('guardFace', new THREE.Float32BufferAttribute(faceKinds, 1));
  smooth.computeBoundingBox();
  const axis = section === 'swingarm' ? 'x' : 'y';
  const start = smooth.boundingBox.min[axis], length = smooth.boundingBox.max[axis] - start;
  const along = [];
  for (let i = 0; i < smooth.attributes.position.count; i++) along.push((smooth.attributes.position[`get${axis.toUpperCase()}`](i) - start) / length);
  smooth.setAttribute('guardAlong', new THREE.Float32BufferAttribute(along, 1));
  return smooth;
}

function frameGuards(model, spec) {
  const profile = spec.frameGuardPreview;
  if (!profile) throw new Error(`Frame guard preview is not configured for ${spec.id}`);
  const group = new THREE.Group();
  group.name = 'frame_guards';
  const meshes = [];
  model.traverse((mesh) => { if (mesh.isMesh && mesh.name === 'frame') meshes.push(mesh); });
  model.updateWorldMatrix(true, true);
  const toBikeSpace = model.parent.matrixWorld.clone().invert();
  const normal = new THREE.Vector3();
  const material = new THREE.MeshPhysicalMaterial({
    color: '#151518', metalness: 0, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.2
  });
  const sourceTriangles = [];
  for (const mesh of meshes) {
    const source = mesh.geometry.attributes.position, index = mesh.geometry.index;
    const transform = new THREE.Matrix4().multiplyMatrices(toBikeSpace, mesh.matrixWorld);
    for (let i = 0; i < (index ? index.count : source.count); i += 3) {
      const points = [0, 1, 2].map((corner) => new THREE.Vector3().fromBufferAttribute(source, index ? index.getX(i + corner) : i + corner).applyMatrix4(transform));
      const triangle = new THREE.Triangle(...points);
      if (Math.abs(triangle.getNormal(normal).z) >= 0.35) sourceTriangles.push(triangle);
    }
  }
  for (const [section, footprint] of Object.entries(guardFootprints(spec))) {
    const alignment = profile;
    const shape = new THREE.Shape(THREE.ShapeUtils.isClockWise(footprint.outline) ? footprint.outline : [...footprint.outline].reverse());
    shape.holes = footprint.holes.map((hole) => new THREE.Path(THREE.ShapeUtils.isClockWise(hole) ? [...hole].reverse() : hole));
    for (const [x, y, radius] of footprint.fasteners) {
      const center = new THREE.Vector2(x * alignment.scale[0] + alignment.offset[0], y * alignment.scale[1] + alignment.offset[1]);
      if (section === 'swingarm') continue;
      const hole = new THREE.Path();
      hole.absellipse(center.x, center.y, radius * alignment.scale[0], radius * alignment.scale[1], 0, Math.PI * 2, false);
      shape.holes.push(hole);
    }
    const bounds = new THREE.Box2().setFromPoints(footprint.outline).expandByScalar(0.025);
    for (const side of [-1, 1]) {
      const depth = profile.depth[section];
      const triangles = sourceTriangles.filter((triangle) => {
        if (side * triangle.getNormal(normal).z < 0.35) return false;
        const center = triangle.getMidpoint(new THREE.Vector3());
        return bounds.containsPoint(new THREE.Vector2(center.x, center.y)) && side * center.z >= depth[0] && side * center.z <= depth[1];
      });
      const surface = fittedGuardDepth(triangles, footprint, side, depth, spec.id, section);
      const cover = new THREE.Mesh(moldedGuardGeometry(shape, surface, side, section), material);
      cover.name = `${section}_guard_${side < 0 ? 'left' : 'right'}`;
      cover.castShadow = cover.receiveShadow = true;
      group.add(cover);
    }
  }
  return group;
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
    const isWheel = o.name === 'wheel_front' || o.name === 'wheel_rear';
    if (!spec.preserveMaterials) o.material = isWheel ? wheelMat : meshes === 1 ? solidMat : frameMat;
    if (isWheel) wheels[o.name.endsWith('front') ? 'front' : 'rear'] = o;
  });
  root.add(model);

  const swap = new THREE.Group();
  const brake = new THREE.Group();
  const guards = new THREE.Group();
  let guardTemplate = null;
  root.add(swap, brake, guards);
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
  function clearGuards() {
    const materials = new Set();
    guards.traverse((o) => { if (o.isMesh && o.material.userData.paintFinish) materials.add(o.material); });
    for (const material of materials) material.dispose();
    guards.clear();
  }

  const api = {
    root,
    setFrameColor() {},
    dispose() {
      clearRims();
      clearGuards();
      const guardMaterials = new Set();
      guardTemplate?.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          guardMaterials.add(o.material);
        }
      });
      for (const material of guardMaterials) material.dispose();
      for (const geometry of splitGeometries) geometry.dispose();
      for (const tire of Object.values(tires)) {
        tire.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      }
    },
    setSlot(slot, variant = 'stock', color = null, finish = null) {
      if (slot === 'frame-guards') {
        if (variant !== 'stock' && variant !== 'falcon-frame-guards') throw new Error(`Unknown frame guard: ${variant}`);
        clearGuards();
        if (variant !== 'stock') {
          guardTemplate ||= frameGuards(model, spec);
          const covers = guardTemplate.clone(true);
          if (finish) {
            const material = guardPaintMaterial(finish);
            covers.traverse((o) => { if (o.isMesh) o.material = material; });
          }
          guards.add(covers);
        }
        return guards;
      }
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

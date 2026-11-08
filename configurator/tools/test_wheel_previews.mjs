import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const bundle = await build({
  stdin: {
    contents: "export { createGlbBike, guardFootprints } from './configurator/bike_glb.js'; export { guardPaint, paintColors, paintEffects, validateGuardPaintProduct } from './configurator/guard_paint.js'; export * as THREE from 'three';",
    resolveDir: root
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  alias: {
    'three/addons': resolve(root, 'configurator/vendor/addons'),
    three: resolve(root, 'configurator/vendor/three.module.js')
  }
});
const { createGlbBike, guardFootprints, guardPaint, paintColors, paintEffects, validateGuardPaintProduct, THREE } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
// Three's file loader uses the browser progress event while Node supplies fetch.
globalThis.ProgressEvent ??= class extends Event {
  constructor(type, init) {
    super(type);
    Object.assign(this, init);
  }
};
const data = JSON.parse(await readFile(resolve(root, 'configurator/data.json'), 'utf8'));
for (const bike of data.bikes) {
  assert.ok(bike.slots.every((slot) => typeof slot === 'string' && data.slots.some((entry) => entry.id === slot)), `${bike.id}: valid slot IDs`);
}
const expected = {
  'talaria-xxx': [[0.625, 0.25032, 0], [-0.625, 0.26408, 0]],
  'talaria-mx4': [[0.615, 0.32388715, 0], [-0.615, 0.32388715, 0]],
  'talaria-mx5': [[0.625, 0.30602, 0], [-0.625, 0.29577, 0]]
};
const position = new THREE.Vector3();
function wheelEnvelope(mesh, center, halfWidth) {
  let radius = 0, floor = Infinity;
  const attr = mesh.geometry.attributes.position;
  for (let i = 0; i < attr.count; i++) {
    position.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld);
    if (Math.abs(position.z - center.z) > halfWidth) continue;
    radius = Math.max(radius, Math.hypot(position.x - center.x, position.y - center.y));
    floor = Math.min(floor, position.y);
  }
  return { radius, floor };
}
for (const spec of data.bikes.filter((bike) => bike.wheelPreview || bike.stockRimRadius)) {
  const bytes = await readFile(resolve(root, 'configurator', spec.glb.split('?')[0]));
  const bike = await createGlbBike({ ...spec, glb: `data:model/gltf-binary;base64,${bytes.toString('base64')}` });
  bike.root.updateMatrixWorld(true);
  const stockMeshes = [];
  bike.root.traverse((mesh) => {
    if (mesh.isMesh && !mesh.name.includes('_stock_tire') && !mesh.name.includes('_brake_and_axle')) {
      stockMeshes.push({ mesh, geometry: mesh.geometry, visible: mesh.visible, matrix: mesh.matrixWorld.clone() });
    }
  });
  const originals = Object.fromEntries(['front', 'rear'].map((side) => {
    const wheel = bike.root.getObjectByName(`wheel_${side}`);
    const tire = bike.root.getObjectByName(`wheel_${side}_stock_tire`);
    assert.ok(wheel && tire, `${spec.id}: ${side} wheel and retained tire exist`);
    assert.equal(wheel.visible, true);
    assert.equal(tire.visible, false);
    const profile = spec.wheelPreview?.[side];
    const center = profile ? new THREE.Vector3(...profile.center) : new THREE.Box3().setFromObject(wheel).getCenter(new THREE.Vector3());
    return [side, { wheel, tire, center, envelope: wheelEnvelope(wheel, center, profile?.tireHalfWidth ?? Infinity) }];
  }));
  for (const color of ['#d7d7dc', '#18181b', '#d7d7dc']) {
    const rims = bike.setSlot('rims', 'supermoto17', color);
    bike.root.updateMatrixWorld(true);
    assert.equal(rims.children.length, 2, `${spec.id}: two replacement rims`);
    for (const [index, side] of ['front', 'rear'].entries()) {
      const { wheel, tire, center, envelope } = originals[side];
      assert.equal(wheel.visible, false);
      assert.equal(tire.visible, true);
      assert.equal(rims.children[index].children.length, 74, `${spec.id}: barrel, hub, 36 spokes, and 36 nipples`);
      assert.equal(rims.children[index].children[0].material.color.getHexString(), color.slice(1), `${spec.id}: selected rim finish`);
      assert.ok(rims.children[index].position.distanceTo(center) < 0.000001, `${spec.id}: ${side} axle alignment`);
      if (expected[spec.id]) {
        assert.ok(rims.children[index].position.distanceTo(new THREE.Vector3(...expected[spec.id][index])) < 0.000001);
      }
      const kept = wheelEnvelope(tire, center, spec.wheelPreview?.[side]?.tireHalfWidth ?? Infinity);
      assert.ok(Math.abs(kept.radius - envelope.radius) < 0.002, `${spec.id}: ${side} outer tire radius preserved within 2mm`);
      assert.ok(Math.abs(kept.floor - envelope.floor) < 0.002, `${spec.id}: ${side} ground clearance preserved within 2mm`);
      const vertices = tire.geometry.attributes.position;
      for (let i = 0; i < vertices.count; i++) {
        position.fromBufferAttribute(vertices, i).applyMatrix4(tire.matrixWorld);
        assert.ok(Number.isFinite(position.lengthSq()), `${spec.id}: finite clipped tire geometry`);
        const radius = Math.hypot(position.x - center.x, position.y - center.y);
        assert.ok(radius >= (spec.wheelPreview?.[side]?.rimRadius ?? spec.stockRimRadius) - 0.000001, `${spec.id}: stock spokes removed from tire`);
      }
    }
    for (const { mesh, geometry, matrix, visible } of stockMeshes) {
      assert.equal(mesh.geometry, geometry, `${spec.id}: original mesh geometry unchanged`);
      assert.ok(mesh.matrixWorld.equals(matrix), `${spec.id}: original mesh transform unchanged`);
      if (mesh.name !== 'wheel_front' && mesh.name !== 'wheel_rear') assert.equal(mesh.visible, visible);
    }
    bike.setSlot('rims', 'stock');
    assert.equal(rims.children.length, 0);
    for (const { wheel, tire } of Object.values(originals)) {
      assert.equal(wheel.visible, true);
      assert.equal(tire.visible, false);
    }
  }
  let guardMaterialDisposals = 0, guardGeometryDisposals = 0;
  if (spec.frameGuardPreview) {
    const original = stockMeshes.find(({ mesh }) => mesh.name === 'frame').mesh;
    const sources = original.geometry.attributes.position;
    const lookup = new Map();
    const index = original.geometry.index;
    const cell = (n) => Math.floor(n / 0.015);
    for (let i = 0; i < (index ? index.count : sources.count); i += 3) {
      const points = [0, 1, 2].map((corner) => new THREE.Vector3().fromBufferAttribute(sources, index ? index.getX(i + corner) : i + corner).applyMatrix4(original.matrixWorld));
      const bounds = new THREE.Box3().setFromPoints(points);
      if (bounds.max.x < -0.65 || bounds.min.x > 0.3 || bounds.max.y < 0.25 || bounds.min.y > 0.85) continue;
      const triangle = new THREE.Triangle(...points);
      for (let x = cell(bounds.min.x); x <= cell(bounds.max.x); x++) for (let y = cell(bounds.min.y); y <= cell(bounds.max.y); y++) {
        const key = `${x},${y}`;
        if (!lookup.has(key)) lookup.set(key, []);
        lookup.get(key).push(triangle);
      }
    }
    const nearest = new THREE.Vector3();
    const distanceToFrame = (point) => {
      let distance = Infinity;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const source of lookup.get(`${cell(point.x) + dx},${cell(point.y) + dy}`) ?? []) {
          distance = Math.min(distance, source.closestPointToPoint(point, nearest).distanceTo(point));
        }
      }
      return distance;
    };
    const inPolygon = (point, polygon, boundary = true) => {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[j], b = polygon[i];
        if (new THREE.Line3(new THREE.Vector3(a.x, a.y, 0), new THREE.Vector3(b.x, b.y, 0)).closestPointToPoint(new THREE.Vector3(point.x, point.y, 0), true, nearest).distanceTo(new THREE.Vector3(point.x, point.y, 0)) < 0.000001) return boundary;
        if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    };
    for (let iteration = 0; iteration < 3; iteration++) {
      if (iteration === 1) {
        bike.root.scale.setScalar(0.85);
        bike.root.position.set(0.2, 0.1, -0.2);
        bike.root.rotation.set(0.1, 0.2, 0.3);
      }
      const guards = bike.setSlot('frame-guards', 'falcon-frame-guards', '#d7d7dc');
      bike.root.scale.setScalar(1);
      bike.root.position.set(0, 0, 0);
      bike.root.rotation.set(0, 0, 0);
      bike.root.updateMatrixWorld(true);
      assert.equal(guards.children.length, 1);
      const covers = guards.children[0].children;
      assert.equal(covers.length, 4, `${spec.id}: paired main-frame and lower covers only`);
      assert.equal(bike.root.getObjectByName('seat_brace_guard_left'), undefined, `${spec.id}: small upper guards removed`);
      const footprints = guardFootprints(spec);
      const lower = footprints.swingarm;
      assert.equal(lower.holes.length, 3, `${spec.id}: photo-shaped lower guard has two tapered windows and one end slot`);
      const normalizedBounds = (points) => new THREE.Box2().setFromPoints(points.map((point) => new THREE.Vector2(
        (point.x - spec.frameGuardPreview.offset[0]) / spec.frameGuardPreview.scale[0],
        (point.y - spec.frameGuardPreview.offset[1]) / spec.frameGuardPreview.scale[1]
      )));
      const lowerBounds = normalizedBounds(lower.outline), lowerSize = lowerBounds.getSize(new THREE.Vector2());
      assert.ok(lowerSize.x > 0.43 && lowerSize.x < 0.45 && lowerSize.y > 0.17 && lowerSize.y < 0.19, `${spec.id}: long bent product silhouette, not a short forked rail mask`);
      const windowBounds = lower.holes.map(normalizedBounds);
      assert.ok(windowBounds[0].max.y < 0.427 && windowBounds[0].min.y > 0.388, `${spec.id}: wide-end molded bands surround the short opening`);
      assert.ok(windowBounds[0].min.x - windowBounds[1].max.x >= 0.017, `${spec.id}: distinct transverse bridge separates the windows`);
      assert.ok(windowBounds[1].getSize(new THREE.Vector2()).x > 0.16 && windowBounds[1].max.x < windowBounds[0].max.x - 0.10, `${spec.id}: long tapered window follows the body behind the wide-end opening`);
      const endSlot = windowBounds[2], slotSize = endSlot.getSize(new THREE.Vector2());
      assert.ok(endSlot.max.x < -0.55 && slotSize.x > 0.028 && slotSize.x < 0.04 && slotSize.y > 0.008 && slotSize.y < 0.013, `${spec.id}: narrow-end rectangular slot remains recognizable`);
      const mountingHole = new THREE.Vector2(
        -0.153 * spec.frameGuardPreview.scale[0] + spec.frameGuardPreview.offset[0],
        0.399 * spec.frameGuardPreview.scale[1] + spec.frameGuardPreview.offset[1]
      );
      const lowerStart = footprints.swingarm.outline.reduce((front, point) => point.x > front.x ? point : front);
      assert.ok(lowerStart.distanceTo(mountingHole) < 0.012, `${spec.id}: secondary guard begins within 12mm of main lower mounting hole`);
      for (const cover of covers) {
        const section = cover.name.replace(/_guard_(left|right)$/, '');
        const footprint = guardFootprints(spec)[section];
        const alignment = spec.frameGuardPreview;
        assert.equal(cover.material.color.getHexString(), '151518', `${spec.id}: black-only guard finish`);
        const attr = cover.geometry.attributes.position;
        const faceKinds = cover.geometry.attributes.guardFace;
        assert.ok(faceKinds, `${spec.id}: actual front, back and edge surfaces, not a decal`);
        assert.ok(attr.count < 250000, `${spec.id}: bounded molded-shell mesh size`);
        assert.equal(cover.material.side, THREE.FrontSide, `${spec.id}: closed volume does not rely on double-sided rendering`);
        const along = cover.geometry.attributes.guardAlong.array;
        assert.ok(Math.abs(along.reduce((min, value) => Math.min(min, value), Infinity)) < 0.000001, `${spec.id}: fade begins at each cover's first end`);
        assert.ok(Math.abs(along.reduce((max, value) => Math.max(max, value), -Infinity) - 1) < 0.000001, `${spec.id}: fade reaches each cover's last end`);
        let area = 0, volume = 0, walls = 0, fronts = 0, backs = 0;
        let largestRailGap = 0, railGapPoint;
        let largestEdgeGap = 0, edgeGapPoint;
        let largestEdgeDepthGap = 0, edgeDepthGapPoint;
        const shellEdges = new Map();
        const triangle = Array.from({ length: 3 }, () => new THREE.Vector3());
        for (let i = 0; i < attr.count; i += 3) {
          triangle.forEach((point, corner) => point.fromBufferAttribute(attr, i + corner));
          const centroid = new THREE.Vector3().copy(triangle[0]).add(triangle[1]).add(triangle[2]).divideScalar(3);
          assert.ok(inPolygon(centroid, footprint.outline), `${spec.id}: no face spans outside the ${section} contour`);
          assert.ok(footprint.holes.every((hole) => !inPolygon(centroid, hole, false)), `${spec.id}: no face bridges a ${section} window at ${centroid.toArray()}`);
          area += new THREE.Triangle(...triangle).getArea();
          volume += triangle[0].dot(new THREE.Vector3().crossVectors(triangle[1], triangle[2])) / 6;
          const kind = faceKinds.getX(i);
          if (kind === 0) backs++;
          else if (kind === 1) fronts++;
          else walls++;
          if (iteration === 0) {
            const keys = triangle.map((point) => point.toArray().map((value) => Math.round(value * 100000)).join(','));
            if (new Set(keys).size === 3) for (let corner = 0; corner < 3; corner++) {
              const key = [keys[corner], keys[(corner + 1) % 3]].sort().join('/');
              shellEdges.set(key, (shellEdges.get(key) ?? 0) + 1);
            }
          }
        }
        if (iteration === 0) assert.ok([...shellEdges.values()].every((count) => count === 2), `${spec.id}: ${section} shell is watertight, including window and mounting-hole walls`);
        assert.ok(volume > area * 0.0008, `${spec.id}: ${section} has positive 3D volume and outward winding (${volume})`);
        assert.ok(fronts > 0 && backs > 0 && walls > 0, `${spec.id}: molded cover has front, inside and wrapped edge faces`);
        assert.ok(area > 0.003, `${spec.id}: ${cover.name} coverage ${area.toFixed(5)} square metres`);
        const sign = cover.name.endsWith('_left') ? -1 : 1;
        const columns = new Map();
        for (let i = 0; i < attr.count; i++) {
          position.fromBufferAttribute(attr, i).applyMatrix4(cover.matrixWorld);
          assert.ok(Number.isFinite(position.lengthSq()));
          const [minimumDepth, maximumDepth] = spec.frameGuardPreview.depth[section];
          assert.ok(sign * position.z >= minimumDepth - 0.012 && sign * position.z <= maximumDepth + 0.02, `${spec.id}: wrapped shell stays around outer rails, away from interior/outboard hardware`);
          assert.ok(inPolygon(position, footprint.outline), `${spec.id}: every vertex stays within the ${section} outline`);
          assert.ok(footprint.holes.every((hole) => !inPolygon(position, hole, false)), `${spec.id}: frame windows remain unpainted`);
          const x = (position.x - alignment.offset[0]) / alignment.scale[0];
          const y = (position.y - alignment.offset[1]) / alignment.scale[1];
          for (const [cx, cy, radius] of footprint.fasteners) {
            assert.ok(Math.hypot(x - cx, y - cy) >= radius * Math.cos(Math.PI / 24) - 0.000001, `${spec.id}: ${section} mounting/axle exclusion ${cx},${cy},${radius} at ${x},${y}`);
          }
          assert.ok(y > (section === 'swingarm' ? 0.265 : 0.30) && y < 0.745, `${spec.id}: guard stays in its frame region`);
          if (section === 'swingarm') assert.ok(x >= -0.602 && x <= -0.159, `${spec.id}: tapered end stops at swingarm axle, not the tire`);
          const key = `${position.x.toFixed(6)},${position.y.toFixed(6)}`;
          const column = columns.get(key) ?? { min: Infinity, max: -Infinity, front: false, back: false };
          column.min = Math.min(column.min, sign * position.z);
          column.max = Math.max(column.max, sign * position.z);
          column.front ||= faceKinds.getX(i) === 1;
          column.back ||= faceKinds.getX(i) === 0;
          columns.set(key, column);
          if (faceKinds.getX(i) === 0 && i % 24 === 0) {
            assert.ok(distanceToFrame(position) < 0.025, `${spec.id}: fitted inner shell stays within 25mm of the low-resolution rail scan at ${position.toArray()}`);
          }
          if (faceKinds.getX(i) === 0 && iteration === 0) {
            if (section === 'swingarm') {
              let projectedDistance = Infinity, surfaceDistance = Infinity;
              for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const source of lookup.get(`${cell(position.x) + dx},${cell(position.y) + dy}`) ?? []) {
                if (sign * source.getNormal(nearest).z < 0.35) continue;
                const center = source.getMidpoint(nearest);
                if (sign * center.z < minimumDepth || sign * center.z > maximumDepth) continue;
                surfaceDistance = Math.min(surfaceDistance, source.closestPointToPoint(position, nearest).distanceTo(position));
                const projected = new THREE.Triangle(...[source.a, source.b, source.c].map((point) => new THREE.Vector3(point.x, point.y, 0)));
                const target = new THREE.Vector3(position.x, position.y, 0);
                projectedDistance = Math.min(projectedDistance, projected.closestPointToPoint(target, nearest).distanceTo(target));
              }
              if (projectedDistance > largestRailGap) {
                largestRailGap = projectedDistance;
                railGapPoint = position.toArray();
              }
              const outlineDistance = Math.min(...footprint.outline.map((a, j) => {
                const b = footprint.outline[(j + 1) % footprint.outline.length];
                return new THREE.Line3(new THREE.Vector3(a.x, a.y, 0), new THREE.Vector3(b.x, b.y, 0))
                  .closestPointToPoint(new THREE.Vector3(position.x, position.y, 0), true, nearest)
                  .distanceTo(new THREE.Vector3(position.x, position.y, 0));
              }));
              if (outlineDistance < 0.0013 && projectedDistance > largestEdgeGap) {
                largestEdgeGap = projectedDistance;
                edgeGapPoint = position.toArray();
              }
              if (outlineDistance < 0.0013 && surfaceDistance > largestEdgeDepthGap) {
                largestEdgeDepthGap = surfaceDistance;
                edgeDepthGapPoint = position.toArray();
              }
            }
          }
        }
        if (section === 'swingarm' && iteration === 0) {
          assert.ok(largestEdgeGap < 0.004, `${spec.id}: full lower-guard perimeter follows actual rail within 4mm at ${edgeGapPoint} (gap ${largestEdgeGap})`);
          assert.ok(largestEdgeDepthGap < 0.006, `${spec.id}: lower inner perimeter hugs outward rail surfaces in 3D within 6mm at ${edgeDepthGapPoint} (gap ${largestEdgeDepthGap})`);
          // Molded cross-bridges span the scan's openings rather than copying its forked rails.
          assert.ok(largestRailGap < 0.015, `${spec.id}: molded bridges remain within 15mm of rail support at ${railGapPoint} (gap ${largestRailGap})`);
        }
        const thicknesses = [...columns.values()].filter(({ front, back }) => front && back).map(({ min, max }) => max - min);
        assert.ok(thicknesses.length > 50 && thicknesses.every((value) => value >= 0.0083 && value <= 0.0125), `${spec.id}: inner and outer caps have 8.4-12.4mm molded depth including edge returns and ridges`);
      }
      for (const { mesh, geometry, matrix, visible } of stockMeshes) {
        assert.equal(mesh.geometry, geometry);
        assert.ok(mesh.matrixWorld.equals(matrix));
        assert.equal(mesh.visible, visible);
      }
      const rims = bike.setSlot('rims', 'supermoto17', '#d7d7dc');
      assert.equal(guards.children[0].children.length, 4, `${spec.id}: rim selection preserves frame guards`);
      bike.setSlot('frame-guards', 'stock');
      assert.equal(guards.children.length, 0, `${spec.id}: guards removable without changing frame`);
      assert.equal(rims.children.length, 2, `${spec.id}: guard removal preserves selected rims`);
      bike.setSlot('rims', 'stock');
    }
    const baseline = bike.setSlot('frame-guards', 'falcon-frame-guards').children[0].children.map((cover) => cover.geometry);
    bike.root.getObjectByName('frame_guards').children[0].material.addEventListener('dispose', () => guardMaterialDisposals++);
    for (const geometry of baseline) geometry.addEventListener('dispose', () => guardGeometryDisposals++);
    let combinations = 0;
    for (const colorName of Object.keys(paintColors)) for (const effectName of Object.keys(paintEffects)) {
      const finish = guardPaint({ option1: colorName, option2: effectName, title: `${colorName} / ${effectName}` });
      const guards = bike.setSlot('frame-guards', 'falcon-frame-guards', finish.color, finish);
      const covers = guards.children[0].children;
      assert.equal(covers.length, 4);
      for (const [index, cover] of covers.entries()) {
        assert.equal(cover.geometry, baseline[index], `${spec.id}: paint changes reuse aligned guard geometry`);
        assert.deepEqual(cover.material.userData.paintFinish, finish);
        assert.equal(cover.material.color.getHexString(), finish.color.slice(1));
        assert.equal(cover.material.clearcoat, 1);
        assert.equal(cover.material.isMeshPhysicalMaterial, true);
      }
      const material = covers[0].material;
      const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <normal_fragment_begin>' };
      material.onBeforeCompile(shader);
      assert.equal(shader.uniforms.guardFade.value, paintEffects[effectName].fade);
      assert.equal(shader.uniforms.guardSparkle.value, Number(paintEffects[effectName].sparkle));
      assert.equal(shader.uniforms.guardColorShift.value, Number(paintColors[colorName].length > 1));
      const disposed = [];
      material.addEventListener('dispose', () => disposed.push(true));
      bike.setSlot('frame-guards', 'stock');
      assert.equal(disposed.length, 1, `${spec.id}: old painted material disposed once`);
      combinations++;
    }
    assert.equal(combinations, 84);
    console.log(`PASS ${spec.id}: all 84 painted finishes, fade/sparkle/color-shift uniforms, aligned geometry reuse, and material cleanup`);
    console.log(`PASS ${spec.id}: four volumetric guards, photo-shaped lower piece with broad bands, two windows and end slot, rail perimeter within 4mm in projection and 6mm in 3D, supported bridges, mounting-hole alignment, no upper pieces, wrapped edges, unchanged frame, and independent rims`);
  }
  bike.dispose();
  if (spec.frameGuardPreview) {
    assert.equal(guardMaterialDisposals, 1, `${spec.id}: shared molded-black material disposed once with the bike`);
    assert.equal(guardGeometryDisposals, 4, `${spec.id}: all cached guard shells disposed once with the bike`);
  }
  console.log(`PASS ${spec.id}: rim swaps, tire envelope, axle alignment, hardware, and stock restoration`);
}
const part = data.parts.find((part) => part.id === 'chrome-talaria-xxx-mx3-mx4-supermoto-wheel-set');
assert.deepEqual(part.previewFits, Object.keys(expected));
assert.deepEqual(part.purchaseFits, ['talaria-xxx', 'talaria-mx4']);
console.log('PASS Talaria fitment: XXX/MX4 purchasing supported; MX5 preview only');
const guards = data.parts.find((part) => part.id === '79bike-frame-guards-pro-lite-gt');
assert.deepEqual(guards.fits, ['79bike-gt', '79bike-pro', '79bike-lite']);
assert.deepEqual(guards.previewFits, guards.fits);
assert.equal(guards.finishColor, '#151518');
assert.equal(guards.finishName, 'Black');
assert.deepEqual(guards.colors, []);
console.log('PASS frame guard product: GT/Pro/Lite supported with one fixed black finish');
const painted = data.parts.find((part) => part.id === 'color-79bike-ventus-frame-guards-pro-lite-gt');
assert.deepEqual(painted.fits, guards.fits);
assert.equal(painted.slot, guards.slot);
assert.equal(painted.paintedGuards, true);
assert.equal(Object.keys(paintColors).length, 14);
assert.equal(Object.keys(paintEffects).length, 6);
assert.throws(() => guardPaint({ option1: 'Unknown', option2: 'Iridescent sparkle' }), /Paint preview unavailable/);
assert.throws(() => guardPaint({ option1: 'Silver', option2: 'Unknown' }), /Paint preview unavailable/);
assert.throws(() => guardPaint({ option1: 'toString', option2: 'Iridescent sparkle' }), /Paint preview unavailable/);
const paintProduct = {
  options: [{ values: Object.keys(paintColors) }, { values: Object.keys(paintEffects) }],
  variants: Object.keys(paintColors).flatMap((option1) => Object.keys(paintEffects).map((option2) => ({ option1, option2 })))
};
assert.doesNotThrow(() => validateGuardPaintProduct(paintProduct));
assert.throws(() => validateGuardPaintProduct({ ...paintProduct, options: [{ values: ['Unknown'] }, paintProduct.options[1]] }), /unsupported paint/);
assert.throws(() => validateGuardPaintProduct({ ...paintProduct, variants: [] }), /unsupported paint/);
assert.throws(() => validateGuardPaintProduct({ ...paintProduct, options: [{ values: ['Silver'] }, paintProduct.options[1]] }), /Inconsistent paint/);
console.log('PASS painted product: 14 colors x 6 effects, GT/Pro/Lite fitment, and explicit unknown-finish errors');

import * as THREE from 'three';

// Some bike scans fuse the treads to the frame. Subtract only their measured
// outboard volumes, splitting triangles at the cut instead of deleting mounts.
export function cutStockPegs(frame, root, { from, to, start }) {
  const source = frame.geometry;
  const positions = source.attributes.position;
  const normals = source.attributes.normal;
  const output = [];
  const outputNormals = [];
  const index = source.index;
  const count = index?.count ?? positions.count;
  frame.updateWorldMatrix(true, false);
  const localToBike = root.matrixWorld.clone().invert().multiply(frame.matrixWorld);
  const point = new THREE.Vector3();
  const sides = [-1, 1];
  const removed = [0, 0];

  function write(polygon) {
    for (let i = 1; i < polygon.length - 1; i++) {
      for (const { position, normal } of [polygon[0], polygon[i], polygon[i + 1]]) {
        output.push(...position);
        outputNormals.push(...normal);
      }
    }
  }

  for (let i = 0; i < count; i += 3) {
    const triangle = [0, 1, 2].map((corner) => {
      const vertex = index ? index.getX(i + corner) : i + corner;
      const position = point.fromBufferAttribute(positions, vertex).toArray();
      const world = point.applyMatrix4(localToBike).toArray();
      return { position, world, normal: point.fromBufferAttribute(normals, vertex).toArray() };
    });
    const sideIndex = sides.findIndex((side) =>
      triangle.some(({ world }) => side * world[2] > start)
      && [0, 1].every((axis) => triangle.some(({ world }) => world[axis] >= from[axis])
        && triangle.some(({ world }) => world[axis] <= to[axis])));
    if (sideIndex < 0) {
      write(triangle);
      continue;
    }
    const side = sides[sideIndex];
    const planes = [[0, 1, from[0]], [0, -1, to[0]], [1, 1, from[1]], [1, -1, to[1]], [2, side, side * start]];
    let remaining = triangle;
    for (const [axis, direction, boundary] of planes) {
      if (remaining.length < 3) break;
      const outside = [], inside = [];
      for (let j = 0; j < remaining.length; j++) {
        const a = remaining[j], b = remaining[(j + 1) % remaining.length];
        const da = direction * (a.world[axis] - boundary);
        const db = direction * (b.world[axis] - boundary);
        (da >= 0 ? inside : outside).push(a);
        if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
          const t = da / (da - db);
          const lerp = (key) => a[key].map((v, k) => THREE.MathUtils.lerp(v, b[key][k], t));
          const intersection = { position: lerp('position'), world: lerp('world'), normal: lerp('normal') };
          inside.push(intersection);
          outside.push(intersection);
        } else if (da === 0) {
          outside.push(a);
        }
      }
      write(outside);
      remaining = inside;
    }
    if (remaining.length >= 3) removed[sideIndex]++;
  }
  if (removed.some((faces) => !faces)) throw new Error('Factory peg cut did not locate both treads');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(output, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(outputNormals, 3));
  return geometry;
}

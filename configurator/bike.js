import * as THREE from 'three';

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const matCache = new Map();

export function mat(color, { metal = 0.4, rough = 0.45, emissive = null, emissiveIntensity = 1 } = {}) {
  const key = `${color}|${metal}|${rough}|${emissive}|${emissiveIntensity}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, metalness: metal, roughness: rough,
      ...(emissive ? { emissive, emissiveIntensity } : {})
    }));
  }
  return matCache.get(key);
}

function shadowed(obj) {
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return obj;
}

function tube(a, b, r, material, seg = 12) {
  const d = new THREE.Vector3().subVectors(b, a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), seg), material);
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
  return mesh;
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

// Cylinder whose axis runs along X (front/back) or Z (side to side).
function cyl(r, len, material, axis = 'z') {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 28), material);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  else m.rotation.z = Math.PI / 2;
  return m;
}

export function geometry(spec) {
  const W = spec.wheelbase, R = spec.wheelR;
  const rearAxle = V(-W / 2, R), frontAxle = V(W / 2, R);
  const forkTop = V(W / 2 - 0.3, spec.headY - 0.02);
  const headPt = new THREE.Vector3().lerpVectors(frontAxle, forkTop, 0.85);
  const pivot = V(-W / 2 + 0.4, R + 0.12);
  const seatFront = V(-0.02, spec.seatY - 0.08);
  const seatRear = V(-W / 2 + 0.22, spec.seatY - 0.06);
  return { W, R, rearAxle, frontAxle, forkTop, headPt, pivot, seatFront, seatRear };
}

/* ---------- part builders: each returns a Group in bike space ---------- */

const metalDark = () => mat('#2a2a2f', { metal: 0.7, rough: 0.4 });
const silver = () => mat('#c9c9d0', { metal: 0.9, rough: 0.25 });

const builders = {
  seat(variant, color, spec) {
    const g = new THREE.Group();
    const { seatFront, seatRear } = geometry(spec);
    const x = (seatFront.x + seatRear.x) / 2, y = spec.seatY;
    const fabric = (c) => mat(c, { metal: 0, rough: 0.9 });
    const cfg = {
      stock: { r: 0.09, len: 0.5, sx: 0.55, sz: 1.1, color: '#1b1b1e' },
      comfort: { r: 0.1, len: 0.55, sx: 0.8, sz: 1.5, color: color || '#222226' },
      race: { r: 0.085, len: 0.6, sx: 0.45, sz: 1.0, color: color || '#222226' }
    }[variant];
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(cfg.r, cfg.len, 8, 16), fabric(cfg.color));
    body.rotation.z = Math.PI / 2;
    body.scale.set(cfg.sx, 1, cfg.sz);
    body.position.set(x, y, 0);
    g.add(body);
    const base = box(cfg.len + cfg.r * 1.6, 0.025, cfg.r * 2 * cfg.sz * 0.9, mat('#0f0f11', { metal: 0.2, rough: 0.7 }), x, y - cfg.r * cfg.sx - 0.005, 0);
    g.add(base);
    if (variant === 'comfort') g.add(box(0.03, 0.08, cfg.r * 2 * cfg.sz * 0.95, fabric(cfg.color), x - cfg.len / 2 - cfg.r * 0.6, y + 0.07, 0));
    return shadowed(g);
  },

  bars(variant, color, spec) {
    const g = new THREE.Group();
    const { forkTop } = geometry(spec);
    const c = mat(color || '#222226', { metal: 0.6, rough: 0.35 });
    const grip = mat('#111114', { metal: 0, rough: 0.9 });
    const base = V(forkTop.x - 0.01, forkTop.y + 0.05);
    const rise = variant === 'hirise' ? 0.14 : variant === 'flat' ? 0.0 : 0.05;
    const width = variant === 'stock' ? 0.7 : 0.8;
    const barMat = variant === 'stock' ? mat('#2a2a2f', { metal: 0.6, rough: 0.4 }) : c;
    g.add(box(0.08, 0.05, 0.2, metalDark(), base.x, base.y - 0.02, 0));
    const y = base.y + rise;
    if (rise > 0.06) for (const s of [-1, 1]) g.add(tube(V(base.x, base.y, s * 0.12), V(base.x - 0.02, y, s * 0.14), 0.014, barMat));
    const bar = cyl(0.014, width, barMat);
    bar.position.set(base.x - 0.02, y, 0);
    g.add(bar);
    for (const s of [-1, 1]) {
      const gp = cyl(0.019, 0.12, grip);
      gp.position.set(base.x - 0.02, y, s * (width / 2 - 0.05));
      g.add(gp);
      g.add(tube(V(base.x - 0.03, y + 0.01, s * 0.2), V(base.x + 0.07, y - 0.02, s * 0.28), 0.007, silver()));
    }
    return shadowed(g);
  },

  light(variant, color, spec) {
    const g = new THREE.Group();
    const { forkTop } = geometry(spec);
    const pos = V(forkTop.x + 0.1, spec.headY - 0.04);
    const led = variant === 'led';
    const r = led ? 0.09 : 0.065;
    const housing = cyl(r, 0.07, metalDark(), 'x');
    housing.position.copy(pos);
    g.add(housing);
    const lens = cyl(r * 0.82, 0.01, mat(led ? color || '#ffffff' : '#fffbe6', { metal: 0, rough: 0.1, emissive: led ? color || '#ffffff' : '#fff2b0', emissiveIntensity: led ? 1.6 : 0.8 }), 'x');
    lens.position.set(pos.x + 0.038, pos.y, 0);
    g.add(lens);
    if (led) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.95, 0.008, 10, 40), mat(color || '#ffffff', { metal: 0, emissive: color || '#ffffff', emissiveIntensity: 2.2 }));
      ring.rotation.y = Math.PI / 2;
      ring.position.set(pos.x + 0.045, pos.y, 0);
      g.add(ring);
    }
    g.add(tube(V(forkTop.x + 0.02, forkTop.y - 0.02), pos, 0.012, metalDark()));
    return shadowed(g);
  },

  guard(variant, color, spec) {
    const g = new THREE.Group();
    if (variant === 'stock') return g;
    const { pivot, R } = geometry(spec);
    const c = mat(color || '#d9d9de', { metal: 0.85, rough: 0.3 });
    const plate = box(0.46, 0.018, 0.2, c, pivot.x + 0.28, R - 0.09, 0);
    plate.rotation.z = -0.12;
    g.add(plate);
    for (const s of [-1, 1]) g.add(box(0.4, 0.05, 0.012, c, pivot.x + 0.28, R - 0.07, s * 0.1));
    return shadowed(g);
  },

  brakes(variant, color, spec) {
    const g = new THREE.Group();
    const { rearAxle, frontAxle } = geometry(spec);
    const big = variant === 'ultra';
    const rotorMat = mat(big ? '#d9d9de' : '#8d8d94', { metal: 0.95, rough: 0.25 });
    const caliper = mat(big ? color || '#d4af37' : '#303036', { metal: 0.5, rough: 0.35 });
    for (const axle of [frontAxle, rearAxle]) {
      const r = big ? 0.155 : 0.11;
      const rotor = cyl(r, 0.007, rotorMat);
      rotor.position.set(axle.x, axle.y, 0.075);
      g.add(rotor);
      if (big) {
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          const hole = cyl(0.012, 0.009, mat('#15121a', { metal: 0, rough: 1 }));
          hole.position.set(axle.x + Math.cos(a) * r * 0.7, axle.y + Math.sin(a) * r * 0.7, 0.075);
          g.add(hole);
        }
      }
      const cal = box(0.07, 0.05, 0.05, caliper, axle.x + (axle === frontAxle ? -r * 0.9 : r * 0.9), axle.y + r * 0.35, 0.075);
      g.add(cal);
    }
    return shadowed(g);
  }
};

export function buildWheel(R, tire, rim, rimColor) {
  const g = new THREE.Group();
  const tr = { stock: 0.062, knobby: 0.075, street: 0.058 }[tire];
  const tireMat = mat('#121214', { metal: 0, rough: 0.95 });
  const t = new THREE.Mesh(new THREE.TorusGeometry(R - tr, tr, 20, 56), tireMat);
  t.scale.z = tire === 'street' ? 1.1 : tire === 'knobby' ? 1.25 : 1.15;
  g.add(t);
  if (tire === 'knobby') {
    const lug = new THREE.BoxGeometry(0.04, 0.045, 0.1);
    const n = 40;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const m = new THREE.Mesh(lug, tireMat);
      m.position.set(Math.cos(a) * (R - 0.008), Math.sin(a) * (R - 0.008), (i % 2 ? 1 : -1) * 0.022);
      m.rotation.z = a;
      g.add(m);
    }
  }
  const rimR = R - tr * 2 + 0.012;
  const rimMat = mat(rim === 'forged' ? rimColor || '#d4af37' : '#b8b8c0', { metal: 0.95, rough: 0.22 });
  const rimMesh = new THREE.Mesh(new THREE.TorusGeometry(rimR, 0.014, 12, 56), rimMat);
  rimMesh.scale.z = 2.6;
  g.add(rimMesh);
  const hub = cyl(0.04, 0.14, silver());
  g.add(hub);
  if (rim === 'forged') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const s = tube(V(0, 0), V(Math.cos(a) * rimR, Math.sin(a) * rimR), 0.017, rimMat, 10);
      s.scale.set(1.8, 1, 1.4);
      g.add(s);
    }
  } else {
    const spokeMat = mat('#aaaab2', { metal: 0.9, rough: 0.3 });
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const z = (i % 2 ? 1 : -1) * 0.025;
      g.add(tube(V(0, 0, z * 0.6), V(Math.cos(a) * rimR, Math.sin(a) * rimR, z * 0.2), 0.0035, spokeMat, 5));
    }
  }
  return shadowed(g);
}

/* ---------- full bike ---------- */

export function createBike(spec, frameColor) {
  const root = new THREE.Group();
  const geo = geometry(spec);
  const { W, R, rearAxle, frontAxle, forkTop, headPt, pivot, seatFront, seatRear } = geo;
  const frameMat = mat(frameColor, { metal: 0.45, rough: 0.35 });
  const dark = metalDark();
  const body = new THREE.Group();

  for (const s of [-1, 1]) {
    const z = s * 0.07;
    body.add(tube(V(headPt.x, headPt.y, z), V(pivot.x, pivot.y, z), 0.022, frameMat));
    body.add(tube(V(seatFront.x, seatFront.y, z), V(pivot.x, pivot.y, z), 0.018, frameMat));
    body.add(tube(V(seatFront.x, seatFront.y, z), V(seatRear.x, seatRear.y, z), 0.018, frameMat));
    body.add(tube(V(pivot.x, pivot.y, s * 0.09), V(rearAxle.x, rearAxle.y, s * 0.09), 0.02, frameMat));
    body.add(tube(V(forkTop.x, forkTop.y, s * 0.065), V(frontAxle.x, frontAxle.y, s * 0.065), 0.019, silver()));
    body.add(box(0.5, 0.26, 0.012, frameMat, 0.0, R + 0.3, s * 0.115)); // side shrouds
  }
  body.add(tube(V(headPt.x, headPt.y, 0), V(seatFront.x, seatFront.y, 0), 0.02, frameMat));
  body.add(box(0.07, 0.05, 0.2, dark, forkTop.x, forkTop.y, 0));
  body.add(box(0.46, 0.25, 0.2, mat('#202024', { metal: 0.3, rough: 0.5 }), 0.02, R + 0.3, 0)); // battery
  const motor = cyl(0.1, 0.22, mat('#9a9aa3', { metal: 0.85, rough: 0.35 }));
  motor.position.set(pivot.x + 0.1, R + 0.02, 0);
  body.add(motor);
  const shock = tube(V(seatFront.x - 0.12, seatFront.y - 0.04), V(pivot.x - 0.12, R + 0.02), 0.03, mat('#ff7a18', { metal: 0.3, rough: 0.5 }));
  body.add(shock);
  body.add(box(0.3, 0.04, 0.12, frameMat, seatRear.x - 0.05, seatRear.y + 0.02, 0)); // tail
  const sprocket = cyl(0.07, 0.01, silver());
  sprocket.position.set(rearAxle.x, rearAxle.y, -0.09);
  body.add(sprocket);

  const fender = new THREE.Mesh(new THREE.TorusGeometry(R + 0.035, 0.012, 8, 32, 1.6), frameMat);
  fender.scale.z = 5;
  fender.rotation.z = 0.35;
  fender.position.copy(frontAxle);
  body.add(fender);
  root.add(shadowed(body));

  const slots = {};
  const wheels = new THREE.Group();
  root.add(wheels);
  for (const id of ['seat', 'bars', 'light', 'guard', 'brakes']) {
    slots[id] = new THREE.Group();
    root.add(slots[id]);
  }

  const state = { tires: 'stock', rims: 'stock', rimColor: null };
  const api = {
    root, frameMat, geo,
    setFrameColor(c) { frameMat.color.set(c); },
    setSlot(slot, variant = 'stock', color = null) {
      if (slot === 'tires' || slot === 'rims') {
        if (slot === 'tires') state.tires = variant;
        else { state.rims = variant; state.rimColor = color; }
        wheels.clear();
        for (const axle of [frontAxle, rearAxle]) {
          const w = buildWheel(R, state.tires, state.rims, state.rimColor);
          w.position.copy(axle);
          wheels.add(w);
        }
        return wheels;
      }
      const grp = slots[slot];
      grp.clear();
      grp.add(builders[slot](variant, color, spec));
      return grp;
    }
  };
  for (const s of ['tires', 'seat', 'bars', 'light', 'guard', 'brakes']) api.setSlot(s, 'stock');
  api.setSlot('rims', 'stock');
  return api;
}

export function disposeBike(bike) {
  if (bike.dispose) return bike.dispose();
  bike.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
}

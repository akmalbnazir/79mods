import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/RoomEnvironment.js';

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#343441';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const v = 45 + Math.random() * 25;
    g.fillStyle = `rgba(${v},${v},${v + 10},.2)`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  g.strokeStyle = 'rgba(12,12,22,.4)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function m(color, rough = 0.8, metal = 0.1) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function add(parent, geo, material, x, y, z) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function garageSign() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 384;
  const context = canvas.getContext('2d');
  context.fillStyle = '#191727';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const gradient = context.createLinearGradient(80, 0, 944, 0);
  gradient.addColorStop(0, '#5598ff');
  gradient.addColorStop(0.5, '#b391ff');
  gradient.addColorStop(1, '#f17dcc');
  context.fillStyle = gradient;
  context.font = 'italic 900 160px sans-serif';
  context.textAlign = 'center';
  context.fillText('79MODS', 512, 220);
  context.fillStyle = '#c7c3db';
  context.font = '500 28px sans-serif';
  context.fillText('THE BUILD ROOM  /  MAKE IT YOURS', 512, 295);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: texture });
}

export function buildGarage(scene, renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = new RoomEnvironment();
  scene.environment = pmrem.fromScene(environment, 0.04).texture;
  environment.dispose();
  pmrem.dispose();
  scene.environmentIntensity = 0.8;
  scene.background = new THREE.Color('#191727');

  const H = 3.6, S = 4.8;
  const room = new THREE.Mesh(new THREE.BoxGeometry(S * 2, H, S * 2), new THREE.MeshStandardMaterial({ color: '#30303e', roughness: 0.95, side: THREE.BackSide }));
  room.position.y = H / 2;
  room.receiveShadow = true;
  scene.add(room);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(S * 2, S * 2), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.82, metalness: 0.12 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.003;
  floor.receiveShadow = true;
  scene.add(floor);

  const steel = m('#242431', 0.6, 0.45);
  const trim = m('#606073', 0.5, 0.55);
  const blueStrip = new THREE.MeshStandardMaterial({ color: '#5598ff', emissive: '#3979ef', emissiveIntensity: 2 });
  const violetStrip = new THREE.MeshStandardMaterial({ color: '#b391ff', emissive: '#8753dd', emissiveIntensity: 2 });
  for (const z of [-S + 0.03, S - 0.03]) {
    add(scene, new THREE.BoxGeometry(S * 2, 0.65, 0.04), steel, 0, 0.325, z);
    add(scene, new THREE.BoxGeometry(S * 2, 0.025, 0.05), violetStrip, 0, 0.66, z);
  }
  for (const x of [-S + 0.03, S - 0.03]) {
    add(scene, new THREE.BoxGeometry(0.04, 0.65, S * 2), steel, x, 0.325, 0);
    add(scene, new THREE.BoxGeometry(0.05, 0.025, S * 2), blueStrip, x, 0.66, 0);
  }

  // Dark shutter and illuminated brand panel keep the bike the focal point.
  const door = new THREE.Group();
  door.position.set(1.5, 0, -S + 0.08);
  const panel = m('#41414f', 0.7, 0.35);
  for (let i = 0; i < 10; i++) add(door, new THREE.BoxGeometry(3.5, 0.27, 0.04), panel, 0, 0.17 + i * 0.29, 0);
  for (const x of [-1.82, 1.82]) add(door, new THREE.BoxGeometry(0.09, 3, 0.12), trim, x, 1.5, 0.04);
  add(door, new THREE.BoxGeometry(3.75, 0.09, 0.12), trim, 0, 3, 0.04);
  add(door, new THREE.BoxGeometry(0.45, 0.04, 0.06), trim, 0, 0.65, 0.06);
  scene.add(door);
  add(scene, new THREE.BoxGeometry(2.6, 1.05, 0.08), steel, -2.25, 1.85, -S + 0.06);
  const sign = add(scene, new THREE.PlaneGeometry(2.5, 0.94), garageSign(), -2.25, 1.85, -S + 0.11);
  sign.castShadow = sign.receiveShadow = false;
  add(scene, new THREE.BoxGeometry(2.6, 0.025, 0.06), violetStrip, -2.25, 1.3, -S + 0.12);

  const bench = new THREE.Group();
  bench.position.set(-S + 0.5, 0, -1.4);
  add(bench, new THREE.BoxGeometry(0.95, 0.07, 3), trim, 0, 0.95, 0);
  add(bench, new THREE.BoxGeometry(0.8, 0.86, 2.85), steel, 0, 0.46, 0);
  const cabinet = m('#47405d', 0.65, 0.25);
  for (let i = 0; i < 4; i++) {
    add(bench, new THREE.BoxGeometry(0.025, 0.17, 2.65), cabinet, 0.415, 0.2 + i * 0.2, 0);
    add(bench, new THREE.BoxGeometry(0.035, 0.025, 0.5), trim, 0.435, 0.23 + i * 0.2, 0);
  }
  add(bench, new THREE.BoxGeometry(0.04, 1.15, 2.9), steel, -0.43, 1.7, 0);
  const tool = m('#c9c9d8', 0.3, 0.85);
  for (let i = 0; i < 7; i++) {
    const z = -1.15 + i * 0.38;
    add(bench, new THREE.BoxGeometry(0.045, 0.3, 0.04), tool, -0.38, 1.7, z);
    const head = add(bench, new THREE.TorusGeometry(0.055, 0.015, 6, 12), tool, -0.38, 1.9, z);
    head.rotation.y = Math.PI / 2;
  }
  add(bench, new THREE.BoxGeometry(0.08, 0.035, 2.9), blueStrip, -0.35, 2.32, 0);
  scene.add(bench);

  const shelf = new THREE.Group();
  shelf.position.set(S - 0.4, 0, -1);
  for (const z of [-1.5, 1.5]) add(shelf, new THREE.BoxGeometry(0.6, 2.6, 0.06), steel, 0, 1.3, z);
  const boxes = ['#6b6480', '#3979ef', '#514566', '#9c5388', '#8b8899'].map((color) => m(color, 0.8));
  for (let r = 0; r < 4; r++) {
    add(shelf, new THREE.BoxGeometry(0.6, 0.04, 3), trim, 0, 0.25 + r * 0.7, 0);
    for (let i = 0; i < 4; i++) {
      const z = -1.1 + i * 0.7;
      add(shelf, new THREE.BoxGeometry(0.4, 0.3, 0.45), boxes[(r + i) % boxes.length], 0, 0.42 + r * 0.7, z);
      add(shelf, new THREE.BoxGeometry(0.012, 0.055, 0.15), tool, -0.21, 0.45 + r * 0.7, z);
    }
  }
  add(shelf, new THREE.BoxGeometry(0.035, 0.035, 3), violetStrip, -0.31, 2.4, 0);
  scene.add(shelf);

  const rubber = m('#15151c', 0.95, 0);
  for (let i = 0; i < 4; i++) {
    const t = add(scene, new THREE.TorusGeometry(0.28, 0.1, 12, 32), rubber, 3.5, 0.1 + i * 0.2, 3.8);
    t.rotation.x = Math.PI / 2;
  }
  const chest = new THREE.Group();
  chest.position.set(-3.5, 0, 3.8);
  add(chest, new THREE.BoxGeometry(1.1, 1, 0.55), cabinet, 0, 0.5, 0);
  for (let i = 0; i < 4; i++) add(chest, new THREE.BoxGeometry(0.8, 0.025, 0.04), trim, 0, 0.2 + i * 0.22, 0.3);
  scene.add(chest);

  const strip = new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#e5eaff', emissiveIntensity: 2.5 });
  for (const x of [-2, 2]) {
    add(scene, new THREE.BoxGeometry(0.2, 0.08, 4.4), steel, x, H - 0.06, 0);
    add(scene, new THREE.BoxGeometry(0.12, 0.02, 4.2), strip, x, H - 0.11, 0);
  }

  scene.add(new THREE.HemisphereLight('#e1e7ff', '#353040', 0.85));
  for (const [x, z] of [[-1.5, 1.5], [2, -1.5]]) {
    const s = new THREE.SpotLight('#f4f1ff', 95, 14, 0.85, 0.8, 1.6);
    s.position.set(x, H - 0.3, z);
    s.target.position.set(0, 0.4, 0);
    s.castShadow = x < 0;
    s.shadow.mapSize.set(2048, 2048);
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.025;
    s.shadow.camera.near = 0.3;
    s.shadow.camera.far = 12;
    scene.add(s, s.target);
  }
  const rim = new THREE.PointLight('#a38bff', 8, 8, 2);
  rim.position.set(-2.8, 2, -2.8);
  scene.add(rim);

  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.012, 64), m('#191a22', 0.8, 0.2));
  pad.position.y = -0.002;
  pad.receiveShadow = true;
  scene.add(pad);
  const ring = add(scene, new THREE.TorusGeometry(1.52, 0.008, 6, 96), violetStrip, 0, 0.008, 0);
  ring.rotation.x = Math.PI / 2;
  ring.castShadow = ring.receiveShadow = false;
  for (const x of [-2, 2]) {
    const guide = add(scene, new THREE.PlaneGeometry(0.025, 3.8), trim, x, 0.006, 0);
    guide.rotation.x = -Math.PI / 2;
    guide.castShadow = false;
  }
}

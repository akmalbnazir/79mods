import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/RoomEnvironment.js';

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#3b3b42';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const v = 50 + Math.random() * 30;
    g.fillStyle = `rgba(${v},${v},${v + 6},.35)`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  g.strokeStyle = 'rgba(0,0,0,.55)';
  g.lineWidth = 3;
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

export function buildGarage(scene, renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  scene.background = new THREE.Color('#15121a');

  const H = 4, S = 6; // room height and half-size
  const room = new THREE.Mesh(new THREE.BoxGeometry(S * 2, H, S * 2), new THREE.MeshStandardMaterial({ color: '#4b4a55', roughness: 0.95, side: THREE.BackSide }));
  room.position.y = H / 2;
  room.receiveShadow = true;
  scene.add(room);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(S * 2, S * 2), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.55, metalness: 0.1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.003;
  floor.receiveShadow = true;
  scene.add(floor);

  // Roll-up door on the back wall
  const door = new THREE.Group();
  door.position.set(0, 0, -S + 0.02);
  const panel = m('#8b8a96', 0.6, 0.3);
  for (let i = 0; i < 9; i++) add(door, new THREE.BoxGeometry(5.6, 0.31, 0.04), panel, 0, 0.2 + i * 0.35, 0);
  scene.add(door);

  // Workbench + tools on the left wall
  const bench = new THREE.Group();
  bench.position.set(-S + 0.5, 0, -1);
  add(bench, new THREE.BoxGeometry(0.9, 0.06, 3), m('#7a5a3a', 0.7), 0, 0.95, 0);
  for (const z of [-1.4, 1.4]) add(bench, new THREE.BoxGeometry(0.8, 0.95, 0.08), m('#2b2b30'), 0, 0.47, z);
  add(bench, new THREE.BoxGeometry(0.1, 0.8, 2.9), m('#b23a2e', 0.5, 0.2), 0.42, 1.4, 0).scale.set(0.2, 1, 1);
  add(bench, new THREE.BoxGeometry(0.03, 1.2, 2.9), m('#34343b'), -0.4, 1.7, 0);
  for (let i = 0; i < 6; i++) add(bench, new THREE.BoxGeometry(0.05, 0.3, 0.05), m('#c9c9d0', 0.3, 0.9), -0.35, 1.7 + (i % 2) * 0.2, -1.1 + i * 0.45);
  scene.add(bench);

  // Shelving with parts boxes on the right wall
  const shelf = new THREE.Group();
  shelf.position.set(S - 0.4, 0, 0.5);
  for (const z of [-1.5, 1.5]) add(shelf, new THREE.BoxGeometry(0.6, 2.4, 0.06), m('#2b2b30'), 0, 1.2, z);
  const colors = ['#6751ed', '#3979ef', '#a43de0', '#ff7a18', '#e8e8ea'];
  for (let r = 0; r < 4; r++) {
    add(shelf, new THREE.BoxGeometry(0.6, 0.04, 3), m('#44444c', 0.6, 0.4), 0, 0.3 + r * 0.7, 0);
    for (let i = 0; i < 5; i++) add(shelf, new THREE.BoxGeometry(0.4, 0.3, 0.45), m(colors[(r + i) % colors.length], 0.7), 0, 0.5 + r * 0.7, -1.2 + i * 0.6);
  }
  scene.add(shelf);

  // Tire stack + tool chest near the front wall
  for (let i = 0; i < 4; i++) {
    const t = add(scene, new THREE.TorusGeometry(0.28, 0.1, 14, 32), m('#111114', 0.95, 0), 3.8, 0.1 + i * 0.2, 4.6);
    t.rotation.x = Math.PI / 2;
  }
  const chest = new THREE.Group();
  chest.position.set(-3.5, 0, 4.9);
  add(chest, new THREE.BoxGeometry(1.1, 1, 0.55), m('#b23a2e', 0.45, 0.35), 0, 0.5, 0);
  for (let i = 0; i < 4; i++) add(chest, new THREE.BoxGeometry(1, 0.02, 0.02), m('#222', 0.5), 0, 0.2 + i * 0.22, 0.28);
  scene.add(chest);

  // Ceiling strip lights
  const strip = new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#f3f0ff', emissiveIntensity: 2.5 });
  for (const x of [-2, 2]) add(scene, new THREE.BoxGeometry(0.12, 0.06, 4), strip, x, H - 0.05, 0);

  scene.add(new THREE.HemisphereLight('#aab4ff', '#2a2230', 0.5));
  for (const [x, z] of [[-1.5, 1], [2, -1.5]]) {
    const s = new THREE.SpotLight('#fff4e6', 80, 14, 0.7, 0.6, 1.6);
    s.position.set(x, H - 0.3, z);
    s.target.position.set(0, 0.4, 0);
    s.castShadow = true;
    s.shadow.mapSize.set(2048, 2048);
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.04;
    scene.add(s, s.target);
  }
  const rim = new THREE.PointLight('#6751ed', 10, 9, 1.6);
  rim.position.set(-3, 2.2, -3);
  scene.add(rim);

  // Turntable pad under the bike
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.02, 64), new THREE.MeshStandardMaterial({ color: '#25232c', roughness: 0.35, metalness: 0.5 }));
  pad.position.y = 0.012;
  pad.receiveShadow = true;
  scene.add(pad);
}

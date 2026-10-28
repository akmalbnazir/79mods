import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { buildGarage } from './garage.js';
import { createBike, disposeBike } from './bike.js';
import { createGlbBike } from './bike_glb.js';

const $ = (id) => document.getElementById(id);
const money = (n) => `$${n.toLocaleString()}`;

const data = await (await fetch('./data.json')).json();
const partById = Object.fromEntries(data.parts.map((p) => [p.id, p]));

const state = {
  bikeId: data.bikes[0].id,
  frameColor: data.bikes[0].colors[0],
  picks: {}, // slot -> { partId, color }
  tab: ''
};

/* ---------- 3D scene ---------- */
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);
const target = new THREE.Vector3(0, 0.5, 0);
const views = {
  reset: [2.6, 1.3, 2.8],
  side: [0, 0.8, 3.6],
  front: [3.6, 0.9, 0],
  rear: [-3.6, 0.9, 0]
};
camera.position.set(...views.reset);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(target);
controls.enableDamping = true;
controls.minDistance = 1.2;
controls.maxDistance = 5;
controls.maxPolarAngle = Math.PI / 2 - 0.04;
controls.enablePan = false;
controls.autoRotateSpeed = 1.2;

buildGarage(scene, renderer);

let bike = null;
let tween = null;
const pops = [];

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  // On narrow screens shift the bike up so the bottom panel doesn't cover it.
  camera.setViewOffset(w, h, 0, innerWidth < 900 ? h * 0.12 : 0, w, h);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

function flyTo(name) {
  const to = new THREE.Vector3(...views[name]);
  const dist = camera.position.distanceTo(target);
  to.sub(target).setLength(Math.max(Math.min(dist, 4), 2.4)).add(target);
  tween = { from: camera.position.clone(), to, t: 0 };
}

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (tween) {
    tween.t = Math.min(1, tween.t + dt / 0.7);
    const k = 1 - Math.pow(1 - tween.t, 3);
    camera.position.lerpVectors(tween.from, tween.to, k);
    if (tween.t >= 1) tween = null;
  }
  for (const p of pops) {
    p.t = Math.min(1, p.t + dt / 0.35);
    const k = p.t < 1 ? 0.85 + 0.15 * (1 - Math.pow(1 - p.t, 3)) + Math.sin(p.t * Math.PI) * 0.06 : 1;
    p.obj.scale.setScalar(k);
  }
  for (let i = pops.length - 1; i >= 0; i--) if (pops[i].t >= 1) pops.splice(i, 1);
  controls.update();
  renderer.render(scene, camera);
});
/* ---------- state -> 3D ---------- */
const currentBike = () => data.bikes.find((b) => b.id === state.bikeId);
const fullName = () => `${currentBike().brandName} ${currentBike().name}`;
const fits = (part) => part.fits.includes(state.bikeId) || part.fits.includes(currentBike().brand);

const bikeSlots = () => data.slots.filter((s) => !currentBike().slots || currentBike().slots.includes(s.id));
state.tab = bikeSlots()[0]?.id || '';

async function buildBike() {
  const spec = currentBike();
  const next = spec.glb ? await createGlbBike(spec) : createBike(spec, state.frameColor);
  if (spec !== currentBike()) return;
  if (bike) { scene.remove(bike.root); disposeBike(bike); }
  bike = next;
  scene.add(bike.root);
  for (const [slot, pick] of Object.entries(state.picks)) {
    const part = partById[pick.partId];
    bike.setSlot(slot, part.variant, pick.color);
  }
}

function applySlot(slot, animate = true) {
  const pick = state.picks[slot];
  const part = pick && partById[pick.partId];
  const obj = bike.setSlot(slot, part ? part.variant : 'stock', pick ? pick.color : null);
  if (animate) pops.push({ obj, t: 0 });
}

/* ---------- UI ---------- */
function renderBikeUI() {
  const bikeChips = $('bike-chips');
  const chip = (label, on, onClick) => {
    const el = document.createElement('button');
    el.textContent = label;
    el.className = on ? 'on' : '';
    el.onclick = onClick;
    return el;
  };
  const brands = [...new Map(data.bikes.map((b) => [b.brand, b.brandName]))];
  const cur = currentBike();
  bikeChips.replaceChildren(...brands.map(([id, name]) => chip(name, id === cur.brand, () => {
    selectBike(data.bikes.find((b) => b.brand === id).id);
  })));
  $('bike-models').replaceChildren(...data.bikes.filter((b) => b.brand === cur.brand).map((b) => chip(b.name, b.id === cur.id, () => selectBike(b.id))));
  $('bike-colors').replaceChildren(...currentBike().colors.map((c) => swatch(c, c === state.frameColor, () => {
    state.frameColor = c;
    bike.setFrameColor(c);
    renderBikeUI();
  })));
}

function swatch(color, on, onClick) {
  const el = document.createElement('button');
  el.className = `swatch${on ? ' on' : ''}`;
  el.style.background = color;
  el.setAttribute('aria-label', color);
  el.onclick = onClick;
  return el;
}

function renderTabs() {
  $('slot-tabs').replaceChildren(...bikeSlots().map((s) => {
    const el = document.createElement('button');
    el.textContent = s.name;
    el.className = s.id === state.tab ? 'on' : '';
    if (state.picks[s.id]) el.insertAdjacentHTML('beforeend', '<span class="dot"></span>');
    el.onclick = () => { state.tab = s.id; renderTabs(); renderParts(); };
    return el;
  }));
}

function renderParts() {
  if (!bikeSlots().length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'No compatible parts are configured for this bike yet.';
    $('parts').replaceChildren(empty);
    return;
  }

  const slotParts = data.parts.filter((p) => p.slot === state.tab).sort((a, b) => fits(b) - fits(a));
  const pick = state.picks[state.tab];
  const cards = [];

  const stock = document.createElement('div');
  stock.className = `part${pick ? '' : ' on'}`;
  stock.innerHTML = '<header><b>Stock</b><span class="price">Included</span></header><small>Factory part</small>';
  const stockRow = document.createElement('div');
  stockRow.className = 'row';
  const stockBtn = button(pick ? 'Use stock' : 'Selected', 'btn ghost', () => { delete state.picks[state.tab]; applySlot(state.tab); refresh(); });
  stockBtn.disabled = !pick;
  stockRow.append(stockBtn);
  stock.append(stockRow);
  cards.push(stock);

  for (const part of slotParts) {
    const ok = fits(part);
    const on = pick && pick.partId === part.id;
    const el = document.createElement('div');
    el.className = `part${on ? ' on' : ''}${ok ? '' : ' disabled'}`;
    el.innerHTML = `<header><b></b><span class="price">${money(part.price)}</span></header><small></small>`;
    el.querySelector('b').textContent = part.name;
    el.querySelector('small').textContent = ok ? `Fits ${fullName()}` : `Doesn't fit ${fullName()}`;
    const row = document.createElement('div');
    row.className = 'row';
    const sw = document.createElement('div');
    sw.style.display = 'flex';
    sw.style.gap = '6px';
    if (ok) for (const c of part.colors) {
      sw.append(swatch(c, on && pick.color === c, () => choose(part, c)));
    }
    row.append(sw, button(on ? 'Remove' : 'Add', on ? 'btn ghost' : 'btn', () => {
      if (on) { delete state.picks[part.slot]; applySlot(part.slot); refresh(); } else choose(part, pick && pick.partId === part.id ? pick.color : part.colors[0] || null);
    }, !ok));
    el.append(row);
    cards.push(el);
  }
  $('parts').replaceChildren(...cards);
}

function button(label, cls, onClick, disabled = false) {
  const el = document.createElement('button');
  el.className = cls;
  el.textContent = label;
  el.disabled = disabled;
  el.onclick = onClick;
  return el;
}

function choose(part, color) {
  state.picks[part.slot] = { partId: part.id, color };
  applySlot(part.slot);
  refresh();
}

function renderSummary() {
  const picks = Object.values(state.picks).map((p) => partById[p.partId]);
  const total = picks.reduce((sum, p) => sum + p.price, 0);
  const lines = $('lines');
  lines.replaceChildren();
  if (!picks.length) lines.innerHTML = '<div class="empty">Pick parts to build your setup.</div>';
  for (const p of picks) {
    const row = document.createElement('div');
    const name = document.createElement('span');
    name.textContent = p.name;
    const price = document.createElement('b');
    price.textContent = money(p.price);
    row.append(name, price);
    lines.append(row);
  }
  $('total').textContent = money(total);
  $('add-cart').disabled = !picks.length;
}

function refresh() {
  renderTabs();
  renderParts();
  renderSummary();
}

async function selectBike(id) {
  if (id === state.bikeId) return;
  state.bikeId = id;
  state.frameColor = currentBike().colors[0];
  const removed = [];
  for (const [slot, pick] of Object.entries(state.picks)) {
    if (!bikeSlots().some((s) => s.id === slot) || !fits(partById[pick.partId])) {
      removed.push(partById[pick.partId].name);
      delete state.picks[slot];
    }
  }
  if (!bikeSlots().some((s) => s.id === state.tab)) state.tab = bikeSlots()[0]?.id || '';
  await buildBike();
  pops.push({ obj: bike.root, t: 0 });
  renderBikeUI();
  refresh();
  if (removed.length) toast(`Removed from build for ${fullName()}: ${removed.join(', ')}`);
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// Prototype stub. On Shopify this would POST { items } to /cart/add.js.
function addToCart(items) {
  console.info('[configurator] add to cart', items);
  toast(`Prototype: ${items.length} part${items.length > 1 ? 's' : ''} would be added to the cart`);
}

$('add-cart').onclick = () => {
  const bikeName = fullName();
  addToCart(Object.values(state.picks).map((p) => ({ handle: p.partId, quantity: 1, properties: { Bike: bikeName, Finish: p.color || '' } })));
};

document.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => flyTo(b.dataset.view); });
$('spin').onclick = (e) => {
  controls.autoRotate = !controls.autoRotate;
  e.currentTarget.setAttribute('aria-pressed', controls.autoRotate);
};
controls.addEventListener('start', () => { tween = null; });

await buildBike();
renderBikeUI();
refresh();
$('loading').classList.add('done');

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { buildGarage } from './garage.js';
import { createBike, disposeBike } from './bike.js?v=release-finishes-31';
import { createGlbBike } from './bike_glb.js?v=release-finishes-31';

const $ = (id) => document.getElementById(id);

const settings = window.configuratorSettings || {};
const currency = settings.currency || window.Shopify?.currency?.active || 'USD';
const money = (amount) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
const storefrontRoot = settings.storefrontRoot || window.Shopify?.routes?.root || '/';
const storefrontPath = (path) => `${storefrontRoot.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
const data = await (await fetch(settings.dataUrl || './data.json', { cache: 'no-store' })).json();
for (const spec of data.bikes) {
  if (spec.glb && settings.models) spec.glb = settings.models[spec.glb.split('?')[0]] || spec.glb;
}
const partById = Object.fromEntries(data.parts.map((p) => [p.id, p]));
let addingToCart = false;
let catalogLoading = true;
let bikeLoading = true;
const catalog = new Map();

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
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
  camera.zoom = innerWidth < 900 ? Math.min(1, camera.aspect / 0.8) * 0.85 : 1;
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
const canPreview = (part) => !part.previewFits || part.previewFits.includes(state.bikeId);

const bikeSlots = () => data.slots.filter((s) => !currentBike().slots || currentBike().slots.includes(s.id));
const modelParts = () => data.parts.filter((part) => fits(part) && canPreview(part) && bikeSlots().some((slot) => slot.id === part.slot));
const variantsFor = (part, product = catalog.get(part.id)?.product) => (product?.variants || []).filter((variant) => !part.fitOptions || variant.option1 === part.fitOptions[state.bikeId]);
const selectedVariant = (part, pick = state.picks[part.slot]) => {
  const variants = variantsFor(part);
  return variants.find((variant) => String(variant.id) === String(pick?.variantId)) || variants.find((variant) => variant.available) || variants[0];
};
const partPrice = (part) => selectedVariant(part) ? selectedVariant(part).price / 100 : part.price;
const variantColor = (variant) => /black/i.test(variant?.option2 || variant?.title || '') ? '#18181b' : '#d7d7dc';
const variantLabel = (part, variant) => {
  if (!part.fitOptions) return variant.title;
  const finish = /black/i.test(variant.option2) ? 'Black' : /chrome/i.test(variant.option2) ? 'Chrome' : variant.option2;
  return [finish, variant.option3].filter(Boolean).join(' / ');
};
state.tab = bikeSlots()[0]?.id || '';

async function buildBike() {
  const spec = currentBike();
  bikeLoading = true;
  stage.setAttribute('aria-busy', 'true');
  refresh();
  try {
    const next = spec.glb ? await createGlbBike(spec) : createBike(spec, state.frameColor);
    if (spec !== currentBike()) { disposeBike(next); return; }
    if (bike) { scene.remove(bike.root); disposeBike(bike); }
    bike = next;
    scene.add(bike.root);
    for (const [slot, pick] of Object.entries(state.picks)) {
      const part = partById[pick.partId];
      bike.setSlot(slot, part.variant, pick.color);
    }
    bikeLoading = false;
  } finally {
    if (spec === currentBike()) stage.setAttribute('aria-busy', 'false');
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
  $('model-note').textContent = cur.modelNote || '';
  $('model-note').hidden = !cur.modelNote;
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
  const slots = bikeSlots().filter((slot) => modelParts().some((part) => part.slot === slot.id));
  if (!slots.some((slot) => slot.id === state.tab)) state.tab = slots[0]?.id || '';
  $('slot-tabs').replaceChildren(...slots.map((s) => {
    const el = document.createElement('button');
    el.textContent = s.name;
    el.className = s.id === state.tab ? 'on' : '';
    if (state.picks[s.id]) el.insertAdjacentHTML('beforeend', '<span class="dot"></span>');
    el.onclick = () => { state.tab = s.id; renderTabs(); renderParts(); };
    return el;
  }));
}

function renderParts() {
  if (!modelParts().length) {
    const empty = document.createElement('div');
    empty.className = 'coming-soon';
    const title = document.createElement('h3');
    title.textContent = 'Coming soon';
    const message = document.createElement('p');
    message.textContent = 'We\'re adding parts slowly. More options for this model are on the way.';
    empty.append(title, message);
    $('parts').replaceChildren(empty);
    return;
  }

  const slotParts = modelParts().filter((part) => part.slot === state.tab);
  const pick = state.picks[state.tab];
  const cards = [];

  const stock = document.createElement('div');
  stock.className = `part${pick ? '' : ' on'}`;
  stock.innerHTML = '<header><b>Stock</b><span class="price">Included</span></header><small>Factory part</small>';
  const stockRow = document.createElement('div');
  stockRow.className = 'row';
  const stockBtn = button(pick ? 'Use stock' : 'Selected', 'btn ghost', () => { delete state.picks[state.tab]; applySlot(state.tab); refresh(); });
  stockBtn.disabled = !pick || addingToCart || bikeLoading;
  stockRow.append(stockBtn);
  stock.append(stockRow);
  cards.push(stock);

  for (const part of slotParts) {
    const ok = fits(part);
    const previewable = canPreview(part);
    const entry = catalog.get(part.id);
    const variant = selectedVariant(part);
    const available = !!variant?.available && !catalogLoading && !entry?.error;
    const on = pick && pick.partId === part.id;
    const el = document.createElement('div');
    el.className = `part${on ? ' on' : ''}${ok && previewable ? '' : ' disabled'}`;
    el.innerHTML = `<header><b></b><span class="price">${money(partPrice(part))}</span></header><small></small>`;
    el.querySelector('b').textContent = part.name;
    el.querySelector('small').textContent = !ok
      ? `Doesn't fit ${fullName()}`
      : previewable
        ? `Fits ${fullName()}${part.previewNote ? `. ${part.previewNote}` : ''}`
        : `Fits ${fullName()}, but 3D preview isn't available for this model`;
    if (catalogLoading || entry?.error || !available) {
      const status = document.createElement('p');
      status.className = 'part-status';
      status.textContent = catalogLoading ? 'Checking availability...' : entry?.error ? 'Could not load options. Please try again.' : 'Sold out';
      el.append(status);
      if (entry?.error) el.append(button('Retry', 'btn ghost', () => loadCatalog(), catalogLoading));
    }
    const variants = variantsFor(part);
    if (variants.length) {
      const label = document.createElement('label');
      label.className = 'variant-field';
      label.append('Wheelset option');
      const select = document.createElement('select');
      select.setAttribute('aria-label', `${part.name} option`);
      select.disabled = addingToCart || bikeLoading;
      for (const option of variants) {
        const node = document.createElement('option');
        node.value = option.id;
        node.textContent = variantLabel(part, option);
        if (!option.available) node.textContent += ' - Sold out';
        node.disabled = !option.available;
        node.selected = option.id === variant?.id;
        select.append(node);
      }
      select.onchange = () => {
        const next = variants.find((option) => String(option.id) === select.value);
        if (next?.available) choose(part, part.colors[0] || null, next.id);
      };
      label.append(select);
      el.append(label);
    }
    if (part.url) {
      const link = document.createElement('a');
      const productUrl = new URL(part.url, location.href);
      if (variant) productUrl.searchParams.set('variant', variant.id);
      link.href = productUrl.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'View product details';
      link.style.display = 'inline-block';
      link.style.marginTop = '6px';
      link.style.color = 'var(--ink)';
      link.style.fontWeight = '700';
      link.style.textDecoration = 'none';
      el.querySelector('small').after(link);
    }
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
    }, !ok || !previewable || !available || addingToCart || bikeLoading));
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

function choose(part, color, variantId = selectedVariant(part)?.id) {
  if (!bike || bikeLoading || addingToCart || !variantId) return;
  const variant = variantsFor(part).find((variant) => variant.id === variantId);
  state.picks[part.slot] = { partId: part.id, color: color || variantColor(variant), variantId };
  applySlot(part.slot);
  refresh();
}

function renderSummary() {
  const picks = Object.values(state.picks).map((p) => partById[p.partId]);
  const total = picks.reduce((sum, part) => sum + partPrice(part), 0);
  const lines = $('lines');
  lines.replaceChildren();
  if (!picks.length) lines.innerHTML = `<div class="empty">${modelParts().length ? 'Pick parts to build your setup.' : 'Coming soon. We\'re adding parts slowly.'}</div>`;
  for (const p of picks) {
    const row = document.createElement('div');
    const name = document.createElement('span');
    name.textContent = p.name;
    const price = document.createElement('b');
    price.textContent = money(partPrice(p));
    row.append(name, price);
    lines.append(row);
  }
  $('total').textContent = money(total);
  $('add-cart').disabled = !picks.length || addingToCart || bikeLoading || catalogLoading
    || picks.some((part) => !selectedVariant(part)?.available || catalog.get(part.id)?.error);
  if (!addingToCart) $('add-cart').textContent = modelParts().length ? 'Add build to cart' : 'Coming soon';
  document.querySelectorAll('#bike-chips button, #bike-models button').forEach((button) => { button.disabled = addingToCart; });
}

function refresh() {
  renderTabs();
  renderParts();
  renderSummary();
}

async function selectBike(id) {
  if (id === state.bikeId || addingToCart) return;
  const previousVariants = Object.fromEntries(Object.entries(state.picks).map(([slot, pick]) => [slot, selectedVariant(partById[pick.partId], pick)]));
  state.bikeId = id;
  state.frameColor = currentBike().colors[0];
  const removed = [];
  for (const [slot, pick] of Object.entries(state.picks)) {
    if (!bikeSlots().some((s) => s.id === slot) || !fits(partById[pick.partId]) || !canPreview(partById[pick.partId])) {
      removed.push(partById[pick.partId].name);
      delete state.picks[slot];
    } else {
      const previous = previousVariants[slot];
      const variant = variantsFor(partById[pick.partId]).find((variant) => variant.available && variant.option2 === previous?.option2 && variant.option3 === previous?.option3)
        || selectedVariant(partById[pick.partId]);
      if (variant) { pick.variantId = variant.id; pick.color = variantColor(variant); }
    }
  }
  if (!bikeSlots().some((s) => s.id === state.tab)) state.tab = bikeSlots()[0]?.id || '';
  renderBikeUI();
  refresh();
  try {
    await buildBike();
    if (id !== state.bikeId) return;
    pops.push({ obj: bike.root, t: 0 });
  } catch {
    if (id !== state.bikeId) return;
    if (bike) { scene.remove(bike.root); disposeBike(bike); bike = null; }
    toast('Could not load this bike. Choose another model and try again.');
  }
  bikeLoading = !bike;
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

$('add-cart').onclick = async () => {
  if (addingToCart || bikeLoading || catalogLoading || !Object.keys(state.picks).length) return;
  const bikeName = fullName();
  const picks = Object.values(state.picks).map((pick) => ({ ...pick }));
  addingToCart = true;
  $('add-cart').textContent = 'Adding build...';
  $('add-cart').setAttribute('aria-busy', 'true');
  refresh();
  try {
    const items = await Promise.all(picks.map(async (pick) => {
      const part = partById[pick.partId];
      const response = await fetch(storefrontPath(`products/${part.id}.js`), { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Could not load ${part.name}. Please try again.`);
      const product = await response.json();
      const requestedId = pick.variantId || new URL(part.url, location.href).searchParams.get('variant');
      const variant = requestedId
        ? variantsFor(part, product).find((variant) => String(variant.id) === String(requestedId))
        : product.variants.length === 1 ? product.variants[0] : null;
      if (!variant) throw new Error(`Choose an option for ${part.name} before adding it.`);
      if (!variant.available) throw new Error(`${part.name} is sold out. Your build has been kept.`);
      const properties = { Bike: bikeName };
      if (variant.title !== 'Default Title') properties['Wheelset option'] = variant.title;
      return { id: variant.id, quantity: 1, properties };
    }));
    const response = await fetch(storefrontPath('cart/add.js'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.description || result.message || 'Could not add your build. Please try again.');
    toast('Build added to your shopping bag.');
    const cartLink = $('view-cart');
    if (cartLink) {
      cartLink.href = storefrontPath('cart');
      cartLink.hidden = false;
    }
    window.parent.dispatchEvent(new CustomEvent('cart:updated', { detail: result }));
  } catch (error) {
    toast(error.message || 'Could not add your build. Please try again.');
  } finally {
    addingToCart = false;
    $('add-cart').textContent = 'Add build to cart';
    $('add-cart').removeAttribute('aria-busy');
    refresh();
  }
};

document.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => flyTo(b.dataset.view); });
$('spin').onclick = (e) => {
  controls.autoRotate = !controls.autoRotate;
  e.currentTarget.setAttribute('aria-pressed', controls.autoRotate);
};
controls.addEventListener('start', () => { tween = null; });

async function loadCatalog() {
  if (!catalogLoading) { catalogLoading = true; refresh(); }
  await Promise.all(data.parts.map(async (part) => {
    try {
      const response = await fetch(storefrontPath(`products/${part.id}.js`), { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Catalog unavailable');
      const product = await response.json();
      if (!Array.isArray(product.variants)) throw new Error('Invalid product options');
      catalog.set(part.id, { product });
    } catch (error) {
      catalog.set(part.id, { error: error.message });
    }
  }));
  catalogLoading = false;
  refresh();
}

try {
  await buildBike();
} catch {
  toast('Could not load this bike. Choose another model and try again.');
}
renderBikeUI();
refresh();
$('loading').classList.add('done');
await loadCatalog();

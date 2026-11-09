const shopifyCart = document.documentElement.dataset.cartMode === 'shopify';
const shopifyRoot = document.documentElement.dataset.cartRoot || window.Shopify?.routes?.root || '/';
const localCartKey = '79mods-cart';
const bagLink = document.querySelector('.bag-link');
const cartDialog = document.createElement('dialog');

function storefrontPath(path) {
  return `${shopifyRoot.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

cartDialog.className = 'cart-drawer';
cartDialog.setAttribute('aria-labelledby', 'cart-drawer-title');
cartDialog.innerHTML = `
  <button class="cart-drawer-scrim" type="button" data-close-cart aria-label="Close shopping bag"></button>
  <aside class="cart-drawer-panel">
    <div class="cart-drawer-heading">
      <div><p class="eyebrow">YOUR NEXT RIDE</p><h2 id="cart-drawer-title">Shopping bag <span data-cart-heading-count></span></h2></div>
      <button class="collection-drawer-close" type="button" data-close-cart aria-label="Close shopping bag"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg></button>
    </div>
    <p class="cart-drawer-status" role="status" aria-live="polite"></p>
    <div class="cart-drawer-items"></div>
    <div class="cart-drawer-footer" hidden>
      <div class="cart-protection-options" data-cart-protection-options hidden></div>
      <div class="cart-subtotal"><span>Subtotal</span><strong data-cart-subtotal></strong></div>
      <p class="cart-shipping-note">Shipping and taxes calculated at checkout.</p>
      <div class="cart-shipping-offer" data-shipping-offer hidden>
        <p data-shipping-offer-status role="status" aria-live="polite"></p>
        <p class="cart-shipping-offer-timer" data-shipping-offer-timer hidden>
          Checkout in <strong data-shipping-offer-countdown>10:00</strong> to keep standard shipping free.
        </p>
      </div>
      <form class="cart-checkout-form" action="${shopifyCart ? storefrontPath('cart') : '/cart'}" method="post">
        <button class="button button-dark cart-checkout" type="submit" name="checkout" formtarget="_top">Checkout <span aria-hidden="true">↗</span></button>
      </form>
      <a class="cart-view-link" href="${shopifyCart ? storefrontPath('cart') : '/cart'}">View cart</a>
    </div>
  </aside>`;
document.body.append(cartDialog);

const storePromotion = document.querySelector('#cart-store-promotion, #cart-halloween-promotion');
if (storePromotion) {
  cartDialog.querySelector('.cart-drawer-items').before(storePromotion.content.cloneNode(true));
}

const itemsContainer = cartDialog.querySelector('.cart-drawer-items');
const statusMessage = cartDialog.querySelector('.cart-drawer-status');
const cartFooter = cartDialog.querySelector('.cart-drawer-footer');
const checkoutButton = cartDialog.querySelector('.cart-checkout');
const protectionConfigElement = document.querySelector('#cart-protection-config');
const protectionConfig = protectionConfigElement ? JSON.parse(protectionConfigElement.textContent) : shopifyCart ? {} : {
  shipping: { id: 68189165551844, price: 599 },
  order: { id: 68189158342884, price: 999 }
};
const protectionProducts = [
  {
    key: 'shipping',
    id: protectionConfig.shipping?.id,
    price: protectionConfig.shipping?.price,
    expectedPrice: 599,
    title: 'Shipping protection',
    description: "Covers your package if it's lost, stolen, or damaged in transit. We'll reship or refund it."
  },
  {
    key: 'order',
    id: protectionConfig.order?.id,
    price: protectionConfig.order?.price,
    expectedPrice: 999,
    title: 'Order protection',
    description: "Protect your order against loss, theft, or damage. If something goes wrong, we'll replace or refund it."
  }
].filter((product) => product.id && Number(product.price) === product.expectedPrice);
const shippingOfferState = { cartToken: null, status: 'idle', code: null, expiresAt: 0, request: null };
let shippingOfferTimer = null;
let bypassShippingSubmit = false;
let appCartRoot = null;
let appCartWasOpen = false;
let lastShippingOfferView = null;
const shippingOfferMarkup = `
  <p data-shipping-offer-status role="status" aria-live="polite"></p>
  <p class="cart-shipping-offer-timer" data-shipping-offer-timer hidden>
    Checkout in <strong data-shipping-offer-countdown>10:00</strong> to keep standard shipping free.
  </p>`;
// The Section Store cart drawer renders inside its own shadow root, so theme.css does not reach it.
const appCartOfferStyles = `
  .cart-drawer .cart-footer { max-height: 45%; min-height: 0; overflow-y: auto; }
  .cart-drawer .cart-footer > * { flex-shrink: 0; }
  .cart-body > .cart-protection-options,
  .cart-body > .cart-shipping-offer,
  .cart-body > .thanksgiving-cart-promotion { flex-shrink: 0; }
  .cart-shipping-offer { margin: 0 0 12px; padding: 12px 14px; border: 1px solid rgba(104, 69, 220, .28); border-radius: 8px; color: #18171b; background: rgba(104, 69, 220, .08); font-size: 13px; line-height: 1.5; text-align: left; }
  .cart-shipping-offer[hidden], .cart-shipping-offer [hidden] { display: none; }
  .cart-shipping-offer p { margin: 0; }
  .cart-shipping-offer-timer { margin-top: 5px !important; }
  .cart-shipping-offer strong { font-variant-numeric: tabular-nums; }
  .cart-protection-options { margin: 0 0 16px; padding: 14px; border: 1px solid rgba(104, 69, 220, .3); border-radius: 8px; background: rgba(104, 69, 220, .06); color: #18171b; text-align: left; }
  .cart-protection-options[hidden] { display: none; }
  .cart-protection-options fieldset { display: grid; gap: 12px; margin: 0; padding: 0; border: 0; }
  .cart-protection-options legend { margin-bottom: 10px; font-size: 12px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
  .cart-protection-choice { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 9px; font-size: 12px; cursor: pointer; }
  .cart-protection-choice input { margin: 2px 0 0; accent-color: #7354e7; }
  .cart-protection-copy { display: grid; gap: 3px; line-height: 1.45; }
  .cart-protection-copy strong { font-size: 12px; }
  .cart-protection-description { color: #6d6874; font-size: 10px; }
  .cart-protection-price { font-size: 12px; white-space: nowrap; }
  .cart-protection-status:empty { display: none; }
  .cart-protection-status { margin: 10px 0 0; color: #a22b36; font-size: 11px; }`;
const appCartPromotionStyles = `
  .thanksgiving-cart-promotion { padding: 12px 0; border-top: 2px solid #6951df; }
  .thanksgiving-cart-promotion .checkout-sale-note { display: grid; gap: 5px; margin-bottom: 12px; font-size: 12px; line-height: 1.5; }
  .thanksgiving-cart-promotion .checkout-sale-note strong { color: #6951df; }
  .thanksgiving-cart-promotion .button-configurator { display: flex; justify-content: space-between; gap: 12px; padding: 12px 16px; border-radius: 999px; color: #fff; background: linear-gradient(112deg, #357cf0, #6751ed 52%, #a73bdc); font-size: 12px; font-weight: 700; text-decoration: none; }`;

function shippingOfferScopes() {
  return appCartRoot ? [document, appCartRoot] : [document];
}

function shippingOfferElements(selector) {
  return shippingOfferScopes().flatMap((scope) => [...scope.querySelectorAll(selector)]);
}

if (!shopifyCart) {
  checkoutButton.textContent = 'Checkout unavailable in preview';
  checkoutButton.disabled = true;
  checkoutButton.setAttribute('aria-disabled', 'true');
}

function formatMoney(cents, currency = 'USD') {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
}

function protectionProductForVariant(variantId) {
  return protectionProducts.find((product) => String(product.id) === String(variantId));
}

const protectionViews = new WeakMap();

function renderProtectionOptions(root, cart) {
  const container = root?.querySelector('[data-cart-protection-options]');
  if (!container) return;
  const viewKey = JSON.stringify([cart.currency, cart.items, protectionProducts]);
  if (protectionViews.get(container) === viewKey) return;
  protectionViews.set(container, viewKey);
  const hasMerchandise = (cart.items || []).some((item) => !protectionProductForVariant(item.variant_id));
  if (!hasMerchandise || !protectionProducts.length) {
    container.hidden = true;
    return;
  }

  const fieldset = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Optional protection for your entire order';
  fieldset.append(legend);

  for (const product of protectionProducts) {
    const item = cart.items.find((cartItem) => String(cartItem.variant_id) === String(product.id));
    const label = document.createElement('label');
    label.className = 'cart-protection-choice';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(item);
    checkbox.dataset.protectionVariant = String(product.id);
    checkbox.setAttribute('aria-label', `${product.title}, ${formatMoney(product.price, cart.currency || 'USD')}`);

    const copy = document.createElement('span');
    copy.className = 'cart-protection-copy';
    const title = document.createElement('strong');
    title.textContent = product.title;
    const description = document.createElement('span');
    description.className = 'cart-protection-description';
    description.textContent = product.description;
    copy.append(title, description);

    const price = document.createElement('strong');
    price.className = 'cart-protection-price';
    price.textContent = formatMoney(product.price, cart.currency || 'USD');
    label.append(checkbox, copy, price);
    fieldset.append(label);
  }

  const status = document.createElement('p');
  status.className = 'cart-protection-status';
  status.dataset.protectionStatus = '';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  container.replaceChildren(fieldset, status);
  container.hidden = false;
}

function getLocalCart() {
  try {
    const items = JSON.parse(localStorage.getItem(localCartKey) || '[]');
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function saveLocalCart(items) {
  localStorage.setItem(localCartKey, JSON.stringify(items));
}

async function getCart() {
  if (!shopifyCart) {
    const items = getLocalCart();
    return {
      items,
      item_count: items.reduce((total, item) => total + item.quantity, 0),
      total_price: items.reduce((total, item) => total + item.price * item.quantity, 0),
      currency: 'USD'
    };
  }

  const response = await fetch(storefrontPath('cart.js'), { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Could not load your shopping bag. Please try again.');
  return response.json();
}

function makeButton(label, className, text) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.textContent = text;
  return button;
}

function updateBagCount(count) {
  if (!bagLink) return;
  let badge = bagLink.querySelector('[data-cart-count]');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'bag-count';
    badge.dataset.cartCount = '';
    bagLink.append(badge);
  }
  badge.textContent = String(count);
  badge.hidden = count === 0;
  bagLink.setAttribute('aria-label', `Open shopping bag${count ? `, ${count} ${count === 1 ? 'item' : 'items'}` : ''}`);
}

function renderCart(cart) {
  itemsContainer.replaceChildren();
  const items = cart.items || [];
  window.currentCart = cart;
  window.currentCartItems = items;
  updateBagCount(cart.item_count || 0);
  cartDialog.querySelector('[data-cart-heading-count]').textContent = cart.item_count ? `(${cart.item_count})` : '';
  cartFooter.hidden = items.length === 0;
  cartDialog.querySelector('[data-cart-subtotal]').textContent = formatMoney(cart.total_price || 0, cart.currency || 'USD');
  renderProtectionOptions(cartDialog, cart);
  renderProtectionOptions(document, cart);
  renderProtectionOptions(appCartRoot, cart);
  if (!items.length) setShippingOfferView('Your free-shipping offer is available when your bag has items.', false);

  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'cart-empty';
    empty.textContent = 'Your bag is empty.';
    itemsContainer.append(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement('article');
    row.className = 'cart-item';
    row.dataset.lineId = item.key || item.id;

    if (item.image) {
      const image = document.createElement('img');
      image.className = 'cart-item-image';
      image.src = item.image;
      image.alt = item.title || '';
      image.loading = 'lazy';
      row.append(image);
    }

    const details = document.createElement('div');
    details.className = 'cart-item-details';
    const title = document.createElement('a');
    title.className = 'cart-item-title';
    title.href = item.url || '#';
    title.textContent = item.product_title || item.title;
    details.append(title);

    if (item.variant_title && item.variant_title !== 'Default Title') {
      const variant = document.createElement('span');
      variant.className = 'cart-item-variant';
      variant.textContent = item.variant_title;
      details.append(variant);
    }

    const controls = document.createElement('div');
    controls.className = 'cart-quantity';
    const protectionProduct = protectionProductForVariant(item.variant_id);
    if (protectionProduct) {
      const quantity = document.createElement('span');
      quantity.textContent = `Qty ${item.quantity}`;
      controls.append(quantity);
    } else {
      const decrease = makeButton('Decrease quantity', 'cart-quantity-button', '−');
      decrease.dataset.cartAction = 'decrease';
      const quantity = document.createElement('span');
      quantity.textContent = String(item.quantity);
      quantity.setAttribute('aria-label', `Quantity ${item.quantity}`);
      const increase = makeButton('Increase quantity', 'cart-quantity-button', '+');
      increase.dataset.cartAction = 'increase';
      controls.append(decrease, quantity, increase);
    }
    details.append(controls);

    const price = document.createElement('strong');
    price.className = 'cart-item-price';
    price.textContent = formatMoney(item.final_line_price ?? item.price * item.quantity, cart.currency || 'USD');
    const remove = makeButton('Remove item', 'cart-remove', 'Remove');
    remove.dataset.cartAction = 'remove';
    details.append(remove);
    row.append(details, price);
    itemsContainer.append(row);
  }
}

function setShippingOfferView(message, showTimer) {
  lastShippingOfferView = { message, showTimer };
  shippingOfferElements('[data-shipping-offer]').forEach((offer) => {
    offer.hidden = false;
    offer.querySelector('[data-shipping-offer-status]').textContent = message;
    offer.querySelector('[data-shipping-offer-timer]').hidden = !showTimer;
  });
}

function updateShippingOfferCountdown() {
  const remaining = Math.ceil(shippingOfferState.expiresAt - Date.now() / 1000);
  if (remaining <= 0) {
    shippingOfferState.status = 'expired';
    shippingOfferState.code = null;
    if (shippingOfferTimer) window.clearInterval(shippingOfferTimer);
    shippingOfferTimer = null;
    setShippingOfferView('Your free-shipping offer expired. You can still check out at standard rates.', false);
    return;
  }
  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
  const seconds = String(remaining % 60).padStart(2, '0');
  shippingOfferElements('[data-shipping-offer-countdown]').forEach((timer) => {
    timer.textContent = `${minutes}:${seconds}`;
  });
}

const SHIPPING_OFFER_COUNTRIES = { US: 'the U.S.', CA: 'Canada' };
let shippingOfferCountryRequest = null;

function detectShippingOfferCountry() {
  shippingOfferCountryRequest ||= fetch(storefrontPath('browsing_context_suggestions.json?country[enabled]=true'), {
    headers: { Accept: 'application/json' }
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((result) => result?.detected_values?.country?.handle)
    .catch(() => null)
    .then((country) => String(country || window.Shopify?.country || 'US').toUpperCase());
  return shippingOfferCountryRequest;
}

async function ensureShippingOffer(cart) {
  if (!shopifyCart || !cart?.item_count || !cart.token) return;
  if (shippingOfferState.cartToken === cart.token) {
    if (shippingOfferState.status === 'loading') return shippingOfferState.request;
    if (shippingOfferState.status === 'active') updateShippingOfferCountdown();
    if (shippingOfferState.status !== 'error') return;
  }

  if (shippingOfferTimer) window.clearInterval(shippingOfferTimer);
  Object.assign(shippingOfferState, {
    cartToken: cart.token,
    status: 'loading',
    code: null,
    expiresAt: 0,
    request: null
  });
  setShippingOfferView('Starting your 10-minute free standard shipping offer.', false);

  const endpoint = storefrontPath('apps/shipping-offer/offer');
  shippingOfferState.request = (async () => {
    try {
      const country = await detectShippingOfferCountry();
      if (!SHIPPING_OFFER_COUNTRIES[country]) {
        shippingOfferState.status = 'unavailable';
        setShippingOfferView('Free standard shipping is available for U.S. and Canada orders.', false);
        return;
      }
      const url = `${endpoint}?cart_token=${encodeURIComponent(cart.token)}&country=${country}`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      const result = await response.json();
      if (response.status === 410) {
        shippingOfferState.status = 'expired';
        setShippingOfferView('Your free-shipping offer expired. You can still check out at standard rates.', false);
        return;
      }
      if (response.status === 429) {
        shippingOfferState.status = 'error';
        setShippingOfferView(`${result.error || 'Free-shipping offers are temporarily limited.'} You can still check out normally.`, false);
        return;
      }
      if (!response.ok || !result.code || !Number.isFinite(Number(result.expiresAt))) {
        throw new Error(result.error || 'Could not start your free-shipping offer.');
      }
      shippingOfferState.status = 'active';
      shippingOfferState.code = result.code;
      shippingOfferState.expiresAt = Number(result.expiresAt);
      const destination = SHIPPING_OFFER_COUNTRIES[result.country] || SHIPPING_OFFER_COUNTRIES[country];
      setShippingOfferView(`Free standard shipping to ${destination} is unlocked. Checkout soon:`, true);
      updateShippingOfferCountdown();
      if (shippingOfferState.status === 'active') {
        shippingOfferTimer = window.setInterval(updateShippingOfferCountdown, 1000);
      }
    } catch (error) {
      shippingOfferState.status = 'error';
      setShippingOfferView('We couldn’t start the free-shipping offer. You can still check out normally.', false);
      console.error(error);
    }
  })();
  return shippingOfferState.request;
}

async function refreshCart() {
  try {
    const cart = await getCart();
    renderCart(cart);
    if (shopifyCart && /\/cart\/?$/.test(location.pathname)) await ensureShippingOffer(cart);
    statusMessage.textContent = '';
  } catch (error) {
    statusMessage.textContent = error.message;
    if (shopifyCart && /\/cart\/?$/.test(location.pathname)) {
      setShippingOfferView('We couldn’t load the timed shipping offer. You can still check out normally.', false);
    }
  }
}

async function openCart() {
  await refreshCart();
  if (!cartDialog.open) cartDialog.showModal();
  await ensureShippingOffer(window.currentCart);
}

async function updateQuantity(item, quantity) {
  statusMessage.textContent = '';
  try {
    if (shopifyCart) {
      const response = await fetch(storefrontPath('cart/change.js'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: item.key || item.id, quantity })
      });
      if (!response.ok) throw new Error('Could not update this item. Please try again.');
      renderCart(await response.json());
    } else {
      const items = getLocalCart();
      const match = items.find((entry) => entry.id === item.id);
      if (match) {
        if (quantity < 1) items.splice(items.indexOf(match), 1);
        else match.quantity = quantity;
      }
      saveLocalCart(items);
      renderCart(await getCart());
    }
  } catch (error) {
    statusMessage.textContent = error.message;
  }
}

async function updateProtectionOption(event) {
  const checkbox = event.target.closest?.('[data-protection-variant]');
  if (!checkbox) return;
  event.preventDefault();
  const selected = checkbox.checked;
  const product = protectionProductForVariant(checkbox.dataset.protectionVariant);
  if (!product) {
    checkbox.checked = !checkbox.checked;
    const status = checkbox.closest('[data-cart-protection-options]')?.querySelector('[data-protection-status]');
    if (status) status.textContent = 'Protection options are available at checkout on the Shopify storefront.';
    else statusMessage.textContent = 'Protection options are available at checkout on the Shopify storefront.';
    return;
  }

  const root = checkbox.getRootNode();
  root.querySelectorAll?.(`[data-protection-variant="${checkbox.dataset.protectionVariant}"]`).forEach((input) => {
    input.disabled = true;
  });
  try {
    if (!shopifyCart) {
      const items = getLocalCart().filter((item) => String(item.variant_id) !== String(product.id));
      if (selected) {
        items.push({
          id: String(product.id),
          variant_id: product.id,
          title: product.title,
          product_title: product.title,
          price: product.price,
          quantity: 1,
          url: `/products/${product.key}-protection`
        });
      }
      saveLocalCart(items);
      renderCart(await getCart());
      return;
    }
    const cart = await getCart();
    const item = cart.items.find((cartItem) => String(cartItem.variant_id) === String(product.id));
    let response;
    if (selected && !item) {
      response = await fetch(storefrontPath('cart/add.js'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: product.id, quantity: 1 })
      });
    } else if (item && (!selected || item.quantity !== 1)) {
      response = await fetch(storefrontPath('cart/change.js'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: item.key, quantity: selected ? 1 : 0 })
      });
    }

    if (response) {
      const updatedCart = await response.json();
      if (!response.ok) throw new Error(updatedCart.description || 'Could not update order protection. Please try again.');
      window.currentCart = await getCart();
    } else {
      window.currentCart = cart;
    }

    root.querySelectorAll?.(`[data-protection-variant="${checkbox.dataset.protectionVariant}"]`).forEach((input) => {
      input.disabled = false;
    });
    if (/\/cart\/?$/.test(location.pathname)) {
      location.reload();
      return;
    }
    renderCart(window.currentCart);
  } catch (error) {
    console.error(error);
    try {
      const cart = await getCart();
      protectionViews.delete(root.querySelector('[data-cart-protection-options]'));
      root.querySelectorAll?.(`[data-protection-variant="${checkbox.dataset.protectionVariant}"]`).forEach((input) => {
        input.disabled = false;
      });
      renderProtectionOptions(root, cart);
      const status = root.querySelector('[data-protection-status]');
      if (status) status.textContent = error.message;
      else statusMessage.textContent = error.message;
    } catch (refreshError) {
      root.querySelectorAll?.(`[data-protection-variant="${checkbox.dataset.protectionVariant}"]`).forEach((input) => {
        input.checked = !selected;
        input.disabled = false;
      });
      const status = root.querySelector('[data-protection-status]');
      if (status) status.textContent = `Could not confirm the protection update: ${refreshError.message}`;
      else statusMessage.textContent = `Could not confirm the protection update: ${refreshError.message}`;
      console.error(refreshError);
    }
  }
}

cartDialog.addEventListener('click', (event) => {
  const closeButton = event.target.closest('[data-close-cart]');
  if (closeButton) {
    cartDialog.close();
    return;
  }

  const actionButton = event.target.closest('[data-cart-action]');
  if (!actionButton) return;
  const row = actionButton.closest('.cart-item');
  const item = (shopifyCart ? window.currentCartItems : getLocalCart())?.find((entry) => String(entry.key || entry.id) === row?.dataset.lineId);
  if (!item) return;
  const action = actionButton.dataset.cartAction;
  updateQuantity(item, action === 'remove' ? 0 : item.quantity + (action === 'increase' ? 1 : -1));
});

document.addEventListener('change', updateProtectionOption);

cartDialog.addEventListener('close', () => {
  if (location.pathname === '/cart') history.replaceState(null, '', '/');
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('.cart-checkout-form, .cart-page-form');
  if (!shopifyCart || !form || event.submitter?.name !== 'checkout') return;
  const submitter = event.submitter;
  if (bypassShippingSubmit) {
    bypassShippingSubmit = false;
    return;
  }

  if (shippingOfferState.status === 'idle' && window.currentCart?.item_count) {
    event.preventDefault();
    await ensureShippingOffer(window.currentCart);
    if (shippingOfferState.status !== 'active') {
      bypassShippingSubmit = true;
      form.requestSubmit(submitter);
      return;
    }
  }

  if (shippingOfferState.status === 'loading') {
    event.preventDefault();
    await shippingOfferState.request;
    if (shippingOfferState.status !== 'active') {
      bypassShippingSubmit = true;
      form.requestSubmit(submitter);
      return;
    }
  }
  if (shippingOfferState.status !== 'active' || !shippingOfferState.code) return;
  event.preventDefault();
  event.preventDefault();
  if (form.matches('.cart-page-form')) {
    const updates = new FormData(form).getAll('updates[]').map((quantity) => Number(quantity));
    if (updates.length) {
      try {
        const response = await fetch(storefrontPath('cart/update.js'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ updates })
        });
        if (!response.ok) throw new Error('Could not update cart before checkout.');
      } catch {
        setShippingOfferView('We couldn’t apply the timed offer, so checkout will continue without it.', false);
        bypassShippingSubmit = true;
        form.requestSubmit(submitter);
        return;
      }
    }
  }
  const discountPath = `discount/${encodeURIComponent(shippingOfferState.code)}?redirect=${encodeURIComponent('/checkout')}`;
  window.location.assign(storefrontPath(discountPath));
});

function syncAppCartShippingOffer() {
  if (!appCartRoot) return;
  const drawer = appCartRoot.querySelector('.cart-drawer');
  const body = appCartRoot.querySelector('.cart-body');
  if (body && storePromotion && !appCartRoot.querySelector('[data-thanksgiving-promotion]')) {
    const promotion = document.createElement('div');
    promotion.className = 'thanksgiving-cart-promotion';
    promotion.dataset.thanksgivingPromotion = '';
    promotion.append(storePromotion.content.cloneNode(true));
    body.append(promotion);
  }
  if (body && !appCartRoot.querySelector('[data-shipping-offer]')) {
    const offer = document.createElement('div');
    offer.className = 'cart-shipping-offer';
    offer.dataset.shippingOffer = '';
    offer.hidden = true;
    offer.innerHTML = shippingOfferMarkup;
    body.append(offer);
    if (lastShippingOfferView) {
      setShippingOfferView(lastShippingOfferView.message, lastShippingOfferView.showTimer);
      if (shippingOfferState.status === 'active') updateShippingOfferCountdown();
    }
  }
  if (body && !appCartRoot.querySelector('[data-cart-protection-options]') && protectionProducts.length) {
    const options = document.createElement('div');
    options.className = 'cart-protection-options';
    options.dataset.cartProtectionOptions = '';
    options.hidden = true;
    body.append(options);
  }
  if (window.currentCart) renderProtectionOptions(appCartRoot, window.currentCart);

  const isOpen = drawer?.getAttribute('aria-hidden') === 'false';
  if (isOpen && !appCartWasOpen) {
    getCart().then((cart) => {
      window.currentCart = cart;
      renderProtectionOptions(appCartRoot, cart);
      return ensureShippingOffer(cart);
    }).catch((error) => console.error(error));
  }
  appCartWasOpen = isOpen;
}

async function connectAppCartDrawer() {
  if (!shopifyCart || !window.customElements) return;
  await customElements.whenDefined('section-store--cart-block');
  const host = document.querySelector('section-store--cart-block');
  if (!host?.shadowRoot || appCartRoot) return;
  appCartRoot = host.shadowRoot;

  const style = document.createElement('style');
  style.dataset.shippingOfferStyles = '';
  style.textContent = appCartOfferStyles + appCartPromotionStyles;
  appCartRoot.append(style);

  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      syncAppCartShippingOffer();
    });
  }).observe(appCartRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-hidden'] });

  // Capture on the shadow root so this runs before the drawer app's own checkout handler.
  appCartRoot.addEventListener('click', async (event) => {
    const link = event.target.closest?.('.cart-checkout-link');
    if (!link || !['idle', 'loading', 'active'].includes(shippingOfferState.status)) return;
    event.preventDefault();
    event.stopPropagation();
    if (shippingOfferState.status === 'idle') {
      try {
        await ensureShippingOffer(await getCart());
      } catch (error) {
        console.error(error);
      }
    } else if (shippingOfferState.status === 'loading') {
      await shippingOfferState.request;
    }
    if (shippingOfferState.status === 'active' && shippingOfferState.code) {
      const discountPath = `discount/${encodeURIComponent(shippingOfferState.code)}?redirect=${encodeURIComponent('/checkout')}`;
      window.location.assign(storefrontPath(discountPath));
      return;
    }
    window.location.assign(link.href);
  }, true);

  appCartRoot.addEventListener('change', updateProtectionOption);
  syncAppCartShippingOffer();
}

const cartMutationPattern = /\/cart\/(add|change|update|clear)(\.js|\.json)?(\?|$)/;
let shippingOfferRefreshTimer = null;

function scheduleShippingOfferRefresh() {
  window.clearTimeout(shippingOfferRefreshTimer);
  shippingOfferRefreshTimer = window.setTimeout(async () => {
    try {
      const cart = await getCart();
      window.currentCart = cart;
      renderProtectionOptions(cartDialog, cart);
      renderProtectionOptions(document, cart);
      renderProtectionOptions(appCartRoot, cart);
      if (!cart.item_count) {
        setShippingOfferView('Your free-shipping offer is available when your bag has items.', false);
        return;
      }
      await ensureShippingOffer(cart);
    } catch (error) {
      console.error(error);
    }
  }, 150);
}

// Apps such as the Section Store drawer add items with their own requests, so watch every cart change.
function watchCartMutations() {
  if (!shopifyCart) return;
  const isCartMutation = (method, url) => String(method || 'GET').toUpperCase() === 'POST' && cartMutationPattern.test(String(url || ''));

  if (window.fetch) {
    const nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      const request = nativeFetch.apply(this, arguments);
      const url = typeof input === 'string' ? input : input?.url;
      if (isCartMutation(init?.method || input?.method, url)) {
        request.then((response) => { if (response.ok) scheduleShippingOfferRefresh(); }, () => {});
      }
      return request;
    };
  }

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (isCartMutation(method, url)) {
      this.addEventListener('load', () => { if (this.status >= 200 && this.status < 300) scheduleShippingOfferRefresh(); });
    }
    return nativeOpen.apply(this, arguments);
  };
}

watchCartMutations();
connectAppCartDrawer();

if (bagLink) {
  bagLink.addEventListener('click', (event) => {
    event.preventDefault();
    openCart();
  });
}

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-cart-form]');
  if (!form) return;
  event.preventDefault();
  const submitButton = form.querySelector('[type="submit"]');
  const originalLabel = submitButton?.textContent;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Adding...';
  }

  try {
    if (shopifyCart) {
      const response = await fetch(storefrontPath('cart/add.js'), {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new FormData(form)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.description || 'Could not add this item. Please try again.');
    } else {
      const data = new FormData(form);
      const product = {
        id: String(form.dataset.productId),
        title: form.dataset.productTitle,
        product_title: form.dataset.productTitle,
        price: Number(form.dataset.productPrice),
        image: form.dataset.productImage,
        url: form.dataset.productUrl,
        quantity: Math.max(1, Number(data.get('quantity')) || 1)
      };
      const items = getLocalCart();
      const existing = items.find((item) => item.id === product.id);
      if (existing) existing.quantity += product.quantity;
      else items.push(product);
      saveLocalCart(items);
    }
    await openCart();
  } catch (error) {
    statusMessage.textContent = error.message;
    if (!cartDialog.open) cartDialog.showModal();
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
  }
});

if (shopifyCart) {
  window.currentCartItems = [];
  window.addEventListener('cart:updated', () => refreshCart());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshCart();
  });
}

refreshCart();
if (location.pathname === '/cart' && !shopifyCart) openCart();

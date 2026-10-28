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

const halloweenPromotion = document.querySelector('#cart-halloween-promotion');
if (halloweenPromotion) {
  cartDialog.querySelector('.cart-drawer-items').before(halloweenPromotion.content.cloneNode(true));
}

const itemsContainer = cartDialog.querySelector('.cart-drawer-items');
const statusMessage = cartDialog.querySelector('.cart-drawer-status');
const cartFooter = cartDialog.querySelector('.cart-drawer-footer');
const checkoutButton = cartDialog.querySelector('.cart-checkout');
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
  .cart-shipping-offer { margin: 0 0 12px; padding: 12px 14px; border: 1px solid rgba(104, 69, 220, .28); border-radius: 8px; color: #18171b; background: rgba(104, 69, 220, .08); font-size: 13px; line-height: 1.5; text-align: left; }
  .cart-shipping-offer[hidden], .cart-shipping-offer [hidden] { display: none; }
  .cart-shipping-offer p { margin: 0; }
  .cart-shipping-offer-timer { margin-top: 5px !important; }
  .cart-shipping-offer strong { font-variant-numeric: tabular-nums; }`;

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
    const decrease = makeButton('Decrease quantity', 'cart-quantity-button', '−');
    decrease.dataset.cartAction = 'decrease';
    const quantity = document.createElement('span');
    quantity.textContent = String(item.quantity);
    quantity.setAttribute('aria-label', `Quantity ${item.quantity}`);
    const increase = makeButton('Increase quantity', 'cart-quantity-button', '+');
    increase.dataset.cartAction = 'increase';
    controls.append(decrease, quantity, increase);
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
  const footer = appCartRoot.querySelector('.cart-footer');
  const checkoutLink = footer?.querySelector('.cart-checkout-button');
  if (footer && checkoutLink && !footer.querySelector('[data-shipping-offer]')) {
    const offer = document.createElement('div');
    offer.className = 'cart-shipping-offer';
    offer.dataset.shippingOffer = '';
    offer.hidden = true;
    offer.innerHTML = shippingOfferMarkup;
    checkoutLink.before(offer);
    if (lastShippingOfferView) {
      setShippingOfferView(lastShippingOfferView.message, lastShippingOfferView.showTimer);
      if (shippingOfferState.status === 'active') updateShippingOfferCountdown();
    }
  }

  const isOpen = drawer?.getAttribute('aria-hidden') === 'false';
  if (isOpen && !appCartWasOpen) {
    getCart().then(ensureShippingOffer).catch((error) => console.error(error));
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
  style.textContent = appCartOfferStyles;
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

  syncAppCartShippingOffer();
}

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
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshCart();
  });
}

refreshCart();
if (location.pathname === '/cart' && !shopifyCart) openCart();

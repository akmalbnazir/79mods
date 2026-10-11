const shopifyCart = document.documentElement.dataset.cartMode === 'shopify';
const localCartKey = '79mods-cart';
const bagLink = document.querySelector('.bag-link');
const cartDialog = document.createElement('dialog');

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
      <a class="button button-dark cart-checkout" href="/checkout">Checkout <span aria-hidden="true">↗</span></a>
      <a class="cart-view-link" href="/cart">View cart</a>
    </div>
  </aside>`;
document.body.append(cartDialog);

const itemsContainer = cartDialog.querySelector('.cart-drawer-items');
const statusMessage = cartDialog.querySelector('.cart-drawer-status');
const cartFooter = cartDialog.querySelector('.cart-drawer-footer');
const checkoutLink = cartDialog.querySelector('.cart-checkout');

if (!shopifyCart) {
  checkoutLink.textContent = 'Checkout unavailable in preview';
  checkoutLink.removeAttribute('href');
  checkoutLink.setAttribute('aria-disabled', 'true');
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

  const response = await fetch('/cart.js', { headers: { Accept: 'application/json' } });
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
  window.currentCartItems = items;
  updateBagCount(cart.item_count || 0);
  cartDialog.querySelector('[data-cart-heading-count]').textContent = cart.item_count ? `(${cart.item_count})` : '';
  cartFooter.hidden = items.length === 0;
  cartDialog.querySelector('[data-cart-subtotal]').textContent = formatMoney(cart.total_price || 0, cart.currency || 'USD');

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

async function refreshCart() {
  try {
    renderCart(await getCart());
    statusMessage.textContent = '';
  } catch (error) {
    statusMessage.textContent = error.message;
  }
}

async function openCart() {
  await refreshCart();
  if (!cartDialog.open) cartDialog.showModal();
}

async function updateQuantity(item, quantity) {
  statusMessage.textContent = '';
  try {
    if (shopifyCart) {
      const response = await fetch('/cart/change.js', {
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
      const response = await fetch('/cart/add.js', {
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

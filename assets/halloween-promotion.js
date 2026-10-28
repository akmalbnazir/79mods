(() => {
  function expirePromotions() {
    let nextExpiry = Infinity;
    document.querySelectorAll('[data-sale-promotion]').forEach((promotion) => {
      const remaining = Number(promotion.dataset.saleEnds) * 1000 - Date.now();
      if (remaining <= 0) {
        promotion.remove();
      } else {
        nextExpiry = Math.min(nextExpiry, remaining);
      }
    });
    if (Number.isFinite(nextExpiry)) {
      window.setTimeout(expirePromotions, Math.min(nextExpiry, 2147483647));
    }
  }

  expirePromotions();
})();

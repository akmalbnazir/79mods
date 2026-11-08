(() => {
  const key = '79mods-whats-new-black-friday-v1';
  const remember = () => {
    try {
      sessionStorage.setItem(key, '1');
    } catch (error) {
      console.warn('Could not save the What\'s New popup preference.', error);
    }
  };
  const initialize = () => {
    document.querySelectorAll('[data-whats-new]').forEach((popup) => {
      if (popup.dataset.initialized || typeof popup.showModal !== 'function') return;
      popup.dataset.initialized = 'true';
      if (!window.Shopify?.designMode) {
        try {
          if (sessionStorage.getItem(key)) return;
        } catch (error) {
          console.warn('Could not read the What\'s New popup preference.', error);
        }
      }
      const previousFocus = document.activeElement;
      popup.querySelectorAll('[data-whats-new-close]').forEach((button) => {
        button.addEventListener('click', () => popup.close());
      });
      popup.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          popup.close();
        }
      });
      popup.querySelectorAll('a').forEach((link) => link.addEventListener('click', remember));
      popup.addEventListener('close', () => {
        remember();
        document.documentElement.classList.remove('whats-new-open');
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      });
      popup.showModal();
      document.documentElement.classList.add('whats-new-open');
    });
  };
  initialize();
  document.addEventListener('shopify:section:load', initialize);
  document.addEventListener('shopify:section:unload', (event) => {
    if (event.target.querySelector('[data-whats-new][open]')) {
      document.documentElement.classList.remove('whats-new-open');
    }
  });
})();

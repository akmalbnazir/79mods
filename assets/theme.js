document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.querySelector('#category-search');
  const categoryCards = [...document.querySelectorAll('.category-card')];
  const emptyMessage = document.querySelector('#search-empty');
  const searchToggle = document.querySelector('.search-toggle');
  const menuToggle = document.querySelector('.menu-toggle');
  const primaryNav = document.querySelector('#primary-nav');
  const revealItems = document.querySelectorAll('.reveal');

  if (searchInput && categoryCards.length) {
    const filterCategories = (query) => {
      const normalizedQuery = query.trim().toLowerCase();
      let visibleCount = 0;

      for (const card of categoryCards) {
        const matches = !normalizedQuery || `${card.dataset.search || ''} ${card.textContent}`.toLowerCase().includes(normalizedQuery);
        card.hidden = !matches;
        if (matches) visibleCount += 1;
      }

      if (emptyMessage) {
        emptyMessage.hidden = visibleCount > 0;
      }
    };

    searchInput.addEventListener('input', (event) => {
      filterCategories(event.currentTarget.value);
    });

    if (searchToggle) {
      searchToggle.addEventListener('click', () => {
        searchInput.focus();
        const shopSection = document.querySelector('#shop');
        if (shopSection) shopSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    document.addEventListener('keydown', (event) => {
      if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '')) {
        event.preventDefault();
        searchInput.focus();
        const shopSection = document.querySelector('#shop');
        if (shopSection) shopSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      if (event.key === 'Escape') {
        searchInput.value = '';
        filterCategories('');
        searchInput.blur();
      }
    });
  }

  if (menuToggle && primaryNav) {
    menuToggle.addEventListener('click', () => {
      const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
      menuToggle.setAttribute('aria-expanded', String(!isOpen));
      menuToggle.setAttribute('aria-label', isOpen ? 'Open menu' : 'Close menu');
      primaryNav.classList.toggle('is-open', !isOpen);
    });

    primaryNav.addEventListener('click', (event) => {
      if (event.target.closest('a')) {
        menuToggle.setAttribute('aria-expanded', 'false');
        menuToggle.setAttribute('aria-label', 'Open menu');
        primaryNav.classList.remove('is-open');
      }
    });
  }

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14 });

    revealItems.forEach((element) => observer.observe(element));
  } else {
    revealItems.forEach((element) => element.classList.add('is-visible'));
  }

  for (const image of document.querySelectorAll('img')) {
    image.addEventListener('error', () => {
      image.closest('.category-card')?.classList.add('image-unavailable');
    }, { once: true });
  }
});

const collectionsToggle = document.querySelector('.collections-toggle');
const collectionDrawer = document.querySelector('#collection-drawer');

if (collectionsToggle && collectionDrawer) {
  collectionsToggle.addEventListener('click', () => {
    if (!collectionDrawer.open) collectionDrawer.showModal();
    collectionsToggle.setAttribute('aria-expanded', String(collectionDrawer.open));
  });

  collectionDrawer.addEventListener('close', () => {
    collectionsToggle.setAttribute('aria-expanded', 'false');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && collectionDrawer.open) {
      event.preventDefault();
      collectionDrawer.close();
    }
  });

  collectionDrawer.querySelectorAll('[data-close-collection-drawer]').forEach((button) => {
    button.addEventListener('click', () => collectionDrawer.close());
  });

  collectionDrawer.querySelector('.collection-drawer-nav')?.addEventListener('click', (event) => {
    if (event.target.closest('a')) collectionDrawer.close();
  });
}
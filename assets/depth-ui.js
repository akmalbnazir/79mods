document.addEventListener('DOMContentLoaded', () => {
  if (!document.documentElement.hasAttribute('data-depth-ui')) return;

  const header = document.querySelector('.site-header');
  if (header) {
    let frame = 0;
    const update = () => {
      header.classList.toggle('is-depth-scrolled', window.scrollY > 24);
      frame = 0;
    };
    update();
    window.addEventListener('scroll', () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    }, { passive: true });
  }
});

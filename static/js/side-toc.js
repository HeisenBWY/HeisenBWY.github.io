(() => {
  const toc = document.querySelector('.side-toc');
  if (!toc) return;
  const toggle = toc.querySelector('summary');
  const pinLabel = toc.querySelector('.side-toc-pin');
  const pin = pinLabel.querySelector('input');
  const storageKey = 'blog-toc-pinned';
  try { pin.checked = localStorage.getItem(storageKey) === 'true'; } catch {}
  pinLabel.hidden = false;
  if (pin.checked) toc.open = true;
  const unpin = () => {
    pin.checked = false;
    try { localStorage.setItem(storageKey, 'false'); } catch {}
  };
  pin.addEventListener('change', () => {
    try { localStorage.setItem(storageKey, String(pin.checked)); } catch {}
    if (pin.checked) toc.open = true;
  });
  toggle.addEventListener('click', () => {
    if (toc.open && pin.checked) unpin();
  });
  let keyboard = false;
  document.addEventListener('keydown', () => { keyboard = true; });
  document.addEventListener('pointerdown', () => { keyboard = false; });
  toc.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'mouse') toc.open = true;
  });
  toc.addEventListener('pointerleave', (event) => {
    if (!pin.checked && event.pointerType === 'mouse' && !(keyboard && toc.contains(document.activeElement))) {
      toc.open = false;
    }
  });
  toc.addEventListener('focusout', () => {
    requestAnimationFrame(() => {
      if (!pin.checked && !toc.contains(document.activeElement) && !toc.matches(':hover')) toc.open = false;
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toc.open) {
      unpin();
      if (toc.contains(document.activeElement)) toggle.focus();
      toc.open = false;
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!pin.checked && !toc.contains(event.target)) toc.open = false;
  });
  toc.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const heading = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
      heading.addEventListener('blur', () => heading.removeAttribute('tabindex'), { once: true });
    }
    if (!pin.checked) toc.open = false;
  });
})();

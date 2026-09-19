(() => {
  const toc = document.querySelector('.side-toc');
  if (!toc) return;
  const toggle = toc.querySelector('summary');
  const pin = toc.querySelector('.side-toc-pin');
  const panel = toc.querySelector('.side-toc-panel');
  const links = [...toc.querySelectorAll('a[href^="#"]')];
  const storageKey = 'blog-toc-pinned';
  let pinned = false;
  try { pinned = localStorage.getItem(storageKey) === 'true'; } catch {}
  pin.hidden = false;
  const setPinned = (value) => {
    pinned = value;
    toc.classList.toggle('is-pinned', pinned);
    pin.setAttribute('aria-pressed', String(pinned));
    pin.setAttribute('aria-label', pinned ? '取消固定目录' : '固定目录');
    pin.title = pinned ? '取消固定目录' : '固定目录';
    if (pinned) toc.open = true;
    try { localStorage.setItem(storageKey, String(pinned)); } catch {}
  };
  setPinned(pinned);

  const sections = links.map((link) => {
    let id = '';
    try { id = decodeURIComponent(link.hash.slice(1)); } catch { id = link.hash.slice(1); }
    return { link, heading: document.getElementById(id) };
  }).filter(({ heading }) => heading);

  const setActive = (activeLink) => {
    links.forEach((link) => {
      const active = link === activeLink;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
    if (!activeLink || !toc.open) return;
    const linkBox = activeLink.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    if (linkBox.top < panelBox.top || linkBox.bottom > panelBox.bottom) {
      activeLink.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  if (sections.length) {
    setActive(sections[0].link);
    if ('IntersectionObserver' in window) {
      const visible = new Map();
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) visible.set(entry.target.id, entry.boundingClientRect.top);
          else visible.delete(entry.target.id);
        });
        if (!visible.size) return;
        const id = [...visible].sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]))[0][0];
        const current = sections.find(({ heading }) => heading.id === id);
        if (current) setActive(current.link);
      }, { rootMargin: '-10% 0px -72% 0px', threshold: 0 });
      sections.forEach(({ heading }) => observer.observe(heading));
    }
  }

  pin.addEventListener('click', () => setPinned(!pinned));
  toggle.addEventListener('click', () => {
    if (toc.open && pinned) setPinned(false);
  });
  let keyboard = false;
  document.addEventListener('keydown', () => { keyboard = true; });
  document.addEventListener('pointerdown', () => { keyboard = false; });
  toc.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'mouse') toc.open = true;
  });
  toc.addEventListener('pointerleave', (event) => {
    if (!pinned && event.pointerType === 'mouse' && !(keyboard && toc.contains(document.activeElement))) {
      toc.open = false;
    }
  });
  toc.addEventListener('focusout', () => {
    requestAnimationFrame(() => {
      if (!pinned && !toc.contains(document.activeElement) && !toc.matches(':hover')) toc.open = false;
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toc.open) {
      setPinned(false);
      if (toc.contains(document.activeElement)) toggle.focus();
      toc.open = false;
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!pinned && !toc.contains(event.target)) toc.open = false;
  });
  toc.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    setActive(link);
    const heading = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
      heading.addEventListener('blur', () => heading.removeAttribute('tabindex'), { once: true });
    }
    if (!pinned) toc.open = false;
  });
})();

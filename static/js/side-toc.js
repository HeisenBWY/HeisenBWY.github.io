(() => {
  const toc = document.querySelector('.side-toc');
  if (!toc) return;
  const toggle = toc.querySelector('summary');
  const pin = toc.querySelector('.side-toc-pin');
  const panel = toc.querySelector('.side-toc-panel');
  const links = [...toc.querySelectorAll('a[href^="#"]')];
  const progressBar = document.querySelector('.reading-progress span');
  const progressLabel = toc.querySelector('.side-toc-progress');
  const articleMain = document.querySelector('.article-main');
  const storageKey = 'blog-toc-pinned';
  let pinned = false;
  try { pinned = localStorage.getItem(storageKey) === 'true'; } catch {}
  if (window.matchMedia('(max-width: 1179px)').matches && !pinned) toc.open = false;
  if (window.matchMedia('(min-width: 1180px)').matches) toc.open = true;
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

  let progressFrame = 0;
  const updateProgress = () => {
    progressFrame = 0;
    if (!articleMain) return;
    const articleTop = articleMain.getBoundingClientRect().top + window.scrollY;
    const distance = Math.max(1, articleMain.offsetHeight - window.innerHeight);
    const value = Math.min(100, Math.max(0, ((window.scrollY - articleTop) / distance) * 100));
    if (progressBar) progressBar.style.width = `${value}%`;
    if (progressLabel) progressLabel.textContent = `${Math.round(value)}%`;
  };
  const requestProgressUpdate = () => {
    if (!progressFrame) progressFrame = requestAnimationFrame(updateProgress);
  };
  window.addEventListener('scroll', requestProgressUpdate, { passive: true });
  window.addEventListener('resize', requestProgressUpdate);
  updateProgress();

  document.querySelectorAll('.prose .highlight').forEach((block) => {
    if (block.querySelector('.code-toolbar')) return;
    const code = block.querySelector('code');
    const pre = block.querySelector('pre');
    if (!code || !pre) return;
    const language = code.dataset.lang || [...code.classList].find((name) => name.startsWith('language-'))?.slice(9) || 'code';
    const toolbar = document.createElement('div');
    toolbar.className = 'code-toolbar';
    const label = document.createElement('span');
    label.textContent = language;
    const copy = document.createElement('button');
    copy.className = 'code-copy';
    copy.type = 'button';
    copy.textContent = '复制';
    copy.setAttribute('aria-label', `复制 ${language} 代码`);
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.innerText);
        copy.textContent = '已复制';
      } catch {
        const field = document.createElement('textarea');
        field.value = code.innerText;
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.append(field);
        field.select();
        document.execCommand('copy');
        field.remove();
        copy.textContent = '已复制';
      }
      setTimeout(() => { copy.textContent = '复制'; }, 1600);
    });
    toolbar.append(label, copy);
    block.insertBefore(toolbar, pre);
  });

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

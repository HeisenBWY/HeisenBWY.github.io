(() => {
  const root = document.documentElement;
  const picker = document.querySelector('.appearance-picker');
  const status = document.querySelector('.appearance-status');
  const themeButtons = [...document.querySelectorAll('[data-theme-choice]')];
  const immersiveButton = document.querySelector('.immersive-toggle');
  const themeNames = { light: '日间模式', reading: '护眼模式', dark: '夜间模式' };
  const storageKey = 'blog-display-theme';

  const setStatus = (message) => {
    if (!status) return;
    status.textContent = message;
    window.setTimeout(() => {
      if (status.textContent === message) status.textContent = '';
    }, 1800);
  };

  const applyTheme = (theme, announce = false) => {
    const nextTheme = themeNames[theme] ? theme : 'light';
    root.dataset.theme = nextTheme;
    root.style.colorScheme = nextTheme === 'dark' ? 'dark' : 'light';
    themeButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === nextTheme));
    });
    try { localStorage.setItem(storageKey, nextTheme); } catch {}
    if (announce) setStatus(`已切换到${themeNames[nextTheme]}`);
  };

  applyTheme(root.dataset.theme || 'light');

  themeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      applyTheme(button.dataset.themeChoice, true);
      if (picker) picker.open = false;
    });
  });

  const setImmersive = (enabled) => {
    if (!immersiveButton) return;
    document.body.classList.toggle('is-reading-mode', enabled);
    immersiveButton.setAttribute('aria-pressed', String(enabled));
    immersiveButton.querySelector('b').textContent = enabled ? '退出' : '阅读';
    immersiveButton.title = enabled ? '退出沉浸阅读（Esc）' : '进入沉浸阅读';
    setStatus(enabled ? '已进入沉浸阅读' : '已退出沉浸阅读');
  };

  immersiveButton?.addEventListener('click', () => {
    setImmersive(!document.body.classList.contains('is-reading-mode'));
  });

  document.addEventListener('pointerdown', (event) => {
    if (picker?.open && !picker.contains(event.target)) picker.open = false;
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (picker?.open) {
      picker.open = false;
      picker.querySelector('summary')?.focus();
    }
    if (document.body.classList.contains('is-reading-mode')) setImmersive(false);
  });
})();

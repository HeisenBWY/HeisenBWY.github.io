(() => {
  'use strict';

  const input = document.getElementById('search-input');
  const list = document.getElementById('search-results-list');
  const status = document.querySelector('.search-status');
  if (!input || !list || !status) return;

  let entries = null;
  let debounce = null;

  const escapeHTML = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const loadIndex = async () => {
    if (entries) return entries;
    try {
      const res = await fetch('index.json');
      if (!res.ok) throw new Error(res.status);
      entries = (await res.json()).map((entry) => ({
        ...entry,
        _title: String(entry.title || '').toLowerCase(),
        _summary: String(entry.summary || '').toLowerCase(),
        _series: entry.series ? String(entry.series).toLowerCase() : '',
      }));
    } catch {
      entries = [];
      status.textContent = '搜索索引加载失败，请尝试刷新页面。';
    }
    return entries;
  };

  const scoreEntry = (entry, term) => {
    const t = entry._title;
    const tags = entry.tags.map((x) => x.toLowerCase());
    let score = 0;
    if (t.includes(term)) score += 5;
    if (entry._series && entry._series.includes(term)) score += 2;
    if (tags.some((tag) => tag.includes(term))) score += 3;
    if (entry._summary.includes(term)) score += 1;
    return score;
  };

  const search = (query) => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return entries
      .map((entry) => {
        const total = terms.reduce((sum, term) => sum + scoreEntry(entry, term), 0);
        return { entry, score: total };
      })
      .filter((r) => terms.every((term) => scoreEntry(r.entry, term) > 0))
      .sort((a, b) => b.score - a.score || b.entry.date.localeCompare(a.entry.date))
      .map((r) => r.entry);
  };

  const highlight = (title, terms) => {
    const pattern = terms.map(escapeRegExp).join('|');
    const text = escapeHTML(title);
    return text.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>');
  };

  const render = (results, terms) => {
    list.innerHTML = '';
    if (!results.length) {
      status.textContent = '没有匹配的文章，换个关键词试试。';
      return;
    }
    status.textContent = `找到 ${results.length} 篇相关文章：`;
    for (const entry of results) {
      const item = document.createElement('li');
      const tags = (entry.tags || [])
        .map((tag) => `<a href="#" class="archive-tag" data-tag="${escapeHTML(tag)}"># ${escapeHTML(tag)}</a>`)
        .join('');
      item.innerHTML =
        `<a class="archive-item" href="${entry.url}">` +
        `<time>${escapeHTML(entry.date)}</time>` +
        `<span class="archive-item-main"><strong>${highlight(entry.title, terms)}</strong>` +
        `<em>${escapeHTML(entry.summary)}</em></span>` +
        `<span class="archive-item-meta">${escapeHTML(entry.series || '')} · ${entry.minutes} 分钟</span>` +
        `</a>${tags ? `<div class="archive-tags">${tags}</div>` : ''}`;
      list.appendChild(item);
    }
    list.querySelectorAll('.archive-tag').forEach((tag) =>
      tag.addEventListener('click', (e) => {
        e.preventDefault();
        input.value = tag.dataset.tag;
        input.dispatchEvent(new Event('input'));
      })
    );
  };

  input.addEventListener('input', () => {
    if (!entries) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const query = input.value.trim();
      if (!query) {
        list.innerHTML = '';
        status.textContent = '输入关键词开始搜索。';
        return;
      }
      render(search(query), query.toLowerCase().split(/\s+/).filter(Boolean));
    }, 120);
  });

  loadIndex().then(() => {
    if (entries.length) input.focus();
  });
})();

// A short, text-only outline of the page's controls, given to the on-device model as context
// when it drafts JavaScript. Nothing here leaves the computer.
(() => {
  const seen = new Set();
  const items = [];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== 'hidden';
  };
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="menuitem"], video, h1, h2')) {
    if (items.length >= 120 || !visible(el)) continue;
    const label = window.__hearsayLabel(el).slice(0, 60);
    const selector = window.__hearsaySelector(el);
    const key = selector + label;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(`${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ''} "${label}" -> ${selector}`);
  }
  return { title: document.title, url: location.href, outline: items.join('\n') };
})();

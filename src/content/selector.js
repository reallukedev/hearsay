// Builds a CSS selector that finds one element again later, preferring stable attributes
// over long class chains. Shared by the element picker and the page snapshot.
(() => {
  if (window.__hearsaySelector) return;
  const esc = (s) => CSS.escape(s);
  const looksGenerated = (s) => /\d{3,}|[a-f0-9]{8,}|^[a-z]{1,3}-[a-z0-9]{5,}$|__|--[a-z0-9]{5,}/i.test(s);
  const unique = (sel) => { try { return document.querySelectorAll(sel).length === 1; } catch { return false; } };

  function own(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id && !looksGenerated(el.id) && unique(`#${esc(el.id)}`)) return { sel: `#${esc(el.id)}`, done: true };
    for (const attr of ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa', 'aria-label', 'name', 'title', 'placeholder', 'role', 'type']) {
      const v = el.getAttribute(attr);
      if (v && v.length < 60 && !looksGenerated(v)) {
        const sel = `${tag}[${attr}="${v.replace(/"/g, '\\"')}"]`;
        if (unique(sel)) return { sel, done: true };
      }
    }
    const classes = [...el.classList].filter((c) => !looksGenerated(c)).slice(0, 2);
    let sel = tag + classes.map((c) => `.${esc(c)}`).join('');
    const parent = el.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === el.tagName);
      if (same.length > 1) sel += `:nth-of-type(${same.indexOf(el) + 1})`;
    }
    return { sel, done: false };
  }

  window.__hearsaySelector = function selectorFor(el) {
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 6; depth++) {
      const { sel, done } = own(node);
      parts.unshift(sel);
      const full = parts.join(' > ');
      if (done || unique(full)) return full;
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  window.__hearsayLabel = (el) => [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('placeholder'), el.value, el.textContent]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 80);
})();

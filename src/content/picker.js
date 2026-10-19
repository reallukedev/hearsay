// Point-and-click element picker. Hover to see what you'd pick, click to choose, Esc to cancel.
(() => {
  if (window.__hearsayPicker) { window.__hearsayPicker.stop(); }
  const INTERACTIVE = 'button, a, input, select, textarea, summary, label, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], [onclick], [tabindex]';

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      .box{position:fixed;border-radius:8px;box-shadow:0 0 0 3px #173f35,0 0 0 6px #c9f16a;background:rgba(201,241,106,.18);transition:all .08s ease-out;pointer-events:none}
      .tag{position:fixed;max-width:320px;padding:6px 10px;border-radius:9px;background:#173f35;color:#f3f0e6;font:600 13px/1.3 system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
      .bar{position:fixed;left:50%;top:14px;transform:translateX(-50%);display:flex;gap:12px;align-items:center;padding:12px 16px;border-radius:16px;background:#173f35;color:#f3f0e6;font:600 15px/1.3 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.25);pointer-events:none}
      .bar b{color:#c9f16a}
      kbd{font:700 12px system-ui;padding:3px 7px;border-radius:6px;background:rgba(243,240,230,.14)}
      @media (prefers-reduced-motion: reduce){.box{transition:none}}
    </style>
    <div class="box" hidden></div><div class="tag" hidden></div>
    <div class="bar"><span><b>Hearsay:</b> click the thing this command should press, or move with <kbd>Tab</kbd> and choose with <kbd>Enter</kbd></span><kbd>Esc</kbd></div>`;
  const box = shadow.querySelector('.box');
  const tag = shadow.querySelector('.tag');
  document.documentElement.appendChild(host);

  let current = null;
  const target = (el) => (el && el.closest ? el.closest(INTERACTIVE) ?? el : el);

  function onMove(e) {
    const el = target(document.elementFromPoint(e.clientX, e.clientY));
    if (!el || el === current || host.contains(el)) return;
    highlight(el);
  }

  function highlight(el) {
    current = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` });
    box.hidden = false;
    tag.textContent = window.__hearsayLabel(el) || el.tagName.toLowerCase();
    tag.style.left = `${Math.min(Math.max(8, r.left), innerWidth - 330)}px`;
    tag.style.top = `${r.bottom + 10 > innerHeight - 40 ? r.top - 38 : r.bottom + 10}px`;
    tag.hidden = false;
  }

  function swallow(e) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }

  function onClick(e) {
    swallow(e);
    pick(target(document.elementFromPoint(e.clientX, e.clientY)));
  }

  function pick(el) {
    if (!el) return;
    const result = { type: 'hearsay:picked', selector: window.__hearsaySelector(el), text: window.__hearsayLabel(el), tag: el.tagName.toLowerCase(), url: location.href };
    stop();
    chrome.runtime.sendMessage(result).catch(() => {});
  }

  // Keyboard picking: Tab and Shift+Tab walk the page's controls, Enter picks.
  const controls = () => [...document.querySelectorAll(INTERACTIVE)].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(el).visibility !== 'hidden';
  });

  function onKey(e) {
    if (e.key === 'Tab') {
      swallow(e);
      const list = controls();
      if (!list.length) return;
      const i = list.indexOf(current);
      highlight(list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length]);
      return;
    }
    if (e.key === 'Enter' && current) { swallow(e); pick(current); return; }
    if (e.key !== 'Escape') return;
    swallow(e);
    stop();
    chrome.runtime.sendMessage({ type: 'hearsay:picked', cancelled: true }).catch(() => {});
  }

  function stop() {
    removeEventListener('mousemove', onMove, true);
    removeEventListener('click', onClick, true);
    removeEventListener('mousedown', swallow, true);
    removeEventListener('pointerdown', swallow, true);
    removeEventListener('mouseup', swallow, true);
    removeEventListener('keydown', onKey, true);
    host.remove();
    window.__hearsayPicker = null;
  }

  addEventListener('mousemove', onMove, true);
  addEventListener('click', onClick, true);
  addEventListener('mousedown', swallow, true);
  addEventListener('pointerdown', swallow, true);
  addEventListener('mouseup', swallow, true);
  addEventListener('keydown', onKey, true);
  window.__hearsayPicker = { stop };
})();

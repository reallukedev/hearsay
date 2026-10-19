// Runs command steps in a tab. Functions passed to executeScript must be self-contained.
import { fillTemplate } from '../shared/phrases.js';

export function userScriptsAvailable() {
  try {
    chrome.userScripts.getScripts();
    return true;
  } catch {
    return false;
  }
}

function injectedClick(selector, text) {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  let el = null;
  if (selector) {
    try { el = [...document.querySelectorAll(selector)].find(visible) ?? document.querySelector(selector); } catch { el = null; }
  }
  if (!el && text) {
    const want = text.toLowerCase().trim();
    const all = [...document.querySelectorAll('button, a, [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="submit"], input[type="button"], summary, label')].filter(visible);
    const label = (e) => [e.getAttribute('aria-label'), e.getAttribute('title'), e.value, e.textContent].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
    el = all.find((e) => label(e) === want) ?? all.find((e) => label(e).includes(want));
  }
  if (!el) return { ok: false };
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  el.focus?.({ preventScroll: true });
  el.click();
  return { ok: true, label: (el.getAttribute('aria-label') || el.textContent || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 60) };
}

function injectedKeys(combo) {
  const parts = String(combo).split('+').map((s) => s.trim()).filter(Boolean);
  const mods = { shift: false, ctrl: false, alt: false, meta: false };
  let k = parts.pop() ?? '';
  for (const p of parts) {
    const m = p.toLowerCase();
    if (m === 'shift') mods.shift = true;
    else if (m === 'ctrl' || m === 'control') mods.ctrl = true;
    else if (m === 'alt' || m === 'option') mods.alt = true;
    else if (m === 'cmd' || m === 'meta' || m === 'command') mods.meta = true;
  }
  const named = { space: ' ', esc: 'Escape', escape: 'Escape', enter: 'Enter', return: 'Enter', tab: 'Tab', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', backspace: 'Backspace', delete: 'Delete', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown' };
  k = named[k.toLowerCase()] ?? (k.length === 1 ? (mods.shift ? k.toUpperCase() : k.toLowerCase()) : k);
  const code = k.length === 1 ? (/[a-z]/i.test(k) ? `Key${k.toUpperCase()}` : /\d/.test(k) ? `Digit${k}` : k === ' ' ? 'Space' : k) : k;
  const keyCode = k.length === 1 ? k.toUpperCase().charCodeAt(0) : { Enter: 13, Escape: 27, Tab: 9, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Backspace: 8, Delete: 46, ' ': 32 }[k] ?? 0;
  const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
  const opts = { key: k, code, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true, shiftKey: mods.shift, ctrlKey: mods.ctrl, altKey: mods.alt, metaKey: mods.meta };
  target.dispatchEvent(new KeyboardEvent('keydown', opts));
  if (k.length === 1) target.dispatchEvent(new KeyboardEvent('keypress', opts));
  target.dispatchEvent(new KeyboardEvent('keyup', opts));
  return { ok: true };
}

function injectedType(text, selector, submit) {
  const editable = (el) => el && (el.isContentEditable || /^(input|textarea)$/i.test(el.tagName));
  let el = null;
  if (selector) { try { el = document.querySelector(selector); } catch { el = null; } }
  if (!el && editable(document.activeElement)) el = document.activeElement;
  if (!el) el = [...document.querySelectorAll('input[type="search"], input[type="text"], input:not([type]), textarea, [contenteditable="true"]')].find((e) => e.getBoundingClientRect().width > 1);
  if (!el) return { ok: false };
  el.focus();
  if (el.isContentEditable) {
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, text);
  } else {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (submit) {
    const enter = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    const notCancelled = el.dispatchEvent(new KeyboardEvent('keydown', enter));
    el.dispatchEvent(new KeyboardEvent('keyup', enter));
    if (notCancelled && el.form) el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit();
  }
  return { ok: true };
}

function injectedScroll(direction) {
  const scroller = (() => {
    // Many apps scroll an inner element, not the page.
    const candidates = [document.scrollingElement, ...document.querySelectorAll('main, [role="main"], [class*="scroll"], [class*="content"]')];
    return candidates.find((el) => el && el.scrollHeight > el.clientHeight + 40 && getComputedStyle(el).overflowY !== 'hidden') ?? document.scrollingElement;
  })();
  const page = scroller === document.scrollingElement ? innerHeight : scroller.clientHeight;
  const opts = { behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' };
  if (direction === 'down') scroller.scrollBy({ top: page * 0.8, ...opts });
  else if (direction === 'up') scroller.scrollBy({ top: -page * 0.8, ...opts });
  else if (direction === 'top') scroller.scrollTo({ top: 0, ...opts });
  else if (direction === 'bottom') scroller.scrollTo({ top: scroller.scrollHeight, ...opts });
  return { ok: true };
}

// "click Play" with several matches: number them on the page and let the user say which.
function injectedNumberMatches(text) {
  document.querySelectorAll('[data-hearsay-badge]').forEach((b) => b.remove());
  document.querySelectorAll('[data-hearsay-n]').forEach((e) => e.removeAttribute('data-hearsay-n'));
  const want = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim();
  if (!want) return { count: 0 };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const label = (e) => [e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('placeholder'), e.value, e.textContent].filter(Boolean).join(' ').replace(/\s+/g, ' ').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim();
  const all = [...document.querySelectorAll('button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], input, select, textarea, summary, [onclick], [tabindex="0"]')].filter(visible);
  const exact = all.filter((e) => label(e) === want);
  const starts = all.filter((e) => label(e).startsWith(want));
  const contains = all.filter((e) => label(e).includes(want));
  let list = exact.length ? exact : starts.length ? starts : contains;
  list = list.filter((e) => !list.some((o) => o !== e && o.contains(e))).slice(0, 9);
  list.forEach((e, i) => e.setAttribute('data-hearsay-n', String(i + 1)));
  if (list.length > 1) {
    for (const [i, e] of list.entries()) {
      const r = e.getBoundingClientRect();
      const b = document.createElement('div');
      b.setAttribute('data-hearsay-badge', '');
      b.textContent = String(i + 1);
      b.style.cssText = `position:fixed;z-index:2147483646;left:${Math.max(4, r.left - 10)}px;top:${Math.max(4, r.top - 10)}px;min-width:26px;height:26px;padding:0 7px;display:grid;place-items:center;border-radius:9px;background:#2c1a08;color:#ffc27a;font:800 15px/1 system-ui,sans-serif;box-shadow:0 2px 8px rgba(44,26,8,.35);pointer-events:none`;
      document.documentElement.appendChild(b);
    }
  }
  return { count: list.length, labels: list.map((e) => label(e).slice(0, 40)) };
}

function injectedClickNumbered(n) {
  const el = document.querySelector(`[data-hearsay-n="${n}"]`);
  document.querySelectorAll('[data-hearsay-badge]').forEach((b) => b.remove());
  document.querySelectorAll('[data-hearsay-n]').forEach((e) => e.removeAttribute('data-hearsay-n'));
  if (!el) return { ok: false };
  el.focus?.({ preventScroll: true });
  el.click();
  return { ok: true };
}

function injectedClearNumbers() {
  document.querySelectorAll('[data-hearsay-badge]').forEach((b) => b.remove());
  document.querySelectorAll('[data-hearsay-n]').forEach((e) => e.removeAttribute('data-hearsay-n'));
}

async function inject(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res?.result;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runStep(tabId, step, slots = {}) {
  switch (step.type) {
    case 'click': return inject(tabId, injectedClick, [step.selector ?? '', fillTemplate(step.text ?? '', slots)]);
    case 'keys': return inject(tabId, injectedKeys, [step.keys ?? '']);
    case 'type': return inject(tabId, injectedType, [fillTemplate(step.text ?? '', slots), step.selector ?? '', !!step.submit]);
    case 'scroll': return inject(tabId, injectedScroll, [step.direction ?? 'down']);
    case 'wait': await wait(Math.min(10000, Number(step.ms) || 500)); return { ok: true };
    case 'url': {
      const url = fillTemplate(step.url ?? '', slots, { encode: true });
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Only http and https addresses can be opened.' };
      if (step.newTab) await chrome.tabs.create({ url });
      else await chrome.tabs.update(tabId, { url });
      return { ok: true };
    }
    case 'js': {
      if (!userScriptsAvailable()) return { ok: false, error: 'userScripts' };
      const code = `(async () => {\nconst slots = ${JSON.stringify(slots)};\n${step.code ?? ''}\n})();`;
      await chrome.userScripts.execute({ target: { tabId }, js: [{ code }], world: step.world === 'MAIN' ? 'MAIN' : 'USER_SCRIPT', injectImmediately: true });
      return { ok: true };
    }
    default: return { ok: false, error: `Unknown step “${step.type}”` };
  }
}

export async function runSteps(tabId, steps, slots) {
  for (const [i, step] of (steps ?? []).entries()) {
    let res;
    try {
      res = await runStep(tabId, step, slots);
    } catch (err) {
      return { ok: false, step: i, error: String(err?.message ?? err) };
    }
    if (res && res.ok === false) return { ok: false, step: i, error: res.error ?? null };
    if (i < steps.length - 1 && step.type !== 'wait') await wait(120);
  }
  return { ok: true };
}

export async function runEveryday(tabId, id, slots) {
  switch (id) {
    case 'scrollDown': return inject(tabId, injectedScroll, ['down']);
    case 'scrollUp': return inject(tabId, injectedScroll, ['up']);
    case 'top': return inject(tabId, injectedScroll, ['top']);
    case 'bottom': return inject(tabId, injectedScroll, ['bottom']);
    case 'historyBack': await chrome.tabs.goBack(tabId); return { ok: true };
    case 'historyForward': await chrome.tabs.goForward(tabId); return { ok: true };
    case 'reload': await chrome.tabs.reload(tabId); return { ok: true };
    case 'key': return inject(tabId, injectedKeys, [slots.key]);
    case 'click': return inject(tabId, injectedNumberMatches, [slots.text ?? '']);
    case 'clickNumbered': return inject(tabId, injectedClickNumbered, [slots.n]);
    case 'clearNumbers': return inject(tabId, injectedClearNumbers);
    case 'nextTab':
    case 'prevTab': {
      const tab = await chrome.tabs.get(tabId);
      const tabs = await chrome.tabs.query({ windowId: tab.windowId });
      const i = tabs.findIndex((t) => t.id === tabId);
      const next = tabs[(i + (id === 'nextTab' ? 1 : -1) + tabs.length) % tabs.length];
      await chrome.tabs.update(next.id, { active: true });
      return { ok: true };
    }
    default: return { ok: false };
  }
}

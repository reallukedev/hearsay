// Runs in lichess's own page world from document_start. Lichess's board ignores synthetic
// mouse events, so this lets through only the ones Hearsay marks (detail === HEARSAY_MARK),
// and it reports the analysis board's position, which the page can't show in the DOM.
(() => {
  if (window.__hearsayBridge) return;
  window.__hearsayBridge = true;
  const HEARSAY_MARK = 7351;
  const WRAPPED = new Set(['mousedown', 'touchstart', 'click']);
  const wrappers = new WeakMap();

  const trusted = (e) => new Proxy(e, {
    get(target, prop) {
      if (prop === 'isTrusted') return true;
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });

  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (!WRAPPED.has(type) || typeof fn !== 'function') return add.call(this, type, fn, opts);
    let w = wrappers.get(fn);
    if (!w) {
      w = function (e) { return fn.call(this, !e.isTrusted && e.detail === HEARSAY_MARK ? trusted(e) : e); };
      wrappers.set(fn, w);
    }
    return add.call(this, type, w, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    return remove.call(this, type, (typeof fn === 'function' && wrappers.get(fn)) || fn, opts);
  };

  window.addEventListener('hearsay:ask', (e) => {
    let id = null;
    try { id = JSON.parse(e.detail).id; } catch { return; }
    const boards = [];
    const a = window.site?.analysis;
    const el = a?.chessground?.state?.dom?.elements?.board;
    if (a?.node?.fen && el) {
      const index = [...document.querySelectorAll('cg-board')].indexOf(el);
      if (index >= 0) boards.push({ index, fen: a.node.fen, mode: 'analysis', playingAs: null, over: false });
    }
    window.dispatchEvent(new CustomEvent('hearsay:state', { detail: JSON.stringify({ id, boards }) }));
  });
})();

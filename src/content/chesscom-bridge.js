// Runs in chess.com's own page world, read-only: it reports what the board's game object knows
// (position, whose side you are, last move) to the extension's content script.
(() => {
  if (window.__hearsayBridge) return;
  window.__hearsayBridge = true;

  const colorOf = (v) => (v === 1 || v === 'white' || v === 'w' ? 'w' : v === 2 || v === 'black' || v === 'b' ? 'b' : null);

  function describe(board, index) {
    const game = board.game;
    if (!game || typeof game.getFEN !== 'function') return { index, fen: null };
    const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
    const mode = safe(() => game.getMode()?.name ?? null);
    const usePlayingAs = safe(() => game.getMode()?.usePlayingAs, false);
    const last = safe(() => game.getLastMove());
    return {
      index,
      fen: safe(() => game.getFEN()),
      mode,
      playingAs: usePlayingAs === false ? null : colorOf(safe(() => game.getPlayingAs())),
      over: !!safe(() => game.isGameOver(), false),
      lastMove: last ? { from: last.from, to: last.to, san: last.san, color: colorOf(last.color) } : null,
    };
  }

  window.addEventListener('hearsay:ask', (e) => {
    let id = null;
    try { id = JSON.parse(e.detail).id; } catch { return; }
    const boards = [...document.querySelectorAll('wc-chess-board, chess-board')].map(describe);
    window.dispatchEvent(new CustomEvent('hearsay:state', { detail: JSON.stringify({ id, boards }) }));
  });
})();

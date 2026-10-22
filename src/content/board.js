// chess.com and lichess: reads the board, plays spoken moves by clicking squares, draws the on-board overlay.
import { parseFen, legalMoves, withTurn, pieceAt, PIECE_NAMES } from '../shared/chess.js';
import { parseMove, describeMove } from '../shared/move-parse.js';
import { CHESS_COMMANDS, matchAlternatives } from '../shared/commands.js';

const FILES = 'abcdefgh';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arrow = (m) => (/[kq]/.test(m.flags ?? '') && m.piece === 'k' ? `Castled ${m.flags.includes('k') ? 'short' : 'long'}` : `${m.from} → ${m.to}${m.promotion ? ` ${PIECE_NAMES[m.promotion]}` : ''}`);
const colorName = (c) => (c === 'w' ? 'White' : 'Black');

const LICHESS = /(^|\.)lichess\.org$/.test(location.hostname);
const HEARSAY_MARK = 7351; // lichess-bridge.js lets marked synthetic events through

let pending = null; // { kind: 'moves', moves } | { kind: 'resign' }
let ourLastMove = null;
let lastSeenMove = null;

// ---------- Reading the board ----------

function askBridge() {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const onState = (e) => {
      let data;
      try { data = JSON.parse(e.detail); } catch { return; }
      if (data.id !== id) return;
      window.removeEventListener('hearsay:state', onState);
      clearTimeout(timer);
      resolve(data.boards);
    };
    const timer = setTimeout(() => { window.removeEventListener('hearsay:state', onState); resolve(null); }, 250);
    window.addEventListener('hearsay:state', onState);
    window.dispatchEvent(new CustomEvent('hearsay:ask', { detail: JSON.stringify({ id }) }));
  });
}

function boardElements() {
  return [...document.querySelectorAll(LICHESS ? 'cg-board' : 'wc-chess-board, chess-board')];
}

const isFlipped = (el) => (LICHESS ? !!el.closest('.cg-wrap')?.classList.contains('orientation-black') : el.classList.contains('flipped'));

// Lichess draws pieces as <piece class="white pawn" style="transform: translate(x, y)">.
function lichessPieces(el, flipped) {
  const size = el.getBoundingClientRect().width / 8;
  const out = [];
  if (!size) return out;
  for (const p of el.querySelectorAll('piece')) {
    if (p.classList.contains('ghost') || p.classList.contains('fading')) continue;
    const color = p.classList.contains('white') ? 'w' : p.classList.contains('black') ? 'b' : null;
    const role = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'].find((r) => p.classList.contains(r));
    const t = p.style.transform.match(/translate\(([\d.]+)px,\s*([\d.]+)px\)/);
    if (!color || !role || !t) continue;
    const col = Math.round(Number(t[1]) / size), row = Math.round(Number(t[2]) / size);
    out.push({ color, piece: role === 'knight' ? 'n' : role[0], file: flipped ? 7 - col : col, rank: flipped ? row : 7 - row });
  }
  return out;
}

// What the page shows about a lichess game: your side, whose turn, the last move, whether it ended.
function lichessInfo(el, flipped) {
  const main = document.querySelector('main');
  const inGame = !!main?.classList.contains('round');
  const inPuzzle = !!main?.classList.contains('puzzle');
  const bottom = flipped ? 'b' : 'w';
  const playable = !!el.closest('.cg-wrap')?.classList.contains('manipulable');
  const you = (inGame || inPuzzle) && playable ? bottom : null;
  const other = bottom === 'w' ? 'b' : 'w';
  let turn = null;
  if (document.querySelector('.rclock-bottom.running')) turn = bottom;
  else if (document.querySelector('.rclock-top.running')) turn = other;
  else if (inGame) turn = document.querySelectorAll('rm6 l4x kwdb').length % 2 ? 'b' : 'w';
  else if (inPuzzle) turn = you;
  const size = el.getBoundingClientRect().width / 8;
  const squares = [...el.querySelectorAll('square.last-move')].map((q) => {
    const t = q.style.transform.match(/translate\(([\d.]+)px,\s*([\d.]+)px\)/);
    if (!t || !size) return null;
    const col = Math.round(Number(t[1]) / size), row = Math.round(Number(t[2]) / size);
    return FILES[flipped ? 7 - col : col] + String(flipped ? row + 1 : 8 - row);
  }).filter(Boolean);
  return { you, turn, lastSquares: squares, over: inGame && !!document.querySelector('.result-wrap'), mode: inGame ? 'game' : inPuzzle ? 'puzzle' : 'analysis' };
}

function visibleArea(el) {
  const r = el.getBoundingClientRect();
  const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
  const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
  return w * h;
}

// FEN from the piece elements, for boards whose game object we can't read.
function fenFromDom(el, turn, flipped) {
  const rows = Array.from({ length: 8 }, () => Array(8).fill(null));
  if (LICHESS) for (const p of lichessPieces(el, flipped)) rows[7 - p.rank][p.file] = p.color === 'w' ? p.piece.toUpperCase() : p.piece;
  else for (const p of el.querySelectorAll('.piece')) {
    const cls = p.className;
    const kind = cls.match(/\b([wb])([pnbrqk])\b/);
    const sq = cls.match(/\bsquare-(\d)(\d)\b/);
    if (!kind || !sq) continue;
    const ch = kind[1] === 'w' ? kind[2].toUpperCase() : kind[2];
    rows[8 - Number(sq[2])][Number(sq[1]) - 1] = ch;
  }
  const placement = rows.map((row) => {
    let s = '', e = 0;
    for (const c of row) { if (!c) { e++; continue; } if (e) { s += e; e = 0; } s += c; }
    return s + (e || '');
  }).join('/');
  const at = (r, f) => rows[r][f];
  let castling = '';
  if (at(7, 4) === 'K') { if (at(7, 7) === 'R') castling += 'K'; if (at(7, 0) === 'R') castling += 'Q'; }
  if (at(0, 4) === 'k') { if (at(0, 7) === 'r') castling += 'k'; if (at(0, 0) === 'r') castling += 'q'; }
  return `${placement} ${turn} ${castling || '-'} - 0 1`;
}

async function readBoard() {
  const els = boardElements();
  if (!els.length) return null;
  const states = (await askBridge()) ?? [];
  let best = null;
  els.forEach((el, index) => {
    const area = visibleArea(el);
    if (area > 0 && (!best || area > best.area)) best = { el, index, area };
  });
  if (!best) return null;
  const info = states.find((s) => s.index === best.index) ?? {};
  const flipped = isFlipped(best.el);
  const page = LICHESS && !info.fen ? lichessInfo(best.el, flipped) : null;
  if (page) Object.assign(info, { playingAs: page.you, mode: page.mode, over: page.over });
  const bottom = flipped ? 'b' : 'w';
  let fen = info.fen;
  let pos;
  try { pos = fen ? parseFen(fen) : null; } catch { pos = null; }
  // No game object: guess whose turn it is from the board orientation.
  if (!pos) pos = parseFen(fenFromDom(best.el, page?.turn ?? info.playingAs ?? bottom, flipped));
  if (page?.lastSquares.length === 2) {
    // The square that now holds a piece is where the last move went.
    const [a, b] = page.lastSquares;
    const to = pieceAt(pos, a) ? a : b, from = to === a ? b : a;
    const p = pieceAt(pos, to);
    if (p) info.lastMove = { from, to, san: '', color: p.color };
  }
  const you = info.playingAs ?? null;
  // Opponent to move in a game: your clicks become premoves, so offer your own moves.
  const moveFor = you && you !== pos.turn ? you : pos.turn;
  const legal = legalMoves(moveFor === pos.turn ? pos : withTurn(pos, moveFor));
  return { el: best.el, pos, legal, flipped, you, moveFor, premove: moveFor !== pos.turn, mode: info.mode, over: info.over, lastMove: info.lastMove, hasGame: !!info.fen };
}

// ---------- Playing moves ----------

function squarePoint(board, square) {
  const r = board.el.getBoundingClientRect();
  const size = r.width / 8;
  const f = FILES.indexOf(square[0]);
  const rank = Number(square[1]) - 1;
  const col = board.flipped ? 7 - f : f;
  const row = board.flipped ? rank : 7 - rank;
  return { x: r.left + (col + 0.5) * size, y: r.top + (row + 0.5) * size };
}

function press(target, { x, y }) {
  if (LICHESS) {
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, detail: HEARSAY_MARK, view: window };
    target.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
    document.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    return;
  }
  const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, view: window };
  target.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1 }));
  target.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }));
}

async function choosePromotion(color, piece) {
  for (let i = 0; i < 10; i++) {
    const role = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[piece];
    const option = LICHESS
      ? document.querySelector(`#promotion-choice piece.${role}.${color === 'w' ? 'white' : 'black'}`)?.closest('square')
      : document.querySelector(`.promotion-window .promotion-piece.${color}${piece}, .promotion-piece.${color}${piece}`);
    if (option) {
      const r = option.getBoundingClientRect();
      press(option, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      if (LICHESS) option.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: HEARSAY_MARK }));
      else option.click?.();
      return true;
    }
    await sleep(40);
  }
  return false; // auto-queen is on, or the site already chose
}

async function play(board, move) {
  ourLastMove = move.from + move.to;
  press(board.el, squarePoint(board, move.from));
  await sleep(40);
  press(board.el, squarePoint(board, move.to));
  if (move.promotion) await choosePromotion(move.color, move.promotion);
  if (board.premove) return { ok: true, premove: true };
  for (let i = 0; i < 12; i++) {
    await sleep(50);
    const after = await readBoard();
    const p = after && pieceAt(after.pos, move.to);
    if (p && p.color === move.color && !pieceAt(after.pos, move.from)) return { ok: true };
    if (after?.lastMove && after.lastMove.from === move.from && after.lastMove.to === move.to) return { ok: true };
  }
  return { ok: false };
}

// ---------- Buttons and keys for non-move commands ----------

function visible(el) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  // Board controls fade in on hover, so a transparent button still counts.
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}

function findButton(patterns) {
  const all = [...document.querySelectorAll('button, [role="button"], a.cc-button-component, a[class*="button"]')];
  const label = (el) => [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('data-cy'), el.textContent].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const shown = all.filter(visible);
  for (const re of patterns) {
    const hit = shown.find((el) => re.test(label(el)));
    if (hit) return hit;
  }
  // Some controls (like Flip Board) sit collapsed in the layout but still work when clicked.
  for (const re of patterns) {
    const hit = all.find((el) => re.test(el.getAttribute('aria-label') ?? ''));
    if (hit) return hit;
  }
  return null;
}

function key(k) {
  const opts = { key: k, code: k, bubbles: true, cancelable: true, composed: true };
  const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', opts));
  target.dispatchEvent(new KeyboardEvent('keyup', opts));
}

const BUTTONS = {
  flip: [/flip board/i, /flip the board/i, /flip/i, /rotate board/i],
  undo: [/propose a takeback/i, /take ?back/i, /^undo\b/i],
  resign: [/\bresign\b/i, /\babort\b/i],
  draw: [/accept draw/i, /offer draw/i, /\bdraw\b/i],
  rematch: [/rematch/i],
  newgame: [/new \d+ min/i, /new opponent/i, /new game/i, /play again/i],
  next: [/next puzzle/i, /continue training/i, /next lesson/i, /^next$/i, /continue/i, /next challenge/i],
  retry: [/retry/i, /try again/i, /restart/i],
  hint: [/\bhint\b/i],
  solution: [/solution/i, /view the solution/i, /show answer/i],
};

async function runCommand(cmd) {
  if (cmd.id === 'back') { key('ArrowLeft'); return done('Stepped back', 'Say “forward” to step ahead again.'); }
  if (cmd.id === 'forward') { key('ArrowRight'); return done('Stepped forward', ''); }
  if (cmd.id === 'resign') {
    pending = { kind: 'resign' };
    return { status: 'choose', title: 'Resign this game?', detail: 'Say “yes” to resign, or “cancel”.', options: [{ n: 1, label: 'Yes, resign' }], confirm: true };
  }
  const btn = findButton(BUTTONS[cmd.id] ?? []);
  if (btn) { btn.click(); return done(cmd.label, ''); }
  if (cmd.id === 'undo') { key('ArrowLeft'); return done('Stepped back', 'There was no take-back button, so I moved back one move.'); }
  return fail(`No “${cmd.hint}” button here`, 'This page doesn’t show that button right now.');
}

async function confirmResign() {
  const btn = findButton(BUTTONS.resign);
  if (!btn) return fail('No resign button here', 'There is no game to resign on this page.');
  btn.click();
  for (let i = 0; i < 15; i++) {
    await sleep(80);
    const yes = (LICHESS && document.querySelector('.act-confirm button.yes, .fbt.yes')) || findButton([/^yes$/i, /^resign$/i, /yes, resign/i, /confirm/i]);
    if (yes && yes !== btn) { yes.click(); break; }
  }
  return done('Resigned', 'Good game.');
}

// ---------- Overlay ----------

const overlay = (() => {
  let root, raf, board, marks = [];
  const ensure = () => {
    if (root?.isConnected) return root;
    root = document.createElement('div');
    root.className = 'hearsay-overlay';
    root.setAttribute('aria-hidden', 'true');
    document.documentElement.appendChild(root);
    return root;
  };
  const place = () => {
    if (!board?.el.isConnected || !marks.length) { stop(); return; }
    const r = board.el.getBoundingClientRect();
    const size = r.width / 8;
    for (const m of marks) {
      const p = squarePoint(board, m.square);
      m.node.style.transform = `translate(${p.x - size / 2}px, ${p.y - size / 2}px)`;
      m.node.style.width = m.node.style.height = `${size}px`;
    }
    raf = requestAnimationFrame(place);
  };
  const stop = () => { cancelAnimationFrame(raf); raf = null; };
  function show(b, list, { fadeAfter } = {}) {
    clear();
    if (!b) return;
    board = b;
    ensure();
    marks = list.map(({ square, kind, label }) => {
      const node = document.createElement('div');
      node.className = `hearsay-sq hearsay-${kind}`;
      if (label) node.dataset.label = label;
      root.appendChild(node);
      return { square, node };
    });
    if (!raf) place();
    if (fadeAfter) setTimeout(() => marks.forEach((m) => m.node.classList.add('hearsay-out')), fadeAfter);
    if (fadeAfter) setTimeout(clear, fadeAfter + 400);
  }
  function clear() { marks.forEach((m) => m.node.remove()); marks = []; stop(); }
  return { show, clear };
})();

// ---------- Results the panel renders ----------

const done = (title, detail, extra = {}) => ({ status: 'done', title, detail, ...extra });
const fail = (title, detail) => ({ status: 'failed', title, detail });

function illegalReason(board, from, to) {
  const piece = pieceAt(board.pos, from);
  if (!piece) return `There’s no piece on ${from}.`;
  if (piece.color !== board.moveFor) return `The ${PIECE_NAMES[piece.piece]} on ${from} isn’t yours to move.`;
  const own = pieceAt(board.pos, to);
  if (own && own.color === piece.color) return `Your own piece is on ${to}.`;
  return `The ${PIECE_NAMES[piece.piece]} on ${from} can’t go to ${to} right now.`;
}

async function playAndReport(board, move, heard, prefs) {
  if (prefs?.chess?.confirm === 'always') {
    pending = { kind: 'confirm', moves: [move] };
    if (prefs.chess.overlay) overlay.show(board, [{ square: move.from, kind: 'preview' }, { square: move.to, kind: 'preview' }]);
    return { status: 'choose', title: `Play ${arrow(move)}?`, detail: 'Say “yes” to play it, or “cancel”.', options: [{ n: 1, label: arrow(move) }], confirm: true, heard };
  }
  const res = await play(board, move);
  if (!res.ok) {
    overlay.clear();
    return fail('The board didn’t take that', `I clicked ${move.from} then ${move.to}, but the move didn’t land. Try saying it again.`);
  }
  if (prefs?.chess?.overlay !== false) overlay.show(board, [{ square: move.from, kind: 'played' }, { square: move.to, kind: 'played' }], { fadeAfter: 1400 });
  const label = res.premove ? 'Premoved' : 'Played';
  return done(arrow(move), `${heard ? `Heard “${heard}”. ` : ''}Say “undo” to take it back.`, { label, spoken: `${label} ${describeMove(move)}` });
}

async function handleUtterance(alternatives, prefs) {
  const board = await readBoard();

  // A button word in the recognizer's top guess wins; in a lower guess it only wins if no move was heard.
  const topCmd = matchAlternatives(CHESS_COMMANDS, alternatives.slice(0, 1), 0.8);
  if (topCmd && board) return { handled: true, result: await runCommand(topCmd.cmd) };

  if (!board) return { handled: false };
  const r = parseMove(alternatives, { legal: board.legal, pieceNames: !!prefs?.chess?.pieceNames, color: board.moveFor });
  if (r.kind === 'none' || r.kind === 'illegal') {
    const lowerCmd = matchAlternatives(CHESS_COMMANDS, alternatives.slice(1), 0.8);
    if (lowerCmd) return { handled: true, result: await runCommand(lowerCmd.cmd) };
  }
  if (r.kind === 'none') return { handled: false };
  if (board.over) return { handled: true, result: fail('This game is over', 'Say “rematch” or “new game”.') };
  if (r.kind === 'move') return { handled: true, result: await playAndReport(board, r.move, r.heard, prefs) };
  if (r.kind === 'choose') {
    pending = { kind: 'moves', moves: r.options };
    if (prefs?.chess?.overlay !== false) overlay.show(board, r.options.map((m, i) => ({ square: m.to, kind: 'option', label: String(i + 1) })));
    const sameTarget = r.options.every((m) => m.to === r.options[0].to && m.from === r.options[0].from);
    const title = sameTarget ? 'Promote to?' : r.options.every((m) => m.flags.match(/[kq]/)) ? 'Which way to castle?' : 'Which one?';
    return { handled: true, result: { status: 'choose', title, detail: `Heard “${r.heard}”. Say the number.`, options: r.options.map((m, i) => ({ n: i + 1, label: sameTarget ? PIECE_NAMES[m.promotion] : m.flags.match(/[kq]/) ? describeMove(m) : arrow(m) })) } };
  }
  return { handled: true, result: fail('Didn’t play that', `Heard “${r.heard}”. ${illegalReason(board, r.from, r.to)}`) };
}

async function handleChoice(index, prefs) {
  const p = pending;
  pending = null;
  overlay.clear();
  if (!p) return fail('Nothing to choose', '');
  if (p.kind === 'resign') return index === 1 ? confirmResign() : done('Not resigned', 'The game goes on.');
  const move = p.moves[index - 1];
  if (!move) return fail(`There’s no option ${index}`, '');
  const board = await readBoard();
  if (!board) return fail('The board went away', '');
  const fresh = board.legal.find((m) => m.from === move.from && m.to === move.to && m.promotion === move.promotion);
  if (!fresh) return fail('That move isn’t legal anymore', 'The position changed while you were choosing.');
  return playAndReport(board, fresh, null, { ...prefs, chess: { ...prefs?.chess, confirm: 'never' } });
}

async function preview(text, prefs) {
  if (prefs?.chess?.overlay === false) return {};
  const board = await readBoard();
  if (!board) return {};
  const r = parseMove([{ transcript: text, confidence: 1 }], { legal: board.legal, pieceNames: !!prefs?.chess?.pieceNames, color: board.moveFor });
  if (r.kind === 'move') {
    overlay.show(board, [{ square: r.move.from, kind: 'preview' }, { square: r.move.to, kind: 'preview' }]);
    return { title: arrow(r.move) };
  }
  return {};
}

async function context() {
  const board = await readBoard();
  if (!board) return { board: false };
  const examples = [];
  const pick = (fn) => board.legal.find(fn);
  // Central moves make better examples than a2 to a4.
  const central = (m) => 'cdef'.includes(m.to[0]) && '3456'.includes(m.to[1]);
  const pawn = pick((m) => m.piece === 'p' && central(m) && 'de'.includes(m.from[0])) ?? pick((m) => m.piece === 'p' && central(m)) ?? pick((m) => m.piece === 'p');
  const piece = pick((m) => m.piece === 'n' && central(m)) ?? pick((m) => m.piece !== 'p' && m.piece !== 'k') ?? pick((m) => m.piece !== 'p');
  for (const m of [pawn, piece]) if (m) examples.push(`${m.from} to ${m.to}`);
  if (board.legal.some((m) => m.flags.includes('k'))) examples.push('castle short');
  return {
    board: true,
    mode: board.mode,
    you: board.you,
    turn: board.pos.turn,
    yourTurn: !board.premove,
    over: board.over,
    examples,
    status: board.over ? 'Game over' : board.you ? (board.premove ? `${colorName(board.pos.turn)} to move` : `Your move, ${colorName(board.you)}`) : `${colorName(board.pos.turn)} to move`,
  };
}

// ---------- Watching for the other side's moves ----------

let watchTimer = null;
// Throttled rather than debounced: a ticking clock mutates the page constantly.
const observer = new MutationObserver(() => {
  if (watchTimer) return;
  watchTimer = setTimeout(async () => {
    watchTimer = null;
    const board = await readBoard();
    const lm = board?.lastMove;
    if (!lm) return;
    const keyStr = lm.from + lm.to + lm.san;
    if (keyStr === lastSeenMove) return;
    const first = lastSeenMove === null;
    lastSeenMove = keyStr;
    if (first) return;
    if (ourLastMove === lm.from + lm.to) { ourLastMove = null; return; }
    if (board.you && lm.color === board.you) return;
    chrome.runtime.sendMessage({ type: 'hearsay:event', kind: 'move', text: `${colorName(lm.color)} played ${lm.from} to ${lm.to}`, short: `${lm.from} to ${lm.to}`, color: lm.color }).catch(() => {});
  }, 120);
});
observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });

// ---------- Messages from the panel ----------

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const run = async () => {
    switch (msg?.type) {
      case 'hearsay:context': return context();
      case 'hearsay:preview': return preview(msg.text, msg.prefs);
      case 'hearsay:utterance': return handleUtterance(msg.alternatives, msg.prefs);
      case 'hearsay:choose': return { handled: true, result: await handleChoice(msg.index, msg.prefs) };
      case 'hearsay:cancel': pending = null; overlay.clear(); return { ok: true };
      case 'hearsay:clear': overlay.clear(); return { ok: true };
      default: return undefined;
    }
  };
  run().then(reply, (err) => reply({ handled: true, result: fail('Something went wrong', String(err?.message ?? err)) }));
  return true;
});

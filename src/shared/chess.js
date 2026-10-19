// Small, dependency-free chess rules: FEN in, legal moves out.
// Board is a 64-entry array, index = rank * 8 + file, a1 = 0, h8 = 63.

const FILES = 'abcdefgh';
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export const squareName = (i) => FILES[i % 8] + (Math.floor(i / 8) + 1);
export const squareIndex = (s) => (s.charCodeAt(1) - 49) * 8 + (s.charCodeAt(0) - 97);
const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;

export function parseFen(fen) {
  const parts = String(fen).trim().split(/\s+/);
  const rows = parts[0]?.split('/');
  if (!rows || rows.length !== 8) throw new Error('FEN needs 8 ranks');
  const board = new Array(64).fill(null);
  rows.forEach((row, i) => {
    const rank = 7 - i;
    let file = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) file += Number(ch);
      else if (/[pnbrqkPNBRQK]/.test(ch)) {
        if (file > 7) throw new Error('FEN rank too long');
        board[rank * 8 + file] = { piece: ch.toLowerCase(), color: ch === ch.toUpperCase() ? 'w' : 'b' };
        file++;
      } else throw new Error(`Bad FEN character "${ch}"`);
    }
    if (file !== 8) throw new Error('FEN rank has wrong length');
  });
  const turn = parts[1] ?? 'w';
  if (turn !== 'w' && turn !== 'b') throw new Error('FEN side to move must be w or b');
  const castling = parts[2] && parts[2] !== '-' ? parts[2] : '';
  const ep = parts[3] && parts[3] !== '-' ? squareIndex(parts[3]) : -1;
  return { board, turn, castling, ep };
}

export function toFen(pos) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = '', empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = pos.board[r * 8 + f];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += p.color === 'w' ? p.piece.toUpperCase() : p.piece;
    }
    rows.push(row + (empty || ''));
  }
  return `${rows.join('/')} ${pos.turn} ${pos.castling || '-'} ${pos.ep >= 0 ? squareName(pos.ep) : '-'} 0 1`;
}

export const pieceAt = (pos, square) => pos.board[squareIndex(square)] ?? null;

export const withTurn = (pos, color) => ({ ...pos, board: pos.board.slice(), turn: color, ep: -1 });

function attacked(board, idx, by) {
  const f = idx % 8, r = Math.floor(idx / 8);
  const at = (ff, rr) => board[rr * 8 + ff];
  const pr = by === 'w' ? r - 1 : r + 1;
  for (const df of [-1, 1]) {
    if (onBoard(f + df, pr)) {
      const p = at(f + df, pr);
      if (p && p.color === by && p.piece === 'p') return true;
    }
  }
  for (const [df, dr] of KNIGHT) {
    if (!onBoard(f + df, r + dr)) continue;
    const p = at(f + df, r + dr);
    if (p && p.color === by && p.piece === 'n') return true;
  }
  for (const [df, dr] of KING) {
    if (!onBoard(f + df, r + dr)) continue;
    const p = at(f + df, r + dr);
    if (p && p.color === by && p.piece === 'k') return true;
  }
  const slide = (dirs, kinds) => dirs.some(([df, dr]) => {
    let ff = f + df, rr = r + dr;
    while (onBoard(ff, rr)) {
      const p = at(ff, rr);
      if (p) return p.color === by && kinds.includes(p.piece);
      ff += df; rr += dr;
    }
    return false;
  });
  return slide(ROOK_DIRS, 'rq') || slide(BISHOP_DIRS, 'bq');
}

function pseudoMoves(pos) {
  const { board, turn: us } = pos;
  const them = us === 'w' ? 'b' : 'w';
  const out = [];
  const add = (from, to, piece, flags = '', promotion) => {
    const m = { from: squareName(from), to: squareName(to), piece, color: us, flags };
    if (promotion) m.promotion = promotion;
    out.push(m);
  };
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p || p.color !== us) continue;
    const f = i % 8, r = Math.floor(i / 8);
    if (p.piece === 'p') {
      const dir = us === 'w' ? 1 : -1;
      const start = us === 'w' ? 1 : 6;
      const last = us === 'w' ? 7 : 0;
      const pushPawn = (to, flags) => {
        if (Math.floor(to / 8) === last) for (const pr of 'qrbn') add(i, to, 'p', flags + 'p', pr);
        else add(i, to, 'p', flags);
      };
      const one = i + dir * 8;
      if (onBoard(f, r + dir) && !board[one]) {
        pushPawn(one, '');
        const two = i + dir * 16;
        if (r === start && !board[two]) add(i, two, 'p', 'd');
      }
      for (const df of [-1, 1]) {
        if (!onBoard(f + df, r + dir)) continue;
        const to = (r + dir) * 8 + f + df;
        if (board[to] && board[to].color === them) pushPawn(to, 'c');
        else if (to === pos.ep) add(i, to, 'p', 'ce');
      }
      continue;
    }
    if (p.piece === 'n' || p.piece === 'k') {
      for (const [df, dr] of p.piece === 'n' ? KNIGHT : KING) {
        if (!onBoard(f + df, r + dr)) continue;
        const to = (r + dr) * 8 + f + df;
        if (!board[to]) add(i, to, p.piece);
        else if (board[to].color === them) add(i, to, p.piece, 'c');
      }
      if (p.piece === 'k') {
        const home = us === 'w' ? 4 : 60;
        const rights = us === 'w' ? pos.castling.replace(/[a-z]/g, '') : pos.castling.replace(/[A-Z]/g, '').toUpperCase();
        if (i === home && !attacked(board, home, them)) {
          const rook = (sq) => board[sq]?.piece === 'r' && board[sq]?.color === us;
          if (rights.includes('K') && !board[home + 1] && !board[home + 2] && rook(home + 3)
            && !attacked(board, home + 1, them) && !attacked(board, home + 2, them)) add(i, home + 2, 'k', 'k');
          if (rights.includes('Q') && !board[home - 1] && !board[home - 2] && !board[home - 3] && rook(home - 4)
            && !attacked(board, home - 1, them) && !attacked(board, home - 2, them)) add(i, home - 2, 'k', 'q');
        }
      }
      continue;
    }
    const dirs = p.piece === 'r' ? ROOK_DIRS : p.piece === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
    for (const [df, dr] of dirs) {
      let ff = f + df, rr = r + dr;
      while (onBoard(ff, rr)) {
        const to = rr * 8 + ff;
        if (!board[to]) add(i, to, p.piece);
        else { if (board[to].color === them) add(i, to, p.piece, 'c'); break; }
        ff += df; rr += dr;
      }
    }
  }
  return out;
}

export function makeMove(pos, m) {
  const board = pos.board.slice();
  const from = squareIndex(m.from), to = squareIndex(m.to);
  const mover = board[from];
  board[to] = m.promotion ? { piece: m.promotion, color: mover.color } : mover;
  board[from] = null;
  if (m.flags.includes('e')) board[to + (mover.color === 'w' ? -8 : 8)] = null;
  if (m.flags.includes('k')) { board[to - 1] = board[to + 1]; board[to + 1] = null; }
  if (m.flags.includes('q')) { board[to + 1] = board[to - 2]; board[to - 2] = null; }
  let castling = pos.castling;
  const strip = (chars) => { for (const c of chars) castling = castling.replace(c, ''); };
  if (mover.piece === 'k') strip(mover.color === 'w' ? 'KQ' : 'kq');
  for (const [sq, c] of [[0, 'Q'], [7, 'K'], [56, 'q'], [63, 'k']]) if (from === sq || to === sq) strip(c);
  const ep = m.flags.includes('d') ? (from + to) / 2 : -1;
  return { board, turn: pos.turn === 'w' ? 'b' : 'w', castling, ep };
}

export function legalMoves(pos) {
  const us = pos.turn, them = us === 'w' ? 'b' : 'w';
  return pseudoMoves(pos).filter((m) => {
    const next = makeMove(pos, m);
    const king = next.board.findIndex((p) => p && p.piece === 'k' && p.color === us);
    return king === -1 || !attacked(next.board, king, them);
  });
}

export function inCheck(pos) {
  const king = pos.board.findIndex((p) => p && p.piece === 'k' && p.color === pos.turn);
  return king !== -1 && attacked(pos.board, king, pos.turn === 'w' ? 'b' : 'w');
}

export function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = legalMoves(pos);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) n += perft(makeMove(pos, m), depth - 1);
  return n;
}

export const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

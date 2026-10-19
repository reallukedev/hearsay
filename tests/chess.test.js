import { describe, it, expect } from 'vitest';
import { parseFen, legalMoves, perft, withTurn, pieceAt } from '../src/shared/chess.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
const ENDGAME = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1';
const MIRROR = 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1';

const movesOf = (fen) => legalMoves(parseFen(fen));
const find = (moves, from, to, promotion) =>
  moves.filter((m) => m.from === from && m.to === to && (promotion === undefined || m.promotion === promotion));
const uci = (m) => m.from + m.to + (m.promotion ?? '');

describe('parseFen', () => {
  it.each([
    ['too few ranks', 'rnbqkbnr/pppppppp/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
    ['too many ranks', 'rnbqkbnr/pppppppp/8/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
    ['bad piece letter', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNX w KQkq - 0 1'],
    ['bad side to move', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1'],
  ])('throws on %s', (_label, fen) => {
    expect(() => parseFen(fen)).toThrow(Error);
  });

  it('accepts a valid FEN', () => {
    expect(() => parseFen(KIWIPETE)).not.toThrow();
  });
});

describe('pieceAt', () => {
  const pos = parseFen(START);
  it.each([
    ['e1', { piece: 'k', color: 'w' }],
    ['d8', { piece: 'q', color: 'b' }],
    ['g1', { piece: 'n', color: 'w' }],
    ['a7', { piece: 'p', color: 'b' }],
  ])('%s', (sq, expected) => {
    expect(pieceAt(pos, sq)).toEqual(expected);
  });

  it('returns null for an empty square', () => {
    expect(pieceAt(pos, 'e4')).toBeNull();
  });
});

describe('legalMoves', () => {
  it('start position has 20 well-formed white moves', () => {
    const moves = movesOf(START);
    expect(moves).toHaveLength(20);
    for (const m of moves) {
      expect(m.from).toMatch(/^[a-h][1-8]$/);
      expect(m.to).toMatch(/^[a-h][1-8]$/);
      expect(m.color).toBe('w');
      expect(['p', 'n']).toContain(m.piece);
    }
  });

  it('marks double pawn pushes with d and quiet moves without c', () => {
    const moves = movesOf(START);
    expect(find(moves, 'e2', 'e4')[0].flags).toContain('d');
    expect(find(moves, 'e2', 'e3')[0].flags).not.toContain('d');
    expect(find(moves, 'g1', 'f3')[0].flags).not.toContain('c');
  });

  it('lists each promotion piece once, including capture promotions', () => {
    const moves = movesOf('3r3k/4P3/8/8/8/8/8/4K3 w - - 0 1');
    const push = find(moves, 'e7', 'e8');
    const capture = find(moves, 'e7', 'd8');
    expect(push.map((m) => m.promotion).sort()).toEqual(['b', 'n', 'q', 'r']);
    expect(capture.map((m) => m.promotion).sort()).toEqual(['b', 'n', 'q', 'r']);
    for (const m of push) {
      expect(m.flags).toContain('p');
      expect(m.flags).not.toContain('c');
      expect(m.piece).toBe('p');
    }
    for (const m of capture) {
      expect(m.flags).toContain('p');
      expect(m.flags).toContain('c');
    }
    expect(find(moves, 'e7', 'f8')).toHaveLength(0);
  });

  it('includes en passant with the e flag', () => {
    const moves = movesOf('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    const ep = find(moves, 'e5', 'd6');
    expect(ep).toHaveLength(1);
    expect(ep[0].flags).toContain('e');
    expect(ep[0].piece).toBe('p');
  });

  it('excludes en passant that exposes the king along the rank', () => {
    const moves = movesOf('8/8/8/KPp4r/8/8/8/7k w - c6 0 1');
    expect(find(moves, 'b5', 'c6')).toHaveLength(0);
    expect(find(moves, 'b5', 'b6')).toHaveLength(1);
  });

  it('excludes en passant when no ep square is set', () => {
    const moves = movesOf('4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1');
    expect(find(moves, 'e5', 'd6')).toHaveLength(0);
  });

  it('allows both castles with k and q flags', () => {
    const moves = movesOf('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const ks = find(moves, 'e1', 'g1');
    const qs = find(moves, 'e1', 'c1');
    expect(ks).toHaveLength(1);
    expect(qs).toHaveLength(1);
    expect(ks[0].flags).toContain('k');
    expect(ks[0].piece).toBe('k');
    expect(qs[0].flags).toContain('q');
  });

  it('forbids castling through an attacked square', () => {
    const moves = movesOf('r3kr2/8/8/8/8/8/8/R3K2R w KQq - 0 1');
    expect(find(moves, 'e1', 'g1')).toHaveLength(0);
    expect(find(moves, 'e1', 'c1')).toHaveLength(1);
  });

  it('allows queenside castling when only b1 is attacked', () => {
    const moves = movesOf('1r2k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(find(moves, 'e1', 'c1')).toHaveLength(1);
    expect(find(moves, 'e1', 'g1')).toHaveLength(1);
  });

  it('forbids castling out of check', () => {
    const moves = movesOf('4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(find(moves, 'e1', 'g1')).toHaveLength(0);
    expect(find(moves, 'e1', 'c1')).toHaveLength(0);
  });

  it('forbids castling without the right', () => {
    const moves = movesOf('r3k2r/8/8/8/8/8/8/R3K2R w Q - 0 1');
    expect(find(moves, 'e1', 'g1')).toHaveLength(0);
    expect(find(moves, 'e1', 'c1')).toHaveLength(1);
  });

  it('gives an absolutely pinned bishop no moves', () => {
    const moves = movesOf('4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1');
    expect(moves.filter((m) => m.from === 'e2')).toHaveLength(0);
  });

  it('lets a pinned rook move only along the pin line', () => {
    const moves = movesOf('4k3/4r3/8/8/8/8/4R3/4K3 w - - 0 1');
    const rook = moves.filter((m) => m.from === 'e2').map((m) => m.to).sort();
    expect(rook).toEqual(['e3', 'e4', 'e5', 'e6', 'e7']);
    expect(find(moves, 'e2', 'e7')[0].flags).toContain('c');
  });

  it('only allows check evasions when in check', () => {
    const moves = movesOf('4k3/8/8/8/8/8/3q4/4K3 w - - 0 1');
    expect(moves.map(uci).sort()).toEqual(['e1d2', 'e1f1']);
  });

  it('generates black moves when black is to move', () => {
    const moves = movesOf('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    expect(moves).toHaveLength(20);
    expect(moves.every((m) => m.color === 'b')).toBe(true);
    expect(find(moves, 'e7', 'e5')).toHaveLength(1);
  });
});

describe('perft', () => {
  it.each([
    ['start', START, 1, 20],
    ['start', START, 2, 400],
    ['start', START, 3, 8902],
    ['start', START, 4, 197281],
    ['kiwipete', KIWIPETE, 1, 48],
    ['kiwipete', KIWIPETE, 2, 2039],
    ['kiwipete', KIWIPETE, 3, 97862],
    ['endgame', ENDGAME, 1, 14],
    ['endgame', ENDGAME, 2, 191],
    ['endgame', ENDGAME, 3, 2812],
    ['endgame', ENDGAME, 4, 43238],
    ['promotions', MIRROR, 1, 6],
    ['promotions', MIRROR, 2, 264],
    ['promotions', MIRROR, 3, 9467],
  ])('%s depth %i = %i', (_name, fen, depth, expected) => {
    expect(perft(parseFen(fen), depth)).toBe(expected);
  }, 60000);
});

describe('withTurn', () => {
  it('flips the side to move without mutating the original', () => {
    const pos = parseFen(START);
    const black = withTurn(pos, 'b');
    const moves = legalMoves(black);
    expect(moves).toHaveLength(20);
    expect(moves.every((m) => m.color === 'b')).toBe(true);
    expect(legalMoves(pos).every((m) => m.color === 'w')).toBe(true);
  });

  it('clears en passant', () => {
    const pos = parseFen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    const same = withTurn(pos, 'w');
    expect(find(legalMoves(same), 'e5', 'd6')).toHaveLength(0);
    expect(find(legalMoves(pos), 'e5', 'd6')).toHaveLength(1);
  });

  it('keeps pieces in place', () => {
    const pos = withTurn(parseFen(START), 'b');
    expect(pieceAt(pos, 'e1')).toEqual({ piece: 'k', color: 'w' });
    expect(pieceAt(pos, 'e4')).toBeNull();
  });
});

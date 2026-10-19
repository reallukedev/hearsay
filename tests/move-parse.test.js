import { describe, it, expect } from 'vitest';
import { parseMove } from '../src/shared/move-parse.js';
import { parseFen, legalMoves } from '../src/shared/chess.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';
// white pawn e7 can push to e8 or capture the rook on d8
const PROMO = '3r3k/4P3/8/8/8/8/8/4K3 w - - 0 1';
const CASTLE_BOTH = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
// rook on f8 covers f1, so only O-O-O is legal
const CASTLE_LONG_ONLY = 'r3kr2/8/8/8/8/8/8/R3K2R w KQq - 0 1';
const BLACK_CASTLE = 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1';
const TWO_KNIGHTS = '4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1';
const BISHOP_TAKES = '4k3/8/8/4p3/8/2B5/8/4K3 w - - 0 1';
// five white queens can all reach d4
const FIVE_QUEENS = 'k7/8/1Q3Q2/8/8/8/1Q3Q2/3Q3K w - - 0 1';

function ctxFor(fen, opts = {}) {
  return { legal: legalMoves(parseFen(fen)), pieceNames: false, color: fen.split(' ')[1], ...opts };
}

function sayAll(transcripts, fen = START, opts) {
  const alts = transcripts.map((transcript, i) => ({ transcript, confidence: 0.9 - i * 0.1 }));
  return parseMove(alts, ctxFor(fen, opts));
}

function say(text, fen = START, opts) {
  return parseMove([{ transcript: text, confidence: 0.9 }], ctxFor(fen, opts));
}

function expectMove(result, from, to, promotion) {
  expect(result.kind).toBe('move');
  expect(result.move.from).toBe(from);
  expect(result.move.to).toBe(to);
  if (promotion) expect(result.move.promotion).toBe(promotion);
}

describe('square pair grammar', () => {
  it.each([
    'e2 to e4',
    'e2 e4',
    'e2e4',
    'E2-E4',
    'e2 two e4',
    'e2 2 e4',
    'from e2 to e4',
    'move e2 to e4',
    'pawn e2 to e4',
    'E2 to E4.',
    'e 2 to e 4',
    'echo two to echo four',
  ])('"%s" plays e2-e4', (text) => {
    expectMove(say(text), 'e2', 'e4');
  });

  it('returns the move object from ctx.legal and the transcript heard', () => {
    const ctx = ctxFor(START);
    const result = parseMove([{ transcript: 'e2 to e4', confidence: 0.9 }], ctx);
    expect(ctx.legal).toContain(result.move);
    expect(result.heard).toBe('e2 to e4');
  });

  it.each([
    ['g one to f three', START, 'g1', 'f3'],
    ['b won to c three', START, 'b1', 'c3'],
    ['g one to f tree', START, 'g1', 'f3'],
    ['e two to e for', START, 'e2', 'e4'],
    ['e two to e fore', START, 'e2', 'e4'],
    ['e too to e four', START, 'e2', 'e4'],
    ['d two to d three', START, 'd2', 'd3'],
    ['e seven to e five', AFTER_E4, 'e7', 'e5'],
    ['d seven to d six', AFTER_E4, 'd7', 'd6'],
    ['g eight to f six', AFTER_E4, 'g8', 'f6'],
    ['g ate to f six', AFTER_E4, 'g8', 'f6'],
  ])('number words: "%s"', (text, fen, from, to) => {
    expectMove(say(text, fen), from, to);
  });

  it.each([
    ['a', 'a'], ['ay', 'a'], ['eh', 'a'], ['alpha', 'a'],
    ['b', 'b'], ['be', 'b'], ['bee', 'b'], ['bravo', 'b'],
    ['c', 'c'], ['see', 'c'], ['sea', 'c'], ['charlie', 'c'],
    ['d', 'd'], ['dee', 'd'], ['delta', 'd'],
    ['e', 'e'], ['ee', 'e'], ['echo', 'e'],
    ['f', 'f'], ['ef', 'f'], ['eff', 'f'], ['foxtrot', 'f'],
    ['g', 'g'], ['gee', 'g'], ['golf', 'g'],
    ['h', 'h'], ['aitch', 'h'], ['hotel', 'h'],
  ])('file word "%s" means %s', (word, file) => {
    expectMove(say(`${word} two to ${word} four`), `${file}2`, `${file}4`);
  });

  it.each([
    ['b2 before', 'b2', 'b4'],
    ['a2 to 84', 'a2', 'a4'],
    ['bee two to bee four', 'b2', 'b4'],
  ])('merged homophone "%s"', (text, from, to) => {
    expectMove(say(text), from, to);
  });

  it('does not turn "d2 to be four" into a move', () => {
    expect(say('d2 to be four').kind).not.toBe('move');
  });
});

describe('promotion', () => {
  it.each([
    ['e7 to e8 queen', 'e8', 'q'],
    ['e7 e8 knight', 'e8', 'n'],
    ['e7 to e8 equals rook', 'e8', 'r'],
    ['e7 to e8 promote to bishop', 'e8', 'b'],
    ['e7 to e8 night', 'e8', 'n'],
    ['e7 to e8 nite', 'e8', 'n'],
    ['E7 to E8 Queen!', 'e8', 'q'],
    ['e seven to e eight queen', 'e8', 'q'],
    ['e7 to d8 queen', 'd8', 'q'],
    ['e7 to d8 knight', 'd8', 'n'],
  ])('"%s"', (text, to, promotion) => {
    expectMove(say(text, PROMO), 'e7', to, promotion);
  });

  it.each([
    ['e7 to e8', 'e8'],
    ['e7 to d8', 'd8'],
  ])('"%s" with no piece offers all four, queen first', (text, to) => {
    const result = say(text, PROMO);
    expect(result.kind).toBe('choose');
    expect(result.options).toHaveLength(4);
    expect(result.options[0].promotion).toBe('q');
    expect(result.options.map((m) => m.promotion).sort()).toEqual(['b', 'n', 'q', 'r']);
    for (const m of result.options) {
      expect(m.from).toBe('e7');
      expect(m.to).toBe(to);
    }
  });
});

describe('castling', () => {
  it.each([
    'castle short',
    'castle kingside',
    'castles king side',
    'short castle',
    'o-o',
    'O-O',
    'e1 to g1',
  ])('"%s" castles king side', (text) => {
    expectMove(say(text, CASTLE_BOTH), 'e1', 'g1');
  });

  it.each(['castle long', 'castle queenside', 'o-o-o', 'O-O-O', 'e1 to c1'])(
    '"%s" castles queen side',
    (text) => {
      expectMove(say(text, CASTLE_BOTH), 'e1', 'c1');
    },
  );

  it('plain "castle" with both legal chooses, king side first', () => {
    const result = say('castle', CASTLE_BOTH);
    expect(result.kind).toBe('choose');
    expect(result.options.map((m) => m.to)).toEqual(['g1', 'c1']);
  });

  it('plain "castle" with only one legal plays it', () => {
    expectMove(say('castle', CASTLE_LONG_ONLY), 'e1', 'c1');
  });

  it('does not play an illegal short castle', () => {
    expect(say('castle short', CASTLE_LONG_ONLY).kind).not.toBe('move');
  });

  it('works for black', () => {
    expectMove(say('castle short', BLACK_CASTLE), 'e8', 'g8');
    expectMove(say('o-o-o', BLACK_CASTLE), 'e8', 'c8');
  });
});

describe('piece names', () => {
  const on = { pieceNames: true };

  it.each([
    ['knight f3', START, 'g1', 'f3'],
    ['knight to f3', START, 'g1', 'f3'],
    ['queen h5', AFTER_E4_E5, 'd1', 'h5'],
    ['bishop takes e5', BISHOP_TAKES, 'c3', 'e5'],
  ])('"%s"', (text, fen, from, to) => {
    expectMove(say(text, fen, on), from, to);
  });

  it('chooses when two pieces can reach the square', () => {
    const result = say('knight d2', TWO_KNIGHTS, on);
    expect(result.kind).toBe('choose');
    expect(result.options.map((m) => m.from).sort()).toEqual(['b1', 'f1']);
    expect(result.options.every((m) => m.to === 'd2' && m.piece === 'n')).toBe(true);
  });

  it('never offers more than four options', () => {
    const result = say('queen d4', FIVE_QUEENS, on);
    expect(result.kind).not.toBe('move');
    if (result.kind === 'choose') {
      expect(result.options.length).toBeGreaterThanOrEqual(2);
      expect(result.options.length).toBeLessThanOrEqual(4);
      expect(result.options.every((m) => m.piece === 'q' && m.to === 'd4')).toBe(true);
    }
  });

  it('returns none for piece names when pieceNames is off', () => {
    expect(say('knight f3').kind).toBe('none');
    expect(say('queen h5', AFTER_E4_E5).kind).toBe('none');
  });
});

describe('alternatives', () => {
  it('falls back to a later alternative when the first is illegal', () => {
    const result = sayAll(['e2 to e5', 'e2 to e4']);
    expectMove(result, 'e2', 'e4');
    expect(result.heard).toBe('e2 to e4');
  });

  it('falls back when the first is not a move at all', () => {
    expectMove(sayAll(['hello there', 'g1 to f3']), 'g1', 'f3');
  });

  it('prefers the first alternative when it is legal', () => {
    expectMove(sayAll(['d2 to d4', 'e2 to e4']), 'd2', 'd4');
  });

  it('reports illegal when no alternative is legal', () => {
    const result = sayAll(['e2 to e5', 'e2 to e6']);
    expect(result.kind).toBe('illegal');
    expect(result.from).toBe('e2');
  });
});

describe('illegal and none', () => {
  it.each([
    ['e2 to e5', 'e2', 'e5'],
    ['a3 to a4', 'a3', 'a4'],
    ['g1 to g3', 'g1', 'g3'],
  ])('"%s" is illegal', (text, from, to) => {
    const result = say(text);
    expect(result.kind).toBe('illegal');
    expect(result.from).toBe(from);
    expect(result.to).toBe(to);
    expect(result.heard).toBe(text);
  });

  it('carries the promotion on an illegal promotion', () => {
    const result = say('e7 to f8 queen', PROMO);
    expect(result.kind).toBe('illegal');
    expect(result.from).toBe('e7');
    expect(result.to).toBe('f8');
    expect(result.promotion).toBe('q');
  });

  it.each(['flip the board', 'hello', 'Next page.', ''])('"%s" is none', (text) => {
    expect(say(text)).toEqual({ kind: 'none' });
  });

  it('returns none for no alternatives', () => {
    expect(parseMove([], ctxFor(START))).toEqual({ kind: 'none' });
  });
});

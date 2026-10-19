// Turns what the recognizer heard into a legal move.
// Every token can mean several things ("to" is a connector or the digit 2), so we search
// all readings, keep the ones that are legal right now, and pick the cheapest.

const FILE_WORDS = {
  a: 'a', ay: 'a', eh: 'a', alpha: 'a', alfa: 'a',
  b: 'b', be: 'b', bee: 'b', bea: 'b', bravo: 'b',
  c: 'c', see: 'c', sea: 'c', si: 'c', cee: 'c', charlie: 'c',
  d: 'd', dee: 'd', de: 'd', delta: 'd',
  e: 'e', ee: 'e', echo: 'e',
  f: 'f', ef: 'f', eff: 'f', foxtrot: 'f',
  g: 'g', gee: 'g', ge: 'g', jee: 'g', golf: 'g',
  h: 'h', aitch: 'h', haitch: 'h', hotel: 'h', age: 'h',
};
const RANK_WORDS = {
  1: '1', one: '1', won: '1',
  2: '2', two: '2',
  3: '3', three: '3', tree: '3',
  4: '4', four: '4', for: '4', fore: '4',
  5: '5', five: '5',
  6: '6', six: '6', sex: '6',
  7: '7', seven: '7',
  8: '8', eight: '8', ate: '8',
};
const PROMO_WORDS = { queen: 'q', quinn: 'q', rook: 'r', rock: 'r', ruck: 'r', bishop: 'b', knight: 'n', night: 'n', nite: 'n' };
const PIECE_WORDS = { ...PROMO_WORDS, king: 'k', pawn: 'p', porn: 'p', prawn: 'p' };
const CONNECTORS = new Set(['to', 'takes', 'take', 'x', 'captures', 'capture', 'onto', 'into']);
const FILLERS = new Set(['move', 'play', 'the', 'square', 'please', 'from', 'and', 'um', 'uh', 'pawn', 'then', 'go', 'promote', 'promotes', 'promoting', 'promotion', 'equals', 'equal', 'as', 'a', 'an']);
const MERGED = { before: ['b', '4'], beef: ['b', '4'], seaform: ['c', '4'], defour: ['d', '4'] };

const MAX_COST = 4;

export function tokenize(text) {
  let s = String(text).toLowerCase();
  s = s.replace(/[o0]\s*-\s*[o0]\s*-\s*[o0]/g, ' castle long ').replace(/[o0]\s*-\s*[o0]/g, ' castle short ');
  s = s.replace(/=/g, ' equals ').replace(/[^a-z0-9\s]/g, ' ');
  const out = [];
  for (const word of s.split(/\s+/).filter(Boolean)) {
    // "e2e4", "84", "e7e8q": recognizer output with the spaces squeezed out.
    if (/\d/.test(word) && /^[a-h1-8]+[qrbn]?$/.test(word)) {
      for (const ch of word) out.push(/[qrbn]/.test(ch) && ch === word.at(-1) && word.length > 2 ? { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[ch] : ch);
    } else if (MERGED[word]) out.push(...MERGED[word]);
    else out.push(word);
  }
  return out;
}

// Each reading: [kind, value, cost]. Kinds: F file, R rank, C connector, P promotion, S skip.
function readings(tok) {
  const r = [];
  if (FILE_WORDS[tok] && tok !== 'a' && tok !== 'be' && tok !== 'see' && tok !== 'age') r.push(['F', FILE_WORDS[tok], 0]);
  if (tok === 'a' || tok === 'be' || tok === 'see') r.push(['F', FILE_WORDS[tok], 0.5]);
  if (tok === 'age') r.push(['F', 'h', 1.5]);
  if (RANK_WORDS[tok]) r.push(['R', RANK_WORDS[tok], tok === 'for' || tok === 'fore' || tok === 'won' || tok === 'ate' || tok === 'tree' || tok === 'sex' ? 0.5 : 0]);
  if (tok === 'to' || tok === 'too') r.push(['R', '2', 1]);
  if (tok === '8') r.push(['F', 'a', 2]);
  if (CONNECTORS.has(tok)) r.push(['C', null, 0]);
  if (tok === 'two' || tok === '2' || tok === 'too') r.push(['C', null, 1]);
  if (PROMO_WORDS[tok]) r.push(['P', PROMO_WORDS[tok], 0]);
  if (FILLERS.has(tok)) r.push(['S', null, 0]);
  if (!r.length) r.push(['S', null, 2]);
  return r;
}

// States: 0 want file1, 1 want rank1, 2 have square1, 3 want rank2, 4 have square2, 5 have promotion.
function parsePairs(tokens) {
  const results = [];
  const opts = tokens.map(readings);
  const walk = (i, state, acc, cost) => {
    if (cost > MAX_COST) return;
    if (i === tokens.length) {
      if (state >= 4) results.push({ from: acc.f1 + acc.r1, to: acc.f2 + acc.r2, promotion: acc.p, cost });
      return;
    }
    for (const [kind, val, c] of opts[i]) {
      if (kind === 'S') { walk(i + 1, state, acc, cost + c); continue; }
      if (state === 0 && kind === 'F') walk(i + 1, 1, { ...acc, f1: val }, cost + c);
      else if (state === 1 && kind === 'R') walk(i + 1, 2, { ...acc, r1: val }, cost + c);
      else if (state === 2 && kind === 'C') walk(i + 1, 2.5, acc, cost + c);
      else if ((state === 2 || state === 2.5) && kind === 'F') walk(i + 1, 3, { ...acc, f2: val }, cost + c);
      else if (state === 3 && kind === 'R') walk(i + 1, 4, { ...acc, r2: val }, cost + c);
      else if (state === 4 && kind === 'C') walk(i + 1, 4, acc, cost + c);
      else if (state === 4 && kind === 'P') walk(i + 1, 5, { ...acc, p: val }, cost + c);
    }
  };
  walk(0, 0, {}, 0);
  return results;
}

function parseCastle(text) {
  const t = ` ${tokenize(text).join(' ')} `;
  if (!/ (castle|castles|castling|castled) /.test(t)) return null;
  if (/ (short|king ?side|kings ?side) /.test(t)) return 'k';
  if (/ (long|queen ?side|queens ?side) /.test(t)) return 'q';
  return 'any';
}

function parsePieceMove(tokens) {
  const idx = tokens.findIndex((t) => PIECE_WORDS[t] && PIECE_WORDS[t] !== 'p');
  if (idx === -1) return null;
  const rest = tokens.slice(idx + 1).filter((t) => !CONNECTORS.has(t) && !FILLERS.has(t));
  if (rest.length < 2) return null;
  const f = FILE_WORDS[rest[rest.length - 2]];
  const r = RANK_WORDS[rest[rest.length - 1]];
  if (!f || !r) return null;
  return { piece: PIECE_WORDS[tokens[idx]], to: f + r };
}

const PROMO_ORDER = 'qrbn';
const moveKey = (m) => m.from + m.to + (m.promotion || '');

function promotionChoices(legal, from, to) {
  return legal
    .filter((m) => m.from === from && m.to === to && m.promotion)
    .sort((a, b) => PROMO_ORDER.indexOf(a.promotion) - PROMO_ORDER.indexOf(b.promotion));
}

export function parseMove(alternatives, ctx) {
  const legal = ctx?.legal ?? [];
  const alts = (alternatives ?? []).filter((a) => a && a.transcript && a.transcript.trim());
  if (!alts.length) return { kind: 'none' };

  // Castling is checked first: it has its own words and can't be confused with squares.
  for (const alt of alts) {
    const side = parseCastle(alt.transcript);
    if (!side) continue;
    const castles = legal.filter((m) => m.piece === 'k' && /[kq]/.test(m.flags) && (side === 'any' || m.flags.includes(side)))
      .sort((a, b) => b.flags.includes('k') - a.flags.includes('k'));
    if (castles.length === 1) return { kind: 'move', move: castles[0], heard: alt.transcript };
    if (castles.length > 1) return { kind: 'choose', options: castles, heard: alt.transcript };
    const home = (ctx?.color ?? 'w') === 'w' ? '1' : '8';
    return { kind: 'illegal', heard: alt.transcript, from: 'e' + home, to: (side === 'q' ? 'c' : 'g') + home };
  }

  const scored = [];
  let firstParse = null;
  alts.forEach((alt, rank) => {
    const tokens = tokenize(alt.transcript);
    for (const p of parsePairs(tokens)) {
      const cost = p.cost + rank * 0.75;
      if (!firstParse || cost < firstParse.cost) firstParse = { ...p, cost, heard: alt.transcript };
      const matches = legal.filter((m) => m.from === p.from && m.to === p.to && (!p.promotion || m.promotion === p.promotion));
      for (const m of matches) scored.push({ move: m, cost, heard: alt.transcript, promoNamed: !!p.promotion });
    }
    if (ctx?.pieceNames) {
      const pm = parsePieceMove(tokens);
      if (pm) {
        const matches = legal.filter((m) => m.piece === pm.piece && m.to === pm.to);
        for (const m of matches) scored.push({ move: m, cost: 0.25 + rank * 0.75, heard: alt.transcript, promoNamed: true });
      }
    }
  });

  if (scored.length) {
    const best = Math.min(...scored.map((s) => s.cost));
    const top = scored.filter((s) => s.cost === best);
    const unique = [...new Map(top.map((s) => [moveKey(s.move), s])).values()];
    const heard = unique[0].heard;
    if (unique.length === 1) return { kind: 'move', move: unique[0].move, heard };
    const allSamePair = unique.every((s) => s.move.from === unique[0].move.from && s.move.to === unique[0].move.to);
    if (allSamePair && unique[0].move.promotion) {
      return { kind: 'choose', options: promotionChoices(legal, unique[0].move.from, unique[0].move.to), heard };
    }
    return { kind: 'choose', options: unique.slice(0, 4).map((s) => s.move), heard };
  }

  if (firstParse && firstParse.cost <= 1.5) {
    const out = { kind: 'illegal', heard: firstParse.heard, from: firstParse.from, to: firstParse.to };
    if (firstParse.promotion) out.promotion = firstParse.promotion;
    return out;
  }
  return { kind: 'none' };
}

// Plain words for a move, for the panel and screen readers.
export function describeMove(m) {
  if (m.flags?.includes('k')) return 'castle short';
  if (m.flags?.includes('q')) return 'castle long';
  const promo = m.promotion ? ` = ${{ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[m.promotion]}` : '';
  return `${m.from} to ${m.to}${promo}`;
}

// Strings the recognizer can be nudged toward (contextual biasing, where Chrome supports it).
export function biasPhrases(legal) {
  const set = new Set();
  for (const m of legal) set.add(`${m.from} to ${m.to}`);
  return [...set].slice(0, 200);
}

// Matches spoken text against command phrases like "search for {text}".

const NUMBER_WORDS = {
  zero: 0, oh: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6,
  seven: 7, eight: 8, ate: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

const clean = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '').replace(/'/g, '');

export function words(text) {
  return String(text).split(/\s+/).map((raw) => ({ raw: raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''), w: clean(raw) })).filter((x) => x.w);
}

export function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

const asNumber = (w) => (/^\d+$/.test(w) ? w : NUMBER_WORDS[w] !== undefined ? String(NUMBER_WORDS[w]) : null);

export function compile(phrase) {
  return String(phrase).trim().split(/\s+/).filter(Boolean).map((part) => {
    const slot = part.match(/^\{([a-zA-Z]+)\}$/);
    return slot ? { slot: slot[1] } : { lit: clean(part) };
  }).filter((t) => t.slot || t.lit);
}

function matchOne(tokens, said) {
  let best = null;
  const walk = (pi, wi, edits, slots) => {
    if (pi === tokens.length) {
      if (wi === said.length && (!best || edits < best.edits)) best = { edits, slots };
      return;
    }
    const t = tokens[pi];
    if (t.lit) {
      if (wi >= said.length) return;
      const w = said[wi].w;
      if (w === t.lit) walk(pi + 1, wi + 1, edits, slots);
      else if (t.lit.length >= 4 && editDistance(w, t.lit) === 1) walk(pi + 1, wi + 1, edits + 1, slots);
      return;
    }
    if (t.slot === 'number') {
      const n = wi < said.length ? asNumber(said[wi].w) : null;
      if (n !== null) walk(pi + 1, wi + 1, edits, { ...slots, number: n });
      return;
    }
    // Free text takes at least one word; try every length, the next literal decides.
    for (let end = wi + 1; end <= said.length; end++) {
      walk(pi + 1, end, edits, { ...slots, [t.slot]: said.slice(wi, end).map((x) => x.raw).join(' ') });
    }
  };
  walk(0, 0, 0, {});
  return best;
}

export function matchPhrase(transcript, phrases) {
  const said = words(transcript);
  if (!said.length) return null;
  let best = null;
  for (const phrase of phrases ?? []) {
    const tokens = compile(phrase);
    if (!tokens.length) continue;
    const m = matchOne(tokens, said);
    if (!m) continue;
    const literals = tokens.filter((t) => t.lit).length;
    const score = Math.max(0, 1 - m.edits * (0.5 / Math.max(1, literals)));
    if (!best || score > best.score || (score === best.score && literals > best.literals)) {
      best = { phrase, slots: m.slots, score, literals };
    }
  }
  if (!best) return null;
  const { literals, ...out } = best;
  return out;
}

// Fill "{text}" style blanks in a URL or text template.
export function fillTemplate(template, slots, { encode = false } = {}) {
  return String(template).replace(/\{([a-zA-Z]+)\}/g, (_, name) => {
    const v = slots?.[name] ?? '';
    return encode ? encodeURIComponent(v) : v;
  });
}

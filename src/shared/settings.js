// Preferences and user sites live in chrome.storage.local, so they stay on this device.

export const DEFAULT_PREFS = {
  lang: 'en-US',
  engine: 'auto', // auto | local | cloud
  startOnOpen: true,
  sounds: true,
  speakResults: false,
  everyday: true, // scroll, back, "click ..." on chess.com and sites you added
  everydayEverywhere: false, // same, on every site (needs extra permission)
  chess: {
    confirm: 'never', // never | always
    pieceNames: false,
    overlay: true,
    announceOpponent: false,
  },
};

export async function getPrefs() {
  const { prefs } = await chrome.storage.local.get('prefs');
  return mergeDeep(structuredClone(DEFAULT_PREFS), prefs ?? {});
}

export async function setPrefs(patch) {
  const next = mergeDeep(await getPrefs(), patch);
  await chrome.storage.local.set({ prefs: next });
  return next;
}

export async function getSites() {
  const { sites } = await chrome.storage.local.get('sites');
  return Array.isArray(sites) ? sites : [];
}

export async function saveSites(sites) {
  await chrome.storage.local.set({ sites });
}

export const newId = () => Math.random().toString(36).slice(2, 10);

function mergeDeep(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') mergeDeep(target[k], v);
    else target[k] = v;
  }
  return target;
}

// "https://www.youtube.com/*" style match patterns, the same syntax Chrome uses.
export function patternToRegExp(pattern) {
  const m = String(pattern).trim().match(/^(\*|https?|file):\/\/([^/]*)(\/.*)?$/);
  if (!m) return null;
  const [, scheme, host, path = '/*'] = m;
  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const schemeRe = scheme === '*' ? 'https?' : esc(scheme);
  let hostRe = host === '*' ? '[^/]+' : host.startsWith('*.') ? `([^/]+\\.)?${esc(host.slice(2))}` : esc(host);
  const pathRe = path.split('*').map(esc).join('.*');
  return new RegExp(`^${schemeRe}://${hostRe}${pathRe}$`);
}

export function siteMatches(site, url) {
  if (!url || site.enabled === false) return false;
  return (site.match ?? []).some((p) => patternToRegExp(p)?.test(url));
}

export function originPattern(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return `${u.protocol}//${u.host}/*`;
  } catch { return null; }
}

export const isChessCom = (url) => /^https:\/\/(www\.)?chess\.com\//.test(url ?? '');

import { getPrefs, setPrefs, getSites, saveSites, newId, originPattern, patternToRegExp } from '../shared/settings.js';
import { GLOBAL_COMMANDS, CHESS_COMMANDS, EVERYDAY_COMMANDS } from '../shared/commands.js';
import { matchPhrase, compile } from '../shared/phrases.js';
import { TEMPLATES } from '../shared/templates.js';
import { nanoStatus, draftCode } from './nano.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

let prefs;
let sites = [];

// ---------- Small helpers ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

const icon = {
  chevron: () => svg('<path d="M6 9l6 6 6-6"/>'),
  close: () => svg('<path d="M6 6l12 12M18 6L6 18"/>', 16),
  back: () => svg('<path d="M15 18l-6-6 6-6"/>', 18),
  target: () => svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>', 18),
  play: () => svg('<path d="M7 5l12 7-12 7z"/>', 16),
};
function svg(paths, size = 20) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = paths;
  return s;
}

// replaceChildren, minus the false/null left by `cond && node`.
const put = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false && k !== 0));

let savedTimer;
function flashSaved(text = 'Saved') {
  const el = $('#saved');
  el.textContent = text;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { el.textContent = ''; }, 2200);
}

let saveTimer;
let lastOwnWrite = 0;
async function writeSites() {
  lastOwnWrite = Date.now();
  await saveSites(sites);
}
function persistSites() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => { await writeSites(); flashSaved(); }, 250);
}

function confirmDialog({ title, body, ok = 'OK', danger = true }) {
  const dlg = $('#tpl-dialog').content.firstElementChild.cloneNode(true);
  $('h2', dlg).textContent = title;
  $('p', dlg).textContent = body;
  const okBtn = $('button[value="ok"]', dlg);
  okBtn.textContent = ok;
  okBtn.className = danger ? 'btn-danger' : 'btn-primary';
  document.body.append(dlg);
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => { resolve(dlg.returnValue === 'ok'); dlg.remove(); }, { once: true });
  });
}

const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const patchFor = (path, value) => path.split('.').reduceRight((acc, k) => ({ [k]: acc }), value);
const favicon = (url) => `/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`;
const patternUrl = (p) => String(p).replace(/\*\.?/g, '').replace(/\/$/, '/');
const hostOf = (p) => { try { return new URL(patternUrl(p)).hostname.replace(/^www\./, ''); } catch { return p; } };

// ---------- Preferences ----------

function bindPrefs() {
  for (const sw of $$('.switch[data-pref]')) {
    const path = sw.dataset.pref;
    sw.setAttribute('aria-checked', String(!!getPath(prefs, path)));
    sw.addEventListener('click', async () => {
      const next = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(next));
      prefs = await setPrefs(patchFor(path, next));
      flashSaved();
    });
  }
  for (const seg of $$('.seg[data-pref]')) {
    const path = seg.dataset.pref;
    const sync = () => $$('button', seg).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === getPath(prefs, path))));
    sync();
    $$('button', seg).forEach((b) => b.addEventListener('click', async () => {
      prefs = await setPrefs(patchFor(path, b.dataset.value));
      sync();
      flashSaved();
      if (path === 'engine') refreshLocal();
    }));
    // Arrow keys move between options, like native radios.
    seg.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const btns = $$('button', seg);
      const i = btns.indexOf(document.activeElement);
      const next = btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length];
      next.focus();
      next.click();
    });
  }
  const lang = $('#lang');
  lang.value = prefs.lang;
  lang.addEventListener('change', async () => { prefs = await setPrefs({ lang: lang.value }); flashSaved(); refreshLocal(); });

  const everywhere = $('#everywhere');
  const ALL = { origins: ['https://*/*', 'http://*/*'] };
  const syncEverywhere = async () => everywhere.setAttribute('aria-checked', String(prefs.everydayEverywhere && (await chrome.permissions.contains(ALL))));
  syncEverywhere();
  everywhere.addEventListener('click', async () => {
    const on = everywhere.getAttribute('aria-checked') !== 'true';
    if (on && !(await chrome.permissions.request(ALL).catch(() => false))) return;
    prefs = await setPrefs({ everydayEverywhere: on });
    syncEverywhere();
    flashSaved();
  });
}

async function refreshLocal() {
  const row = $('#localRow');
  if (!SR?.available) { row.hidden = true; return; }
  row.hidden = prefs.engine === 'cloud';
  const note = $('#localNote');
  const btn = $('#localInstall');
  const state = await SR.available({ langs: [prefs.lang], processLocally: true }).catch(() => 'unavailable');
  btn.hidden = state !== 'downloadable';
  note.textContent = {
    available: 'Downloaded. Speech stays on this computer.',
    downloadable: 'Not downloaded yet. It’s free and makes recognition private and faster.',
    downloading: 'Downloading…',
    unavailable: 'Chrome doesn’t offer on-device speech for this language on this computer yet.',
  }[state] ?? '';
}

$('#localInstall')?.addEventListener('click', async (e) => {
  e.currentTarget.disabled = true;
  $('#localNote').textContent = 'Downloading…';
  try { await SR.install({ langs: [prefs.lang], processLocally: true }); } catch { /* status below says what happened */ }
  e.currentTarget.disabled = false;
  refreshLocal();
});

// ---------- Mic test ----------

const micTest = (() => {
  let rec, stream, ctx, raf;
  async function start(btn) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      $('#micHeard').textContent = 'Chrome blocked the microphone. Click the icon at the right of the address bar to allow it.';
      return;
    }
    btn.textContent = 'Stop the test';
    ctx = new AudioContext();
    const an = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    const tick = () => {
      an.getFloatTimeDomainData(buf);
      const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
      $('#micLevel').style.transform = `scaleX(${Math.min(1, rms * 9)})`;
      raf = requestAnimationFrame(tick);
    };
    tick();
    if (!SR) { $('#micHeard').textContent = 'The microphone works, but this browser has no speech recognition.'; return; }
    rec = new SR();
    rec.lang = prefs.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    rec.onresult = (e) => {
      const res = e.results[e.results.length - 1];
      const alts = [...res].map((a) => a.transcript.trim()).filter(Boolean);
      const out = $('#micHeard');
      out.replaceChildren('Heard ', h('b', { text: `“${alts[0] ?? ''}”` }), alts.length > 1 && res.isFinal ? `, or maybe ${alts.slice(1).map((a) => `“${a}”`).join(', ')}` : '');
    };
    rec.onerror = (e) => { if (e.error !== 'no-speech') $('#micHeard').textContent = `Speech recognition stopped: ${e.error}.`; };
    rec.start();
  }
  function stop(btn) {
    rec?.abort();
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.close();
    cancelAnimationFrame(raf);
    rec = stream = ctx = null;
    $('#micLevel').style.transform = 'scaleX(0)';
    btn.textContent = 'Start the test';
  }
  return { toggle: (btn) => (stream ? stop(btn) : start(btn)) };
})();
$('#micTest').addEventListener('click', (e) => micTest.toggle(e.currentTarget));

// ---------- Built-in command reference ----------

function renderReference() {
  const groups = [
    ['Chess moves', [
      ['e2 to e4', 'Any move as two squares. “e two e four” and “e2e4” work too.'],
      ['e7 to e8 queen', 'Promotion. Leave the piece out and Hearsay asks.'],
      ['castle short / castle long', 'Also “castle kingside”, “O-O”.'],
      ['knight f3', 'Only when piece names are on.'],
      ['one, two, three…', 'Pick an option when Hearsay asks “Which one?”.'],
    ]],
    ['Chess buttons', CHESS_COMMANDS.map((c) => [c.hint, c.phrases.filter((p) => p !== c.hint).slice(0, 4).join(', ')])],
    ['Everyday', EVERYDAY_COMMANDS.map((c) => [c.hint.replace('Play', '…'), c.phrases.filter((p) => p !== c.hint).slice(0, 4).join(', ').replace(/\{text\}/g, '…')])],
    ['Hearsay itself', GLOBAL_COMMANDS.map((c) => [c.hint, c.phrases.filter((p) => p !== c.hint).slice(0, 4).join(', ')])],
  ];
  $('#commandList').replaceChildren(...groups.map(([name, rows]) => h('div', { class: 'ref-group' },
    h('h2', { text: name }),
    h('dl', {}, rows.flatMap(([say, also]) => [h('dt', { text: `“${say}”` }), h('dd', { text: also || '' })])),
  )));
}

// ---------- Setup checklist ----------

async function renderSetup() {
  const list = $('#setupList');
  const mic = await navigator.permissions.query({ name: 'microphone' }).then((s) => s.state).catch(() => 'prompt');
  const cmds = await chrome.commands.getAll();
  const toggleKey = cmds.find((c) => c.name === 'toggle-listening')?.shortcut || 'Not set';
  const panelKey = cmds.find((c) => c.name === '_execute_action')?.shortcut || 'Not set';
  const us = await chrome.runtime.sendMessage({ type: 'hearsay:userscripts' }).catch(() => ({}));
  const nano = await nanoStatus();
  const local = SR?.available ? await SR.available({ langs: [prefs.lang], processLocally: true }).catch(() => 'unavailable') : 'unsupported';

  const row = (title, note, pill, ...actions) => h('div', { class: 'row' },
    h('span', { class: 'row-text' }, h('strong', { text: title }), note && h('small', { text: note })),
    h('span', { class: 'actions' }, pill && h('span', { class: `status-pill ${pill[0]}`, text: pill[1] }), ...actions));
  const button = (text, onclick, cls = 'btn-secondary') => h('button', { type: 'button', class: cls, text, onclick });

  list.replaceChildren(
    row('Microphone', mic === 'granted' ? 'Allowed for Hearsay.' : mic === 'denied' ? 'Blocked. Click the icon at the right of the address bar to allow it.' : 'Chrome asks once.',
      mic === 'granted' ? ['ok', 'Allowed'] : ['todo', mic === 'denied' ? 'Blocked' : 'Not yet'],
      mic !== 'granted' && button('Allow', async () => { try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); } catch { /* shown below */ } renderSetup(); }, 'btn-primary')),
    row('Side panel', 'Hearsay listens from a panel beside the page. Pin the toolbar icon to find it easily.', null,
      button('Open the panel', async () => { const w = await chrome.windows.getCurrent(); chrome.sidePanel.open({ windowId: w.id }); })),
    row('Keyboard shortcuts', `Start or pause: ${toggleKey}. Open the panel: ${panelKey}. A foot pedal or switch mapped to these keys works too.`, null,
      button('Change', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }))),
    row('JavaScript commands', us.available ? 'On. Commands with a “Run JavaScript” step will work.' : 'Off. To use “Run JavaScript” steps, open Hearsay’s details and turn on “Allow User Scripts”.',
      us.available ? ['ok', 'On'] : ['off', 'Off'],
      !us.available && button('Open details', () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }))),
    row('On-device speech', { available: 'Ready. Speech stays on this computer.', downloadable: 'Available to download in Listening.', downloading: 'Downloading.', unavailable: 'Not offered for your language on this computer.', unsupported: 'This version of Chrome doesn’t have it yet.' }[local] ?? '',
      local === 'available' ? ['ok', 'Ready'] : ['off', local === 'downloadable' ? 'Optional' : 'Not available']),
    row('Gemini Nano', { available: 'Ready to draft JavaScript for your commands.', downloadable: 'Downloads the first time you draft code (about 2 GB, once).', downloading: 'Downloading.', unavailable: 'This computer doesn’t meet Chrome’s requirements for it. Everything else works.', missing: 'This version of Chrome doesn’t have it. Everything else works.' }[nano] ?? '',
      nano === 'available' ? ['ok', 'Ready'] : ['off', nano === 'downloadable' ? 'Optional' : 'Not available']),
  );
}

// ---------- Sites: list ----------

const sitesEl = $('#sites');

function route() {
  const m = location.hash.match(/^#site=(\w+)/);
  const site = m && sites.find((s) => s.id === m[1]);
  if (site) renderEditor(site);
  else renderSiteList();
  highlightNav();
}

function renderSiteList() {
  const input = h('input', { class: 'text-input', type: 'url', placeholder: 'A web address, like youtube.com', 'aria-label': 'Web address of the site to add', autocomplete: 'off' });
  const error = h('p', { class: 'warn-line', hidden: true, role: 'alert' });
  const add = async (e) => {
    e?.preventDefault();
    let raw = input.value.trim();
    if (!raw) { input.focus(); return; }
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    const pattern = originPattern(raw);
    if (!pattern) { error.hidden = false; error.textContent = 'That doesn’t look like a web address. Try something like youtube.com.'; return; }
    const site = await createSite({ name: hostOf(pattern), match: [pattern], commands: [] });
    if (site) location.hash = `site=${site.id}`;
  };

  const cards = sites.map((s) => {
    const sw = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(s.enabled !== false), 'aria-label': `${s.name} commands on` });
    sw.addEventListener('click', () => { s.enabled = sw.getAttribute('aria-checked') !== 'true'; sw.setAttribute('aria-checked', String(s.enabled)); persistSites(); });
    const n = (s.commands ?? []).length;
    return h('div', { class: 'site-card' },
      h('img', { src: favicon(patternUrl(s.match?.[0] ?? '')), alt: '' }),
      h('div', { class: 'meta' }, h('strong', { text: s.name }), h('small', { text: `${n} command${n === 1 ? '' : 's'} · ${(s.match ?? []).map(hostOf).join(', ')}` })),
      sw,
      h('a', { class: 'btn-secondary open', href: `#site=${s.id}`, text: 'Edit' }));
  });

  const unused = TEMPLATES.filter((t) => !sites.some((s) => s.template === t.key));
  put(sitesEl, 
    h('div', { class: 'sites-head' }, h('div', {}, h('h1', { id: 'sites-h', text: 'Sites' }),
      h('p', { class: 'lead', text: 'Give any website its own voice commands. Say the phrase on that site and Hearsay clicks, types, presses keys or runs your JavaScript.' }))),
    h('form', { class: 'add-site', onsubmit: add }, input, h('button', { class: 'btn-primary', type: 'submit', text: 'Add site' })),
    error,
    h('div', { class: 'site-list' },
      h('div', { class: 'site-card' },
        h('img', { src: favicon('https://www.chess.com/'), alt: '' }),
        h('div', { class: 'meta' }, h('strong', { text: 'chess.com' }), h('small', { text: 'Built in: moves, puzzles, lessons and game buttons. Add your own commands too.' })),
        h('span', { class: 'badge', text: 'Built in' }),
        h('button', { type: 'button', class: 'btn-secondary open', text: 'Add commands', onclick: async () => {
          const existing = sites.find((s) => (s.match ?? []).includes('https://www.chess.com/*'));
          const site = existing ?? (await createSite({ name: 'chess.com', match: ['https://www.chess.com/*'], commands: [] }));
          if (site) location.hash = `site=${site.id}`;
        } })),
      ...cards),
    !sites.length && h('div', { class: 'empty' }, h('p', { text: 'No sites yet. Add one above, or start from a template and change it to suit you.' })),
    unused.length && h('h2', { text: 'Start from a template' }),
    unused.length && h('div', { class: 'templates' }, unused.map((t) => h('button', { type: 'button', class: 'template', onclick: () => addTemplate(t) },
      h('strong', { text: t.name }), h('span', { text: t.blurb }), h('span', { text: `${t.commands.length} commands` })))),
    h('h2', { text: 'Share and back up' }),
    h('p', { class: 'lead', text: 'Packs are plain JSON files. Share them on GitHub, or keep a backup.' }),
    h('div', { class: 'tools' },
      h('button', { type: 'button', class: 'btn-secondary', text: 'Import a pack', onclick: importPack }),
      h('button', { type: 'button', class: 'btn-secondary', text: 'Export all sites', disabled: !sites.length, onclick: () => exportPack(sites, 'hearsay-sites.json') })),
  );
}

async function createSite({ name, match, commands, template }) {
  const granted = await chrome.permissions.request({ origins: match }).catch(() => false);
  if (!granted) {
    flashSaved('Permission not given');
    return null;
  }
  const site = { id: newId(), name, match, enabled: true, commands: commands.map((c) => ({ id: newId(), enabled: true, reviewed: true, ...c })) };
  if (template) site.template = template;
  sites.push(site);
  await writeSites();
  flashSaved('Site added');
  return site;
}

async function addTemplate(t) {
  const site = await createSite({ name: t.name, match: t.match, commands: structuredClone(t.commands), template: t.key });
  if (site) location.hash = `site=${site.id}`;
}

function exportPack(list, filename) {
  const clean = list.map(({ id, template, ...s }) => ({ ...s, commands: (s.commands ?? []).map(({ id: _id, reviewed, ...c }) => c) }));
  const blob = new Blob([JSON.stringify({ hearsay: 1, sites: clean }, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// A phrase that is only blanks would match everything you say.
const hasWords = (p) => compile(p).some((t) => t.lit);

function validPack(data) {
  if (!data || data.hearsay !== 1 || !Array.isArray(data.sites)) return null;
  const stepTypes = new Set(['click', 'keys', 'type', 'url', 'scroll', 'wait', 'js']);
  const out = [];
  for (const s of data.sites) {
    // A pack names specific sites. "Every site" or "every .com" patterns are refused.
    const specific = (p) => { const host = p.match(/^https?:\/\/([^/]+)/)?.[1] ?? ''; const bare = host.replace(/^\*\./, ''); return !bare.includes('*') && bare.split('.').length >= 2; };
    const match = (Array.isArray(s?.match) ? s.match : []).filter((p) => typeof p === 'string' && /^https?:\/\//.test(p) && patternToRegExp(p) && specific(p));
    if (!match.length) continue;
    const commands = (Array.isArray(s.commands) ? s.commands : []).map((c) => ({
      name: typeof c?.name === 'string' ? c.name.slice(0, 80) : '',
      phrases: (Array.isArray(c?.phrases) ? c.phrases : []).filter((p) => typeof p === 'string' && hasWords(p)).map((p) => p.slice(0, 120)).slice(0, 20),
      steps: (Array.isArray(c?.steps) ? c.steps : []).filter((st) => stepTypes.has(st?.type)).slice(0, 20),
    })).filter((c) => c.phrases.length && c.steps.length);
    out.push({ name: typeof s.name === 'string' ? s.name.slice(0, 60) : hostOf(match[0]), match, commands });
  }
  return out.length ? out : null;
}

async function importPack() {
  const file = await new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'application/json,.json' });
    input.addEventListener('change', () => resolve(input.files[0] ?? null));
    input.click();
  });
  if (!file) return;
  let pack;
  try { pack = validPack(JSON.parse(await file.text())); } catch { pack = null; }
  if (!pack) { await confirmDialog({ title: 'That file isn’t a Hearsay pack', body: 'Packs are JSON files exported from Hearsay.', ok: 'OK', danger: false }); return; }
  const cmdCount = pack.reduce((n, s) => n + s.commands.length, 0);
  const jsCount = pack.reduce((n, s) => n + s.commands.filter((c) => c.steps.some((st) => st.type === 'js')).length, 0);
  const ok = await confirmDialog({
    title: `Import ${pack.length} site${pack.length === 1 ? '' : 's'}?`,
    body: `${cmdCount} command${cmdCount === 1 ? '' : 's'} for ${pack.map((s) => s.name).join(', ')}${jsCount ? `, ${jsCount} of them running JavaScript` : ''}. They arrive switched off, so you can read each one before turning it on. Chrome will ask to allow Hearsay on these sites.`,
    ok: 'Import',
    danger: false,
  });
  if (!ok) return;
  const origins = [...new Set(pack.flatMap((s) => s.match))];
  if (!(await chrome.permissions.request({ origins }).catch(() => false))) { flashSaved('Permission not given'); return; }
  for (const s of pack) {
    sites.push({
      id: newId(), name: s.name, match: s.match, enabled: true,
      commands: s.commands.map((c) => ({ ...c, id: newId(), enabled: false, reviewed: false })),
    });
  }
  await writeSites();
  flashSaved('Imported');
  renderSiteList();
}

// ---------- Sites: editor ----------

const STEP_TYPES = [
  ['click', 'Click something'],
  ['keys', 'Press keys'],
  ['type', 'Type text'],
  ['url', 'Open an address'],
  ['scroll', 'Scroll'],
  ['wait', 'Wait'],
  ['js', 'Run JavaScript'],
];

let pendingPick = null;
let userScriptsOn = false;
let nanoState = 'missing';

function stepSummary(st) {
  switch (st.type) {
    case 'click': return `click “${st.label || st.text || 'something'}”`;
    case 'keys': return `press ${st.keys || 'keys'}`;
    case 'type': return `type “${st.text || ''}”${st.submit ? ' and press Enter' : ''}`;
    case 'url': return `open ${st.url ? (() => { try { return new URL(st.url.replace(/\{\w+\}/g, 'x')).hostname; } catch { return st.url; } })() : 'an address'}`;
    case 'scroll': return `scroll ${st.direction || 'down'}`;
    case 'wait': return `wait ${(Number(st.ms) || 500) / 1000}s`;
    case 'js': return 'run JavaScript';
    default: return st.type;
  }
}

function blanksIn(phrases) {
  return [...new Set((phrases ?? []).flatMap((p) => compile(p).filter((t) => t.slot).map((t) => t.slot)))];
}

async function renderEditor(site) {
  userScriptsOn = (await chrome.runtime.sendMessage({ type: 'hearsay:userscripts' }).catch(() => ({})))?.available;
  nanoState = await nanoStatus();
  const granted = await chrome.permissions.contains({ origins: site.match }).catch(() => false);

  const name = h('input', { class: 'name', value: site.name, 'aria-label': 'Site name', maxlength: 60 });
  name.addEventListener('input', () => { site.name = name.value.trim() || hostOf(site.match[0]); persistSites(); });
  const on = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(site.enabled !== false), 'aria-label': 'Commands for this site are on' });
  on.addEventListener('click', () => { site.enabled = on.getAttribute('aria-checked') !== 'true'; on.setAttribute('aria-checked', String(site.enabled)); persistSites(); });

  const matchInput = h('input', { class: 'text-input', value: site.match.join(', '), 'aria-describedby': 'match-help' });
  matchInput.addEventListener('change', async () => {
    const list = matchInput.value.split(/[,\s]+/).map((p) => p.trim()).filter(Boolean).map((p) => (/^https?:\/\//.test(p) ? p : `https://${p}`)).map((p) => (p.includes('/', 8) ? p : `${p}/*`)).filter((p) => patternToRegExp(p));
    if (!list.length) { matchInput.value = site.match.join(', '); return; }
    if (!(await chrome.permissions.request({ origins: list }).catch(() => false))) { matchInput.value = site.match.join(', '); flashSaved('Permission not given'); return; }
    site.match = list;
    matchInput.value = list.join(', ');
    persistSites();
  });

  const tester = h('input', { class: 'text-input', placeholder: 'Type what you’d say, like “search for cats”', 'aria-label': 'Check which command a phrase runs' });
  const testerOut = h('p', { class: 'result', 'aria-live': 'polite' });
  tester.addEventListener('input', () => {
    const said = tester.value.trim();
    if (!said) { testerOut.textContent = ''; return; }
    let best = null;
    for (const c of site.commands) {
      const m = matchPhrase(said, c.phrases);
      if (m && m.score >= 0.75 && (!best || m.score > best.m.score)) best = { c, m };
    }
    testerOut.className = `result ${best ? 'ok' : 'bad'}`;
    testerOut.textContent = best
      ? `Runs “${best.c.name || best.c.phrases[0]}”${Object.keys(best.m.slots).length ? ` with ${Object.entries(best.m.slots).map(([k, v]) => `${k} = “${v}”`).join(', ')}` : ''}.`
      : 'No command matches that yet.';
  });

  const list = h('div', { class: 'commands' }, site.commands.map((c) => commandCard(site, c)));
  const addCommand = () => {
    const c = { id: newId(), name: '', phrases: [], steps: [{ type: 'click' }], enabled: true, reviewed: true };
    site.commands.push(c);
    persistSites();
    const card = commandCard(site, c, true);
    list.append(card);
    $('.phrases input', card)?.focus();
  };

  put(sitesEl, 
    h('button', { type: 'button', class: 'crumb', onclick: () => { location.hash = 'sites'; } }, icon.back(), 'All sites'),
    h('div', { class: 'editor-head' }, h('img', { class: 'fav', src: favicon(patternUrl(site.match[0])), alt: '' }), name, on),
    h('div', { class: 'site-meta' },
      h('label', { class: 'field' }, h('span', { text: 'Works on' }), matchInput,
        h('small', { id: 'match-help', text: 'Addresses this site’s commands apply to. Use * as a wildcard: https://*.example.com/*' })),
      !granted && h('div', { class: 'perm-warning' }, 'Hearsay isn’t allowed on this site yet, so its commands can’t run.',
        h('button', { type: 'button', class: 'btn-primary', text: 'Allow', onclick: async () => { if (await chrome.permissions.request({ origins: site.match }).catch(() => false)) renderEditor(site); } }))),
    h('h2', { text: 'Commands' }),
    h('p', { class: 'lead', text: 'Each command is a few ways of saying something, and the steps to do when you say any of them.' }),
    h('div', { class: 'site-meta' }, h('label', { class: 'field' }, h('span', { text: 'Check a phrase' }),
      h('div', { class: 'inline' }, tester, h('button', { type: 'button', class: 'btn-secondary', text: 'Run it in the panel', title: 'Runs on the active tab of the window with the Hearsay panel open', onclick: () => {
        if (!tester.value.trim()) { tester.focus(); return; }
        chrome.windows.getCurrent().then((w) => chrome.runtime.sendMessage({ type: 'hearsay:simulate', text: tester.value.trim(), windowId: w.id }))
          .then((res) => { if (!res?.ok) throw new Error('no panel'); })
          .catch(() => { testerOut.className = 'result bad'; testerOut.textContent = 'Open the Hearsay panel in this window first.'; });
      } }))), testerOut),
    list,
    h('div', { class: 'tools' }, h('button', { type: 'button', class: 'btn-primary', text: 'Add a command', onclick: addCommand })),
    h('div', { class: 'danger-zone' },
      h('button', { type: 'button', class: 'btn-secondary', text: 'Export this site', onclick: () => exportPack([site], `hearsay-${hostOf(site.match[0])}.json`) }),
      h('button', { type: 'button', class: 'btn-quiet', text: 'Delete this site', onclick: async () => {
        if (!(await confirmDialog({ title: `Delete ${site.name}?`, body: `Its ${site.commands.length} command${site.commands.length === 1 ? '' : 's'} will be gone. Export it first if you might want them back.`, ok: 'Delete' }))) return;
        sites = sites.filter((s) => s !== site);
        await writeSites();
        flashSaved('Deleted');
        location.hash = 'sites';
      } })),
  );
  if (!site.commands.length) addCommand();
}

function commandCard(site, cmd, open = false) {
  const card = h('details', { class: 'command', open: open || undefined });
  const title = h('strong');
  const sub = h('small');
  const badges = h('span', { class: 'inline' });
  const refreshSummary = () => {
    title.textContent = cmd.name || (cmd.phrases[0] ? `“${cmd.phrases[0]}”` : 'New command');
    sub.textContent = cmd.steps.length ? cmd.steps.map(stepSummary).join(', then ') : 'No steps yet';
    const needsReview = cmd.reviewed === false;
    put(badges,
      needsReview ? h('span', { class: 'badge warn', text: 'Not reviewed' }) : null,
      cmd.enabled === false ? h('span', { class: 'badge', text: 'Off' }) : null,
    );
  };
  const changed = () => { refreshSummary(); persistSites(); };
  refreshSummary();

  card.append(h('summary', {}, h('span', { class: 'say' }, title, sub), badges, h('span', { class: 'chev' }, icon.chevron())));

  // Name
  const nameInput = h('input', { class: 'text-input', value: cmd.name ?? '', placeholder: 'Optional, like “Subscribe”' });
  nameInput.addEventListener('input', () => { cmd.name = nameInput.value.trim(); changed(); });

  // Phrases
  const phrasesBox = h('div', { class: 'phrases' });
  const phraseInput = h('input', { placeholder: cmd.phrases.length ? 'Another way to say it' : 'What you’ll say, like “search for {text}”', 'aria-label': 'Add a phrase, then press Enter' });
  const renderPhrases = () => {
    phrasesBox.replaceChildren(...cmd.phrases.map((p, i) => {
      const chip = h('span', { class: 'phrase' });
      for (const part of p.split(/(\{\w+\})/)) chip.append(/^\{\w+\}$/.test(part) ? h('span', { class: 'blank', text: part }) : part);
      chip.append(h('button', { type: 'button', 'aria-label': `Remove “${p}”`, onclick: () => { cmd.phrases.splice(i, 1); renderPhrases(); changed(); } }, icon.close()));
      return chip;
    }), phraseInput);
    renderTry();
  };
  const commit = () => {
    const v = phraseInput.value.trim().replace(/\s+/g, ' ');
    if (!v) return false;
    if (!hasWords(v)) {
      phraseInput.setCustomValidity('Add at least one word besides the blank, or it would catch everything you say.');
      phraseInput.reportValidity();
      return false;
    }
    phraseInput.setCustomValidity('');
    if (!cmd.phrases.includes(v)) cmd.phrases.push(v);
    phraseInput.value = '';
    renderPhrases();
    changed();
    phraseInput.focus();
    return true;
  };
  phraseInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { if (commit()) e.preventDefault(); else if (e.key === 'Enter') e.preventDefault(); }
    if (e.key === 'Backspace' && !phraseInput.value && cmd.phrases.length) { cmd.phrases.pop(); renderPhrases(); changed(); }
  });
  phraseInput.addEventListener('blur', commit);

  // Steps
  const stepsBox = h('div', { class: 'steps' });
  const renderSteps = () => stepsBox.replaceChildren(...cmd.steps.map((st, i) => stepRow(site, cmd, st, i, { changed, rerender: renderSteps })));
  renderSteps();

  // Enabled + try + delete
  const enabled = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(cmd.enabled !== false), 'aria-label': 'Command is on' });
  enabled.addEventListener('click', async () => {
    const next = enabled.getAttribute('aria-checked') !== 'true';
    if (next && cmd.reviewed === false) {
      card.open = true;
      const ok = await confirmDialog({
        title: 'Turn on an imported command?',
        body: `When you say “${cmd.phrases[0]}”, it will ${cmd.steps.map(stepSummary).join(', then ')}. ${cmd.steps.some((s) => s.type === 'js') ? 'Read its JavaScript below first. ' : ''}Only turn it on if you trust where the pack came from.`,
        ok: 'Turn on',
        danger: false,
      });
      if (!ok) return;
      cmd.reviewed = true;
    }
    cmd.enabled = next;
    enabled.setAttribute('aria-checked', String(next));
    changed();
  });
  const tryBox = h('div', { class: 'inline' });
  const result = h('span', { class: 'result', 'aria-live': 'polite' });
  const slotInputs = {};
  function renderTry() {
    const blanks = blanksIn(cmd.phrases);
    tryBox.replaceChildren(...blanks.map((b) => {
      slotInputs[b] ??= h('input', { class: 'text-input', placeholder: `Sample ${b}`, 'aria-label': `Sample value for ${b}`, value: b === 'number' ? '1' : 'hello' });
      return slotInputs[b];
    }));
  }
  renderPhrases();

  const tryIt = async () => {
    result.className = 'result';
    result.textContent = 'Running on the open tab…';
    const slots = Object.fromEntries(Object.entries(slotInputs).map(([k, el]) => [k, el.value]));
    const res = await chrome.runtime.sendMessage({ type: 'hearsay:test-steps', pattern: site.match, steps: cmd.steps, slots }).catch((e) => ({ ok: false, error: e.message }));
    result.className = `result ${res?.ok ? 'ok' : 'bad'}`;
    result.textContent = res?.ok ? 'It worked.'
      : res?.error === 'notab' ? `Open ${hostOf(site.match[0])} in a tab first.`
      : res?.error === 'userScripts' ? 'Turn on “Allow User Scripts” for Hearsay first (see Setup).'
      : `Step ${(res?.step ?? 0) + 1} didn’t work${res?.error && res.error !== 'null' ? `: ${res.error}` : '. Try picking the element again.'}`;
  };

  card.append(h('div', { class: 'command-body' },
    h('label', { class: 'field' }, h('span', { text: 'When I say' }), phrasesBox,
      h('small', { text: 'Add a few ways of saying it. {text} catches any words, {number} catches a number: “search for {text}”, “open result {number}”.' })),
    h('div', { class: 'field' }, h('span', { text: 'Do this' }), stepsBox,
      h('div', {}, h('button', { type: 'button', class: 'btn-secondary', text: 'Add a step', onclick: () => { cmd.steps.push({ type: 'keys' }); renderSteps(); changed(); } }))),
    h('label', { class: 'field' }, h('span', { text: 'Name' }), nameInput),
    h('div', { class: 'command-actions' },
      h('div', { class: 'left' }, tryBox, h('button', { type: 'button', class: 'btn-primary', onclick: tryIt }, icon.play(), 'Try it'), result),
      h('div', { class: 'left' }, h('label', { class: 'check' }, enabled, 'On'),
        h('button', { type: 'button', class: 'btn-quiet', text: 'Delete command', onclick: async () => {
          if (!(await confirmDialog({ title: 'Delete this command?', body: `“${cmd.name || cmd.phrases[0] || 'New command'}” will be removed.`, ok: 'Delete' }))) return;
          site.commands = site.commands.filter((c) => c !== cmd);
          card.remove();
          persistSites();
        } }))),
  ));
  return card;
}

function stepRow(site, cmd, st, index, { changed, rerender }) {
  const type = h('select', { 'aria-label': `Step ${index + 1} kind` }, STEP_TYPES.map(([v, label]) => h('option', { value: v, text: label })));
  type.value = st.type;
  type.addEventListener('change', () => {
    for (const k of Object.keys(st)) delete st[k];
    st.type = type.value;
    if (st.type === 'js') st.world = 'USER_SCRIPT';
    rerender();
    changed();
  });
  const remove = h('button', { type: 'button', class: 'btn-quiet', 'aria-label': `Remove step ${index + 1}`, onclick: () => { cmd.steps.splice(index, 1); rerender(); changed(); } }, icon.close());

  const input = (key, attrs = {}) => {
    const el = h('input', { class: 'text-input', value: st[key] ?? '', ...attrs });
    el.addEventListener('input', () => { st[key] = el.value; changed(); });
    return el;
  };
  const check = (key, label) => {
    const el = h('input', { type: 'checkbox', checked: !!st[key] });
    el.addEventListener('change', () => { st[key] = el.checked; changed(); });
    return h('label', { class: 'check' }, el, label);
  };
  const pickButton = (field) => h('button', { type: 'button', class: 'btn-secondary', onclick: async (e) => {
    pendingPick = { st, field, rerender, changed };
    e.currentTarget.textContent = 'Click it on the page…';
    const res = await chrome.runtime.sendMessage({ type: 'hearsay:pick-start', url: patternUrl(site.match[0]) }).catch((err) => ({ ok: false, error: err.message }));
    if (!res?.ok) { pendingPick = null; e.currentTarget.textContent = 'Couldn’t open the page'; }
  } }, icon.target(), st.selector ? 'Pick again' : 'Pick on the page');

  const body = [];
  if (st.type === 'click') {
    body.push(h('div', { class: 'inline' }, pickButton('click'),
      st.selector ? h('div', { class: 'picked' }, h('strong', { text: st.label || st.text || 'Picked element' }), h('code', { text: st.selector })) : null));
    body.push(h('label', { class: 'field' }, h('span', { text: 'Or match it by its text' }), input('text', { placeholder: 'Button or link text, like Subscribe. {text} works here.' })));
    body.push(h('details', {}, h('summary', { class: 'btn-quiet', text: 'CSS selector' }), h('label', { class: 'field' }, input('selector', { placeholder: '#search-button', 'aria-label': 'CSS selector', spellcheck: 'false' }))));
  }
  if (st.type === 'keys') {
    const cap = h('button', { type: 'button', class: 'btn-secondary keycap', text: st.keys || 'Click, then press the keys', 'aria-label': `Keys: ${st.keys || 'not set'}. Click, then press the keys to record.` });
    cap.addEventListener('click', () => { cap.dataset.listening = 'true'; cap.textContent = 'Press the keys now…'; });
    cap.addEventListener('blur', () => { cap.dataset.listening = 'false'; cap.textContent = st.keys || 'Click, then press the keys'; });
    cap.addEventListener('keydown', (e) => {
      if (cap.dataset.listening !== 'true') return;
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      const parts = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.metaKey && 'Cmd', e.shiftKey && 'Shift'].filter(Boolean);
      const k = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      st.keys = [...parts, k].join('+');
      cap.dataset.listening = 'false';
      cap.textContent = st.keys;
      cap.setAttribute('aria-label', `Keys: ${st.keys}`);
      changed();
    });
    body.push(h('div', { class: 'inline' }, cap, h('small', { text: 'The page gets the keys as if you pressed them.' })));
  }
  if (st.type === 'type') {
    body.push(h('label', { class: 'field' }, h('span', { text: 'Text' }), input('text', { placeholder: '{text} types whatever you said in the blank' })));
    body.push(h('div', { class: 'inline' }, pickButton('type'),
      st.selector ? h('div', { class: 'picked' }, h('strong', { text: st.label || 'Picked field' }), h('code', { text: st.selector })) : h('small', { text: 'Without a pick, Hearsay types into the focused box, or the page’s search box.' })));
    body.push(check('submit', 'Press Enter afterwards'));
  }
  if (st.type === 'url') {
    body.push(h('label', { class: 'field' }, h('span', { text: 'Address' }), input('url', { type: 'url', placeholder: 'https://example.com/search?q={text}' })));
    body.push(check('newTab', 'Open in a new tab'));
  }
  if (st.type === 'scroll') {
    const sel = h('select', {}, [['down', 'Down a screen'], ['up', 'Up a screen'], ['top', 'To the top'], ['bottom', 'To the bottom']].map(([v, t]) => h('option', { value: v, text: t })));
    sel.value = st.direction ?? 'down';
    sel.addEventListener('change', () => { st.direction = sel.value; changed(); });
    body.push(sel);
  }
  if (st.type === 'wait') {
    const secs = h('input', { class: 'text-input', type: 'number', min: '0.1', max: '10', step: '0.1', value: String((Number(st.ms) || 500) / 1000), 'aria-label': 'Seconds to wait' });
    secs.addEventListener('input', () => { st.ms = Math.round(Number(secs.value) * 1000) || 500; changed(); });
    body.push(h('div', { class: 'inline' }, secs, h('span', { text: 'seconds, so the page can catch up' })));
  }
  if (st.type === 'js') body.push(...jsEditor(site, cmd, st, changed));

  return h('div', { class: 'step' }, h('div', { class: 'step-body' }, h('div', { class: 'step-kind' }, type), ...body), remove);
}

function jsEditor(site, cmd, st, changed) {
  const code = h('textarea', { spellcheck: 'false', 'aria-label': 'JavaScript', placeholder: '// slots.text holds what you said in {text}\ndocument.querySelector("button.subscribe")?.click();' });
  code.value = st.code ?? '';
  code.addEventListener('input', () => { st.code = code.value; changed(); });
  code.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.shiftKey) return;
    e.preventDefault();
    code.setRangeText('  ', code.selectionStart, code.selectionEnd, 'end');
    code.dispatchEvent(new Event('input'));
  });
  const world = h('select', { 'aria-label': 'Where the code runs' }, h('option', { value: 'USER_SCRIPT', text: 'Separate from the page (safer)' }), h('option', { value: 'MAIN', text: 'Inside the page, with its own variables' }));
  world.value = st.world ?? 'USER_SCRIPT';
  world.addEventListener('change', () => { st.world = world.value; changed(); });

  const fit = () => { code.style.height = 'auto'; code.style.height = `${Math.min(440, Math.max(150, code.scrollHeight + 4))}px`; };
  code.addEventListener('input', fit);
  requestAnimationFrame(fit);

  const out = [];
  if (!userScriptsOn) out.push(h('p', { class: 'warn-line', text: 'JavaScript steps need “Allow User Scripts” turned on for Hearsay. Setup shows how.' }));
  const codeField = [h('label', { class: 'field' }, h('span', { text: 'Code' }), code), h('div', { class: 'inline' }, world)];

  if (nanoState !== 'missing' && nanoState !== 'unavailable') {
    const desc = h('input', { class: 'text-input', placeholder: 'Describe it: “like the first video in the list”', 'aria-label': 'Describe what the code should do' });
    const status = h('p', { 'aria-live': 'polite' });
    let controller = null;
    const go = h('button', { type: 'button', class: 'btn-primary', text: 'Draft it' });
    go.addEventListener('click', async () => {
      if (controller) { controller.abort(); return; }
      if (!desc.value.trim()) { desc.focus(); return; }
      controller = new AbortController();
      go.textContent = 'Stop';
      status.textContent = 'Reading the page…';
      const page = await chrome.runtime.sendMessage({ type: 'hearsay:snapshot', pattern: site.match }).catch(() => null);
      status.textContent = page ? 'Drafting with Gemini Nano…' : 'Drafting without a page outline (open the site in a tab for better results)…';
      try {
        const text = await draftCode({
          description: desc.value.trim(), phrase: cmd.phrases[0], page, signal: controller.signal,
          onProgress: (p) => { status.textContent = `Downloading Gemini Nano, ${Math.round(p * 100)}%. This happens once.`; },
          onText: (t) => { code.value = t; fit(); },
        });
        code.value = text;
        fit();
        // The draft isn't saved until you accept it.
        status.replaceChildren('Drafted. Read it over first. ',
          h('button', { type: 'button', class: 'btn-primary', text: 'Use this code', onclick: () => { st.code = code.value; changed(); status.textContent = 'Saved. Press Try it to run it on the open tab.'; } }), ' ',
          h('button', { type: 'button', class: 'btn-quiet', text: 'Discard', onclick: () => { code.value = st.code ?? ''; fit(); status.textContent = 'Discarded.'; } }));
      } catch (err) {
        status.textContent = err?.name === 'AbortError' ? 'Stopped.' : 'Gemini Nano couldn’t draft that. Try describing it differently.';
      } finally {
        controller = null;
        go.textContent = 'Draft it';
      }
    });
    out.push(h('div', { class: 'nano' }, h('p', {}, h('strong', { text: 'Let Gemini Nano write it. ' }), 'It runs on this computer, looks at the open page’s buttons, and drafts code you can check before saving.'),
      h('div', { class: 'inline' }, desc, go), status));
  }
  out.push(...codeField);
  return out;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'hearsay:picked' || !pendingPick) return;
  const { st, field, rerender, changed } = pendingPick;
  pendingPick = null;
  if (!msg.cancelled) {
    st.selector = msg.selector;
    st.label = msg.text?.slice(0, 60) || msg.tag;
    if (field === 'click' && !st.text) st.text = '';
    changed();
  }
  rerender();
});

// ---------- Navigation ----------

function highlightNav() {
  const id = location.hash.startsWith('#site=') ? 'sites' : location.hash.slice(1) || 'sites';
  $$('[data-nav]').forEach((a) => a.setAttribute('aria-current', String(a.dataset.nav === id)));
}

const observer = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting && !location.hash.startsWith('#site=')) $$('[data-nav]').forEach((a) => a.setAttribute('aria-current', String(a.dataset.nav === e.target.id)));
}, { rootMargin: '-40% 0px -55% 0px' });

async function init() {
  prefs = await getPrefs();
  sites = await getSites();
  bindPrefs();
  refreshLocal();
  renderReference();
  renderSetup();
  route();
  $$('.panel').forEach((p) => observer.observe(p));
  window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#site=') || location.hash === '#sites') { route(); sitesEl.scrollIntoView({ block: 'start' }); }
    else highlightNav();
  });
  if (location.hash && !location.hash.startsWith('#site=')) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  window.addEventListener('focus', renderSetup);
  // Another page (the panel's "Add commands for this site") changed the list. The open editor keeps
  // its own objects, so only the list view reloads, and never in response to this page's own saves.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !changes.sites || Date.now() - lastOwnWrite < 1500 || location.hash.startsWith('#site=')) return;
    sites = await getSites();
    renderSiteList();
  });
}

init();

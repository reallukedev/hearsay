import { getPrefs, getSites, saveSites, newId, isChessCom, originPattern } from '../shared/settings.js';
import { CHESS_COMMANDS, EVERYDAY_COMMANDS, GLOBAL_COMMANDS } from '../shared/commands.js';
import { Listener, speechSupported, micPermission } from './speech.js';
import { route, commandsFor, canTouch, cancelPending } from './router.js';
import { sounds } from './sounds.js';

const $ = (id) => document.getElementById(id);
const els = { body: document.body, status: $('statusText'), ctx: $('ctx'), ctxIcon: $('ctxIcon'), ctxText: $('ctxText'), hero: $('hero'), orb: $('orb'), title: $('title'), detail: $('detail'), options: $('options'), heroAction: $('heroAction'), lower: $('lower'), toggle: $('toggle'), toggleText: $('toggleText'), toggleKey: $('toggleKey'), settings: $('settings') };

const state = {
  mode: 'starting', // starting | setup | listening | hearing | done | choose | failed | paused | off
  prefs: null,
  sites: [],
  tab: null,
  windowId: null,
  context: null, // what the current tab offers
  pending: null,
  log: [],
  help: false,
  busy: false,
};
let listener = null;
let previewTimer = null;
let currentUtterance = null;

// ---------- Rendering ----------

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// Quoted speech in a detail line gets emphasis.
const richLine = (s) => esc(s).replace(/“([^”]*)”/g, '<strong>“$1”</strong>');

function setMode(mode) {
  state.mode = mode;
  els.body.dataset.state = mode;
  els.body.classList.toggle('help', state.help);
  const words = { starting: 'Starting', setup: 'Set up', listening: 'Listening', hearing: 'Hearing you', done: 'Listening', choose: 'Waiting for you', failed: 'Listening', paused: 'Paused', off: 'Mic off' };
  els.status.textContent = words[mode];
  const live = !['paused', 'off', 'setup', 'starting'].includes(mode);
  els.toggleText.textContent = live ? (state.pending ? 'Cancel' : 'Pause') : mode === 'setup' ? 'Set up the microphone' : 'Resume';
  chrome.runtime.sendMessage({ type: 'hearsay:state', listening: live }).catch(() => {});
}

function hero({ title = '', size = 'big', detail = '', options = null, action = null, animate = true }) {
  els.title.className = `title${size === 'big' ? '' : ` ${size}`}`;
  els.title.textContent = title;
  if (title.includes('→')) els.title.setAttribute('aria-label', title.replace(/→/g, 'to'));
  else els.title.removeAttribute('aria-label');
  els.detail.innerHTML = richLine(detail);
  els.options.hidden = !options?.length;
  els.options.replaceChildren(...(options ?? []).map((o) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opt';
    b.innerHTML = `<b>${o.n}</b><span>${esc(o.label)}</span>`;
    b.setAttribute('aria-label', `Option ${o.n}: ${o.label}`);
    b.addEventListener('click', () => handleFinal([{ transcript: String(o.n), confidence: 1 }]));
    li.append(b);
    return li;
  }));
  els.heroAction.hidden = !action;
  if (action) {
    els.heroAction.textContent = action.label;
    els.heroAction.onclick = action.run;
  }
  if (animate) {
    els.hero.classList.remove('enter');
    void els.hero.offsetWidth;
    els.hero.classList.add('enter');
  }
}

const titleSize = (t) => (t.length <= 9 ? 'big' : 'small');

function chip(label, say = label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = label;
  b.title = `Say “${say}”, or click to run it`;
  b.addEventListener('click', () => handleFinal([{ transcript: say, confidence: 1 }]));
  return b;
}

function heading(text) {
  const h = document.createElement('h2');
  h.textContent = text;
  return h;
}

function chipsFor() {
  const c = state.context;
  const list = [];
  if (c?.kind === 'chess') {
    for (const e of c.examples ?? []) list.push(e);
    list.push('flip board', 'undo');
  }
  if (c?.kind === 'site' || c?.kind === 'chess') {
    for (const cmd of (c.commands ?? []).slice(0, 5)) list.push(cmd.phrases[0]);
  }
  if (c?.everyday && c?.kind !== 'chess') list.push('scroll down');
  list.push('what can I say');
  return [...new Set(list)].slice(0, 8);
}

function sayable(p) {
  return p.replace(/\{number\}/g, '3').replace(/\{(\w+)\}/g, '…');
}

function renderLower() {
  const parts = [];
  const c = state.context;
  const mode = state.mode;
  if (mode === 'choose' || mode === 'setup' || mode === 'starting') { els.lower.replaceChildren(); return; }

  if (state.help) {
    const groups = document.createElement('div');
    groups.className = 'groups';
    const group = (name, phrases) => {
      if (!phrases.length) return;
      const d = document.createElement('div');
      const h = document.createElement('h3');
      h.textContent = name;
      const row = document.createElement('div');
      row.className = 'chips';
      row.append(...phrases.map((p) => chip(sayable(p), p.includes('{') ? sayable(p) : p)));
      d.append(h, row);
      groups.append(d);
    };
    if (c?.kind === 'chess') group('Chess', ['e2 to e4', 'g1 to f3', 'castle short', 'e7 to e8 queen', ...CHESS_COMMANDS.map((x) => x.hint)]);
    group(c?.siteName ? `On ${c.siteName}` : 'Your commands', (c?.commands ?? []).map((x) => x.phrases[0]));
    if (c?.everyday) group('Anywhere on this page', EVERYDAY_COMMANDS.map((x) => x.hint));
    group('Hearsay', GLOBAL_COMMANDS.filter((x) => x.id !== 'yes').map((x) => x.hint));
    parts.push(groups);
  } else if ((mode === 'done' || mode === 'paused' || mode === 'off') && state.log.length) {
    parts.push(heading('Just now'));
    const ul = document.createElement('ul');
    ul.className = 'log';
    for (const item of state.log.slice(0, 4)) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${esc(item.what)}</span><span>${esc(item.detail)}</span>`;
      ul.append(li);
    }
    parts.push(ul);
  } else if (c?.kind === 'unknown' || c?.kind === 'browser') {
    const card = document.createElement('div');
    card.className = 'card';
    if (c.kind === 'browser') {
      card.innerHTML = '<p>Chrome doesn’t let extensions work on its own pages. Switch to a website tab and Hearsay picks it up.</p>';
    } else {
      card.innerHTML = `<p><strong>${esc(c.host)}</strong> has no voice commands yet. Add some: point at buttons to click, keys to press, or describe what you want and Hearsay drafts it.</p>`;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'act';
      b.textContent = `Add commands for ${c.host}`;
      b.addEventListener('click', addThisSite);
      card.append(b);
    }
    parts.push(card);
  } else {
    parts.push(heading('You can say'));
    const row = document.createElement('div');
    row.className = 'chips';
    row.append(...chipsFor().map((p) => chip(sayable(p), p.includes('{') ? 'what can I say' : p)));
    parts.push(row);
  }
  els.lower.replaceChildren(...parts);
}

function idleHero() {
  const c = state.context;
  let title = 'Say a command';
  if (c?.kind === 'chess') title = c.status ?? 'Open a board to play';
  else if (c?.kind === 'unknown') title = 'Listening';
  else if (c?.kind === 'browser') title = 'Listening';
  if (state.help) title = 'Here’s what works here';
  hero({ title, size: 'tiny', animate: false });
}

// Only finished results are announced; live transcripts would flood a screen reader.
function announce(text) {
  $('announce').textContent = '';
  requestAnimationFrame(() => { $('announce').textContent = text.replace(/→/g, 'to'); });
}

function showOutcome(o) {
  if (!o) return;
  announce([o.title, o.detail].filter(Boolean).join('. '));
  if (o.status === 'choose') {
    setMode('choose');
    hero({ title: o.title, size: 'small', detail: o.detail, options: o.options });
    if (state.prefs.sounds) sounds.choose();
  } else if (o.status === 'done') {
    setMode('done');
    const label = o.label ? `${o.label}. ` : '';
    hero({ title: o.title, size: titleSize(o.title), detail: `${label}${o.detail ?? ''}`.trim() });
    remember(o.label ?? 'Done', o.title);
    if (state.prefs.sounds) sounds.done();
  } else if (o.status === 'failed') {
    setMode('failed');
    const action = o.action ? { label: o.action.label, run: () => chrome.tabs.create({ url: chrome.runtime.getURL(`src/options/${o.action.open}`) }) } : null;
    hero({ title: o.title, size: 'small', detail: o.detail, action });
    if (state.prefs.sounds) sounds.failed();
  }
  renderLower();
  speak(o.spoken ?? (o.status === 'choose' ? o.title : o.status === 'failed' ? o.title : null));
}

function remember(what, detail) {
  state.log.unshift({ what, detail });
  state.log.length = Math.min(state.log.length, 12);
}

function speak(text) {
  if (!text || !state.prefs.speakResults || !('speechSynthesis' in globalThis)) return;
  const u = new SpeechSynthesisUtterance(text.replace(/→/g, 'to'));
  u.lang = state.prefs.lang;
  u.rate = 1.1;
  speechSynthesis.cancel();
  currentUtterance = u;
  listener?.muteUntil(performance.now() + 30000);
  // cancel() fires the previous utterance's end, so only the current one may unmute.
  u.onend = u.onerror = () => { if (currentUtterance === u) listener?.muteUntil(performance.now() + 250); };
  speechSynthesis.speak(u);
}

// ---------- Context: what this tab offers ----------

// panel.html?tab=123 binds the panel to one tab, so it can be opened as a normal page while developing.
const pinnedTab = Number(new URLSearchParams(location.search).get('tab')) || null;

async function activeTab() {
  if (pinnedTab) return chrome.tabs.get(pinnedTab).catch(() => null);
  const [tab] = await chrome.tabs.query({ active: true, windowId: state.windowId });
  return tab ?? null;
}

async function refreshContext() {
  const tab = await activeTab();
  state.tab = tab;
  const url = tab?.url ?? '';
  const origin = originPattern(url);
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* not a web page */ }
  const commands = commandsFor(url, state.sites);
  const siteName = commands[0]?.site?.name ?? null;
  const everyday = state.prefs.everyday && (isChessCom(url) || commands.length > 0 || state.prefs.everydayEverywhere) && (await canTouch(url));
  let ctx;
  if (!origin) ctx = { kind: 'browser' };
  else if (isChessCom(url)) {
    const info = tab?.id != null ? await chrome.tabs.sendMessage(tab.id, { type: 'hearsay:context' }).catch(() => null) : null;
    ctx = { kind: 'chess', host, commands, siteName: 'chess.com', everyday, examples: info?.examples ?? [], status: info?.board ? info.status : 'Open a game, puzzle or lesson' };
  } else if (commands.length) ctx = { kind: 'site', host, commands, siteName, everyday };
  else if (everyday) ctx = { kind: 'site', host, commands, siteName: null, everyday };
  else ctx = { kind: 'unknown', host };
  state.context = ctx;

  els.ctx.hidden = false;
  els.ctxText.textContent = ctx.kind === 'browser' ? 'Browser page' : ctx.kind === 'chess' ? 'chess.com · Chess' : siteName ? `${host} · ${siteName}` : host;
  const icon = tab?.favIconUrl && /^https?:/.test(tab.favIconUrl) ? tab.favIconUrl : '';
  els.ctxIcon.hidden = !icon;
  if (icon) els.ctxIcon.src = icon;

  if (state.mode === 'listening') idleHero();
  if (!['choose', 'hearing'].includes(state.mode)) renderLower();
}

async function addThisSite() {
  const url = state.tab?.url;
  const origin = originPattern(url);
  if (!origin) return;
  const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
  if (!granted) {
    showOutcome({ status: 'failed', title: 'Permission not given', detail: 'Hearsay needs to be allowed on this site to run commands there.' });
    return;
  }
  const host = new URL(url).hostname.replace(/^www\./, '');
  const sites = await getSites();
  let site = sites.find((s) => (s.match ?? []).includes(origin));
  if (!site) {
    site = { id: newId(), name: host, match: [origin], enabled: true, commands: [] };
    sites.push(site);
    await saveSites(sites);
  }
  chrome.tabs.create({ url: chrome.runtime.getURL(`src/options/options.html#site=${site.id}`) });
}

// ---------- Listening ----------

function onInterim(text) {
  if (!text || ['paused', 'off', 'choose'].includes(state.mode)) return;
  state.help = false;
  setMode('hearing');
  hero({ title: text, size: 'small', detail: '', animate: false });
  els.lower.replaceChildren();
  if (state.context?.kind === 'chess' && state.tab?.id != null) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const res = await chrome.tabs.sendMessage(state.tab.id, { type: 'hearsay:preview', text, prefs: state.prefs }).catch(() => null);
      if (res?.title && state.mode === 'hearing') hero({ title: res.title, size: titleSize(res.title), detail: `“${text}”`, animate: false });
    }, 60);
  }
}

async function handleFinal(alternatives) {
  clearTimeout(previewTimer);
  if (state.busy) return;
  // While paused, only "resume" gets through.
  if (state.mode === 'paused') {
    if (alternatives.some((a) => /\b(resume|start listening|wake up|unpause)\b/i.test(a.transcript))) resume();
    return;
  }
  if (state.mode === 'off' || state.mode === 'setup') return;
  state.busy = true;
  state.help = false;
  try {
    state.tab = (await activeTab()) ?? state.tab;
    const res = await route(alternatives, { tab: state.tab, prefs: state.prefs, sites: state.sites, pending: state.pending });
    state.pending = res.pending ?? null;
    if (res.global === 'pause') pause();
    else if (res.global === 'resume') { setMode('listening'); idleHero(); renderLower(); }
    else if (res.global === 'help') { state.help = true; setMode('listening'); idleHero(); renderLower(); }
    else showOutcome(res.outcome);
    if (!state.pending && state.mode !== 'choose') els.toggleText.textContent = ['paused', 'off'].includes(state.mode) ? 'Resume' : 'Pause';
    else if (state.pending) els.toggleText.textContent = 'Cancel';
  } finally {
    state.busy = false;
  }
}

function onLevel(level) {
  els.orb.style.setProperty('--level', level.toFixed(3));
}

function onError(kind) {
  const messages = {
    permission: ['Microphone blocked', 'Hearsay needs the microphone. Allow it once and it stays allowed.'],
    nomic: ['No microphone found', 'Plug one in or check your system sound settings, then press Resume.'],
    network: ['Can’t reach speech recognition', 'Chrome’s speech service didn’t answer. Hearsay keeps trying.'],
    language: ['Language not supported', 'Pick another language in settings.'],
    unsupported: ['Speech recognition unavailable', 'This browser has no speech recognition. Hearsay needs Chrome.'],
    'local-unavailable': ['On-device speech isn’t ready', 'Using Chrome’s online recognition instead. You can download the on-device model in settings.'],
    other: ['Something interrupted listening', 'Hearsay will start again by itself.'],
  };
  const [title, detail] = messages[kind] ?? messages.other;
  if (kind === 'permission') { showSetup(); return; }
  if (kind === 'network' || kind === 'other' || kind === 'local-unavailable') {
    if (state.mode === 'listening') hero({ title, size: 'small', detail });
    return;
  }
  stopListening('off');
  hero({ title, size: 'small', detail });
}

async function startListening() {
  if (!speechSupported()) { onError('unsupported'); return; }
  if ((await micPermission()) !== 'granted') { showSetup(); return; }
  listener?.stop();
  const biasWords = ['castle short', 'castle long', 'queen', 'knight', 'rook', 'bishop', ...CHESS_COMMANDS.map((c) => c.hint)];
  listener = new Listener({ lang: state.prefs.lang, engine: state.prefs.engine, biasWords, onInterim, onFinal: handleFinal, onError, onLevel });
  setMode('listening');
  idleHero();
  renderLower();
  await listener.start();
  if (state.prefs.sounds) sounds.on();
}

function stopListening(mode = 'off') {
  listener?.stop();
  listener = null;
  setMode(mode);
}

function pause() {
  // A soft pause: the recognizer keeps running so you can say "resume" hands-free.
  setMode('paused');
  const key = els.toggleKey.hidden ? '' : ` Press ${els.toggleKey.textContent} or the button to turn it back on.`;
  hero({ title: 'Paused', size: 'tiny', detail: `Only listening for “resume”.${key}`, animate: false });
  onLevel(0);
  renderLower();
  if (state.prefs.sounds) sounds.off();
}

function resume() {
  if (!listener) { startListening(); return; }
  setMode('listening');
  idleHero();
  renderLower();
  if (state.prefs.sounds) sounds.on();
}

function showSetup() {
  stopListening('setup');
  hero({
    title: 'Allow the microphone',
    size: 'small',
    detail: 'Chrome asks once. Hearsay only listens while this panel is open and never records.',
    action: { label: 'Allow microphone', run: () => chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding/welcome.html#mic') }) },
  });
  renderLower();
}

async function toggle() {
  if (state.pending) {
    await cancelPending(state.pending);
    state.pending = null;
    showOutcome({ status: 'done', title: 'Cancelled', detail: 'Nothing was played.' });
    return;
  }
  if (state.mode === 'setup') { showSetup(); chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding/welcome.html#mic') }); return; }
  if (state.mode === 'off' || !listener) { await startListening(); return; }
  if (state.mode === 'paused') resume();
  else pause();
}

// ---------- Wiring ----------

async function init() {
  const win = await chrome.windows.getCurrent();
  state.windowId = win.id;
  // Reconnect whenever the background worker restarts, so the toolbar icon keeps reflecting the mic.
  const connect = () => chrome.runtime.connect({ name: `panel:${win.id}` }).onDisconnect.addListener(() => setTimeout(() => { connect(); setMode(state.mode); }, 1000));
  connect();

  state.prefs = await getPrefs();
  state.sites = await getSites();

  const cmds = await chrome.commands.getAll();
  const shortcut = cmds.find((c) => c.name === 'toggle-listening')?.shortcut;
  els.toggleKey.textContent = shortcut ? shortcut.replace(/[+⇧⌥⌘]/g, (m) => ({ '+': ' ', '⇧': 'Shift ', '⌥': 'Option ', '⌘': 'Cmd ' })[m]).trim() : '';
  els.toggleKey.hidden = !shortcut;

  els.toggle.addEventListener('click', toggle);
  els.settings.addEventListener('click', () => chrome.runtime.openOptionsPage());

  chrome.tabs.onActivated.addListener(({ windowId }) => { if (windowId === state.windowId && !pinnedTab) refreshContext(); });
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (tabId === state.tab?.id && (info.status === 'complete' || info.url)) refreshContext();
  });
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes.sites) state.sites = await getSites();
    if (changes.prefs) {
      const before = state.prefs;
      state.prefs = await getPrefs();
      if (listener && (before.lang !== state.prefs.lang || before.engine !== state.prefs.engine)) startListening();
    }
    refreshContext();
  });
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg?.type === 'hearsay:event' && sender.tab?.id === state.tab?.id) {
      remember(msg.color === 'w' ? 'White played' : 'Black played', msg.short);
      if (state.prefs.chess.announceOpponent) speak(msg.text);
      if (state.mode === 'listening') refreshContext();
      else if (['done', 'paused'].includes(state.mode)) renderLower();
    }
    const fromHearsay = sender.id === chrome.runtime.id && !sender.tab?.url?.startsWith('http');
    if (msg?.type === 'hearsay:toggle' && fromHearsay && msg.windowId === state.windowId) {
      chrome.storage.session.remove('startNow');
      toggle();
      reply({ ok: true });
    }
    // Typed phrases from the settings page's phrase checker run here as if they were spoken.
    if (msg?.type === 'hearsay:simulate' && fromHearsay && (msg.windowId == null || msg.windowId === state.windowId)) {
      handleFinal([{ transcript: String(msg.text ?? ''), confidence: 1 }]);
      reply({ ok: true });
    }
  });
  navigator.permissions?.query({ name: 'microphone' }).then((st) => {
    st.onchange = () => { if (st.state === 'granted' && state.mode === 'setup') startListening(); };
  }).catch(() => {});

  await refreshContext();

  const { startNow } = await chrome.storage.session.get('startNow');
  if (startNow === state.windowId) await chrome.storage.session.remove('startNow');
  if (state.prefs.startOnOpen || startNow === state.windowId) await startListening();
  else {
    setMode('off');
    hero({ title: 'Mic off', size: 'tiny', detail: `Press Resume${els.toggleKey.hidden ? '' : ` or ${els.toggleKey.textContent}`} to start listening.`, animate: false });
    renderLower();
  }
}

init();

// Decides what a finished utterance means on the current tab and makes it happen.
// Order: an open question first, then Hearsay's own words, your site commands, chess.com, everyday commands.
import { GLOBAL_COMMANDS, EVERYDAY_COMMANDS, matchAlternatives, parseChoice } from '../shared/commands.js';
import { matchPhrase, compile } from '../shared/phrases.js';
import { siteMatches, isChessCom, originPattern } from '../shared/settings.js';

const KEY_WORDS = { enter: 'Enter', escape: 'Escape', space: 'space', tab: 'Tab' };

// Phrases that are only blanks would swallow everything said on the site, so they never match.
const hasWords = (p) => compile(p).some((t) => t.lit);

export function commandsFor(url, sites) {
  return sites.filter((s) => siteMatches(s, url)).flatMap((s) => (s.commands ?? [])
    .filter((c) => c.enabled !== false)
    .map((c) => ({ ...c, phrases: (c.phrases ?? []).filter(hasWords), site: s }))
    .filter((c) => c.phrases.length));
}

export async function canTouch(url) {
  const origin = originPattern(url);
  if (!origin) return false;
  if (isChessCom(url)) return true;
  try { return await chrome.permissions.contains({ origins: [origin] }); } catch { return false; }
}

const send = (tabId, msg) => chrome.tabs.sendMessage(tabId, msg).catch(() => null);
const bg = (msg) => chrome.runtime.sendMessage(msg).catch((err) => ({ ok: false, error: String(err?.message ?? err) }));

function stepsFailed(res, cmd) {
  if (res?.error === 'userScripts') {
    return { status: 'failed', title: 'JavaScript is switched off', detail: `“${cmd.name || cmd.phrases[0]}” runs JavaScript, which needs “Allow User Scripts” turned on for Hearsay.`, action: { label: 'Show me how', open: 'options.html#setup' } };
  }
  const which = res?.step != null ? ` (step ${res.step + 1})` : '';
  return { status: 'failed', title: 'That command didn’t work', detail: `“${cmd.name || cmd.phrases[0]}” couldn’t finish${which}. ${res?.error && res.error !== 'null' ? res.error : 'The page may have changed. Try picking the element again in settings.'}` };
}

export async function route(alternatives, { tab, prefs, sites, pending }) {
  const url = tab?.url ?? '';
  const tabId = tab?.id;
  const first = alternatives[0]?.transcript ?? '';

  // 1. Answering a question we asked.
  if (pending) {
    const said = matchAlternatives(GLOBAL_COMMANDS, alternatives.slice(0, 1), 0.8)?.cmd.id;
    let n = null;
    if (pending.confirm) {
      // Yes-or-cancel questions (resign, confirm a move) need a clear yes, not a number homophone.
      if (said === 'yes' || /^(1|one|number one)$/i.test(first.trim())) n = 1;
    } else {
      for (const a of alternatives) { n = parseChoice(a.transcript); if (n) break; }
    }
    if (said === 'cancel') {
      await cancelPending(pending);
      return { outcome: { status: 'done', title: 'Cancelled', detail: 'Nothing was played.' }, pending: null };
    }
    if (n) {
      if (pending.source === 'content') {
        const res = await send(pending.tabId, { type: 'hearsay:choose', index: n, prefs });
        return { outcome: res?.result ?? { status: 'failed', title: 'The page didn’t answer', detail: 'Try reloading the tab.' }, pending: null };
      }
      if (pending.source === 'click') {
        if (n > pending.count) return { outcome: { ...pending.outcome, detail: `There are only ${pending.count}. Say a number from 1 to ${pending.count}.` }, pending };
        const res = await bg({ type: 'hearsay:everyday', tabId: pending.tabId, id: 'clickNumbered', slots: { n } });
        return { outcome: res?.ok ? { status: 'done', title: `Clicked ${pending.labels[n - 1] || n}`, detail: '' } : { status: 'failed', title: 'Couldn’t click that', detail: 'The page changed. Say it again.' }, pending: null };
      }
    }
    // Said something else: drop the question and treat it as a fresh command.
    await cancelPending(pending);
  }

  // 2. Hearsay's own words.
  const global = matchAlternatives(GLOBAL_COMMANDS, alternatives, 0.8);
  if (global && ['pause', 'resume', 'help'].includes(global.cmd.id)) return { global: global.cmd.id, pending: null };
  if (global?.cmd.id === 'cancel') return { outcome: { status: 'done', title: 'Nothing to cancel', detail: '' }, pending: null };

  // 3. Your commands for this site.
  const mine = commandsFor(url, sites);
  if (mine.length && tabId != null) {
    let best = null;
    for (const [rank, a] of alternatives.entries()) {
      for (const cmd of mine) {
        const m = matchPhrase(a.transcript, cmd.phrases);
        const score = m ? m.score - rank * 0.05 : 0;
        if (m && m.score >= 0.75 && (!best || score > best.score)) best = { cmd, m, score, heard: a.transcript };
      }
    }
    if (best) {
      const res = await bg({ type: 'hearsay:run', tabId, steps: best.cmd.steps, slots: best.m.slots });
      if (!res?.ok) return { outcome: stepsFailed(res, best.cmd), pending: null };
      const slotText = Object.values(best.m.slots).join(', ');
      return { outcome: { status: 'done', title: best.cmd.name || best.m.phrase.replace(/\{(\w+)\}/g, slotText), label: 'Done', detail: `Heard “${best.heard}”.`, spoken: 'Done' }, pending: null };
    }
  }

  // 4. chess.com moves and buttons.
  if (isChessCom(url) && tabId != null) {
    const res = await send(tabId, { type: 'hearsay:utterance', alternatives, prefs });
    if (res?.handled) {
      const out = res.result;
      return { outcome: out, pending: out.status === 'choose' ? { source: 'content', confirm: !!out.confirm, tabId } : null };
    }
  }

  // 5. Everyday commands: scrolling, clicking by name, tabs.
  const everydayHere = prefs.everyday && (isChessCom(url) || mine.length || prefs.everydayEverywhere);
  if (everydayHere && tabId != null && (await canTouch(url))) {
    const hit = matchAlternatives(EVERYDAY_COMMANDS, alternatives, 0.8);
    if (hit) return runEverydayHit(hit, tabId);
  }

  if (!url || !originPattern(url)) {
    return { outcome: { status: 'failed', title: 'Can’t work on this page', detail: 'Chrome doesn’t let extensions control its own pages. Switch to a website tab.' }, pending: null };
  }
  return {
    outcome: { status: 'failed', title: 'Didn’t catch that', detail: `Heard “${first}”. Say “what can I say” for ideas.` },
    pending: null,
  };
}

async function runEverydayHit(hit, tabId) {
  const { id } = hit.cmd;
  if (id === 'click') {
    const text = hit.match.slots.text;
    const res = await bg({ type: 'hearsay:everyday', tabId, id: 'click', slots: { text } });
    if (!res?.count) return { outcome: { status: 'failed', title: `No “${text}” here`, detail: 'I couldn’t find a button or link with that name on screen.' }, pending: null };
    if (res.count === 1) {
      const clicked = await bg({ type: 'hearsay:everyday', tabId, id: 'clickNumbered', slots: { n: 1 } });
      if (!clicked?.ok) return { outcome: { status: 'failed', title: `Couldn’t click ${text}`, detail: 'The page changed before Hearsay got there. Say it again.' }, pending: null };
      return { outcome: { status: 'done', title: `Clicked ${text}`, label: 'Done', detail: `Heard “${hit.heard}”.` }, pending: null };
    }
    const outcome = { status: 'choose', title: `Which “${text}”?`, detail: 'They’re numbered on the page. Say the number.', options: res.labels.map((l, i) => ({ n: i + 1, label: l || `Option ${i + 1}` })) };
    return { outcome, pending: { source: 'click', count: res.count, labels: res.labels, outcome, tabId } };
  }
  const slots = {};
  if (id === 'key') {
    const word = Object.keys(KEY_WORDS).find((k) => hit.heard.toLowerCase().includes(k)) ?? 'escape';
    slots.key = KEY_WORDS[word];
  }
  const res = await bg({ type: 'hearsay:everyday', tabId, id, slots });
  if (res && res.ok === false) return { outcome: { status: 'failed', title: 'That didn’t work here', detail: '' }, pending: null };
  const names = { scrollDown: 'Scrolled down', scrollUp: 'Scrolled up', top: 'Top of the page', bottom: 'Bottom of the page', historyBack: 'Went back', historyForward: 'Went forward', reload: 'Reloaded', key: `Pressed ${slots.key}`, nextTab: 'Next tab', prevTab: 'Previous tab' };
  return { outcome: { status: 'done', title: names[id] ?? 'Done', label: 'Done', detail: `Heard “${hit.heard}”.` }, pending: null };
}

export async function cancelPending(pending) {
  const tabId = pending?.tabId;
  if (!pending || tabId == null) return;
  if (pending.source === 'content') await send(tabId, { type: 'hearsay:cancel' });
  if (pending.source === 'click') await bg({ type: 'hearsay:everyday', tabId, id: 'clearNumbers' });
}

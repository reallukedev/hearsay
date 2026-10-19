import { runSteps, runEveryday, userScriptsAvailable } from './actions.js';

// The worker sleeps when idle and forgets everything in memory, so nothing here relies on globals.
const EXT = chrome.runtime.getURL('');

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding/welcome.html') });
});

chrome.runtime.onStartup.addListener(() => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }));

// The panel holds a port open; when the panel closes the port drops and the icon goes quiet.
chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith('panel:')) return;
  port.onDisconnect.addListener(() => { if (!chrome.runtime.lastError) setIcon(false); });
});

function setIcon(listening) {
  const path = listening
    ? { 16: '/icons/icon-16.png', 32: '/icons/icon-32.png' }
    : { 16: '/icons/paused-16.png', 32: '/icons/paused-32.png' };
  chrome.action.setIcon({ path }).catch(() => {});
  chrome.action.setTitle({ title: listening ? 'Hearsay is listening' : 'Open Hearsay' }).catch(() => {});
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-listening') return;
  if (tab?.windowId != null) {
    // Opening needs the key press as its user gesture, so it happens before any await.
    // Opening an already open panel does nothing.
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    chrome.storage.session.set({ startNow: tab.windowId });
  }
  const windowId = tab?.windowId ?? (await chrome.windows.getLastFocused()).id;
  // An open panel toggles and clears startNow; a panel that is just opening reads startNow and starts.
  chrome.runtime.sendMessage({ type: 'hearsay:toggle', windowId }).catch(() => {});
});

async function focusTab(tabId) {
  const tab = await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return tab;
}

async function findOrOpenTab(url) {
  const pattern = (() => { try { const u = new URL(url); return `${u.protocol}//${u.host}/*`; } catch { return null; } })();
  if (pattern) {
    const [existing] = await chrome.tabs.query({ url: pattern });
    if (existing) return focusTab(existing.id);
  }
  const tab = await chrome.tabs.create({ url, active: true });
  await new Promise((resolve) => {
    const listener = (id, info) => { if (id === tab.id && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(listener); resolve(); } };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(resolve, 15000);
  });
  return tab;
}

const handlers = {
  'hearsay:state': async (msg) => { setIcon(!!msg.listening); return { ok: true }; },
  'hearsay:run': async (msg) => runSteps(msg.tabId, msg.steps, msg.slots),
  'hearsay:everyday': async (msg) => runEveryday(msg.tabId, msg.id, msg.slots ?? {}),
  'hearsay:userscripts': async () => ({ available: userScriptsAvailable() }),
  'hearsay:pick-start': async (msg, sender) => {
    await chrome.storage.session.set({ pickRequester: sender.tab?.id ?? null });
    const tab = await findOrOpenTab(msg.url);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/selector.js', 'src/content/picker.js'] });
    return { ok: true, tabId: tab.id };
  },
  'hearsay:picked': async () => {
    const { pickRequester } = await chrome.storage.session.get('pickRequester');
    if (pickRequester != null) {
      // The settings page hears the picker's message itself; this just brings it back to the front.
      await focusTab(pickRequester).catch(() => {});
      await chrome.storage.session.remove('pickRequester');
    }
    return { ok: true };
  },
  'hearsay:snapshot': async (msg) => {
    const [tab] = await chrome.tabs.query({ url: msg.pattern });
    if (!tab) return null;
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/selector.js', 'src/content/snapshot.js'] });
    return results.at(-1)?.result ?? null;
  },
  'hearsay:test-steps': async (msg) => {
    const [tab] = await chrome.tabs.query({ url: msg.pattern });
    if (!tab) return { ok: false, error: 'notab' };
    await focusTab(tab.id);
    return runSteps(tab.id, msg.steps, msg.slots ?? {});
  },
};

// Only Hearsay's own pages may run steps or inject scripts. Content scripts on web pages may not.
const FROM_PAGE_OK = new Set(['hearsay:picked']);

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  const fromExtensionPage = sender.id === chrome.runtime.id && sender.url?.startsWith(EXT);
  if (!fromExtensionPage && !FROM_PAGE_OK.has(msg.type)) return false;
  handler(msg, sender).then(reply, (err) => reply({ ok: false, error: String(err?.message ?? err) }));
  return true;
});

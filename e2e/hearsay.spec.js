import { test, expect } from '@playwright/test';
import { launch } from './harness.js';

const fen = (page) => page.evaluate(() => document.querySelector('wc-chess-board').game.getFEN());

let app, board, panel;

test.beforeAll(async () => {
  app = await launch();
});
test.afterAll(async () => app?.context.close());

async function openBoard(position) {
  board = app.context.pages()[0] ?? (await app.context.newPage());
  const q = position ? `?fen=${encodeURIComponent(position)}` : '';
  await board.goto(`https://www.chess.com/analysis${q}`, { waitUntil: 'domcontentloaded' });
  // chess.com applies ?fen= after the board appears, so wait for the position itself.
  const placement = (position ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR').split(' ')[0];
  await board.waitForFunction((p) => document.querySelector('wc-chess-board')?.game?.getFEN?.().startsWith(p), placement, { timeout: 30_000 });
  panel ??= await app.context.newPage();
  await panel.setViewportSize({ width: 380, height: 720 });
  await panel.goto(app.url('src/sidepanel/panel.html'));
  await panel.evaluate(async () => (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()));
  const tabId = await panel.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.chess.com/*' }))[0].id);
  await panel.goto(app.url(`src/sidepanel/panel.html?tab=${tabId}`));
  await expect(panel.locator('body')).toHaveAttribute('data-state', 'listening');
}

// Typed phrases reach the panel the same way the settings page's phrase checker sends them.
async function say(text) {
  await app.worker.evaluate((t) => chrome.runtime.sendMessage({ type: 'hearsay:simulate', text: t }), text);
}

test('a spoken square-to-square move is played on the board', async () => {
  await openBoard();
  await say('e two to e four');
  await expect(panel.locator('#title')).toHaveText('e2 → e4');
  await expect(panel.locator('body')).toHaveAttribute('data-state', 'done');
  expect(await fen(board)).toMatch(/^rnbqkbnr\/pppppppp\/8\/8\/4P3\/8\/PPPP1PPP\/RNBQKBNR b/);
  await panel.screenshot({ path: 'e2e-results/played.png' });
});

test('an ambiguous castle asks, and the spoken number picks', async () => {
  await openBoard('4k3/1P6/8/8/8/8/8/R3K2R w KQ - 0 1');
  await say('castle');
  await expect(panel.locator('body')).toHaveAttribute('data-state', 'choose');
  await expect(panel.locator('.opt')).toHaveCount(2);
  await say('two');
  await expect(panel.locator('#title')).toHaveText('Castled long');
  expect(await fen(board)).toMatch(/^4k3\/1P6\/8\/8\/8\/8\/8\/2KR3R b/);
});

test('a promotion without a piece asks which piece', async () => {
  await openBoard('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1');
  await say('bee seven to bee eight');
  await expect(panel.locator('#title')).toHaveText('Promote to?');
  await say('one');
  await expect(panel.locator('#title')).toHaveText('b7 → b8 queen');
  expect(await fen(board)).toMatch(/^1Q2k3\//);
});

test('an illegal move is refused with the reason', async () => {
  await openBoard();
  await say('e2 to e5');
  await expect(panel.locator('body')).toHaveAttribute('data-state', 'failed');
  await expect(panel.locator('#detail')).toContainText('can’t go to e5');
  expect(await fen(board)).toMatch(/^rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPPP\/RNBQKBNR w/);
});

test('pause ignores moves until "resume"', async () => {
  await openBoard();
  await say('pause');
  await expect(panel.locator('body')).toHaveAttribute('data-state', 'paused');
  await say('e2 to e4');
  await panel.waitForTimeout(800);
  expect(await fen(board)).toMatch(/ w /);
  await say('resume');
  await expect(panel.locator('body')).toHaveAttribute('data-state', 'listening');
});

test('a site command built in settings runs from its phrase', async () => {
  await openBoard();
  await app.worker.evaluate(() => chrome.storage.local.set({ sites: [{ id: 's1', name: 'Extras', match: ['https://www.chess.com/*'], enabled: true, commands: [
    { id: 'c1', name: 'Open the daily puzzle', phrases: ['open {text} puzzle'], steps: [{ type: 'url', url: 'https://www.chess.com/daily-chess-puzzle' }], enabled: true, reviewed: true },
  ] }] }));
  await panel.waitForTimeout(300);
  await say('open the daily puzzle');
  await expect(panel.locator('#title')).toHaveText('Open the daily puzzle');
  await expect(board).toHaveURL(/chess\.com\/daily/);
  await app.worker.evaluate(() => chrome.storage.local.remove('sites'));
});

// Lichess sometimes puts headless browsers behind a bot check; then this test can't run.
async function openLichess(position) {
  board = app.context.pages()[0] ?? (await app.context.newPage());
  const path = position ? `/${position.replace(/ /g, '_')}` : '';
  await board.goto(`https://lichess.org/analysis${path}`, { waitUntil: 'domcontentloaded' });
  await board.waitForFunction(() => window.site?.analysis?.node?.fen, null, { timeout: 30_000 });
  panel ??= await app.context.newPage();
  await panel.goto(app.url('src/sidepanel/panel.html'));
  const tabId = await panel.evaluate(async () => (await chrome.tabs.query({ url: 'https://lichess.org/*' }))[0].id);
  await panel.goto(app.url(`src/sidepanel/panel.html?tab=${tabId}`));
  await expect(panel.locator('body')).toHaveAttribute('data-state', 'listening');
}
const lichessFen = (page) => page.evaluate(() => window.site.analysis.node.fen);

test('a spoken move is played on a lichess board', async () => {
  await openLichess();
  await expect(panel.locator('#ctxText')).toContainText('lichess');
  await say('e two to e four');
  await expect(panel.locator('#title')).toHaveText('e2 → e4');
  expect(await lichessFen(board)).toMatch(/^rnbqkbnr\/pppppppp\/8\/8\/4P3\/8\/PPPP1PPP\/RNBQKBNR b/);
});


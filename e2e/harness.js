// Launches Chromium with Hearsay loaded unpacked. Recent Chromium ignores --load-extension,
// so the extension is loaded through the DevTools protocol instead.
import { chromium } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export const ROOT = path.resolve(import.meta.dirname, '..');

export async function launch({ headless = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearsay-'));
  const context = await chromium.launchPersistentContext(dir, {
    channel: 'chromium',
    headless,
    viewport: { width: 1280, height: 860 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: ROOT });
  let worker = context.serviceWorkers().find((w) => w.url().includes(id));
  worker ??= await context.waitForEvent('serviceworker', (w) => w.url().includes(id));
  return { context, worker, id, url: (p) => `chrome-extension://${id}/${p}` };
}

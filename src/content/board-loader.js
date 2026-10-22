// Content scripts can't be ES modules, so this one loads the real module.
import(chrome.runtime.getURL('src/content/board.js')).catch((err) => console.warn('[Hearsay] could not start on this page', err));

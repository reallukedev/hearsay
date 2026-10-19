# Contributing

Thanks for helping. Hearsay is plain JavaScript modules with no build step, so a change is visible after you reload the extension at `chrome://extensions`.

## How it fits together

```
src/sidepanel/   The panel. Owns the microphone (speech.js), decides what an utterance means (router.js), shows the state.
src/content/     chess.com: chesscom.js reads the board and clicks squares; chesscom-bridge.js runs in the page and reports the game state.
                 picker.js, selector.js, snapshot.js are injected on demand for the site builder.
src/background/  Service worker. Runs site command steps (actions.js), opens the panel from the shortcut, brokers the picker.
src/options/     Settings and the site builder. nano.js talks to Gemini Nano.
src/shared/      Pure logic shared by everything: chess rules, the move parser, phrase matching, built-in commands, settings.
```

An utterance goes: recognizer → `router.route()` → in order, an open question (“Which one?”), Hearsay’s own words (pause, help), your site commands, chess.com, everyday commands.

## Working on it

- Open `src/sidepanel/panel.html?tab=<tabId>` in a normal tab to work on the panel without the side panel. It binds to that tab.
- The settings page’s **Check a phrase → Run it in the panel** sends typed text to the open panel as if you’d said it.
- `npm test` covers the pure logic. If you touch `chess.js`, the perft numbers must still match.
- `npm run test:e2e` drives the real chess.com. If chess.com changes its board, start with `readBoard()` and `findButton()` in `src/content/chesscom.js`.

## Adding a site

Most sites don’t need code: build a pack in settings, export it, and open a pull request adding it to `packs/`. Keep JavaScript steps short and readable, since people will review them before turning them on.

## Style

- Match the code around you. Comments explain why, not what.
- Copy is plain and specific. Buttons say what they do. Error messages say what happened and what to do next. No em dashes.
- Colors and type come from `src/shared/tokens.css`. The panel’s state colors are signals, so don’t reuse them for decoration.

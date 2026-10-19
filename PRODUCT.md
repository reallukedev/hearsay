# Product

<!-- impeccable:product-schema 1 -->

## Platform

web (Chrome extension, Manifest V3)

## Stack

Plain JavaScript ES modules, no build step, so anyone can clone and "Load unpacked". Vitest and Playwright as dev-only tooling.

## Users

People who want to play online chess without using their hands, or using them as little as possible. The founding user has carpal tunnel syndrome in both hands; mouse dragging is painful. They sit at a desktop with a board open in Chrome, often in timed games where a second matters. Secondary: anyone with RSI, tremor, limited mobility, or who just wants to call moves out loud.

## Product Purpose

Hearsay is general voice control for the browser that ships with chess defaults. Out of the box: say a move as two squares ("a2 to a4") and it is played on chess.com, in live games, bots, puzzles, lessons and analysis. Success: a full game played without touching the mouse, with fewer misheard moves than the extension it replaces.

Beyond chess, any site can be added and given voice commands: click an element picked on the page, press keys, type, open a URL, scroll, or run JavaScript. Phrases can carry blanks ("search for {text}"). JavaScript can be drafted by Chrome's built-in on-device model (Gemini Nano, Prompt API) and is always reviewed by the user before it is saved. Adding a site should be powerful and easy.

## Positioning

It listens against the position. The parser knows every legal move at that instant, so "bee four" or "a too a for" resolves to the one legal move it can mean, instead of failing on a mishearing.

## Operating Context

- Chrome side panel sits next to the board and holds the microphone, so the permission belongs to the extension, not each chess site.
- Moves are played by simulating the same pointer input a person would make on the board.
- Timed games: latency between speech end and the move landing must feel immediate.

## Capabilities and Constraints

- Square-to-square format is the primary grammar. Piece notation is optional and off by default.
- Castling, promotion ("e7 to e8 queen"), en passant through the same grammar.
- Built-in chess support: chess.com only. Everything else comes from user-added sites, templates and imported packs.
- Custom commands use chrome.userScripts, which needs the user to enable "Allow User Scripts" for the extension.
- Gemini Nano is only present on supported hardware; everything must work without it.
- No accounts, no servers, no analytics. Speech goes through Chrome's recognizer (on-device when Chrome offers it).

## Brand Commitments

None yet. Open source on GitHub, released as a single commit.

## Evidence on Hand

None. Do not invent users, ratings, testimonials, download counts or accuracy figures.

## Product Principles

1. Never play a move the user did not say. When unsure, ask or do nothing, never guess silently.
2. Zero hand use is the target: every action reachable by voice, with a single key as backup.
3. Speed matters in timed games; confirmation is optional, never forced.
4. The page stays the page: the extension adds a quiet layer, it doesn't take over the board.

## Accessibility & Inclusion

Built for motor impairment first. Every control is keyboard reachable, large targets, readable at a distance, works with reduced motion, and announces results to screen readers. Spoken feedback is optional.

# Design

Hearsay is used with eyes on something else: the board, or the page being controlled. The side panel sits in peripheral vision, so its entire background is the microphone's state. Settings and onboarding are calm reading surfaces in the same palette.

## State colors

These are signals, not decoration. Each fills the whole panel.

| State | Color | Ink | Meaning |
| --- | --- | --- | --- |
| Listening / hearing | Pine `#173f35` | `#f3f0e6` | Ready, or taking in speech |
| Done | Lime `#c9f16a` | `#16271f` | Something happened. Stays until you speak again |
| Choose | Apricot `#ffc27a` | `#2c1a08` | Needs your answer, by number |
| Failed | Coral `#ff7a63` | `#2b0d07` | Nothing was done, and why |
| Paused / off / setup | Stone `#e8e3d8` (dark `#24221e`) | `#2a2620` (dark `#ece7dc`) | Not acting on speech |

Secondary text on a state field is the field's ink at 66 to 76% opacity, never gray. Chips and option rows are the ink at 7 to 10%.

## Neutrals

Settings and onboarding follow the system theme.

| Token | Light | Dark |
| --- | --- | --- |
| `--oat` page | `#f4f1e9` | `#191714` |
| `--paper` surface | `#fbfaf6` | `#221f1b` |
| `--ink` text | `#1d1b16` | `#f1ede4` |
| `--ink-2` / `--ink-3` | `#4c473e` / `#6f695e` | `#cfc8bb` / `#a59d90` |
| `--line` | `#e1dbcd` | `#37332d` |

Pine is the primary action color in settings. Lime marks "on" (switch knobs, status pills).

## Type

Hanken Grotesk, self-hosted (`fonts/`), weights 400 to 900.

- Panel result: 66px / 900 / -0.035em. Longer results drop to `clamp(32px, 11vw, 46px)`.
- Panel prose: 17px / 600, line-height 1.38.
- Settings headings: `clamp(28px, 4vw, 38px)` / 900. Section heads 20px / 800. Body 16px.
- Code only in JavaScript steps: system monospace 14px.

## Shape and depth

Radii: 10, 14, 18, 24px. Pills only for small chips and status. Groups of settings rows are one rounded surface split by 1px gaps of `--line`; never a one-sided border. Shadows are rare and soft.

## Motion

- The panel cross-fades its field color over 280ms when the state changes.
- Results rise 6px and fade in over 320ms, staggered 40ms.
- The mic ring scales with input level (about 30 updates a second).
- Everything respects `prefers-reduced-motion`.

## On the board

The overlay drawn on chess.com uses the same language: pine and lime outline while you speak, lime fill when played, apricot numbered squares when Hearsay asks which one.

## Copy

Plain, specific, second person. Buttons name the action. Errors say what happened and what to do. No em dashes.

# Logic spec

Pure modules with no browser APIs. Tests import them directly with Vitest.

## `src/shared/chess.js`

- `parseFen(fen)` returns a position object. Throws `Error` on a malformed FEN (wrong rank count, bad piece letter, bad side to move).
- `legalMoves(position)` returns every legal move for the side to move as objects `{ from, to, piece, color, promotion?, flags }`.
  - `from`/`to` are lowercase squares like `"e2"`.
  - `piece` is one of `p n b r q k`, `color` is `w` or `b`.
  - Promotions appear once per promotion piece (`q r b n`) with `promotion` set.
  - `flags` is a string containing any of: `c` capture, `e` en passant, `k` king-side castle, `q` queen-side castle, `p` promotion, `d` double pawn push.
  - Moves that leave the mover's king in check are excluded. Castling through or out of check is excluded.
- `perft(position, depth)` counts leaf nodes. Known values:
  - start position: depth 1 = 20, 2 = 400, 3 = 8902, 4 = 197281
  - `r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1`: 1 = 48, 2 = 2039, 3 = 97862
  - `8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1`: 1 = 14, 2 = 191, 3 = 2812, 4 = 43238
  - `r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1`: 1 = 6, 2 = 264, 3 = 9467
- `withTurn(position, color)` returns a copy with the side to move set to `color` and en passant cleared (used for premoves).
- `pieceAt(position, square)` returns `{ piece, color }` or `null`.

## `src/shared/move-parse.js`

`parseMove(alternatives, ctx)`

- `alternatives`: array of `{ transcript, confidence }` from the speech recognizer, best first. Transcripts are raw recognizer text, any case, may contain punctuation.
- `ctx`: `{ legal, pieceNames = false, color }` where `legal` is the array from `legalMoves`, and `color` is the user's color (`w`/`b`).
- Returns one of:
  - `{ kind: 'move', move, heard }`: exactly one best legal move. `move` is the object from `legal` (same reference). `heard` is the transcript that produced it.
  - `{ kind: 'choose', options, heard }`: two to four equally plausible legal moves, best first. Never more than 4.
  - `{ kind: 'illegal', heard, from, to, promotion? }`: the speech clearly named a from-square and to-square but no legal move matches.
  - `{ kind: 'none' }`: not a move at all (for example "flip the board", "hello").

Grammar it must accept (case-insensitive, all should resolve against the start position or the stated FEN):

- Square pairs with a connector or none: `e2 to e4`, `e2 e4`, `e2e4`, `E2-E4`, `e2 two e4` (recognizers often write "to" as "two" or "2"), `e2 2 e4`, `from e2 to e4`, `move e2 to e4`, `pawn e2 to e4`.
- Spelled letters and homophones: `a`/`ay`/`eh`/`alpha`; `b`/`be`/`bee`/`bravo`; `c`/`see`/`sea`/`charlie`; `d`/`dee`/`delta`; `e`/`ee`/`echo`; `f`/`ef`/`eff`/`foxtrot`; `g`/`gee`/`golf`; `h`/`aitch`/`hotel`.
- Spelled numbers and homophones: `one`/`won`, `two`/`to`/`too`, `three`/`tree`, `four`/`for`/`fore`, `five`, `six`, `seven`, `eight`/`ate`.
- Spaced forms: `e 2 to e 4`, `echo two to echo four`, `g one to f three` (knight move).
- Merged homophones the recognizer produces: `before` means `b4` (so `b2 before` is b2 to b4), and `84` can mean `a4` (so `a2 to 84` is a2 to a4) when that makes a legal move.
- Promotion: `e7 to e8 queen`, `e7 e8 knight`, `e7 to e8 equals rook`, `e7 to e8 promote to bishop`. `night`/`nite` mean knight. With no piece named, a promotion resolves to `choose` over the four promotions (queen first).
- Castling: `castle short`, `castle kingside`, `castles king side`, `short castle`, `o-o`, `castle long`, `castle queenside`, `o-o-o`. Also king moves `e1 to g1`. When only one castle is legal, plain `castle` plays it; when both are legal it returns `choose` with king side first.
- Piece names (only when `ctx.pieceNames` is true): `knight f3`, `knight to f3`, `bishop takes e5`, `queen h5`. With two pieces able to reach, returns `choose`. When `pieceNames` is false, `knight f3` returns `none`.
- Alternatives: if the first alternative gives no legal move but a later one does, the later one wins (e.g. alternatives `["e2 to e5", "e2 to e4"]` resolves to e2-e4).
- Disambiguation via legality: `b2 to b4` vs mishearings is resolved by legality; for example in the start position `d2 to be four` should not play (no legal d2-b4), but `bee two to bee four` plays b2-b4.
- Illegal: `e2 to e5` in the start position returns `illegal` with from `e2`, to `e5`. `a3 to a4` (empty square) is `illegal` too.

## `src/shared/phrases.js`

`matchPhrase(transcript, phrases)`

- `phrases`: array of strings, each may contain blanks `{name}` (letters only). `{number}` captures a number (digits or number words up to "twenty", returned as a string of digits); any other blank captures one or more words of free text, as the user said it (original casing trimmed).
- Matching is case-insensitive, ignores punctuation and repeated spaces, and allows small mishearings: each literal word may differ by at most 1 edit if it is 4+ letters long.
- Returns `null` or `{ phrase, slots, score }` for the best phrase, where `score` is between 0 and 1 (1 is exact). Prefer exact matches over fuzzy, and longer literal matches over shorter ones.
- Examples:
  - `matchPhrase('Next page', ['next page'])` → `{ phrase: 'next page', slots: {}, score: 1 }`
  - `matchPhrase('search for cute cats', ['search for {text}'])` → slots `{ text: 'cute cats' }`
  - `matchPhrase('go to page 12', ['go to page {number}'])` → slots `{ number: '12' }`
  - `matchPhrase('go to page twelve', ['go to page {number}'])` → slots `{ number: '12' }`
  - `matchPhrase('nexd page', ['next page'])` → match with score below 1
  - `matchPhrase('search for', ['search for {text}'])` → `null` (blank needs at least one word)
  - `matchPhrase('play', ['play', 'play video'])` → phrase `play`
  - `matchPhrase('hello there', ['next page'])` → `null`

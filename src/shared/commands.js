// Built-in phrases. Each list is what people actually say, not just the tidy version.
import { matchPhrase } from './phrases.js';

export const GLOBAL_COMMANDS = [
  { id: 'pause', phrases: ['pause', 'stop listening', 'go to sleep', 'mute', 'pause listening', 'stop'], hint: 'pause' },
  { id: 'resume', phrases: ['resume', 'start listening', 'wake up', 'unpause', 'listen'], hint: 'resume' },
  { id: 'help', phrases: ['what can i say', 'help', 'show commands', 'what can you do'], hint: 'what can I say' },
  { id: 'cancel', phrases: ['cancel', 'never mind', 'nevermind', 'no', 'forget it'], hint: 'cancel' },
  { id: 'yes', phrases: ['yes', 'yeah', 'yep', 'confirm', 'do it', 'play it', 'correct'], hint: 'yes' },
];

export const CHESS_COMMANDS = [
  { id: 'flip', phrases: ['flip', 'flip board', 'flip the board', 'rotate board', 'turn the board', 'turn board around'], hint: 'flip board', label: 'Flipped the board' },
  { id: 'undo', phrases: ['undo', 'take back', 'takeback', 'take it back', 'undo move', 'undo that'], hint: 'undo', label: 'Took it back' },
  { id: 'back', phrases: ['back', 'go back', 'previous move', 'step back'], hint: 'back', label: 'Stepped back' },
  { id: 'forward', phrases: ['forward', 'next move', 'step forward', 'go forward'], hint: 'forward', label: 'Stepped forward' },
  { id: 'resign', phrases: ['resign', 'i resign', 'resign the game', 'resign game'], hint: 'resign', label: 'Resigned' },
  { id: 'draw', phrases: ['offer draw', 'offer a draw', 'draw offer', 'accept draw', 'accept the draw'], hint: 'offer draw', label: 'Draw' },
  { id: 'rematch', phrases: ['rematch', 'play again', 'request rematch'], hint: 'rematch', label: 'Asked for a rematch' },
  { id: 'newgame', phrases: ['new game', 'start a new game', 'play a new game', 'find a game'], hint: 'new game', label: 'New game' },
  { id: 'next', phrases: ['next', 'next puzzle', 'continue', 'next lesson', 'next one', 'keep going'], hint: 'next puzzle', label: 'Next' },
  { id: 'retry', phrases: ['retry', 'try again', 'restart', 'again'], hint: 'retry', label: 'Retrying' },
  { id: 'hint', phrases: ['hint', 'give me a hint', 'show hint'], hint: 'hint', label: 'Hint' },
  { id: 'solution', phrases: ['solution', 'show solution', 'show me the answer', 'show answer'], hint: 'show solution', label: 'Solution' },
];

export const EVERYDAY_COMMANDS = [
  { id: 'scrollDown', phrases: ['scroll down', 'page down', 'down', 'scroll'], hint: 'scroll down' },
  { id: 'scrollUp', phrases: ['scroll up', 'page up', 'up'], hint: 'scroll up' },
  { id: 'top', phrases: ['scroll to top', 'go to top', 'top of page', 'top'], hint: 'go to top' },
  { id: 'bottom', phrases: ['scroll to bottom', 'go to bottom', 'bottom of page', 'bottom'], hint: 'go to bottom' },
  { id: 'historyBack', phrases: ['go back a page', 'previous page', 'back a page', 'browser back'], hint: 'previous page' },
  { id: 'historyForward', phrases: ['go forward a page', 'forward a page', 'browser forward'], hint: 'forward a page' },
  { id: 'reload', phrases: ['reload', 'refresh', 'reload page', 'refresh page', 'refresh the page'], hint: 'reload' },
  { id: 'click', phrases: ['click {text}', 'press {text}', 'tap {text}', 'select {text}', 'open {text}'], hint: 'click Play' },
  { id: 'key', phrases: ['press enter', 'press escape', 'press space', 'press tab', 'escape', 'hit enter'], hint: 'press escape' },
  { id: 'nextTab', phrases: ['next tab', 'switch tab', 'tab right'], hint: 'next tab' },
  { id: 'prevTab', phrases: ['previous tab', 'last tab', 'tab left'], hint: 'previous tab' },
];

// Some words are commands on their own ("back"), so phrases must match the whole utterance.
export function matchCommand(list, transcript, minScore = 0.75) {
  let best = null;
  for (const cmd of list) {
    const m = matchPhrase(transcript, cmd.phrases);
    if (m && m.score >= minScore && (!best || m.score > best.match.score)) best = { cmd, match: m };
  }
  return best;
}

export function matchAlternatives(list, alternatives, minScore) {
  for (const alt of alternatives) {
    const hit = matchCommand(list, alt.transcript, minScore);
    if (hit) return { ...hit, heard: alt.transcript };
  }
  return null;
}

const ORDINALS = { one: 1, won: 1, first: 1, '1': 1, two: 2, to: 2, too: 2, second: 2, '2': 2, three: 3, third: 3, tree: 3, '3': 3, four: 4, for: 4, fourth: 4, '4': 4, five: 5, fifth: 5, '5': 5, six: 6, sixth: 6, '6': 6, seven: 7, '7': 7, eight: 8, ate: 8, '8': 8, nine: 9, '9': 9 };

// "two", "number 2", "the second one" -> 2
export function parseChoice(transcript) {
  let ws = String(transcript).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w && !['number', 'the', 'option', 'pick', 'choose', 'please', 'go', 'with'].includes(w));
  if (ws.length === 2 && ws[1] === 'one') ws = [ws[0]];
  return ws.length === 1 && ORDINALS[ws[0]] ? ORDINALS[ws[0]] : null;
}

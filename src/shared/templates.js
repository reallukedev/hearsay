// Starter packs. They show what's possible and can be edited like anything you build yourself.
export const TEMPLATES = [
  {
    key: 'youtube',
    name: 'YouTube',
    blurb: 'Play, pause, skip, captions, fullscreen and search.',
    match: ['https://www.youtube.com/*'],
    commands: [
      { name: 'Play or pause', phrases: ['play', 'pause video', 'pause it', 'resume video'], steps: [{ type: 'keys', keys: 'k' }] },
      { name: 'Skip ahead 10 seconds', phrases: ['skip ahead', 'skip forward', 'forward ten seconds'], steps: [{ type: 'keys', keys: 'l' }] },
      { name: 'Back 10 seconds', phrases: ['rewind', 'back ten seconds', 'go back a bit'], steps: [{ type: 'keys', keys: 'j' }] },
      { name: 'Captions on or off', phrases: ['captions', 'subtitles', 'toggle captions'], steps: [{ type: 'keys', keys: 'c' }] },
      { name: 'Fullscreen', phrases: ['fullscreen', 'full screen', 'exit fullscreen'], steps: [{ type: 'keys', keys: 'f' }] },
      { name: 'Mute or unmute', phrases: ['mute video', 'unmute', 'mute it'], steps: [{ type: 'keys', keys: 'm' }] },
      { name: 'Next video', phrases: ['next video', 'skip video'], steps: [{ type: 'keys', keys: 'Shift+N' }] },
      { name: 'Search YouTube', phrases: ['search for {text}', 'find {text}', 'youtube {text}'], steps: [{ type: 'url', url: 'https://www.youtube.com/results?search_query={text}' }] },
    ],
  },
  {
    key: 'wikipedia',
    name: 'Wikipedia',
    blurb: 'Look things up and wander with random articles.',
    match: ['https://en.wikipedia.org/*'],
    commands: [
      { name: 'Look something up', phrases: ['look up {text}', 'search for {text}', 'what is {text}'], steps: [{ type: 'url', url: 'https://en.wikipedia.org/wiki/Special:Search?search={text}' }] },
      { name: 'Random article', phrases: ['random article', 'surprise me'], steps: [{ type: 'url', url: 'https://en.wikipedia.org/wiki/Special:Random' }] },
    ],
  },
  {
    key: 'google',
    name: 'Google Search',
    blurb: 'Search by voice and open results by number.',
    match: ['https://www.google.com/*'],
    commands: [
      { name: 'Search Google', phrases: ['search for {text}', 'google {text}'], steps: [{ type: 'url', url: 'https://www.google.com/search?q={text}' }] },
      { name: 'Open a result by number', phrases: ['open result {number}', 'result {number}'], steps: [{ type: 'js', world: 'USER_SCRIPT', code: "const links = [...document.querySelectorAll('#search a h3')].map((h) => h.closest('a'));\nconst link = links[Number(slots.number) - 1];\nif (link) link.click();" }] },
    ],
  },
];

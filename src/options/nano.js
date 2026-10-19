// Drafts JavaScript with Chrome's built-in model (Gemini Nano, Prompt API). Free, on-device, no key.
// Drafts are shown to you for review; nothing runs until you save and say the command.

const SYSTEM = `You write short JavaScript snippets that a browser extension runs on a web page when the user says a voice command.
Rules:
- Output only JavaScript. No explanations, no Markdown fences.
- Plain browser JavaScript. No imports, no libraries, no network requests unless the user asks for one.
- The code runs inside an async function, so you may use await.
- A variable named slots holds words captured from the spoken phrase, for example slots.text or slots.number (always strings).
- Prefer clicking the page's existing controls, using the selectors listed in the page outline.
- Keep it under 25 lines. Check that elements exist before using them.`;

export async function nanoStatus() {
  const LM = globalThis.LanguageModel;
  if (!LM) return 'missing';
  try {
    return await LM.availability({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] });
  } catch {
    return 'unavailable';
  }
}

let session = null;

export async function draftCode({ description, phrase, page, onProgress, onText, signal }) {
  const LM = globalThis.LanguageModel;
  if (!LM) throw new Error('missing');
  session ??= await LM.create({
    initialPrompts: [{ role: 'system', content: SYSTEM }],
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    monitor(m) { m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded)); },
  });
  const prompt = [
    page ? `Page: ${page.title}\nAddress: ${page.url}\nControls on the page (tag "label" -> selector):\n${page.outline}` : 'No page outline is available; write code that works on typical pages.',
    `Voice phrase: "${phrase || '(not set)'}"`,
    `What it should do: ${description}`,
    'Write the code.',
  ].join('\n\n');
  const s = await session.clone();
  let text = '';
  try {
    for await (const chunk of s.promptStreaming(prompt, { signal })) {
      // Older Chrome builds stream the whole text so far; newer ones stream deltas.
      text = chunk.startsWith(text) ? chunk : text + chunk;
      onText?.(clean(text));
    }
  } finally {
    s.destroy();
  }
  return clean(text);
}

function clean(text) {
  return text.replace(/^\s*```(?:javascript|js)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

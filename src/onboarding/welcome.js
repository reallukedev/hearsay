const $ = (id) => document.getElementById(id);

async function showShortcuts() {
  const cmds = await chrome.commands.getAll();
  const pretty = (s) => s.replace(/[+⇧⌥⌘]/g, (m) => ({ '+': ' ', '⇧': 'Shift ', '⌥': 'Option ', '⌘': 'Cmd ' })[m]).trim();
  const toggle = cmds.find((c) => c.name === 'toggle-listening')?.shortcut;
  const panel = cmds.find((c) => c.name === '_execute_action')?.shortcut;
  if (toggle) $('toggleKey').textContent = pretty(toggle);
  if (panel) $('panelKey').textContent = pretty(panel);
}

let raf;
function meter(stream) {
  const ctx = new AudioContext();
  const an = ctx.createAnalyser();
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  const tick = () => {
    an.getFloatTimeDomainData(buf);
    const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
    $('level').style.transform = `scaleX(${Math.min(1, rms * 9)})`;
    raf = requestAnimationFrame(tick);
  };
  tick();
  // Stop the preview after a while; it was only there to prove the mic works.
  setTimeout(() => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); ctx.close(); $('level').style.transform = 'scaleX(0)'; }, 12000);
}

async function allowMic() {
  const note = $('micNote');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    $('step-mic').classList.add('done');
    $('mic').textContent = 'Microphone allowed';
    note.textContent = 'Allowed. Say something and watch the bar move.';
    meter(stream);
  } catch (err) {
    note.textContent = err?.name === 'NotFoundError'
      ? 'No microphone found. Plug one in and try again.'
      : 'Chrome blocked the microphone. Click the icon at the right of the address bar, allow the microphone, then try again.';
  }
}

async function init() {
  showShortcuts();
  $('mic').addEventListener('click', allowMic);
  $('panel').addEventListener('click', async () => {
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: win.id });
    $('step-panel').classList.add('done');
  });
  const state = await navigator.permissions.query({ name: 'microphone' }).then((s) => s.state).catch(() => 'prompt');
  if (state === 'granted') { $('step-mic').classList.add('done'); $('mic').textContent = 'Microphone allowed'; }
  else if (location.hash === '#mic') allowMic();
}

init();

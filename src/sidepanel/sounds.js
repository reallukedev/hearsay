// Short, quiet tones so you know what happened without looking.
let ctx;

function tone(freq, start, dur, gain = 0.05) {
  ctx ??= new AudioContext();
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sounds = {
  done: () => { tone(660, 0, 0.12); tone(880, 0.07, 0.16); },
  choose: () => { tone(587, 0, 0.12); tone(587, 0.16, 0.12); },
  failed: () => { tone(330, 0, 0.22, 0.045); },
  on: () => { tone(523, 0, 0.1, 0.035); tone(784, 0.06, 0.12, 0.035); },
  off: () => { tone(784, 0, 0.1, 0.035); tone(523, 0.06, 0.12, 0.035); },
};

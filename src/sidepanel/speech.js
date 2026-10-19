// Wraps Chrome's speech recognition: keeps it running, restarts it when Chrome stops it,
// prefers on-device recognition when asked, and measures the mic level for the ring.

const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
const FILES = 'abcdefgh';
const SQUARES = [...FILES].flatMap((f) => [1, 2, 3, 4, 5, 6, 7, 8].map((r) => `${f}${r}`));

export const speechSupported = () => !!SR;

export async function micPermission() {
  try {
    const st = await navigator.permissions.query({ name: 'microphone' });
    return st.state; // granted | prompt | denied
  } catch {
    return 'prompt';
  }
}

export async function localAvailability(lang) {
  if (!SR?.available) return 'unsupported';
  try { return await SR.available({ langs: [lang], processLocally: true }); } catch { return 'unsupported'; }
}

export class Listener {
  constructor({ lang = 'en-US', engine = 'auto', biasWords = [], onInterim, onFinal, onError, onLevel, onRunning }) {
    Object.assign(this, { lang, engine, biasWords, onInterim, onFinal, onError, onLevel, onRunning });
    this.wanted = false;
    this.rec = null;
    this.failures = 0;
    this.ignoreUntil = 0;
  }

  async start() {
    if (!SR) { this.onError?.('unsupported'); return; }
    this.wanted = true;
    await this.#meter();
    if (this.wanted) await this.#open();
  }

  stop() {
    this.wanted = false;
    try { this.rec?.abort(); } catch { /* already stopped */ }
    this.rec = null;
    this.#stopMeter();
    this.onRunning?.(false);
  }

  // Drop anything heard until a time (used while Hearsay is speaking, so it doesn't hear itself).
  muteUntil(t) { this.ignoreUntil = t; }

  async #open() {
    if (!this.wanted) return;
    const rec = new SR();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 5;

    if (this.engine !== 'cloud' && 'processLocally' in rec) {
      const state = await localAvailability(this.lang);
      if (!this.wanted) return; // stopped while we were asking
      if (state === 'available') rec.processLocally = true;
      else if (this.engine === 'local') this.onError?.('local-unavailable');
    }
    if (rec.processLocally && 'phrases' in rec && globalThis.SpeechRecognitionPhrase) {
      try {
        rec.phrases = [...SQUARES, ...this.biasWords].map((p) => new globalThis.SpeechRecognitionPhrase(p, 2.0));
      } catch { /* biasing is a bonus */ }
    }

    rec.onstart = () => this.onRunning?.(true);
    rec.onresult = (e) => {
      this.failures = 0; // it's working, so the next restart can be quick
      if (performance.now() < this.ignoreUntil) return;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          const alts = [];
          for (let j = 0; j < res.length; j++) alts.push({ transcript: res[j].transcript.trim(), confidence: res[j].confidence });
          if (alts.some((a) => a.transcript)) this.onFinal?.(alts);
        } else {
          this.onInterim?.(res[0].transcript.trim());
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.wanted = false; this.onError?.('permission'); return; }
      if (e.error === 'audio-capture') { this.wanted = false; this.onError?.('nomic'); return; }
      if (e.error === 'language-not-supported') { this.wanted = false; this.onError?.('language'); return; }
      if (e.error === 'phrases-not-supported') { this.biasWords = []; return; }
      this.failures++;
      this.onError?.(e.error === 'network' ? 'network' : 'other');
    };
    rec.onend = () => {
      this.onRunning?.(false);
      if (!this.wanted) return;
      // Chrome ends sessions after silence; reopen, backing off if it keeps failing.
      const delay = Math.min(5000, 120 * 2 ** this.failures);
      setTimeout(() => { if (this.wanted && this.rec === rec) this.#open(); }, delay);
    };
    this.rec = rec;
    try { rec.start(); } catch { /* already started */ }
  }

  async #meter() {
    if (this.stream) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      if (err?.name === 'NotAllowedError') { this.wanted = false; this.onError?.('permission'); }
      return;
    }
    if (!this.wanted) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; return; }
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    const an = this.ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    let smooth = 0;
    let last = 0;
    const tick = (t) => {
      this.raf = requestAnimationFrame(tick);
      if (t - last < 33) return; // about 30 updates a second is plenty for a ring
      last = t;
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const level = Math.min(1, rms * 9);
      smooth = level > smooth ? level : smooth * 0.82 + level * 0.18;
      this.onLevel?.(smooth);
    };
    this.raf = requestAnimationFrame(tick);
  }

  #stopMeter() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
    this.onLevel?.(0);
  }
}

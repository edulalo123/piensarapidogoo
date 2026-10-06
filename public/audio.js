/* Audio sintetizado con Web Audio API (no requiere archivos de sonido) */
const Sound = (() => {
  let ctx = null, muted = localStorage.muted === '1', mus = null, step = 0;
  const NOTES = [262, 330, 392, 330, 294, 349, 440, 349];

  const init = () => {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (C) ctx = new C(); }
    if (ctx && ctx.state === 'suspended') ctx.resume();
  };
  const tone = (f, d = .15, type = 'sine', v = .15, delay = 0) => {
    if (!ctx || muted) return;
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + delay;
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(.001, t + d);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + d);
  };
  const seq = (notes, gap, type, v) => notes.forEach((f, i) => tone(f, gap * 1.6, type, v, i * gap));

  return {
    init,
    get muted() { return muted; },
    toggle() { muted = !muted; localStorage.muted = muted ? '1' : '0'; if (muted) this.stopMusic(); return muted; },
    music() { if (mus || muted || !ctx) return; mus = setInterval(() => tone(NOTES[step++ % NOTES.length], .35, 'triangle', .05), 350); },
    stopMusic() { clearInterval(mus); mus = null; },
    tick() { tone(880, .08, 'square', .06); },
    coin() { tone(1318, .08, 'square', .05); tone(1760, .18, 'square', .05, .07); },
    good() { seq([523, 659, 784], .12, 'triangle', .18); },
    bad() { seq([196, 147], .22, 'sawtooth', .12); },
    win() { seq([523, 523, 523, 659, 784, 659, 784, 1047], .16, 'triangle', .2); },
  };
})();

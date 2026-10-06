const { validate } = require('./quizStore');

/* ================= REGLAS (ajusta los números aquí) ================= */
const MAX_P = 20, MAX_S = 6;
const START = 100;       // pozo inicial (pregunta 1)
const GIFT = 10;         // regalo al INICIAR cada pregunta, desde la 2
const BONUS_CAP = 30;    // tope del bono por velocidad
const POWER_COST = 40;   // costo de 50/50 y Espía
const SHIELD_PCT = 0.2;  // Escudo: recupera 20% de lo perdido en opciones incorrectas
const STEP_MS = { reveal: 8000, summary: 6000, ranking: 8000 }; // duración de cada paso automático
const POST = ['reveal', 'summary', 'ranking'];
const sum = a => a.reduce((x, y) => x + y, 0);

class Game {
  constructor(code, hostToken, io) {
    Object.assign(this, {
      code, hostToken, io, phase: 'lobby', quiz: null, qIndex: -1, people: new Map(), host: null,
      timer: null, endsAt: 0, paused: false, remaining: 0, created: Date.now(),
    });
  }

  isHost(t) { return t === this.hostToken; }
  list(role) { return [...this.people.values()].filter(p => !role || p.role === role); }
  remainingMs() { return this.paused ? this.remaining : Math.max(0, this.endsAt - Date.now()); }

  /* ---------- Acceso y reconexión ---------- */
  join(sid, token, name, role) {
    if (this.isHost(token)) { this.host = { sid, online: true }; return { ok: true }; }
    let p = this.people.get(token);
    if (!p && name) { // reconexión por nombre
      const q = this.list().find(x => x.name.toLowerCase() === name.toLowerCase());
      if (q) {
        if (q.online) return { error: 'Ese nombre ya está en uso (si te desconectaste, espera unos segundos y reintenta)' };
        this.people.delete(q.token); q.token = token; this.people.set(token, q); p = q;
      }
    }
    if (p) { p.sid = sid; p.online = true; return { ok: true }; }
    if (!name) return { error: 'Ingresa tu nombre' };
    if (role === 'player') {
      if (this.phase !== 'lobby') return { error: 'La partida ya inició: entra como espectador' };
      if (this.list('player').length >= MAX_P) return { error: 'Los 20 cupos de jugador están llenos: entra como espectador' };
    } else {
      role = 'spectator';
      if (this.list('spectator').length >= MAX_S) return { error: 'Los 6 cupos de espectador están llenos' };
    }
    this.people.set(token, {
      token, name, role, sid, online: true, coins: role === 'player' ? START : 0,
      base: 0, start: 0, bets: [], confirmed: false, bonusPot: 0, bonus: 0, refund: 0,
      delta: null, hit: false, history: [], right: 0, wrong: 0,
      used: { shield: false, fifty: false, spy: false }, shieldOn: false, hidden: [], spy: null,
    });
    return { ok: true };
  }

  leave(token, sid) {
    if (this.isHost(token)) { if (this.host && this.host.sid === sid) this.host.online = false; }
    else {
      const p = this.people.get(token);
      if (!p || p.sid !== sid) return;
      if (this.phase === 'lobby') this.people.delete(token); else p.online = false;
    }
    this.emitAll();
  }

  /* ---------- Flujo: pregunta → reveal (A) → summary (B) → ranking (C) → siguiente/final (D) ---------- */
  start(data) {
    if (this.phase !== 'lobby') return { error: 'La partida ya inició' };
    const v = validate(data);
    if (v.error) return v;
    if (!this.list('player').length) return { error: 'Necesitas al menos 1 jugador' };
    this.quiz = v;
    this.next();
    return { ok: true };
  }

  next() { // Paso D
    clearTimeout(this.timer);
    this.qIndex++;
    const { n, alts, time } = this.quiz;
    if (this.qIndex >= n) { this.phase = 'final'; return this.emitAll(); }
    for (const p of this.list('player')) {
      if (this.qIndex > 0) p.coins += GIFT;                    // 🎁 regalo desde la pregunta 2
      Object.assign(p, {
        base: p.coins, start: p.coins, bets: Array(alts).fill(0), confirmed: false, bonusPot: 0, bonus: 0,
        refund: 0, delta: null, hit: false, shieldOn: false, hidden: [], spy: null,
      });
    }
    this.phase = 'question'; this.paused = false;
    this.endsAt = Date.now() + time * 1000;
    this.arm();
    this.emitAll();
  }

  arm() { clearTimeout(this.timer); this.timer = setTimeout(() => this.resolve(), Math.max(0, this.endsAt - Date.now())); }

  show(ph) { // muestra un paso y programa el siguiente
    this.phase = ph;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.advance(), STEP_MS[ph]);
    this.emitAll();
  }

  advance() {
    clearTimeout(this.timer);
    const f = { reveal: () => this.show('summary'), summary: () => this.show('ranking'), ranking: () => this.next() }[this.phase];
    if (f) f();
  }

  /* ---------- Controles del Host ---------- */
  control(a) {
    if (a === 'skip') { if (this.phase === 'question') this.resolve(); else if (POST.includes(this.phase)) this.advance(); return; }
    if (this.phase !== 'question') return;
    if (a === 'pause' && !this.paused) { this.remaining = this.remainingMs(); clearTimeout(this.timer); this.paused = true; }
    else if (a === 'resume' && this.paused) { this.endsAt = Date.now() + this.remaining; this.paused = false; this.arm(); }
    else if (a === 'add') { if (this.paused) this.remaining += 10000; else { this.endsAt += 10000; this.arm(); } }
    else return;
    this.emitAll();
  }

  /* ---------- Apuestas ---------- */
  check(token, bets) { // validación estricta en servidor
    const p = this.people.get(token);
    if (!p || this.phase !== 'question' || p.role !== 'player' || p.confirmed) return { error: 'No puedes apostar ahora' };
    if (this.paused) return { error: 'La partida está en pausa' };
    if (this.remainingMs() <= 0) return { error: 'Se acabó el tiempo' };
    if (!Array.isArray(bets) || bets.length !== this.quiz.alts) return { error: 'Apuesta inválida' };
    const b = bets.map(Number);
    if (b.some(x => !Number.isInteger(x) || x < 0)) return { error: 'Solo montos enteros' };
    if (sum(b) > p.base) return { error: `No puedes apostar más de tu pozo (${p.base})` };
    if (p.hidden.some(i => b[i] > 0)) return { error: 'Esa alternativa fue eliminada por el 50/50' };
    return { p, b };
  }

  bet(token, bets) { const r = this.check(token, bets); if (r.p) r.p.bets = r.b; } // borrador

  allConfirmed() { const on = this.list('player').filter(x => x.online); return on.length > 0 && on.every(x => x.confirmed); }

  confirm(token, bets) {
    const r = this.check(token, bets);
    if (!r.p) return r;
    const { p, b } = r;
    if (p.base > 0 && sum(b) === 0) return { error: 'Apuesta al menos 1 moneda' };
    p.bets = b; p.confirmed = true;
    // Bono por velocidad (solo si acierta): 1 moneda por cada 2 s restantes, máx. 30. Se cobra al resolver.
    p.bonusPot = Math.min(BONUS_CAP, Math.floor(Math.floor(this.remainingMs() / 1000) / 2));
    if (this.allConfirmed()) this.resolve(); else this.emitAll(); // 100% confirmó → pasa sin esperar el reloj
    return { ok: true, bonusPot: p.bonusPot };
  }

  /* ---------- Comodines (1 uso por partida) ---------- */
  power(token, type) {
    const p = this.people.get(token);
    if (!p || p.role !== 'player' || this.phase !== 'question' || p.confirmed || this.paused || this.remainingMs() <= 0)
      return { error: 'No disponible ahora' };
    if (!['shield', 'fifty', 'spy'].includes(type)) return { error: 'Comodín inválido' };
    if (p.used[type]) return { error: 'Ya usaste este comodín' };
    const cost = type === 'shield' ? 0 : POWER_COST;
    if (p.base < cost) return { error: 'Monedas insuficientes' };
    const { alts } = this.quiz, players = this.list('player');
    if (type === 'shield') p.shieldOn = true;
    if (type === 'fifty') { // oculta 2 incorrectas al azar
      const wrong = [...Array(alts).keys()].filter(j => j !== this.quiz.questions[this.qIndex].correct).sort(() => Math.random() - .5);
      p.hidden = wrong.slice(0, 2);
      p.bets = p.bets.map((v, j) => (p.hidden.includes(j) ? 0 : v));
    }
    if (type === 'spy') {
      const conf = players.filter(x => x.confirmed);
      if (conf.length * 2 < players.length) return { error: 'El Espía se habilita cuando al menos el 50% haya confirmado' };
      const totals = Array(alts).fill(0), people = Array(alts).fill(0);
      conf.forEach(x => x.bets.forEach((v, j) => { totals[j] += v; if (v > 0) people[j]++; }));
      p.spy = { totals, people }; // foto de lo apostado hasta este instante
    }
    p.used[type] = true; p.base -= cost; p.coins -= cost;
    if (sum(p.bets) > p.base) p.bets = Array(alts).fill(0); // el costo redujo el pozo: reinicia la apuesta
    this.emitAll();
    return { ok: true };
  }

  /* ---------- Resolución → Paso A ---------- */
  resolve() {
    if (this.phase !== 'question') return;
    clearTimeout(this.timer); this.paused = false;
    const c = this.quiz.questions[this.qIndex].correct;
    for (const p of this.list('player')) {
      const kept = p.bets[c] || 0, lost = sum(p.bets) - kept;  // solo lo apostado a la correcta se conserva
      p.hit = kept > 0;
      p.bonus = p.hit && p.confirmed ? p.bonusPot : 0;          // bono solo en aciertos
      p.refund = p.shieldOn ? Math.floor(lost * SHIELD_PCT) : 0; // Escudo: 20% de lo perdido
      p.coins = kept + p.bonus + p.refund;
      p.delta = p.coins - p.start;
      p.hit ? p.right++ : p.wrong++;
      p.history.push({ q: this.qIndex + 1, delta: p.delta, coins: p.coins, hit: p.hit });
    }
    this.show('reveal');
  }

  /* ---------- Estado hacia cada cliente ---------- */
  state(token) {
    const ph = this.phase, post = POST.includes(ph);
    const q = this.quiz && this.quiz.questions[this.qIndex];
    const pl = this.list('player');
    const players = [...pl].sort((a, b) => b.coins - a.coins).map(p => ({
      name: p.name, coins: p.coins, online: p.online, right: p.right, wrong: p.wrong,
      delta: post ? p.delta : null, hit: post ? p.hit : null, confirmed: ph === 'question' && p.confirmed,
    }));
    const me = this.people.get(token), top = players[0] ? players[0].coins : 0;
    return {
      code: this.code, phase: ph, paused: this.paused, qIndex: this.qIndex, total: this.quiz ? this.quiz.n : 0,
      remaining: ph === 'question' ? this.remainingMs() : 0,
      question: q && (ph === 'question' || ph === 'reveal') ? { text: q.text, options: q.options } : null,
      correct: ph === 'reveal' ? q.correct : null,
      dist: ph === 'reveal' ? q.options.map((_, j) => { const bs = pl.map(p => p.bets[j] || 0); return { people: bs.filter(v => v > 0).length, coins: sum(bs) }; }) : null,
      players, specs: this.list('spectator').map(p => p.name), maxP: MAX_P, maxS: MAX_S,
      winners: ph === 'final' ? players.filter(p => p.coins === top && top > 0).map(p => p.name) : null,
      you: me ? {
        host: false, name: me.name, role: me.role, coins: me.coins, pool: me.base, confirmed: me.confirmed,
        bonusPot: me.bonusPot, bonus: me.bonus, refund: me.refund, bets: me.bets, delta: me.delta, hit: me.hit,
        history: me.history, gift: ph === 'question' && this.qIndex > 0,
        pw: { shield: me.shieldOn, hidden: me.hidden, spy: me.spy, used: me.used },
      } : { host: this.isHost(token) },
    };
  }

  emitAll() {
    const send = (sid, t) => this.io.to(sid).emit('state', this.state(t));
    if (this.host && this.host.online) send(this.host.sid, this.hostToken);
    for (const p of this.people.values()) if (p.online) send(p.sid, p.token);
  }
}

module.exports = Game;

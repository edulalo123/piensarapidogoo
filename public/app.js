const socket = io(), $ = s => document.querySelector(s), app = $('#app'), L = 'ABCDE';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sg = n => (n >= 0 ? '+' : '') + n, sum = a => a.reduce((x, y) => x + y, 0);
const POWER_COST = 40; // debe coincidir con server/game.js
let S = null, key = '', bets = [], endAt = 0, lastTick = 0, quizCode = null;

const toast = m => { const t = $('#toast'); t.textContent = m; t.className = 'show'; setTimeout(() => (t.className = ''), 3000); };
const tk = () => sessionStorage.tk || (sessionStorage.tk = Math.random().toString(36).slice(2) + Date.now().toString(36));
const canBet = () => S && S.phase === 'question' && !S.paused && S.you.role === 'player' && !S.you.confirmed && endAt > Date.now();

/* ---------- Conexión y reconexión ---------- */
function join(code, name, role, auto) {
  socket.emit('join', { code, name, role, token: tk() }, r => {
    if (r.error) {
      if (auto || r.error === 'Sala no encontrada') { delete sessionStorage.room; S = null; key = ''; Sound.stopMusic(); home(); }
      return toast(r.error);
    }
    Object.assign(sessionStorage, { room: r.code, name: name || '', role: role || '' });
    history.replaceState(null, '', '/sala/' + r.code);
  });
}
socket.on('connect', () => { if (sessionStorage.room) join(sessionStorage.room, sessionStorage.name || '', sessionStorage.role || 'player', true); });
socket.on('state', s => { S = s; render(); });

/* ---------- Inicio ---------- */
function home() {
  const c = (location.pathname.split('/')[2] || '').toUpperCase();
  app.innerHTML = `<section class="card center"><h1>🧠 Trivia de Apuestas</h1></section>
    <section class="card"><h2>Unirme a una sala</h2>
      <input id="nm" placeholder="Tu nombre" maxlength="20">
      <input id="cd" placeholder="Código de sala" maxlength="5" value="${esc(c)}">
      <div class="roles"><label><input type="radio" name="role" value="player" checked>Jugador</label>
      <label><input type="radio" name="role" value="spectator">Espectador</label></div>
      <button id="jn" class="big">Entrar</button></section>
    <section class="card"><h2>Organizar una partida</h2><button id="cr" class="big alt">Crear sala</button></section>`;
  $('#jn').onclick = () => join($('#cd').value.trim().toUpperCase(), $('#nm').value.trim(), document.querySelector('[name=role]:checked').value);
  $('#cr').onclick = () => socket.emit('create', null, r => { sessionStorage.tk = r.token; join(r.code, '', ''); });
}

/* ---------- Render: se reconstruye la pantalla solo cuando cambia la "llave" ---------- */
function render() {
  const y = S.you, ph = S.phase;
  const pw = y.pw ? [y.pw.shield, y.pw.hidden.length > 0, !!y.pw.spy].map(Number).join('') : '';
  const k = ph + (S.qIndex >= 0 && ph !== 'final' ? S.qIndex : '') + (y.confirmed ? 'c' : '') + (ph === 'question' ? pw : '');
  if (k !== key) { key = k; document.body.dataset.tab = 'q'; build(); }
  document.body.dataset.paused = S.paused ? '1' : '0';
  update();
  if (ph === 'question') Sound.music(); else Sound.stopMusic();
}

/* ---------- Componentes ---------- */
// Controles de apuesta rápida por opción: ±10, 25/50/75 % del pozo, All-In
const ctl = j => `<div class="ctl"><button data-a="-" data-j="${j}">−10</button>
  <input type="number" min="0" value="${bets[j]}" data-j="${j}"><button data-a="+" data-j="${j}">+10</button>
  ${[25, 50, 75].map(p => `<button class="alt" data-a="${p}" data-j="${j}">${p}%</button>`).join('')}
  <button class="alt" data-a="all" data-j="${j}">All-In</button></div>`;

const powerHTML = () => `<div class="power"><button id="pw-shield" data-p="shield">🛡 Escudo · gratis</button>
  <button id="pw-fifty" data-p="fifty">✂ 50/50 · ${POWER_COST}</button><button id="pw-spy" data-p="spy">🕵 Espía · ${POWER_COST}</button></div>`;

const hostBar = () => `<div class="hostbar"><button id="pz" class="alt">⏸ Pausar</button><button id="p10" class="alt">+10 s</button><button id="sk" class="alt">⏭ Saltar tiempo</button></div>`;

const nxt = () => `<p class="muted">Continúa automáticamente.</p>${S.you.host ? '<button id="skip">Siguiente ahora</button>' : ''}`;

const spyHTML = s => {
  const mx = Math.max(...s.totals, 1), top = s.totals.indexOf(Math.max(...s.totals));
  return `<div class="spy"><h3>🕵 Lo que apuestan los demás (hasta ahora)</h3>${s.totals.map((v, j) =>
    `<div class="bar2"><b>${L[j]}</b><div class="fill" style="width:${Math.round(v / mx * 100)}%"></div><span>${v} 🪙 · ${s.people[j]} 👥${v > 0 && j === top ? ' ⭐' : ''}</span></div>`).join('')}</div>`;
};

function podiumHTML() {
  const t = S.players.slice(0, 3), m = ['🥇', '🥈', '🥉'];
  if (!t.length) return '';
  return `<div class="podium">${[1, 0, 2].filter(i => t[i]).map(i =>
    `<div class="pd p${i + 1}"><div class="who">${esc(t[i].name)}</div><div>${t[i].coins} 🪙</div><div class="step">${m[i]}</div></div>`).join('')}</div>`;
}

function rankHTML() {
  return `<h2>Ranking</h2><table>` + S.players.map(p =>
    `<tr class="${p.name === S.you.name ? 'me' : ''}"><td>${S.players.findIndex(x => x.coins === p.coins) + 1}</td>
    <td>${esc(p.name)}${p.online ? '' : ' ⚫'}</td><td>${p.coins} 🪙</td>
    <td>${p.delta !== null ? sg(p.delta) : ''}</td><td>${p.confirmed ? '✔' : ''}</td></tr>`).join('') + '</table>';
}

/* ---------- Construcción de pantallas ---------- */
function build() {
  const y = S.you, q = S.question, ph = S.phase;
  lastTick = 0;
  if (ph === 'lobby') return lobby();

  if (ph === 'final') { // Paso D (final)
    Sound.win();
    app.innerHTML = `<section class="card center"><h1>🏆 Ranking definitivo</h1><h2 id="win"></h2><div id="pod"></div></section>
      <section class="card" id="people"></section>
      ${y.role === 'player' && y.history.length ? `<section class="card"><h3>Tu historial</h3><div class="chips">${y.history.map(h => `<span>P${h.q}: ${sg(h.delta)} → ${h.coins}</span>`).join('')}</div></section>` : ''}`;
    return;
  }

  if (ph === 'reveal') { // Paso A: respuesta correcta + cuánta gente apostó + quién ganó/perdió
    if (y.role === 'player' && !y.hit) Sound.bad(); else Sound.good();
    app.innerHTML = `<section class="card"><h2>✅ Respuesta correcta</h2><h2 class="qt">${esc(q.text)}</h2>
      ${q.options.map((o, j) => `<div class="row${j === S.correct ? ' ok' : ''}"><b>${L[j]}</b><span>${esc(o)}</span><small>👥 ${S.dist[j].people} · ${S.dist[j].coins} 🪙</small></div>`).join('')}
      <p id="mine"></p><div id="wl"></div>${nxt()}</section>`;
    return;
  }

  if (ph === 'summary') { // Paso B: correctas e incorrectas acumuladas por participante
    app.innerHTML = `<section class="card"><h2>📊 Resumen individual</h2><p class="muted">Acumulado hasta la pregunta ${S.qIndex + 1}</p><table id="sumt"></table>${nxt()}</section>`;
    return;
  }

  if (ph === 'ranking') { // Paso C: podio + tabla con saldos
    app.innerHTML = `<section class="card center"><h2>🏅 Ranking</h2><div id="pod"></div>${nxt()}</section><section class="card" id="people"></section>`;
    return;
  }

  // Pantalla de pregunta
  const hid = (y.pw && y.pw.hidden) || [];
  bets = y.bets && y.bets.length === q.options.length ? y.bets.slice() : Array(q.options.length).fill(0);
  const pl = y.role === 'player', act = pl && !y.confirmed;
  app.innerHTML = `${pl ? '' : '<nav class="tabs"><button data-t="q">Pregunta</button><button data-t="rank">Ranking</button></nav>'}
    <section class="card" id="qsec"><div class="bar"><span>Pregunta ${S.qIndex + 1}/${S.total}</span><b id="timer" class="timer"></b></div>
    ${y.host ? hostBar() : ''}
    <h2 class="qt">${esc(q.text)}</h2>
    ${q.options.map((o, j) => hid.includes(j)
      ? `<div class="row gone"><b>${L[j]}</b><span>${esc(o)}</span><em>eliminada</em></div>`
      : `<div class="row"><b>${L[j]}</b><span>${esc(o)}</span>${act ? ctl(j) : pl ? `<strong>${bets[j]} 🪙</strong>` : ''}</div>`).join('')}
    ${y.pw && y.pw.spy ? spyHTML(y.pw.spy) : ''}
    <div id="hud"></div>
    ${act ? powerHTML() + '<div class="actions"><button id="eq" class="alt">Repartir por igual</button><button id="clr" class="alt">Limpiar apuesta</button></div><button id="ok" class="big">Confirmar apuesta</button>' : ''}
    </section>${pl ? '' : '<section class="card tabbed" id="people"></section>'}`;
}

function update() {
  const y = S.you, ph = S.phase, pe = $('#people');
  if (ph === 'lobby') {
    const chips = a => a.map(n => `<span>${esc(n)}</span>`).join('') || '<em>Nadie aún</em>';
    pe.innerHTML = `<h3>Jugadores (${S.players.length}/${S.maxP})</h3><div class="chips">${chips(S.players.map(p => p.name))}</div>
      <h3>Espectadores (${S.specs.length}/${S.maxS})</h3><div class="chips">${chips(S.specs)}</div>`;
    return;
  }
  if (ph === 'question') {
    endAt = Date.now() + S.remaining; hud(); pwUpdate();
    const pz = $('#pz'); if (pz) pz.textContent = S.paused ? '▶ Reanudar' : '⏸ Pausar';
  }
  if (ph === 'reveal') {
    const w = S.players.filter(p => p.hit), l = S.players.filter(p => !p.hit);
    const chips = a => a.map(p => `<span>${esc(p.name)} ${sg(p.delta)}</span>`).join('') || '<em>Nadie</em>';
    $('#wl').innerHTML = `<h3>✅ Acertaron (${w.length})</h3><div class="chips">${chips(w)}</div><h3>❌ No acertaron (${l.length})</h3><div class="chips">${chips(l)}</div>`;
    $('#mine').innerHTML = y.role === 'player'
      ? `${y.hit ? '✅ ¡Acertaste!' : '❌ No acertaste'} · <b>${sg(y.delta)} 🪙</b>${y.bonus ? ` · bono rapidez +${y.bonus}` : ''}${y.refund ? ` · escudo +${y.refund}` : ''}` : '';
  }
  if (ph === 'summary')
    $('#sumt').innerHTML = '<tr><td></td><td>Jugador</td><td>✅</td><td>❌</td></tr>' + [...S.players].sort((a, b) => b.right - a.right).map(p =>
      `<tr class="${p.name === y.name ? 'me' : ''}"><td></td><td>${esc(p.name)}</td><td>${p.right}</td><td>${p.wrong}</td></tr>`).join('');
  if (ph === 'ranking') $('#pod').innerHTML = podiumHTML();
  if (ph === 'final') {
    $('#pod').innerHTML = podiumHTML();
    $('#win').textContent = S.winners.length ? `${S.winners.length > 1 ? 'Ganadores' : 'Ganador'}: ${S.winners.join(', ')} · ${S.players[0].coins} 🪙` : 'Nadie tiene monedas';
  }
  if (pe) pe.innerHTML = rankHTML();
}

function hud() {
  const h = $('#hud'); if (!h) return;
  const y = S.you;
  if (y.role === 'player') {
    const left = y.pool - sum(bets);
    h.innerHTML = y.confirmed
      ? `✅ Apuesta confirmada · si aciertas ganas <b>+${y.bonusPot}</b> de bono por rapidez`
      : `${y.gift ? '🎁 +10 de regalo · ' : ''}Pozo: <b>${y.pool} 🪙</b> · Sin asignar: <b>${left}</b> ${left ? '<small>(se pierden si no las apuestas)</small>' : ''}<br><small>Bono si aciertas: 1 moneda por cada 2 s restantes (máx. 30)</small>`;
  } else h.innerHTML = `Confirmaron <b>${S.players.filter(p => p.confirmed).length}</b> de ${S.players.length} jugadores.${S.paused ? ' · <b>⏸ En pausa</b>' : ''}`;
}

// Habilita/deshabilita comodines según saldo, usos y confirmaciones (Espía: ≥50% de la sala)
function pwUpdate() {
  const y = S.you; if (!y.pw || y.confirmed) return;
  const c = S.players.filter(p => p.confirmed).length;
  const off = { shield: y.pw.used.shield, fifty: y.pw.used.fifty || y.pool < POWER_COST, spy: y.pw.used.spy || y.pool < POWER_COST || c * 2 < S.players.length };
  for (const k in off) { const b = $('#pw-' + k); if (b) b.disabled = off[k]; }
  const s = $('#pw-shield'); if (s && y.pw.shield) s.textContent = '🛡 Escudo activo ✔';
  const sp = $('#pw-spy'); if (sp && !y.pw.used.spy) sp.title = 'Se habilita cuando al menos el 50% haya confirmado';
}

/* ---------- Apuestas (validación en frontend: nunca superar el pozo) ---------- */
function sync(send = true) {
  document.querySelectorAll('input[data-j]').forEach(i => { if (i !== document.activeElement) i.value = bets[+i.dataset.j]; });
  hud();
  if (send) socket.emit('bet', bets);
}
function setBet(j, v) {
  if (!canBet()) return;
  const others = sum(bets) - bets[j];
  bets[j] = Math.max(0, Math.min(Math.floor(v) || 0, S.you.pool - others)); // tope = pozo − lo ya asignado
  sync();
}
function confirmBet() {
  if (sum(bets) > S.you.pool) return toast('No puedes apostar más de tu pozo');
  if (S.you.pool > 0 && sum(bets) === 0) return toast('Apuesta al menos 1 moneda');
  socket.emit('confirm', bets, r => (r.error ? toast(r.error) : Sound.coin()));
}

app.addEventListener('click', e => {
  const t = e.target, id = t.id, a = t.dataset.a, j = +t.dataset.j;
  // Controles del host
  if (id === 'skip' || id === 'sk') return socket.emit('ctl', 'skip');
  if (id === 'pz') return socket.emit('ctl', S.paused ? 'resume' : 'pause');
  if (id === 'p10') return socket.emit('ctl', 'add');
  if (t.dataset.t) { document.body.dataset.tab = t.dataset.t; return; }
  if (!canBet()) return;
  if (t.dataset.p) return socket.emit('power', t.dataset.p, r => (r.error ? toast(r.error) : Sound.coin()));
  const pool = S.you.pool;
  if (id === 'ok') return confirmBet();
  if (id === 'clr') bets = bets.map(() => 0);
  else if (id === 'eq') { const hid = S.you.pw.hidden, ok = bets.map((_, i) => i).filter(i => !hid.includes(i)); bets = bets.map((_, i) => (ok.includes(i) ? Math.floor(pool / ok.length) + (ok.indexOf(i) < pool % ok.length ? 1 : 0) : 0)); }
  else if (a === 'all') bets = bets.map((_, i) => (i === j ? pool : 0));
  else if (a === '+' || a === '-') { setBet(j, bets[j] + (a === '+' ? 10 : -10)); return Sound.coin(); }
  else if (a) { setBet(j, Math.floor(pool * Number(a) / 100)); return Sound.coin(); } // 25 / 50 / 75 %
  else return;
  if (id !== 'clr') Sound.coin();
  sync();
});
app.addEventListener('input', e => { const i = e.target; if (i.type === 'number' && i.dataset.j !== undefined) setBet(+i.dataset.j, +i.value); });
app.addEventListener('change', e => { if (e.target.type === 'number' && e.target.dataset.j !== undefined) sync(false); });

setInterval(() => {
  const t = $('#timer'); if (!t || !S || S.phase !== 'question') return;
  const ms = S.paused ? S.remaining : Math.max(0, endAt - Date.now()), s = Math.ceil(ms / 1000);
  t.textContent = (S.paused ? '⏸ ' : '') + s + ' s'; t.classList.toggle('low', s <= 10);
  if (!S.paused && s <= 10 && s > 0 && s !== lastTick) { lastTick = s; Sound.tick(); }
}, 200);

/* ---------- Lobby y editor del creador ---------- */
function lobby() {
  const host = S.you.host;
  app.innerHTML = `<section class="card"><h1>🧠 Sala <span class="code">${S.code}</span></h1>
    <div class="linkrow"><input id="link" readonly value="${location.origin}/sala/${S.code}"><button id="copy">Copiar</button></div></section>
    ${host ? editorHTML() : '<section class="card center"><h2>Esperando a que el creador inicie…</h2></section>'}
    <section class="card" id="people"></section>`;
  $('#copy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText($('#link').value); toast('Enlace copiado'); };
  if (host) initEditor();
}

function editorHTML() {
  const opts = (vals, def, u) => vals.map(v => `<option value="${v}"${v === def ? ' selected' : ''}>${v}${u}</option>`).join('');
  return `<section class="card"><h2>Configuración</h2><div class="grid3">
      <label>Preguntas<select id="n">${opts([5, 10, 15], 10, '')}</select></label>
      <label>Alternativas<select id="alts">${opts([4, 5], 5, '')}</select></label>
      <label>Tiempo<select id="time">${opts([30, 60, 90, 120], 60, ' s')}</select></label></div></section>
    <section class="card"><h2>Rondas guardadas</h2><p id="qc" class="muted"></p>
      <div class="linkrow"><input id="lc" placeholder="Código de ronda" maxlength="6"><button id="load">Cargar</button></div>
      <div class="linkrow"><button id="save">Guardar</button><button id="savenew" class="alt">Guardar como nueva</button><button id="newq" class="alt">Limpiar</button></div></section>
    <div id="editor">${Array.from({ length: 15 }, (_, i) => `<section class="card q"><h3>Pregunta ${i + 1}</h3>
      <textarea rows="2" maxlength="300" placeholder="Enunciado"></textarea>
      ${[0, 1, 2, 3, 4].map(j => `<label class="eo"><input type="radio" name="c${i}" value="${j}" title="Correcta"><b>${L[j]}</b><input type="text" maxlength="120" placeholder="Alternativa ${L[j]}"></label>`).join('')}
      <small>Marca el círculo de la respuesta correcta.</small></section>`).join('')}</div>
    <button id="start" class="big">Iniciar partida</button>`;
}

const collect = () => ({
  n: +$('#n').value, alts: +$('#alts').value, time: +$('#time').value,
  questions: [...document.querySelectorAll('.q')].map(c => ({
    text: c.querySelector('textarea').value,
    options: [...c.querySelectorAll('input[type=text]')].map(i => i.value),
    correct: +((c.querySelector('input[type=radio]:checked') || { value: -1 }).value),
  })),
});
const saveDraft = () => { localStorage.draft2 = JSON.stringify({ quizCode, ...collect() }); };
const showQC = () => { $('#qc').innerHTML = quizCode ? `Editando la ronda <span class="code">${quizCode}</span>` : 'Ronda nueva (aún sin guardar)'; };

function applyCfg() {
  const n = +$('#n').value, a = +$('#alts').value;
  document.querySelectorAll('.q').forEach((c, i) => { c.hidden = i >= n; c.querySelectorAll('.eo')[4].hidden = a < 5; });
}
function fill(d) {
  $('#n').value = d.n; $('#alts').value = d.alts; $('#time').value = d.time;
  document.querySelectorAll('.q').forEach((c, i) => {
    const q = (d.questions || [])[i] || { text: '', options: [], correct: -1 };
    c.querySelector('textarea').value = q.text || '';
    c.querySelectorAll('input[type=text]').forEach((x, j) => (x.value = (q.options || [])[j] || ''));
    c.querySelectorAll('input[type=radio]').forEach(r => (r.checked = +r.value === +q.correct));
  });
  applyCfg();
}

function initEditor() {
  try { const d = JSON.parse(localStorage.draft2 || 'null'); if (d) { quizCode = d.quizCode || null; fill(d); } } catch (e) { /* borrador dañado */ }
  applyCfg(); showQC();
  ['#n', '#alts', '#time'].forEach(s => ($(s).onchange = () => { applyCfg(); saveDraft(); }));
  $('#editor').addEventListener('input', saveDraft); $('#editor').addEventListener('change', saveDraft);
  $('#load').onclick = () => socket.emit('quiz:load', $('#lc').value.trim(), r => {
    if (r.error) return toast(r.error);
    quizCode = r.code; fill(r.quiz); showQC(); saveDraft(); toast('Ronda cargada');
  });
  const store = code => socket.emit('quiz:save', { code, quiz: collect() }, r => {
    if (r.error) return toast(r.error);
    quizCode = r.code; showQC(); saveDraft(); toast('Ronda guardada: ' + r.code);
  });
  $('#save').onclick = () => store(quizCode);
  $('#savenew').onclick = () => store(null);
  $('#newq').onclick = () => { quizCode = null; fill({ n: 10, alts: 5, time: 60, questions: [] }); showQC(); saveDraft(); };
  $('#start').onclick = () => socket.emit('start', collect(), r => r && r.error && toast(r.error));
}

/* ---------- Sonido ---------- */
document.addEventListener('pointerdown', Sound.init);
$('#snd').textContent = Sound.muted ? '🔇' : '🔊';
$('#snd').onclick = () => { Sound.toggle(); $('#snd').textContent = Sound.muted ? '🔇' : '🔊'; if (S && S.phase === 'question') Sound.music(); };

home();

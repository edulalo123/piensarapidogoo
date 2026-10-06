const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const rooms = require('./roomManager');
const quizzes = require('./quizStore');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const pub = path.join(__dirname, '../public');

app.use(express.static(pub));
app.get('/sala/:code', (_, res) => res.sendFile(path.join(pub, 'index.html')));

io.on('connection', socket => {
  let room = null, token = null;
  const isHost = () => room && room.isHost(token);

  socket.on('create', (_, ack) => {
    const g = rooms.create(io);
    ack({ code: g.code, token: g.hostToken });
  });

  socket.on('join', ({ code, name, role, token: t } = {}, ack) => {
    const g = rooms.get(code);
    if (!g) return ack({ error: 'Sala no encontrada' });
    if (!t) return ack({ error: 'Sesión inválida' });
    const r = g.join(socket.id, String(t), String(name || '').trim().slice(0, 20), role);
    if (r.error) return ack(r);
    room = g; token = String(t);
    ack({ ok: true, code: g.code });
    g.emitAll();
  });

  // Gestión de rondas (solo el creador)
  socket.on('quiz:save', ({ code, quiz } = {}, ack) => ack(isHost() ? quizzes.save(code, quiz) : { error: 'Solo el creador' }));
  socket.on('quiz:load', (code, ack) => {
    if (!isHost()) return ack({ error: 'Solo el creador' });
    const q = quizzes.get(code);
    ack(q ? { ok: true, code: String(code).toUpperCase(), quiz: q } : { error: 'Ronda no encontrada' });
  });

  socket.on('start', (data, ack) => ack(isHost() ? room.start(data) : { error: 'Solo el creador' }));
  socket.on('bet', bets => room && room.bet(token, bets));
  socket.on('confirm', (bets, ack) => ack(room ? room.confirm(token, bets) : { error: 'Sin sala' }));
  socket.on('power', (type, ack) => ack(room ? room.power(token, type) : { error: 'Sin sala' })); // comodines
  socket.on('ctl', action => isHost() && room.control(action)); // host: pause | resume | add | skip
  socket.on('disconnect', () => room && room.leave(token, socket.id));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Trivia lista en http://localhost:${PORT}`));

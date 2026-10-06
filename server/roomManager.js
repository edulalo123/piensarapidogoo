const { randomUUID } = require('crypto');
const Game = require('./game');

const rooms = new Map();
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin caracteres ambiguos (0/O, 1/I)

function newCode() {
  let c;
  do { c = Array.from({ length: 5 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join(''); }
  while (rooms.has(c));
  return c;
}

module.exports = {
  create(io) {
    const g = new Game(newCode(), randomUUID(), io);
    rooms.set(g.code, g);
    return g;
  },
  get: code => rooms.get(String(code || '').toUpperCase()),
};

// Limpia salas con más de 6 horas
setInterval(() => {
  for (const [c, g] of rooms) if (Date.now() - g.created > 6 * 3600e3) rooms.delete(c);
}, 10 * 60e3).unref();

/*
 * Almacenamiento de cuestionarios ("rondas") en data/quizzes.json
 * Estructura:
 * {
 *   "K7M2QX": {                       <- código único de ronda (6 caracteres)
 *     "n": 10, "alts": 4, "time": 60, <- preguntas (5/10/15), alternativas (4/5), segundos
 *     "questions": [ { "text": "...", "options": ["A","B","C","D"], "correct": 2 }, ... ],
 *     "updated": 1790000000000
 *   }
 * }
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '../data/quizzes.json');
const CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let db = {};
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* primera vez */ }

const persist = () => {
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); }
  catch (e) { console.error('No se pudo guardar:', e.message); }
};
const newCode = () => Array.from({ length: 6 }, () => CH[Math.floor(Math.random() * CH.length)]).join('');

function validate(q) {
  q = q || {};
  const n = +q.n, alts = +q.alts, time = +q.time;
  if (![5, 10, 15].includes(n)) return { error: 'Cantidad de preguntas no válida (5, 10 o 15)' };
  if (![4, 5].includes(alts)) return { error: 'Las alternativas deben ser 4 o 5' };
  if (![30, 60, 90, 120].includes(time)) return { error: 'Tiempo no válido' };
  if (!Array.isArray(q.questions) || q.questions.length < n) return { error: `Se requieren ${n} preguntas` };
  const questions = [];
  for (let i = 0; i < n; i++) {
    const x = q.questions[i] || {};
    const text = String(x.text || '').trim().slice(0, 300);
    const options = (x.options || []).slice(0, alts).map(o => String(o || '').trim().slice(0, 120));
    const correct = Number(x.correct);
    if (!text || options.length !== alts || options.some(o => !o) || !Number.isInteger(correct) || correct < 0 || correct >= alts)
      return { error: `Completa la pregunta ${i + 1} y marca su respuesta correcta` };
    questions.push({ text, options, correct });
  }
  return { n, alts, time, questions };
}

function save(code, quiz) {
  const v = validate(quiz);
  if (v.error) return v;
  code = code ? String(code).toUpperCase() : null;
  if (code && !db[code]) return { error: 'Código de ronda no encontrado' };
  if (!code) { do { code = newCode(); } while (db[code]); }
  db[code] = { ...v, updated: Date.now() };
  persist();
  return { ok: true, code };
}

const get = code => db[String(code || '').toUpperCase()];

module.exports = { validate, save, get };

// Academia: progreso de lecciones, corrección de quizzes y tareas prácticas
// comprobadas con los datos reales del usuario (operaciones, órdenes, diario…).
const { MODULES, LESSONS, BADGES, PASS } = require('../public/courses');
const { category } = require('./market');
const { BrokerError } = require('./broker');

class Academy {
  constructor(db) {
    this.db = db;
  }

  logActivity(userId, kind) {
    this.db.prepare('INSERT INTO activity (user_id, kind) VALUES (?, ?)').run(userId, kind);
  }

  // Cada tarea es una consulta sobre lo que el usuario ha hecho de verdad en el simulador.
  checks(userId) {
    const one = (sql, ...args) => this.db.prepare(sql).get(userId, ...args);
    const count = (sql, ...args) => Object.values(one(sql, ...args))[0];
    const activity = (kind) => count('SELECT COUNT(*) FROM activity WHERE user_id = ? AND kind = ?', kind) > 0;
    const trades = this.db.prepare('SELECT symbol FROM trades WHERE user_id = ? AND bot_id IS NULL').all(userId);
    const journalNotes = count("SELECT COUNT(*) FROM journal WHERE user_id = ? AND (COALESCE(notes, '') != '' OR COALESCE(lesson, '') != '' OR setup IS NOT NULL)");
    return {
      trade: trades.length > 0,
      limit_order: count("SELECT COUNT(*) FROM orders WHERE user_id = ? AND type = 'limit' AND oco IS NULL") > 0,
      sell: count("SELECT COUNT(*) FROM trades WHERE user_id = ? AND side = 'sell' AND bot_id IS NULL") > 0,
      bracket: count('SELECT COUNT(*) FROM orders WHERE user_id = ? AND oco IS NOT NULL') > 0,
      stop_order: count("SELECT COUNT(*) FROM orders WHERE user_id = ? AND type = 'stop'") > 0,
      diversify3: count('SELECT COUNT(*) FROM holdings WHERE user_id = ?') >= 3,
      journal: journalNotes >= 1,
      journal5: journalNotes >= 5,
      forex_trade: trades.some((t) => category(t.symbol) === 'Forex'),
      backtest: activity('backtest'),
      replay: count('SELECT COUNT(*) FROM replay_sessions WHERE user_id = ?') > 0,
      custom_strategy: count('SELECT COUNT(*) FROM custom_strategies WHERE user_id = ?') > 0 || activity('custom_strategy'),
      bot: count('SELECT COUNT(*) FROM bots WHERE user_id = ?') > 0 || activity('bot'),
    };
  }

  progress(userId) {
    const rows = this.db.prepare('SELECT lesson_id, quiz_score, completed_at FROM lesson_progress WHERE user_id = ?').all(userId);
    const done = Object.fromEntries(rows.map((r) => [r.lesson_id, r]));
    const checks = this.checks(userId);
    const moduleDone = (m) => m.lessons.every((l) => done[l.id]);
    const badges = BADGES.filter((b) => (b.task ? checks[b.task] : b.module ? moduleDone(MODULES.find((m) => m.id === b.module)) : b.all ? LESSONS.every((l) => done[l.id]) : false)).map((b) => b.id);
    return {
      lessons: done,
      checks,
      badges,
      completed: rows.length,
      total: LESSONS.length,
      xp: rows.length * 100 + badges.length * 50,
    };
  }

  // Corrige el quiz en el servidor y marca la lección como completada si se aprueba
  // y, cuando la lección tiene tarea práctica, ésta ya está hecha.
  submit(userId, lessonId, answers) {
    const lesson = LESSONS.find((l) => l.id === lessonId);
    if (!lesson) throw new BrokerError('Lección no encontrada', 404);
    if (!Array.isArray(answers) || answers.length !== lesson.quiz.length) throw new BrokerError('Responde todas las preguntas');
    const results = lesson.quiz.map((q, i) => ({ correct: Number(answers[i]) === q.answer, answer: q.answer, explain: q.explain }));
    const score = results.filter((r) => r.correct).length / lesson.quiz.length;
    const passed = score >= PASS;
    const taskDone = !lesson.task || this.checks(userId)[lesson.task.id];
    const completed = passed && taskDone;
    if (completed) {
      this.db
        .prepare('INSERT INTO lesson_progress (user_id, lesson_id, quiz_score) VALUES (?, ?, ?) ON CONFLICT(user_id, lesson_id) DO UPDATE SET quiz_score = MAX(quiz_score, excluded.quiz_score)')
        .run(userId, lessonId, score);
    }
    return { score, passed, taskDone, completed, results, progress: this.progress(userId) };
  }
}

module.exports = { Academy };

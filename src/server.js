const path = require('node:path');
const express = require('express');
const { openDb } = require('./db');
const { Market } = require('./market');
const { Broker, BrokerError } = require('./broker');
const { BotManager } = require('./bots');
const { backtest } = require('./backtest');
const { publicList } = require('./strategies');
const { schema, validateDefinition } = require('./custom');
const { Academy } = require('./academy');
const { AIAdvisor, marketContext } = require('./ai');

const JOURNAL_SETUPS = ['Tendencia', 'Ruptura', 'Reversión', 'Soporte/resistencia', 'Cruce de medias', 'RSI/osciladores', 'FVG', 'Order Block', 'Barrida de liquidez', 'Noticia', 'DCA / largo plazo', 'Otro'];
const JOURNAL_EMOTIONS = ['Tranquilo', 'Seguro', 'Dudoso', 'Ansioso', 'FOMO', 'Revancha', 'Aburrido', 'Eufórico'];

function createApp(broker, market, bots, advisor = new AIAdvisor(broker.db)) {
  const app = express();
  const academy = new Academy(broker.db);
  app.use(express.json({ limit: '32kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const auth = (req, res, next) => {
    const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const user = broker.userByToken(token);
    if (!user) return res.status(401).json({ error: 'Inicia sesión para continuar' });
    req.user = user;
    req.token = token;
    next();
  };

  const api = express.Router();

  api.get('/config', (req, res) => {
    res.json({
      ...market.info(),
      initialCash: broker.initialCash,
      feeRate: broker.feeRate,
      feeRates: Object.fromEntries(market.symbols.map((s) => [s, broker.feeFor(s)])),
      minNotional: broker.minNotional,
    });
  });

  api.get('/tickers', (req, res) => res.json(market.tickers));

  api.get('/ohlcv', async (req, res, next) => {
    try {
      const { symbol, timeframe = '1h', limit = 120 } = req.query;
      res.json(await market.ohlcv(String(symbol), String(timeframe), Math.min(Number(limit) || 120, 1000)));
    } catch (e) {
      next(e instanceof BrokerError ? e : new BrokerError(e.message, 502));
    }
  });

  api.post('/register', (req, res) => {
    const token = broker.register(req.body?.username, req.body?.password);
    res.status(201).json({ token });
  });

  api.post('/login', (req, res) => {
    res.json({ token: broker.login(req.body?.username, req.body?.password) });
  });

  api.post('/logout', auth, (req, res) => {
    broker.logout(req.token);
    res.json({ ok: true });
  });

  api.get('/me', auth, (req, res) => res.json(broker.portfolio(req.user.id)));
  api.get('/trades', auth, (req, res) => res.json(broker.trades(req.user.id)));
  api.get('/orders', auth, (req, res) => res.json(broker.orders(req.user.id)));

  // Guarda las notas del diario escritas al abrir la operación (opcionales).
  const saveJournal = (userId, tradeId, j) => {
    if (!j || !tradeId) return;
    const setup = JOURNAL_SETUPS.includes(j.setup) ? j.setup : null;
    const emotion = JOURNAL_EMOTIONS.includes(j.emotion) ? j.emotion : null;
    const notes = String(j.notes ?? '').slice(0, 2000) || null;
    const lesson = String(j.lesson ?? '').slice(0, 1000) || null;
    const rating = [1, 2, 3, 4, 5].includes(Number(j.rating)) ? Number(j.rating) : null;
    broker.db
      .prepare(`INSERT INTO journal (trade_id, user_id, setup, emotion, notes, lesson, rating) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(trade_id) DO UPDATE SET setup = excluded.setup, emotion = excluded.emotion, notes = excluded.notes,
                lesson = excluded.lesson, rating = excluded.rating, updated_at = datetime('now')`)
      .run(tradeId, userId, setup, emotion, notes, lesson, rating);
  };

  api.post('/orders', auth, (req, res) => {
    const { symbol, side, type = 'market', qty, price, stop, target, journal } = req.body ?? {};
    if (type === 'market' && side === 'buy' && stop) {
      const r = broker.bracketBuy(req.user.id, symbol, qty, stop, target);
      saveJournal(req.user.id, r.trade.id, journal);
      return res.status(201).json(r);
    }
    if (type === 'market') {
      const trade = broker.marketOrder(req.user.id, symbol, side, qty);
      saveJournal(req.user.id, trade.id, journal);
      return res.status(201).json({ trade });
    }
    res.status(201).json({ order: broker.placeOrder(req.user.id, symbol, side, type, qty, price) });
  });

  // ---------- Diario de trading ----------
  api.get('/journal', auth, (req, res) => {
    const rows = broker.db
      .prepare(`SELECT t.*, j.setup, j.emotion, j.notes, j.lesson, j.rating
                FROM trades t LEFT JOIN journal j ON j.trade_id = t.id
                WHERE t.user_id = ? ORDER BY t.id DESC LIMIT 1000`)
      .all(req.user.id);
    res.json({ setups: JOURNAL_SETUPS, emotions: JOURNAL_EMOTIONS, trades: rows });
  });

  api.put('/journal/:tradeId', auth, (req, res) => {
    const id = Number(req.params.tradeId);
    if (!broker.db.prepare('SELECT 1 FROM trades WHERE id = ? AND user_id = ?').get(id, req.user.id)) throw new BrokerError('Operación no encontrada', 404);
    saveJournal(req.user.id, id, req.body ?? {});
    res.json({ ok: true });
  });

  // ---------- Modo Replay ----------
  api.get('/history', async (req, res) => {
    const { symbol, timeframe = '1h', since, limit = 500 } = req.query;
    try {
      res.json(await market.history(String(symbol), String(timeframe), Number(since), Number(limit)));
    } catch (e) {
      throw new BrokerError(e.message, 400);
    }
  });

  api.get('/replay-sessions', auth, (req, res) => {
    res.json(broker.db.prepare('SELECT id, symbol, timeframe, start_ts, end_ts, initial, final, trades, win_rate, max_dd, created_at FROM replay_sessions WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id));
  });

  api.post('/replay-sessions', auth, (req, res) => {
    const b = req.body ?? {};
    if (!market.symbols.includes(b.symbol)) throw new BrokerError('Símbolo no soportado');
    const nums = ['start_ts', 'end_ts', 'initial', 'final', 'trades', 'win_rate', 'max_dd'].map((k) => Number(b[k]));
    if (nums.some((v) => !Number.isFinite(v))) throw new BrokerError('Datos de la sesión inválidos');
    const data = JSON.stringify(Array.isArray(b.data) ? b.data.slice(0, 500) : []);
    const r = broker.db
      .prepare('INSERT INTO replay_sessions (user_id, symbol, timeframe, start_ts, end_ts, initial, final, trades, win_rate, max_dd, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.user.id, b.symbol, String(b.timeframe).slice(0, 4), ...nums, data.slice(0, 200000));
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });

  // ---------- IA (Claude) ----------
  api.get('/ai', auth, (req, res) => res.json(advisor.info(req.user.id)));

  // Análisis educativo del gráfico actual.
  api.post('/ai/analyze', auth, async (req, res) => {
    const { symbol, timeframe = '1h' } = req.body ?? {};
    if (!market.symbols.includes(symbol)) throw new BrokerError('Símbolo no soportado');
    const candles = await market.ohlcv(symbol, String(timeframe), 300);
    const r = await advisor.explain(req.user.id,
      'Analiza este gráfico para un alumno que está aprendiendo. Incluye: 1) tendencia y estructura, 2) niveles clave (soportes/resistencias, FVG, order blocks, liquidez), 3) un escenario alcista y uno bajista, con qué los confirmaría y qué los invalidaría, 4) qué vigilar en las próximas velas. Termina con un recordatorio breve de gestión del riesgo.',
      marketContext(symbol, String(timeframe), candles));
    res.json(r);
  });

  // Revisión de una operación del diario: qué se hizo bien y qué mejorar.
  api.post('/ai/review/:tradeId', auth, async (req, res) => {
    const t = broker.db
      .prepare('SELECT t.*, j.setup, j.emotion, j.notes, j.lesson FROM trades t LEFT JOIN journal j ON j.trade_id = t.id WHERE t.id = ? AND t.user_id = ?')
      .get(Number(req.params.tradeId), req.user.id);
    if (!t) throw new BrokerError('Operación no encontrada', 404);
    // Para una venta, se incluye la compra previa del mismo activo (la entrada).
    const entry = t.side === 'sell'
      ? broker.db.prepare("SELECT t.*, j.setup, j.emotion, j.notes FROM trades t LEFT JOIN journal j ON j.trade_id = t.id WHERE t.user_id = ? AND t.symbol = ? AND t.side = 'buy' AND t.id < ? ORDER BY t.id DESC LIMIT 1").get(req.user.id, t.symbol, t.id)
      : null;
    const candles = await market.ohlcv(t.symbol, '1h', 300);
    const orders = broker.db.prepare("SELECT type, side, price, status FROM orders WHERE user_id = ? AND symbol = ? AND created_at >= datetime(?, '-1 minute') ORDER BY id LIMIT 5")
      .all(req.user.id, t.symbol, (entry ?? t).created_at);
    const r = await advisor.explain(req.user.id,
      'Revisa esta operación de un alumno como lo haría un buen mentor. Explica qué hizo bien, qué pudo mejorar (momento de entrada, stop-loss, tamaño de la posición, salida, emociones según sus notas) y termina con UNA lección concreta y accionable. Sé honesto pero amable.',
      {
        operacion: { lado: t.side, activo: t.symbol, cantidad: t.qty, precio: t.price, fecha_utc: t.created_at, comision: t.fee, resultado_realizado: t.side === 'sell' ? t.realized : null, notas_del_alumno: { setup: t.setup, emocion: t.emotion, notas: t.notes, leccion: t.lesson } },
        entrada_previa: entry && { precio: entry.price, fecha_utc: entry.created_at, notas: { setup: entry.setup, emocion: entry.emotion, notas: entry.notes } },
        ordenes_de_proteccion: orders,
        patrimonio_actual: broker.portfolio(req.user.id).equity,
        mercado_ahora_1h: marketContext(t.symbol, '1h', candles),
      });
    res.json(r);
  });

  // ---------- Academia ----------
  api.get('/academy', auth, (req, res) => res.json(academy.progress(req.user.id)));
  api.post('/academy/lessons/:id', auth, (req, res) => res.json(academy.submit(req.user.id, req.params.id, req.body?.answers)));

  api.delete('/orders/:id', auth, (req, res) => {
    broker.cancelOrder(req.user.id, Number(req.params.id));
    res.json({ ok: true });
  });

  api.post('/reset', auth, (req, res) => {
    broker.resetAccount(req.user.id);
    res.json({ ok: true });
  });

  // ---------- Backtesting ----------
  api.get('/strategies', (req, res) => res.json(publicList()));

  api.post('/backtest', async (req, res) => {
    const { symbol, timeframe = '1h', limit = 500, strategy, params, stopLoss, takeProfit, trailing, positionPct, customId } = req.body ?? {};
    let { definition } = req.body ?? {};
    if (customId != null) definition = customStrategy(req, Number(customId));
    if (!market.symbols.includes(symbol)) throw new BrokerError('Símbolo no soportado');
    let candles;
    try {
      candles = await market.ohlcv(symbol, String(timeframe), Number(limit) || 500);
    } catch (e) {
      throw new BrokerError('No se pudieron obtener datos históricos: ' + e.message, 502);
    }
    const result = backtest(candles, {
      strategy, params, definition, stopLoss, takeProfit, trailing, positionPct,
      initialCash: broker.initialCash, feeRate: broker.feeFor(symbol),
    });
    const user = optionalUser(req);
    if (user) academy.logActivity(user.id, 'backtest');
    res.json({ ...result, candles });
  });

  // ---------- Estrategias personalizadas (constructor visual) ----------
  const optionalUser = (req) => broker.userByToken((req.get('authorization') || '').replace(/^Bearer\s+/i, ''));
  const customStrategy = (req, id) => {
    const user = optionalUser(req);
    const row = broker.db.prepare('SELECT * FROM custom_strategies WHERE id = ? AND (public = 1 OR user_id = ?)').get(id, user?.id ?? -1);
    if (!row) throw new BrokerError('Estrategia personalizada no encontrada', 404);
    return JSON.parse(row.definition);
  };
  const presentCustom = (r) => ({ ...r, definition: JSON.parse(r.definition), public: !!r.public });

  api.get('/strategy-schema', (req, res) => res.json(schema()));

  api.get('/custom-strategies', auth, (req, res) => {
    const mine = broker.db.prepare('SELECT * FROM custom_strategies WHERE user_id = ? ORDER BY updated_at DESC').all(req.user.id);
    const community = broker.db
      .prepare('SELECT c.*, u.username AS author FROM custom_strategies c JOIN users u ON u.id = c.user_id WHERE c.public = 1 AND c.user_id != ? ORDER BY c.updated_at DESC LIMIT 100')
      .all(req.user.id);
    res.json({ mine: mine.map(presentCustom), community: community.map(presentCustom) });
  });

  api.post('/custom-strategies', auth, (req, res) => {
    const def = validateDefinition(req.body?.definition);
    const { n } = broker.db.prepare('SELECT COUNT(*) AS n FROM custom_strategies WHERE user_id = ?').get(req.user.id);
    if (n >= 50) throw new BrokerError('Máximo 50 estrategias por usuario');
    const r = broker.db
      .prepare('INSERT INTO custom_strategies (user_id, name, definition, public) VALUES (?, ?, ?, ?)')
      .run(req.user.id, def.name, JSON.stringify(def), req.body?.public ? 1 : 0);
    academy.logActivity(req.user.id, 'custom_strategy');
    res.status(201).json(presentCustom(broker.db.prepare('SELECT * FROM custom_strategies WHERE id = ?').get(Number(r.lastInsertRowid))));
  });

  api.put('/custom-strategies/:id', auth, (req, res) => {
    const def = validateDefinition(req.body?.definition);
    const r = broker.db
      .prepare("UPDATE custom_strategies SET name = ?, definition = ?, public = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(def.name, JSON.stringify(def), req.body?.public ? 1 : 0, Number(req.params.id), req.user.id);
    if (!r.changes) throw new BrokerError('Estrategia no encontrada', 404);
    res.json(presentCustom(broker.db.prepare('SELECT * FROM custom_strategies WHERE id = ?').get(Number(req.params.id))));
  });

  api.delete('/custom-strategies/:id', auth, (req, res) => {
    const r = broker.db.prepare('DELETE FROM custom_strategies WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
    if (!r.changes) throw new BrokerError('Estrategia no encontrada', 404);
    res.json({ ok: true });
  });

  // Copia una estrategia de la comunidad a "Mis estrategias" para poder editarla.
  api.post('/custom-strategies/:id/copy', auth, (req, res) => {
    const def = customStrategy(req, Number(req.params.id));
    const r = broker.db
      .prepare('INSERT INTO custom_strategies (user_id, name, definition, copied_from) VALUES (?, ?, ?, ?)')
      .run(req.user.id, `${def.name} (copia)`.slice(0, 60), JSON.stringify({ ...def, name: `${def.name} (copia)`.slice(0, 60) }), Number(req.params.id));
    res.status(201).json(presentCustom(broker.db.prepare('SELECT * FROM custom_strategies WHERE id = ?').get(Number(r.lastInsertRowid))));
  });

  // ---------- Bots ----------
  api.get('/bots', auth, (req, res) => res.json(bots.list(req.user.id)));

  api.post('/bots', auth, (req, res) => {
    const bot = bots.create(req.user.id, req.body ?? {});
    academy.logActivity(req.user.id, 'bot');
    res.status(201).json(bot);
  });

  // { active } pausa o reanuda; el resto de campos cambian la configuración.
  api.patch('/bots/:id', auth, (req, res) => {
    const { active, ...changes } = req.body ?? {};
    const id = Number(req.params.id);
    if (Object.keys(changes).length) bots.update(req.user.id, id, changes);
    if (active !== undefined) bots.setActive(req.user.id, id, Boolean(active));
    res.json(bots.get(req.user.id, id));
  });

  api.get('/bots/:id/decisions', auth, (req, res) => res.json(bots.decisions(req.user.id, Number(req.params.id))));
  api.get('/bots/:id/events', auth, (req, res) => res.json(bots.events(req.user.id, Number(req.params.id))));
  api.get('/bots/:id/trades', auth, (req, res) => res.json(bots.trades(req.user.id, Number(req.params.id))));

  api.delete('/bots/:id', auth, (req, res) => {
    bots.remove(req.user.id, Number(req.params.id), { closePosition: req.query.close === '1' });
    res.json({ ok: true });
  });

  api.get('/leaderboard', (req, res) => res.json(broker.leaderboard()));

  app.use('/api', api);

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500 && !(err instanceof BrokerError)) console.error(err);
    res.status(status).json({ error: err.message || 'Error interno' });
  });

  return app;
}

async function main() {
  const port = Number(process.env.PORT) || 3000;
  const db = openDb(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'simulador.db'));
  const market = new Market({
    exchanges: (process.env.EXCHANGES || 'kraken,coinbase,binance').split(',').map((s) => s.trim()),
    simulated: process.env.SIMULATED === '1',
    pollMs: Number(process.env.POLL_MS) || 5000,
  });
  const broker = new Broker(db, market, {
    initialCash: Number(process.env.INITIAL_CASH) || 10000,
    feeRate: process.env.FEE_RATE !== undefined ? Number(process.env.FEE_RATE) : 0.001,
    categoryFees: {
      Forex: process.env.FEE_RATE_FOREX !== undefined ? Number(process.env.FEE_RATE_FOREX) : 0.0001,
      Oro: process.env.FEE_RATE_GOLD !== undefined ? Number(process.env.FEE_RATE_GOLD) : 0.0005,
    },
  });
  const advisor = new AIAdvisor(db);
  console.log(advisor.enabled ? `[ia] activada con el modelo ${advisor.model}` : '[ia] desactivada: define ANTHROPIC_API_KEY para usarla');
  const bots = new BotManager(db, market, broker, { intervalMs: Number(process.env.BOT_INTERVAL_MS) || 20000, advisor });
  await market.start();
  market.on('tick', () => broker.processOrders());
  bots.start();
  createApp(broker, market, bots, advisor).listen(port, () => {
    console.log(`Simulador de trading listo en http://localhost:${port}`);
  });
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { createApp };

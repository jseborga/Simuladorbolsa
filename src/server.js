const path = require('node:path');
const express = require('express');
const { openDb } = require('./db');
const { Market } = require('./market');
const { Broker, BrokerError } = require('./broker');
const { BotManager } = require('./bots');
const { backtest } = require('./backtest');
const { publicList } = require('./strategies');
const { schema, validateDefinition } = require('./custom');

function createApp(broker, market, bots) {
  const app = express();
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

  api.post('/orders', auth, (req, res) => {
    const { symbol, side, type = 'market', qty, price } = req.body ?? {};
    if (type === 'market') return res.status(201).json({ trade: broker.marketOrder(req.user.id, symbol, side, qty) });
    res.status(201).json({ order: broker.placeOrder(req.user.id, symbol, side, type, qty, price) });
  });

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
    res.status(201).json(bots.create(req.user.id, req.body ?? {}));
  });

  // { active } pausa o reanuda; el resto de campos cambian la configuración.
  api.patch('/bots/:id', auth, (req, res) => {
    const { active, ...changes } = req.body ?? {};
    const id = Number(req.params.id);
    if (Object.keys(changes).length) bots.update(req.user.id, id, changes);
    if (active !== undefined) bots.setActive(req.user.id, id, Boolean(active));
    res.json(bots.get(req.user.id, id));
  });

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
  const bots = new BotManager(db, market, broker, { intervalMs: Number(process.env.BOT_INTERVAL_MS) || 20000 });
  await market.start();
  market.on('tick', () => broker.processOrders());
  bots.start();
  createApp(broker, market, bots).listen(port, () => {
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

// Bots de trading automático sobre la cuenta virtual del usuario.
// Cada bot ejecuta una estrategia en una temporalidad: al cerrar cada vela
// calcula la señal y, si toca, compra `amount` USD o vende lo que compró.
// Sólo opera con lo que el propio bot compró; no toca tus compras manuales.
const { getStrategy, normalizeParams } = require('./strategies');
const { TIMEFRAME_MS } = require('./market');
const { BrokerError } = require('./broker');

const MAX_BOTS = 10;

class BotManager {
  constructor(db, market, broker, { intervalMs = 20000 } = {}) {
    this.db = db;
    this.market = market;
    this.broker = broker;
    this.intervalMs = intervalMs;
    this.running = false;
  }

  start() {
    this.timer = setInterval(() => this.runAll().catch((e) => console.warn('[bots]', e.message)), this.intervalMs);
    this.timer.unref?.();
    this.market.on('tick', () => this.checkRisk());
  }

  stop() {
    clearInterval(this.timer);
  }

  create(userId, { symbol, timeframe = '1h', strategy, params, amount, stopLoss = 0, takeProfit = 0 }) {
    if (!this.market.symbols.includes(symbol)) throw new BrokerError('Símbolo no soportado');
    if (!TIMEFRAME_MS[timeframe]) throw new BrokerError('Temporalidad no soportada');
    const s = getStrategy(strategy);
    const p = normalizeParams(s, params);
    amount = Number(amount);
    if (!Number.isFinite(amount) || amount < this.broker.minNotional) throw new BrokerError('Monto por operación inválido');
    const sl = Math.min(Math.max(Number(stopLoss) || 0, 0), 90);
    const tp = Math.min(Math.max(Number(takeProfit) || 0, 0), 1000);
    const { n } = this.db.prepare('SELECT COUNT(*) AS n FROM bots WHERE user_id = ?').get(userId);
    if (n >= MAX_BOTS) throw new BrokerError(`Máximo ${MAX_BOTS} bots por usuario`);
    const r = this.db
      .prepare('INSERT INTO bots (user_id, symbol, timeframe, strategy, params, amount, stop_loss, take_profit, last_event) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(userId, symbol, timeframe, s.id, JSON.stringify(p), amount, sl, tp, 'Creado. Esperando al cierre de la próxima vela…');
    const bot = this.get(userId, Number(r.lastInsertRowid));
    this.runBot(bot).catch(() => {});
    return bot;
  }

  get(userId, id) {
    const b = this.db.prepare('SELECT * FROM bots WHERE id = ? AND user_id = ?').get(id, userId);
    if (!b) throw new BrokerError('Bot no encontrado', 404);
    return b;
  }

  list(userId) {
    return this.db.prepare('SELECT * FROM bots WHERE user_id = ? ORDER BY id DESC').all(userId).map((b) => {
      const price = this.market.price(b.symbol);
      const unrealized = b.qty > 0 && price ? (price - b.entry_price) * b.qty : 0;
      return { ...b, params: JSON.parse(b.params), strategyName: getStrategy(b.strategy).name, price, unrealized };
    });
  }

  setActive(userId, id, active) {
    this.get(userId, id);
    this.db.prepare('UPDATE bots SET active = ?, last_event = ? WHERE id = ?').run(active ? 1 : 0, active ? 'Reanudado' : 'Pausado', id);
  }

  remove(userId, id, { closePosition = false } = {}) {
    const bot = this.get(userId, id);
    if (closePosition && bot.qty > 0) this.sell(bot, 'Cierre al eliminar el bot');
    this.db.prepare('DELETE FROM bots WHERE id = ?').run(id);
  }

  log(bot, event, extra = {}) {
    const sets = ["last_event = ?", "last_run = datetime('now')"];
    const vals = [event];
    for (const [k, v] of Object.entries(extra)) {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
    this.db.prepare(`UPDATE bots SET ${sets.join(', ')} WHERE id = ?`).run(...vals, bot.id);
  }

  async runAll() {
    if (this.running) return;
    this.running = true;
    try {
      const bots = this.db.prepare('SELECT * FROM bots WHERE active = 1').all();
      for (const bot of bots) {
        try {
          await this.runBot(bot);
        } catch (e) {
          this.log(bot, 'Error: ' + e.message);
        }
      }
    } finally {
      this.running = false;
    }
  }

  async runBot(bot) {
    if (!bot.active) return;
    const step = TIMEFRAME_MS[bot.timeframe];
    const candles = await this.market.ohlcv(bot.symbol, bot.timeframe, 300);
    const closed = candles.filter((c) => c[0] + step <= Date.now());
    if (closed.length < 10) return;
    const last = closed[closed.length - 1];
    if (bot.last_candle === last[0]) return; // esta vela ya fue evaluada
    const strategy = getStrategy(bot.strategy);
    const { signals } = strategy.run(closed, JSON.parse(bot.params));
    const signal = signals[signals.length - 1];
    const fresh = this.db.prepare('SELECT * FROM bots WHERE id = ?').get(bot.id);
    if (!fresh) return;
    this.db.prepare('UPDATE bots SET last_candle = ?, last_signal = ? WHERE id = ?').run(last[0], signal ?? null, bot.id);
    if (signal === 'buy' && fresh.qty === 0) this.buy(fresh);
    else if (signal === 'sell' && fresh.qty > 0) this.sell(fresh, 'Señal de venta');
    else this.log(fresh, signal ? `Señal de ${signal === 'buy' ? 'compra' : 'venta'} ignorada (${fresh.qty > 0 ? 'ya en posición' : 'sin posición'})` : 'Vela cerrada: sin señal');
  }

  buy(bot) {
    try {
      const price = this.broker.quote(bot.symbol, 'buy');
      const t = this.broker.marketOrder(bot.user_id, bot.symbol, 'buy', bot.amount / (price * (1 + this.broker.feeRate)), { botId: bot.id });
      this.log(bot, `Compró ${+t.qty.toFixed(8)} a ${t.price}`, { qty: t.qty, entry_price: t.price, trade_count: bot.trade_count + 1 });
    } catch (e) {
      this.log(bot, 'No pudo comprar: ' + e.message);
    }
  }

  sell(bot, reason) {
    const h = this.db.prepare('SELECT qty FROM holdings WHERE user_id = ? AND symbol = ?').get(bot.user_id, bot.symbol);
    const qty = Math.min(bot.qty, h?.qty ?? 0);
    if (qty <= 0) {
      this.log(bot, 'La posición ya no existe (¿vendida manualmente?)', { qty: 0, entry_price: null });
      return;
    }
    try {
      const t = this.broker.marketOrder(bot.user_id, bot.symbol, 'sell', qty, { botId: bot.id });
      const pnl = (t.price - bot.entry_price) * qty - t.fee - bot.entry_price * qty * this.broker.feeRate;
      this.log(bot, `${reason}: vendió a ${t.price} (G/P ${pnl.toFixed(2)} USD)`, {
        qty: 0, entry_price: null, realized: bot.realized + pnl, trade_count: bot.trade_count + 1,
      });
    } catch (e) {
      this.log(bot, 'No pudo vender: ' + e.message);
    }
  }

  // Stop-loss / take-profit de los bots, revisado en cada actualización de precios.
  checkRisk() {
    const bots = this.db.prepare('SELECT * FROM bots WHERE active = 1 AND qty > 0 AND (stop_loss > 0 OR take_profit > 0)').all();
    for (const bot of bots) {
      const t = this.market.tickers[bot.symbol];
      if (!t?.last) continue;
      const bid = t.bid || t.last;
      if (bot.stop_loss > 0 && bid <= bot.entry_price * (1 - bot.stop_loss / 100)) this.sell(bot, 'Stop-loss');
      else if (bot.take_profit > 0 && bid >= bot.entry_price * (1 + bot.take_profit / 100)) this.sell(bot, 'Take-profit');
    }
  }
}

module.exports = { BotManager };

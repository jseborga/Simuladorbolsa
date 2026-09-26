// Bots de trading automático sobre la cuenta virtual del usuario.
// Tres tipos, como en las plataformas habituales:
//  - signal: ejecuta una estrategia (predefinida o creada con el constructor) al cierre
//            de cada vela, con stop-loss, take-profit y trailing stop opcionales.
//  - dca:    compra una cantidad fija cada X horas, compra extra si el precio cae
//            un Y % y vende todo al alcanzar el take-profit sobre el precio medio.
//  - grid:   divide un rango de precios en N niveles; compra en cada nivel al bajar y
//            vende un nivel más arriba al subir.
//  - ai:     un agente de IA (Claude) recibe el resumen del mercado al cierre de cada vela y
//            decide comprar, vender o mantener, explicando por qué. El servidor valida y
//            limita cada decisión (confianza mínima, tamaño, stop obligatorio y máximo).
// Cada bot sólo opera con lo que él mismo compró; no toca tus compras manuales.
const { resolve } = require('./strategies');
const { validateDefinition } = require('./custom');
const { TIMEFRAME_MS } = require('./market');
const { BrokerError } = require('./broker');
const { marketContext } = require('./ai');

const MAX_BOTS = 10;
const MAX_EVENTS = 200;
const TYPES = ['signal', 'dca', 'grid', 'ai'];
const MAX_AI_BOTS = 3;
const AI_TIMEFRAMES = ['15m', '1h', '4h', '1d']; // no menos de 15m: cada vela es una consulta a la IA

const num = (v, def = 0) => (v === undefined || v === null || v === '' ? def : Number(v));
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const fmt = (p) => (p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(4) : p.toPrecision(4));

class BotManager {
  constructor(db, market, broker, { intervalMs = 20000, advisor = null } = {}) {
    this.db = db;
    this.market = market;
    this.broker = broker;
    this.advisor = advisor;
    this.thinking = new Set(); // bots IA con una consulta en curso
    this.intervalMs = intervalMs;
    this.running = false;
  }

  start() {
    this.timer = setInterval(() => this.runAll().catch((e) => console.warn('[bots]', e.message)), this.intervalMs);
    this.timer.unref?.();
    this.market.on('tick', () => this.onTick());
  }

  stop() {
    clearInterval(this.timer);
  }

  // ---------- Alta, edición y consulta ----------

  create(userId, body = {}) {
    const type = body.type || 'signal';
    if (!TYPES.includes(type)) throw new BrokerError('Tipo de bot inválido');
    const { symbol } = body;
    if (!this.market.symbols.includes(symbol)) throw new BrokerError('Símbolo no soportado');
    const { n } = this.db.prepare('SELECT COUNT(*) AS n FROM bots WHERE user_id = ?').get(userId);
    if (n >= MAX_BOTS) throw new BrokerError(`Máximo ${MAX_BOTS} bots por usuario`);

    const row = {
      type, symbol, name: String(body.name ?? '').trim().slice(0, 40) || null,
      timeframe: '1h', strategy: type, params: '{}', amount: 0,
      stop_loss: clamp(num(body.stopLoss), 0, 90), take_profit: clamp(num(body.takeProfit), 0, 1000),
      trailing: clamp(num(body.trailing), 0, 90), config: {},
    };

    if (type === 'signal') {
      row.timeframe = body.timeframe || '1h';
      if (!TIMEFRAME_MS[row.timeframe]) throw new BrokerError('Temporalidad no soportada');
      row.amount = this.validAmount(body.amount);
      if (body.customId != null || body.definition) {
        const definition = body.definition ? validateDefinition(body.definition) : this.loadCustom(userId, Number(body.customId));
        row.strategy = 'custom';
        row.params = JSON.stringify({ definition });
      } else {
        const { strategy, params } = resolve({ strategy: body.strategy, params: body.params });
        row.strategy = strategy.id;
        row.params = JSON.stringify(params);
      }
    } else if (type === 'dca') {
      row.amount = this.validAmount(body.amount);
      row.config = this.dcaConfig(body);
      row.config.state = { buys: 0, cost: 0, lastBuyAt: 0, lastBuyPrice: null };
    } else if (type === 'ai') {
      if (!this.advisor?.enabled) throw new BrokerError('La IA no está configurada en este servidor: define la variable ANTHROPIC_API_KEY', 503);
      const { n: ais } = this.db.prepare("SELECT COUNT(*) AS n FROM bots WHERE user_id = ? AND type = 'ai'").get(userId);
      if (ais >= MAX_AI_BOTS) throw new BrokerError(`Máximo ${MAX_AI_BOTS} bots IA por usuario`);
      row.timeframe = body.timeframe || '1h';
      if (!AI_TIMEFRAMES.includes(row.timeframe)) throw new BrokerError('Los bots IA usan velas de 15m o más');
      row.amount = this.validAmount(body.amount);
      row.strategy = 'ai';
      row.config = { ...this.aiConfig(body), stop: null, target: null };
    } else {
      row.config = this.gridConfig(body);
      row.amount = row.config.investment / row.config.grids;
    }

    const r = this.db
      .prepare(`INSERT INTO bots (user_id, type, name, symbol, timeframe, strategy, params, amount, stop_loss, take_profit, trailing, config, last_event)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, row.type, row.name, row.symbol, row.timeframe, row.strategy, row.params, row.amount,
        row.stop_loss, row.take_profit, row.trailing, JSON.stringify(row.config), 'Creado');
    const bot = this.raw(Number(r.lastInsertRowid));
    this.event(bot, type === 'signal' ? 'Bot creado. Evaluará la estrategia al cierre de cada vela.'
      : type === 'dca' ? 'Bot DCA creado.' : type === 'ai' ? 'Bot IA creado. Consultará a la IA al cierre de cada vela.' : 'Bot grid creado.');
    if (type === 'grid') this.initGrid(bot);
    else if (type === 'dca') this.runDca(this.raw(bot.id));
    else if (type === 'ai') this.runAi(bot).catch((e) => this.log(bot, 'Error de la IA: ' + e.message));
    else this.runSignal(bot).catch(() => {});
    return this.get(userId, bot.id);
  }

  validAmount(v) {
    const a = Number(v);
    if (!Number.isFinite(a) || a < this.broker.minNotional) throw new BrokerError('Monto por operación inválido');
    return a;
  }

  dcaConfig(b) {
    const intervalHours = num(b.intervalHours, 24);
    if (!(intervalHours >= 0.1 && intervalHours <= 24 * 30)) throw new BrokerError('Intervalo de compra inválido (0,1 h – 30 días)');
    return {
      intervalHours,
      dropPct: clamp(num(b.dropPct), 0, 90),
      maxBuys: Math.round(clamp(num(b.maxBuys), 0, 1000)),
    };
  }

  aiConfig(b) {
    return {
      instructions: String(b.instructions ?? '').trim().slice(0, 1000),
      minConfidence: clamp(num(b.minConfidence, 0.6), 0, 1),
      maxStopPct: clamp(num(b.maxStopPct, 8), 0.2, 30),
    };
  }

  gridConfig(b) {
    const low = Number(b.low), high = Number(b.high);
    const grids = Math.round(Number(b.grids));
    const investment = Number(b.investment);
    if (!(low > 0 && high > low)) throw new BrokerError('Rango inválido: el precio máximo debe ser mayor que el mínimo');
    if (!(grids >= 2 && grids <= 50)) throw new BrokerError('El número de niveles debe estar entre 2 y 50');
    if (!(investment / grids >= this.broker.minNotional)) throw new BrokerError('Inversión demasiado pequeña para tantos niveles');
    if ((high - low) / low / grids < this.broker.feeFor(b.symbol) * 2) {
      throw new BrokerError('Niveles demasiado juntos: la ganancia por nivel no cubriría las comisiones');
    }
    return { low, high, grids, investment, cells: [] };
  }

  loadCustom(userId, id) {
    const s = this.db.prepare('SELECT * FROM custom_strategies WHERE id = ? AND (user_id = ? OR public = 1)').get(id, userId);
    if (!s) throw new BrokerError('Estrategia personalizada no encontrada', 404);
    return JSON.parse(s.definition);
  }

  raw(id) {
    return this.db.prepare('SELECT * FROM bots WHERE id = ?').get(id);
  }

  get(userId, id) {
    const b = this.db.prepare('SELECT * FROM bots WHERE id = ? AND user_id = ?').get(id, userId);
    if (!b) throw new BrokerError('Bot no encontrado', 404);
    return this.present(b);
  }

  present(b) {
    const params = JSON.parse(b.params || '{}');
    const config = JSON.parse(b.config || '{}');
    const price = this.market.price(b.symbol);
    const unrealized = b.qty > 0 && price ? (price - b.entry_price) * b.qty : 0;
    let strategyName;
    if (b.type === 'dca') strategyName = 'DCA (compra periódica)';
    else if (b.type === 'ai') strategyName = 'Agente IA';
    else if (b.type === 'grid') strategyName = 'Grid';
    else if (b.strategy === 'custom') strategyName = params.definition?.name ?? 'Personalizada';
    else {
      try { strategyName = resolve({ strategy: b.strategy, params }).strategy.name; } catch { strategyName = b.strategy; }
    }
    return { ...b, params, config, strategyName, price, unrealized };
  }

  list(userId) {
    return this.db.prepare('SELECT * FROM bots WHERE user_id = ? ORDER BY id DESC').all(userId).map((b) => this.present(b));
  }

  events(userId, id) {
    this.get(userId, id);
    return this.db.prepare('SELECT message, created_at FROM bot_events WHERE bot_id = ? ORDER BY id DESC LIMIT 100').all(id);
  }

  decisions(userId, id) {
    this.get(userId, id);
    return this.db.prepare('SELECT * FROM ai_decisions WHERE bot_id = ? ORDER BY id DESC LIMIT 50').all(id)
      .map((d) => ({ ...d, factors: JSON.parse(d.factors || '[]') }));
  }

  trades(userId, id) {
    this.get(userId, id);
    return this.db.prepare('SELECT * FROM trades WHERE user_id = ? AND bot_id = ? ORDER BY id DESC LIMIT 100').all(userId, id);
  }

  // Cambia la configuración de un bot existente.
  update(userId, id, body = {}) {
    const bot = this.get(userId, id);
    const sets = {};
    if (body.name !== undefined) sets.name = String(body.name).trim().slice(0, 40) || null;
    if (body.stopLoss !== undefined) sets.stop_loss = clamp(num(body.stopLoss), 0, 90);
    if (body.takeProfit !== undefined && bot.type !== 'grid') sets.take_profit = clamp(num(body.takeProfit), 0, 1000);
    if (body.amount !== undefined && bot.type !== 'grid') sets.amount = this.validAmount(body.amount);
    if (bot.type === 'signal') {
      if (body.trailing !== undefined) sets.trailing = clamp(num(body.trailing), 0, 90);
      if (body.timeframe !== undefined && body.timeframe !== bot.timeframe) {
        if (!TIMEFRAME_MS[body.timeframe]) throw new BrokerError('Temporalidad no soportada');
        sets.timeframe = body.timeframe;
        sets.last_candle = null;
      }
      if (body.params !== undefined && bot.strategy !== 'custom') {
        sets.params = JSON.stringify(resolve({ strategy: bot.strategy, params: body.params }).params);
        sets.last_candle = null;
      }
    } else if (bot.type === 'dca') {
      const cfg = { ...bot.config, ...this.dcaConfig({ ...bot.config, ...body }) };
      sets.config = JSON.stringify(cfg);
    } else if (bot.type === 'ai') {
      sets.config = JSON.stringify({ ...bot.config, ...this.aiConfig({ ...bot.config, ...body }) });
      if (body.timeframe !== undefined && body.timeframe !== bot.timeframe) {
        if (!AI_TIMEFRAMES.includes(body.timeframe)) throw new BrokerError('Los bots IA usan velas de 15m o más');
        sets.timeframe = body.timeframe;
        sets.last_candle = null;
      }
    } else if (['low', 'high', 'grids', 'investment'].some((k) => body[k] !== undefined)) {
      throw new BrokerError('El rango de un grid no se puede cambiar con el bot en marcha: elimínalo y crea otro');
    }
    const keys = Object.keys(sets);
    if (!keys.length) return bot;
    this.db.prepare(`UPDATE bots SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => sets[k]), id);
    this.event(bot, 'Configuración actualizada');
    return this.get(userId, id);
  }

  setActive(userId, id, active) {
    const bot = this.get(userId, id);
    this.db.prepare('UPDATE bots SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    this.log(bot, active ? 'Reanudado' : 'Pausado');
  }

  remove(userId, id, { closePosition = false } = {}) {
    const bot = this.raw(this.get(userId, id).id);
    if (closePosition && bot.qty > 0) this.sellAll(bot, 'Cierre al eliminar el bot');
    this.db.prepare('DELETE FROM bots WHERE id = ?').run(id);
  }

  // ---------- Registro ----------

  event(bot, message) {
    this.db.prepare('INSERT INTO bot_events (bot_id, message) VALUES (?, ?)').run(bot.id, message);
    this.db.prepare('DELETE FROM bot_events WHERE bot_id = ? AND id NOT IN (SELECT id FROM bot_events WHERE bot_id = ? ORDER BY id DESC LIMIT ?)')
      .run(bot.id, bot.id, MAX_EVENTS);
  }

  // Actualiza el estado del bot; `record` guarda además el mensaje en el registro.
  log(bot, message, extra = {}, record = true) {
    const sets = ['last_event = ?', "last_run = datetime('now')"];
    const vals = [message];
    for (const [k, v] of Object.entries(extra)) {
      sets.push(`${k} = ?`);
      vals.push(k === 'config' ? JSON.stringify(v) : v);
    }
    this.db.prepare(`UPDATE bots SET ${sets.join(', ')} WHERE id = ?`).run(...vals, bot.id);
    if (record) this.event(bot, message);
  }

  // ---------- Ejecución ----------

  async runAll() {
    if (this.running) return;
    this.running = true;
    try {
      for (const bot of this.db.prepare("SELECT * FROM bots WHERE active = 1 AND type IN ('signal', 'dca', 'ai')").all()) {
        try {
          if (bot.type === 'signal') await this.runSignal(bot);
          else if (bot.type === 'ai') await this.runAi(bot);
          else this.runDca(bot);
        } catch (e) {
          this.log(bot, 'Error: ' + e.message);
        }
      }
    } finally {
      this.running = false;
    }
  }

  onTick() {
    for (const bot of this.db.prepare('SELECT * FROM bots WHERE active = 1').all()) {
      try {
        if (bot.type === 'grid') this.tickGrid(bot);
        else if (bot.type === 'dca') this.tickDca(bot);
        else if (bot.type === 'ai') this.tickAi(bot);
        else this.tickSignal(bot);
      } catch (e) {
        this.log(bot, 'Error: ' + e.message);
      }
    }
  }

  // Compra `usd` dólares; devuelve la operación o null si falló.
  buyUsd(bot, usd, reason) {
    try {
      const price = this.broker.quote(bot.symbol, 'buy');
      const qty = usd / (price * (1 + this.broker.feeFor(bot.symbol)));
      return this.broker.marketOrder(bot.user_id, bot.symbol, 'buy', qty, { botId: bot.id });
    } catch (e) {
      this.log(bot, `No pudo comprar (${reason}): ${e.message}`);
      return null;
    }
  }

  // Vende hasta `qty` (sin superar lo que el usuario tiene realmente).
  sellQty(bot, qty, reason) {
    const h = this.db.prepare('SELECT qty FROM holdings WHERE user_id = ? AND symbol = ?').get(bot.user_id, bot.symbol);
    const q = Math.min(qty, h?.qty ?? 0);
    if (q <= 0) return null;
    try {
      return this.broker.marketOrder(bot.user_id, bot.symbol, 'sell', q, { botId: bot.id });
    } catch (e) {
      this.log(bot, `No pudo vender (${reason}): ${e.message}`);
      return null;
    }
  }

  // P/G de vender `qty` a `t.price` habiendo comprado a `entry` (incluye ambas comisiones).
  pnl(bot, t, qty, entry) {
    return (t.price - entry) * qty - t.fee - entry * qty * this.broker.feeFor(bot.symbol);
  }

  sellAll(bot, reason) {
    if (bot.type === 'grid') {
      const cfg = JSON.parse(bot.config);
      const held = cfg.cells.filter((c) => c.state === 'sell');
      const qty = held.reduce((a, c) => a + c.qty, 0);
      const t = this.sellQty(bot, qty, reason);
      const pnl = t ? held.reduce((a, c) => a + this.pnl(bot, t, c.qty * (t.qty / qty), c.buyPrice), 0) : 0;
      for (const c of held) Object.assign(c, { state: 'buy', qty: 0, buyPrice: null });
      this.log(bot, t ? `${reason}: vendió todo a ${fmt(t.price)} (G/P ${pnl.toFixed(2)} USD)` : `${reason}: no había posición que vender`, {
        qty: 0, entry_price: null, realized: bot.realized + pnl, trade_count: bot.trade_count + (t ? 1 : 0), config: cfg,
      });
      return;
    }
    const t = this.sellQty(bot, bot.qty, reason);
    if (!t) {
      this.log(bot, 'La posición ya no existe (¿vendida manualmente?)', { qty: 0, entry_price: null, peak: null });
      return;
    }
    const pnl = this.pnl(bot, t, t.qty, bot.entry_price);
    const extra = { qty: 0, entry_price: null, peak: null, realized: bot.realized + pnl, trade_count: bot.trade_count + 1 };
    if (bot.type === 'dca') {
      const cfg = JSON.parse(bot.config);
      cfg.state = { ...cfg.state, buys: 0, cost: 0, lastBuyPrice: null };
      extra.config = cfg;
    }
    if (bot.type === 'ai') extra.config = { ...JSON.parse(bot.config), stop: null, target: null };
    this.log(bot, `${reason}: vendió ${+t.qty.toFixed(8)} a ${fmt(t.price)} (G/P ${pnl.toFixed(2)} USD)`, extra);
  }

  // --- Bot de señales ---

  async runSignal(bot) {
    if (!bot.active) return;
    const step = TIMEFRAME_MS[bot.timeframe];
    const candles = await this.market.ohlcv(bot.symbol, bot.timeframe, 300);
    const closed = candles.filter((c) => c[0] + step <= Date.now());
    if (closed.length < 10) return;
    const last = closed[closed.length - 1];
    if (bot.last_candle === last[0]) return; // esta vela ya fue evaluada
    const params = JSON.parse(bot.params);
    const { strategy, params: p } = resolve(bot.strategy === 'custom' ? { definition: params.definition } : { strategy: bot.strategy, params });
    const { signals } = strategy.run(closed, p);
    const signal = signals[signals.length - 1];
    const fresh = this.raw(bot.id);
    if (!fresh) return;
    this.db.prepare('UPDATE bots SET last_candle = ?, last_signal = ? WHERE id = ?').run(last[0], signal ?? null, bot.id);
    if (signal === 'buy' && fresh.qty === 0) {
      const t = this.buyUsd(fresh, fresh.amount, 'señal de compra');
      if (t) this.log(fresh, `Señal de compra: compró ${+t.qty.toFixed(8)} a ${fmt(t.price)}`, { qty: t.qty, entry_price: t.price, peak: t.price, trade_count: fresh.trade_count + 1 });
    } else if (signal === 'sell' && fresh.qty > 0) {
      this.sellAll(fresh, 'Señal de venta');
    } else {
      const msg = signal ? `Señal de ${signal === 'buy' ? 'compra' : 'venta'} ignorada (${fresh.qty > 0 ? 'ya en posición' : 'sin posición'})` : 'Vela cerrada: sin señal';
      this.log(fresh, msg, {}, !!signal);
    }
  }

  tickSignal(bot) {
    if (!(bot.qty > 0)) return;
    const t = this.market.tickers[bot.symbol];
    if (!t?.last) return;
    const bid = t.bid || t.last;
    if (bot.trailing > 0 && bid > (bot.peak ?? 0)) {
      this.db.prepare('UPDATE bots SET peak = ? WHERE id = ?').run(bid, bot.id);
      bot.peak = bid;
    }
    if (bot.stop_loss > 0 && bid <= bot.entry_price * (1 - bot.stop_loss / 100)) this.sellAll(bot, 'Stop-loss');
    else if (bot.trailing > 0 && bid <= bot.peak * (1 - bot.trailing / 100)) this.sellAll(bot, 'Trailing stop');
    else if (bot.take_profit > 0 && bid >= bot.entry_price * (1 + bot.take_profit / 100)) this.sellAll(bot, 'Take-profit');
  }

  // --- Bot IA ---

  // Al cerrar cada vela: resumen del mercado → decisión de la IA → validación → ejecución.
  async runAi(bot) {
    if (!bot.active || !this.advisor || this.thinking.has(bot.id)) return;
    const step = TIMEFRAME_MS[bot.timeframe];
    const candles = await this.market.ohlcv(bot.symbol, bot.timeframe, 300);
    const closed = candles.filter((c) => c[0] + step <= Date.now());
    if (closed.length < 30) return;
    const last = closed[closed.length - 1];
    if (bot.last_candle === last[0]) return;
    // Se marca la vela antes de llamar: si la IA falla, no se reintenta en bucle.
    this.db.prepare('UPDATE bots SET last_candle = ? WHERE id = ?').run(last[0], bot.id);
    this.thinking.add(bot.id);
    try {
      const cfg = JSON.parse(bot.config);
      const price = last[4];
      const memory = this.db
        .prepare('SELECT candle_ts, price, action, confidence, reasoning, executed, note FROM ai_decisions WHERE bot_id = ? ORDER BY id DESC LIMIT 5')
        .all(bot.id).reverse()
        .map((d) => ({
          when: new Date(d.candle_ts).toISOString().slice(0, 16), action: d.action, confidence: d.confidence, price: d.price,
          price_change_since_pct: Number((((price - d.price) / d.price) * 100).toFixed(2)),
          executed: !!d.executed, note: d.note, reasoning: String(d.reasoning || '').slice(0, 200),
        }));
      const position = bot.qty > 0
        ? { open: true, qty: bot.qty, entry_price: bot.entry_price, stop_loss: cfg.stop, take_profit: cfg.target, unrealized_pct: Number((((price - bot.entry_price) / bot.entry_price) * 100).toFixed(2)) }
        : { open: false };
      const account = {
        budget_per_trade_usd: bot.amount, realized_pnl_usd: Number(bot.realized.toFixed(2)), trades: bot.trade_count,
        fee_pct_per_side: this.broker.feeFor(bot.symbol) * 100,
        limits: { min_confidence_to_buy: cfg.minConfidence, max_stop_distance_pct: cfg.maxStopPct },
      };
      const d = await this.advisor.decide(bot.user_id, {
        context: marketContext(bot.symbol, bot.timeframe, closed), position, account, instructions: cfg.instructions, memory,
      });
      this.applyAi(this.raw(bot.id), d, last);
    } finally {
      this.thinking.delete(bot.id);
    }
  }

  // Valida la decisión de la IA contra los límites del bot y la ejecuta.
  applyAi(bot, d, candle) {
    if (!bot) return;
    const cfg = JSON.parse(bot.config);
    const confidence = clamp(num(d.confidence), 0, 1);
    const sizePct = clamp(num(d.size_pct), 0, 100);
    const action = ['buy', 'sell', 'hold'].includes(d.action) ? d.action : 'hold';
    let stop = num(d.stop_loss) > 0 ? num(d.stop_loss) : null;
    let target = num(d.take_profit) > 0 ? num(d.take_profit) : null;
    let executed = false;
    const notes = [];

    if (action === 'buy') {
      if (bot.qty > 0) notes.push('Ya había una posición abierta');
      else if (confidence < cfg.minConfidence) notes.push(`Confianza ${(confidence * 100).toFixed(0)} % por debajo del mínimo ${(cfg.minConfidence * 100).toFixed(0)} %`);
      else {
        const price = this.broker.quote(bot.symbol, 'buy');
        const maxDist = cfg.maxStopPct / 100;
        if (!(stop > 0 && stop < price)) {
          stop = price * (1 - Math.min(maxDist, (bot.stop_loss || 3) / 100));
          notes.push('Stop inválido o ausente: se puso uno automático');
        } else if ((price - stop) / price > maxDist) {
          stop = price * (1 - maxDist);
          notes.push(`Stop demasiado lejos: recortado al ${cfg.maxStopPct} %`);
        }
        if (target !== null && !(target > price)) { target = null; notes.push('Objetivo inválido: ignorado'); }
        const usd = (bot.amount * sizePct) / 100;
        if (usd < this.broker.minNotional) notes.push('Tamaño demasiado pequeño');
        else {
          const t = this.buyUsd(bot, usd, 'decisión de la IA');
          if (t) {
            executed = true;
            this.log(bot, `IA compró ${+t.qty.toFixed(8)} a ${fmt(t.price)} (confianza ${(confidence * 100).toFixed(0)} %) · stop ${fmt(stop)}${target ? ` · objetivo ${fmt(target)}` : ''}`, {
              qty: t.qty, entry_price: t.price, trade_count: bot.trade_count + 1, config: { ...cfg, stop, target },
            });
          } else notes.push('No se pudo comprar (¿saldo insuficiente?)');
        }
      }
    } else if (action === 'sell') {
      if (bot.qty > 0) { this.sellAll(bot, `IA vendió (confianza ${(confidence * 100).toFixed(0)} %)`); executed = true; }
      else notes.push('No había posición que vender');
    } else if (bot.qty > 0) {
      // "Mantener": la IA puede subir el stop para proteger ganancias, nunca bajarlo.
      const bid = this.broker.quote(bot.symbol, 'sell');
      const changes = {};
      if (stop && stop > (cfg.stop ?? 0) && stop < bid) { changes.stop = stop; notes.push(`Stop subido a ${fmt(stop)}`); }
      if (target && target > bid && target !== cfg.target) { changes.target = target; notes.push(`Objetivo ajustado a ${fmt(target)}`); }
      if (Object.keys(changes).length) { executed = true; this.log(bot, 'IA ajustó la posición: ' + notes.join(' · '), { config: { ...cfg, ...changes } }); }
    }

    this.db
      .prepare(`INSERT INTO ai_decisions (bot_id, candle_ts, price, action, confidence, size_pct, stop, target, reasoning, factors, executed, note, model)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(bot.id, candle[0], candle[4], action, confidence, sizePct, stop, target, String(d.reasoning ?? '').slice(0, 2000),
        JSON.stringify((d.key_factors || []).slice(0, 5).map((f) => String(f).slice(0, 200))), executed ? 1 : 0, notes.join(' · ') || null, d.model ?? null);
    if (!executed) {
      const label = { buy: 'comprar', sell: 'vender', hold: 'mantener' }[action];
      this.log(this.raw(bot.id), `IA decidió ${label} (confianza ${(confidence * 100).toFixed(0)} %)${notes.length ? ' · ' + notes.join(' · ') : ''}`, {}, action !== 'hold' || notes.length > 0);
    }
  }

  tickAi(bot) {
    if (!(bot.qty > 0)) return;
    const t = this.market.tickers[bot.symbol];
    if (!t?.last) return;
    const bid = t.bid || t.last;
    const cfg = JSON.parse(bot.config);
    if (cfg.stop && bid <= cfg.stop) this.sellAll(bot, 'Stop-loss de la IA');
    else if (cfg.target && bid >= cfg.target) this.sellAll(bot, 'Objetivo de la IA');
  }

  // --- Bot DCA ---

  dcaBuy(bot, reason) {
    const cfg = JSON.parse(bot.config);
    const st = cfg.state;
    if (cfg.maxBuys && st.buys >= cfg.maxBuys) return false;
    const t = this.buyUsd(bot, bot.amount, reason);
    if (!t) return false;
    const qty = bot.qty + t.qty;
    st.cost += t.qty * t.price;
    st.buys += 1;
    st.lastBuyPrice = t.price;
    if (reason === 'periódica') st.lastBuyAt = Date.now();
    this.log(bot, `Compra ${reason} #${st.buys}: ${+t.qty.toFixed(8)} a ${fmt(t.price)} · precio medio ${fmt(st.cost / qty)}`, {
      qty, entry_price: st.cost / qty, trade_count: bot.trade_count + 1, config: cfg,
    });
    return true;
  }

  runDca(bot) {
    if (!bot.active) return;
    const cfg = JSON.parse(bot.config);
    if (Date.now() - (cfg.state.lastBuyAt || 0) < cfg.intervalHours * 3600e3) return;
    if (cfg.maxBuys && cfg.state.buys >= cfg.maxBuys) return;
    this.dcaBuy(bot, 'periódica');
  }

  tickDca(bot) {
    if (!(bot.qty > 0)) return;
    const t = this.market.tickers[bot.symbol];
    if (!t?.last) return;
    const bid = t.bid || t.last, ask = t.ask || t.last;
    const cfg = JSON.parse(bot.config);
    if (bot.stop_loss > 0 && bid <= bot.entry_price * (1 - bot.stop_loss / 100)) return this.sellAll(bot, 'Stop-loss');
    if (bot.take_profit > 0 && bid >= bot.entry_price * (1 + bot.take_profit / 100)) return this.sellAll(bot, 'Take-profit del ciclo');
    if (cfg.dropPct > 0 && cfg.state.lastBuyPrice && ask <= cfg.state.lastBuyPrice * (1 - cfg.dropPct / 100)) {
      this.dcaBuy(bot, 'en caída');
    }
  }

  // --- Bot grid ---

  levels(cfg) {
    return Array.from({ length: cfg.grids + 1 }, (_, k) => cfg.low + ((cfg.high - cfg.low) * k) / cfg.grids);
  }

  // Al arrancar: las celdas por encima del precio necesitan activo para vender, así que se compra ya;
  // las demás esperan a que el precio baje hasta su nivel para comprar.
  initGrid(bot) {
    const cfg = JSON.parse(bot.config);
    const lv = this.levels(cfg);
    const price = this.broker.quote(bot.symbol, 'buy');
    const perCell = cfg.investment / cfg.grids;
    cfg.cells = lv.slice(0, -1).map((level) => ({ state: 'buy', qty: 0, buyPrice: null, above: level > price }));
    const upper = cfg.cells.filter((c) => c.above);
    let msg = `Grid de ${cfg.grids} niveles entre ${fmt(cfg.low)} y ${fmt(cfg.high)} (${perCell.toFixed(2)} USD por nivel).`;
    let extra = { config: cfg };
    if (upper.length) {
      const t = this.buyUsd(bot, perCell * upper.length, 'compra inicial del grid');
      if (t) {
        for (const c of upper) Object.assign(c, { state: 'sell', qty: t.qty / upper.length, buyPrice: t.price });
        msg += ` Compra inicial de ${+t.qty.toFixed(8)} a ${fmt(t.price)} para ${upper.length} niveles superiores.`;
        extra = { ...extra, qty: t.qty, entry_price: t.price, trade_count: 1 };
      }
    }
    for (const c of cfg.cells) delete c.above;
    this.log(bot, msg, extra);
  }

  tickGrid(bot) {
    const t = this.market.tickers[bot.symbol];
    if (!t?.last) return;
    const bid = t.bid || t.last, ask = t.ask || t.last;
    const cfg = JSON.parse(bot.config);
    if (!cfg.cells?.length) return;
    if (bot.stop_loss > 0 && bid <= cfg.low * (1 - bot.stop_loss / 100)) {
      this.sellAll(bot, 'Stop-loss del grid');
      this.db.prepare('UPDATE bots SET active = 0 WHERE id = ?').run(bot.id);
      this.event(bot, 'Bot pausado tras el stop-loss');
      return;
    }
    const lv = this.levels(cfg);
    const perCell = cfg.investment / cfg.grids;
    let { qty, realized, trade_count: count } = bot;
    let cost = (bot.entry_price || 0) * bot.qty;
    const msgs = [];
    cfg.cells.forEach((c, k) => {
      if (c.state === 'buy' && ask <= lv[k] && ask >= cfg.low * 0.999) {
        const tr = this.buyUsd({ ...bot, qty }, perCell, `nivel ${fmt(lv[k])}`);
        if (!tr) return;
        Object.assign(c, { state: 'sell', qty: tr.qty, buyPrice: tr.price });
        qty += tr.qty; cost += tr.qty * tr.price; count += 1;
        msgs.push(`compró en ${fmt(tr.price)}`);
      } else if (c.state === 'sell' && bid >= lv[k + 1]) {
        const tr = this.sellQty(bot, c.qty, `nivel ${fmt(lv[k + 1])}`);
        if (!tr) return;
        const p = this.pnl(bot, tr, tr.qty, c.buyPrice);
        realized += p; qty -= c.qty; cost -= c.qty * c.buyPrice; count += 1;
        msgs.push(`vendió en ${fmt(tr.price)} (+${p.toFixed(2)} USD)`);
        Object.assign(c, { state: 'buy', qty: 0, buyPrice: null });
      }
    });
    if (!msgs.length) return;
    qty = Math.max(qty, 0);
    this.log(bot, 'Grid: ' + msgs.join(', '), {
      qty, entry_price: qty > 1e-12 ? cost / qty : null, realized, trade_count: count, config: cfg,
    });
  }
}

module.exports = { BotManager };

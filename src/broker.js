// Motor de "paper trading": cuentas, órdenes y carteras virtuales.
// Nada aquí toca dinero real; sólo usa precios de mercado como referencia.
const crypto = require('node:crypto');
const { tx } = require('./db');

const EPS = 1e-9;

class BrokerError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

class Broker {
  constructor(db, market, { initialCash = 10000, feeRate = 0.001, minNotional = 1 } = {}) {
    this.db = db;
    this.market = market;
    this.initialCash = initialCash;
    this.feeRate = feeRate;
    this.minNotional = minNotional;
  }

  // ---------- Usuarios ----------

  register(username, password) {
    username = String(username ?? '').trim();
    password = String(password ?? '');
    if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(username)) {
      throw new BrokerError('El usuario debe tener 3-24 caracteres (letras, números, _ . -)');
    }
    if (password.length < 6) throw new BrokerError('La contraseña debe tener al menos 6 caracteres');
    if (this.db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      throw new BrokerError('Ese nombre de usuario ya existe', 409);
    }
    const { hash, salt } = hashPassword(password);
    const r = this.db
      .prepare('INSERT INTO users (username, pass_hash, salt, cash, initial_cash) VALUES (?, ?, ?, ?, ?)')
      .run(username, hash, salt, this.initialCash, this.initialCash);
    return this.createSession(Number(r.lastInsertRowid));
  }

  login(username, password) {
    const u = this.db.prepare('SELECT * FROM users WHERE username = ?').get(String(username ?? '').trim());
    if (!u) throw new BrokerError('Usuario o contraseña incorrectos', 401);
    const { hash } = hashPassword(String(password ?? ''), u.salt);
    if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(u.pass_hash, 'hex'))) {
      throw new BrokerError('Usuario o contraseña incorrectos', 401);
    }
    return this.createSession(u.id);
  }

  createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
    return token;
  }

  logout(token) {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  userByToken(token) {
    if (!token) return null;
    return this.db
      .prepare('SELECT u.id, u.username, u.cash, u.initial_cash, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?')
      .get(token) ?? null;
  }

  resetAccount(userId) {
    tx(this.db, () => {
      this.db.prepare('DELETE FROM holdings WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM trades WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM orders WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM bots WHERE user_id = ?').run(userId);
      this.db.prepare('UPDATE users SET cash = initial_cash WHERE id = ?').run(userId);
    });
  }

  // ---------- Operaciones ----------

  validate(symbol, side, qty) {
    if (!this.market.symbols.includes(symbol)) throw new BrokerError('Símbolo no soportado');
    if (side !== 'buy' && side !== 'sell') throw new BrokerError('Lado inválido (buy/sell)');
    qty = Number(qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new BrokerError('Cantidad inválida');
    return qty;
  }

  quote(symbol, side) {
    const t = this.market.tickers[symbol];
    if (!t || !t.last) throw new BrokerError('Todavía no hay precio para ese símbolo', 503);
    return side === 'buy' ? (t.ask || t.last) : (t.bid || t.last);
  }

  // Orden a mercado: se ejecuta de inmediato al mejor precio (ask para comprar, bid para vender).
  marketOrder(userId, symbol, side, qty, { botId = null } = {}) {
    qty = this.validate(symbol, side, qty);
    const price = this.quote(symbol, side);
    return tx(this.db, () => this.fill(userId, symbol, side, qty, price, null, botId));
  }

  // Ejecuta una operación dentro de una transacción ya abierta.
  fill(userId, symbol, side, qty, price, orderId, botId = null) {
    const notional = qty * price;
    if (notional < this.minNotional) throw new BrokerError(`El monto mínimo por operación es $${this.minNotional}`);
    const fee = notional * this.feeRate;
    const user = this.db.prepare('SELECT cash FROM users WHERE id = ?').get(userId);
    const h = this.db.prepare('SELECT qty, avg_price FROM holdings WHERE user_id = ? AND symbol = ?').get(userId, symbol);
    let realized = 0;

    if (side === 'buy') {
      const cost = notional + fee;
      if (cost > user.cash + EPS) {
        throw new BrokerError(`Saldo insuficiente: necesitas $${cost.toFixed(2)} y tienes $${user.cash.toFixed(2)}`);
      }
      this.db.prepare('UPDATE users SET cash = cash - ? WHERE id = ?').run(cost, userId);
      if (h) {
        const newQty = h.qty + qty;
        const avg = (h.qty * h.avg_price + notional) / newQty;
        this.db.prepare('UPDATE holdings SET qty = ?, avg_price = ? WHERE user_id = ? AND symbol = ?').run(newQty, avg, userId, symbol);
      } else {
        this.db.prepare('INSERT INTO holdings (user_id, symbol, qty, avg_price) VALUES (?, ?, ?, ?)').run(userId, symbol, qty, price);
      }
    } else {
      if (!h || h.qty + EPS < qty) {
        throw new BrokerError(`No tienes suficiente ${symbol.split('/')[0]} (disponible: ${h ? h.qty : 0})`);
      }
      const proceeds = notional - fee;
      realized = (price - h.avg_price) * qty - fee;
      this.db.prepare('UPDATE users SET cash = cash + ? WHERE id = ?').run(proceeds, userId);
      const left = h.qty - qty;
      if (left <= EPS) {
        this.db.prepare('DELETE FROM holdings WHERE user_id = ? AND symbol = ?').run(userId, symbol);
      } else {
        this.db.prepare('UPDATE holdings SET qty = ? WHERE user_id = ? AND symbol = ?').run(left, userId, symbol);
      }
    }

    const r = this.db
      .prepare('INSERT INTO trades (user_id, symbol, side, qty, price, fee, realized, order_id, bot_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(userId, symbol, side, qty, price, fee, realized, orderId, botId);
    return { id: Number(r.lastInsertRowid), symbol, side, qty, price, fee, realized };
  }

  // Órdenes pendientes:
  //  - limit buy : se ejecuta cuando el precio baja a `price` o menos.
  //  - limit sell: se ejecuta cuando el precio sube a `price` o más (toma de ganancias).
  //  - stop sell : se ejecuta cuando el precio cae a `price` o menos (stop-loss).
  //  - stop buy  : se ejecuta cuando el precio sube a `price` o más (entrada por ruptura).
  placeOrder(userId, symbol, side, type, qty, price) {
    qty = this.validate(symbol, side, qty);
    if (type !== 'limit' && type !== 'stop') throw new BrokerError('Tipo de orden inválido (limit/stop)');
    price = Number(price);
    if (!Number.isFinite(price) || price <= 0) throw new BrokerError('Precio inválido');
    if (qty * price < this.minNotional) throw new BrokerError(`El monto mínimo por operación es $${this.minNotional}`);
    if (side === 'buy') {
      const cost = qty * price * (1 + this.feeRate);
      const { cash } = this.db.prepare('SELECT cash FROM users WHERE id = ?').get(userId);
      if (cost > cash + EPS) throw new BrokerError(`Saldo insuficiente para esta orden (necesitas ~$${cost.toFixed(2)})`);
    } else {
      const h = this.db.prepare('SELECT qty FROM holdings WHERE user_id = ? AND symbol = ?').get(userId, symbol);
      if (!h || h.qty + EPS < qty) throw new BrokerError(`No tienes suficiente ${symbol.split('/')[0]}`);
    }
    const r = this.db
      .prepare('INSERT INTO orders (user_id, symbol, side, type, qty, price) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, symbol, side, type, qty, price);
    const id = Number(r.lastInsertRowid);
    this.processOrders();
    return this.db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  }

  cancelOrder(userId, orderId) {
    const r = this.db
      .prepare("UPDATE orders SET status = 'cancelled', closed_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'open'")
      .run(orderId, userId);
    if (r.changes === 0) throw new BrokerError('Orden no encontrada o ya cerrada', 404);
  }

  static triggered(o, bid, ask) {
    if (o.side === 'buy') return o.type === 'limit' ? ask <= o.price : ask >= o.price;
    return o.type === 'limit' ? bid >= o.price : bid <= o.price;
  }

  // Revisa las órdenes abiertas contra los precios actuales.
  processOrders() {
    const open = this.db.prepare("SELECT * FROM orders WHERE status = 'open' ORDER BY id").all();
    const filled = [];
    for (const o of open) {
      const t = this.market.tickers[o.symbol];
      if (!t?.last) continue;
      const bid = t.bid || t.last;
      const ask = t.ask || t.last;
      if (!Broker.triggered(o, bid, ask)) continue;
      // Límite: nunca peor que el precio pedido. Stop: al precio de mercado.
      let price = o.side === 'buy' ? ask : bid;
      if (o.type === 'limit') price = o.side === 'buy' ? Math.min(price, o.price) : Math.max(price, o.price);
      try {
        tx(this.db, () => {
          this.fill(o.user_id, o.symbol, o.side, o.qty, price, o.id);
          this.db.prepare("UPDATE orders SET status = 'filled', closed_at = datetime('now') WHERE id = ?").run(o.id);
        });
        filled.push(o.id);
      } catch (e) {
        this.db
          .prepare("UPDATE orders SET status = 'rejected', note = ?, closed_at = datetime('now') WHERE id = ?")
          .run(String(e.message), o.id);
      }
    }
    return filled;
  }

  // ---------- Consultas ----------

  portfolio(userId) {
    const u = this.db.prepare('SELECT id, username, cash, initial_cash, created_at FROM users WHERE id = ?').get(userId);
    const holdings = this.db.prepare('SELECT symbol, qty, avg_price FROM holdings WHERE user_id = ? ORDER BY symbol').all(userId);
    let invested = 0;
    let marketValue = 0;
    const rows = holdings.map((h) => {
      const price = this.market.price(h.symbol) ?? h.avg_price;
      const value = h.qty * price;
      const cost = h.qty * h.avg_price;
      invested += cost;
      marketValue += value;
      return { ...h, price, value, cost, pnl: value - cost, pnlPct: cost ? ((value - cost) / cost) * 100 : 0 };
    });
    const { realized, fees, count } = this.db
      .prepare('SELECT COALESCE(SUM(realized),0) AS realized, COALESCE(SUM(fee),0) AS fees, COUNT(*) AS count FROM trades WHERE user_id = ?')
      .get(userId);
    const equity = u.cash + marketValue;
    return {
      user: { id: u.id, username: u.username, created_at: u.created_at },
      cash: u.cash,
      initialCash: u.initial_cash,
      invested,
      marketValue,
      equity,
      unrealized: marketValue - invested,
      realized,
      fees,
      tradeCount: count,
      returnPct: ((equity - u.initial_cash) / u.initial_cash) * 100,
      holdings: rows.map((r) => ({ ...r, weight: equity ? (r.value / equity) * 100 : 0 })),
    };
  }

  trades(userId, limit = 100) {
    return this.db.prepare('SELECT * FROM trades WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit);
  }

  orders(userId) {
    return this.db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY status = 'open' DESC, id DESC LIMIT 100").all(userId);
  }

  leaderboard(limit = 50) {
    const users = this.db.prepare('SELECT id FROM users').all();
    return users
      .map(({ id }) => {
        const p = this.portfolio(id);
        return { username: p.user.username, equity: p.equity, returnPct: p.returnPct, trades: p.tradeCount };
      })
      .sort((a, b) => b.equity - a.equity)
      .slice(0, limit);
  }
}

module.exports = { Broker, BrokerError, hashPassword };

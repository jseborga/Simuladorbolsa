// Fuente de precios: usa CCXT (datos públicos, sin API key) y, si ningún
// exchange responde, cae a un mercado simulado (paseo aleatorio) para que la
// app siempre funcione, incluso sin conexión.
const ccxt = require('ccxt');
const { EventEmitter } = require('node:events');

// Sólo pares cotizados en USD, porque el saldo de las cuentas está en USD.
const DEFAULT_SYMBOLS = [
  'BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD',
  'DOGE/USD', 'LTC/USD', 'DOT/USD', 'LINK/USD', 'AVAX/USD',
  'EUR/USD', 'GBP/USD', 'AUD/USD', 'PAXG/USD',
];

const CATEGORIES = { EUR: 'Forex', GBP: 'Forex', AUD: 'Forex', PAXG: 'Oro' };
const category = (symbol) => CATEGORIES[symbol.split('/')[0]] || 'Cripto';

// Precios de arranque para el modo simulado.
const SEED_PRICES = {
  BTC: 65000, ETH: 3200, SOL: 150, XRP: 0.55, ADA: 0.45,
  DOGE: 0.12, LTC: 80, DOT: 6.5, LINK: 14, AVAX: 30,
  EUR: 1.08, GBP: 1.27, AUD: 0.66, PAXG: 2400,
};

// Volatilidad por tick del modo simulado: el forex se mueve mucho menos que las criptomonedas.
const SIM_VOL = { Forex: 0.0003, Oro: 0.001, Cripto: 0.004 };

const TIMEFRAME_MS = { '1m': 60e3, '5m': 300e3, '15m': 900e3, '1h': 3600e3, '4h': 14400e3, '1d': 86400e3 };

class Market extends EventEmitter {
  constructor({ exchanges = ['kraken', 'coinbase', 'binance'], symbols = DEFAULT_SYMBOLS, pollMs = 5000, simulated = false } = {}) {
    super();
    this.exchangeIds = exchanges;
    this.symbols = symbols;
    this.pollMs = pollMs;
    this.forceSimulated = simulated;
    this.exchange = null;
    this.mode = 'starting';
    this.tickers = {}; // symbol -> { symbol, last, bid, ask, change, percentage, high, low, volume, timestamp }
    this.timer = null;
    this.ohlcvCache = new Map();
    this.historyCache = new Map();
    this.historyExchanges = {};
    this.historyIds = ['bitstamp', 'bitfinex', 'coinbase', ...exchanges];
  }

  async start() {
    if (!this.forceSimulated) {
      for (const id of this.exchangeIds) {
        if (!ccxt[id]) continue;
        try {
          const ex = new ccxt[id]({ enableRateLimit: true, timeout: 10000 });
          await ex.loadMarkets();
          const available = this.symbols.filter((s) => ex.markets[s]);
          if (available.length === 0) continue;
          this.exchange = ex;
          this.symbols = available;
          this.mode = 'live';
          await this.poll();
          break;
        } catch (e) {
          console.warn(`[market] ${id} no disponible: ${e.constructor.name} ${String(e.message).slice(0, 80)}`);
          this.exchange = null;
        }
      }
    }
    if (!this.exchange) this.startSimulation();
    this.timer = setInterval(() => this.poll().catch((e) => console.warn('[market] poll:', e.message)), this.pollMs);
    this.timer.unref?.();
    console.log(`[market] modo=${this.mode} exchange=${this.exchange?.id ?? 'simulado'} símbolos=${this.symbols.length}`);
  }

  stop() {
    clearInterval(this.timer);
  }

  info() {
    return {
      mode: this.mode,
      exchange: this.exchange?.name ?? 'Mercado simulado',
      symbols: this.symbols,
      categories: Object.fromEntries(this.symbols.map((s) => [s, category(s)])),
    };
  }

  startSimulation() {
    this.mode = 'simulated';
    this.exchange = null;
    this.symbols = this.symbols.filter((s) => SEED_PRICES[s.split('/')[0]]);
    const now = Date.now();
    for (const s of this.symbols) {
      const p = SEED_PRICES[s.split('/')[0]];
      this.tickers[s] = { symbol: s, last: p, bid: p, ask: p, open: p, high: p, low: p, change: 0, percentage: 0, volume: 0, timestamp: now };
    }
  }

  async poll() {
    if (this.mode === 'simulated') {
      for (const s of this.symbols) {
        const t = this.tickers[s];
        const drift = (Math.random() - 0.5) * SIM_VOL[category(s)];
        const last = Math.max(t.last * (1 + drift), 1e-8);
        this.tickers[s] = {
          ...t, last, bid: last * 0.9995, ask: last * 1.0005,
          high: Math.max(t.high, last), low: Math.min(t.low, last),
          change: last - t.open, percentage: ((last - t.open) / t.open) * 100, timestamp: Date.now(),
        };
      }
      this.emit('tick', this.tickers);
      return;
    }
    let raw;
    if (this.exchange.has.fetchTickers) {
      raw = await this.exchange.fetchTickers(this.symbols);
    } else {
      raw = {};
      for (const s of this.symbols) raw[s] = await this.exchange.fetchTicker(s);
    }
    for (const s of this.symbols) {
      const t = raw[s];
      if (!t || !t.last) continue;
      this.tickers[s] = {
        symbol: s, last: t.last, bid: t.bid ?? t.last, ask: t.ask ?? t.last, open: t.open,
        high: t.high, low: t.low, change: t.change, percentage: t.percentage,
        volume: t.baseVolume, timestamp: t.timestamp ?? Date.now(),
      };
    }
    this.emit('tick', this.tickers);
  }

  price(symbol) {
    return this.tickers[symbol]?.last ?? null;
  }

  async ohlcv(symbol, timeframe = '1h', limit = 100) {
    if (!this.symbols.includes(symbol)) throw new Error('Símbolo no soportado');
    if (!TIMEFRAME_MS[timeframe]) throw new Error('Temporalidad no soportada');
    limit = Math.min(Math.max(Number(limit) || 100, 10), 1000);
    if (this.mode !== 'live') return this.simCandles(symbol, timeframe).slice(-limit);
    const key = `${symbol}|${timeframe}|${limit}`;
    const cached = this.ohlcvCache.get(key);
    if (cached && Date.now() - cached.at < 30000) return cached.data;
    const data = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    this.ohlcvCache.set(key, { at: Date.now(), data });
    return data;
  }

  // Histórico antiguo para el modo Replay. Kraken sólo sirve las últimas 720 velas,
  // así que se prueban exchanges que sí guardan años de datos.
  async history(symbol, timeframe, since, limit = 500) {
    if (!this.symbols.includes(symbol)) throw new Error('Símbolo no soportado');
    if (!TIMEFRAME_MS[timeframe]) throw new Error('Temporalidad no soportada');
    limit = Math.min(Math.max(Number(limit) || 500, 50), 2000);
    since = Number(since);
    if (!Number.isFinite(since)) throw new Error('Fecha inválida');
    const key = `${symbol}|${timeframe}|${since}|${limit}`;
    const cached = this.historyCache.get(key);
    if (cached) return cached;
    let result = null;
    if (this.mode === 'live') {
      for (const id of this.historyIds) {
        try {
          const ex = (this.historyExchanges[id] ||= new ccxt[id]({ enableRateLimit: true, timeout: 15000 }));
          if (!ex.markets) await ex.loadMarkets();
          if (!ex.markets[symbol] || !ex.timeframes?.[timeframe]) continue;
          const out = [];
          let cursor = since;
          while (out.length < limit) {
            const batch = await ex.fetchOHLCV(symbol, timeframe, cursor, Math.min(1000, limit - out.length));
            const fresh = batch.filter((c) => !out.length || c[0] > out[out.length - 1][0]);
            if (!fresh.length) break;
            out.push(...fresh);
            cursor = fresh[fresh.length - 1][0] + TIMEFRAME_MS[timeframe];
            if (batch.length < 50) break;
          }
          // Algunos exchanges ignoran la fecha y devuelven lo más reciente: se descarta.
          const startsNear = out.length && out[0][0] - since < (limit / 2) * TIMEFRAME_MS[timeframe];
          if (out.length >= 50 && startsNear) { result = { source: ex.name, candles: out.slice(0, limit) }; break; }
        } catch (e) {
          console.warn(`[history] ${id}: ${String(e.message).slice(0, 80)}`);
        }
      }
    }
    if (!result) {
      // Sin histórico disponible: velas simuladas a partir de la fecha pedida.
      const step = TIMEFRAME_MS[timeframe];
      const start = Math.floor(since / step) * step;
      const candles = this.fakeCandles(this.price(symbol) || SEED_PRICES[symbol.split('/')[0]], step, limit, start + (limit - 1) * step, SIM_VOL[category(symbol)] / 0.004);
      result = { source: 'Simulado', candles };
    }
    if (this.historyCache.size > 50) this.historyCache.delete(this.historyCache.keys().next().value);
    this.historyCache.set(key, result);
    return result;
  }

  // Modo simulado: genera un histórico una sola vez y lo va extendiendo con
  // los precios simulados, para que gráficos, backtests y bots vean datos coherentes.
  simCandles(symbol, timeframe) {
    const key = `${symbol}|${timeframe}`;
    const step = TIMEFRAME_MS[timeframe];
    const price = this.price(symbol);
    const now = Math.floor(Date.now() / step) * step;
    let data = this.ohlcvCache.get(key);
    if (!data) {
      data = this.fakeCandles(price, step, 1000, now, SIM_VOL[category(symbol)] / 0.004);
      this.ohlcvCache.set(key, data);
    }
    let last = data[data.length - 1];
    while (last[0] < now) {
      last = [last[0] + step, last[4], last[4], last[4], last[4], 0];
      data.push(last);
    }
    if (data.length > 1200) data.splice(0, data.length - 1000);
    last[4] = price;
    last[2] = Math.max(last[2], price);
    last[3] = Math.min(last[3], price);
    last[5] += Math.random() * 5;
    return data.map((c) => c.slice());
  }

  // Paseo aleatorio hacia atrás que termina en el precio actual.
  fakeCandles(close, step, limit, end, volScale = 1) {
    const vol = 0.01 * volScale * Math.sqrt(step / 3600e3);
    const out = [];
    let trend = 0;
    for (let i = 0; i < limit; i++) {
      if (i % 40 === 0) trend = (Math.random() - 0.5) * vol * 0.6; // tramos con tendencia
      const open = close / (1 + trend + (Math.random() - 0.5) * 2 * vol);
      const high = Math.max(open, close) * (1 + Math.random() * vol / 2);
      const low = Math.min(open, close) * (1 - Math.random() * vol / 2);
      out.unshift([end - i * step, open, high, low, close, Math.random() * 100]);
      close = open;
    }
    return out;
  }
}

module.exports = { Market, DEFAULT_SYMBOLS, TIMEFRAME_MS, category };

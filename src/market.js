// Fuente de precios: usa CCXT (datos públicos, sin API key) y, si ningún
// exchange responde, cae a un mercado simulado (paseo aleatorio) para que la
// app siempre funcione, incluso sin conexión.
const ccxt = require('ccxt');
const { EventEmitter } = require('node:events');

const DEFAULT_SYMBOLS = [
  'BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD',
  'DOGE/USD', 'LTC/USD', 'DOT/USD', 'LINK/USD', 'AVAX/USD',
];

// Precios de arranque para el modo simulado.
const SEED_PRICES = {
  BTC: 65000, ETH: 3200, SOL: 150, XRP: 0.55, ADA: 0.45,
  DOGE: 0.12, LTC: 80, DOT: 6.5, LINK: 14, AVAX: 30,
};

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
    return { mode: this.mode, exchange: this.exchange?.name ?? 'Mercado simulado', symbols: this.symbols };
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
        const drift = (Math.random() - 0.5) * 0.004; // ±0.2 % por tick
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
    const key = `${symbol}|${timeframe}|${limit}`;
    const cached = this.ohlcvCache.get(key);
    if (cached && Date.now() - cached.at < 30000) return cached.data;
    let data;
    if (this.mode === 'live') {
      data = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    } else {
      data = this.fakeCandles(symbol, timeframe, limit);
    }
    this.ohlcvCache.set(key, { at: Date.now(), data });
    return data;
  }

  // Genera velas hacia atrás que terminan en el precio actual.
  fakeCandles(symbol, timeframe, limit) {
    const step = TIMEFRAME_MS[timeframe];
    const vol = 0.01 * Math.sqrt(step / 3600e3);
    let close = this.price(symbol);
    const end = Math.floor(Date.now() / step) * step;
    const out = [];
    for (let i = 0; i < limit; i++) {
      const open = close / (1 + (Math.random() - 0.5) * 2 * vol);
      const high = Math.max(open, close) * (1 + Math.random() * vol / 2);
      const low = Math.min(open, close) * (1 - Math.random() * vol / 2);
      out.unshift([end - i * step, open, high, low, close, Math.random() * 100]);
      close = open;
    }
    return out;
  }
}

module.exports = { Market, DEFAULT_SYMBOLS, TIMEFRAME_MS };

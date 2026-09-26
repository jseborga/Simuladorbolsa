const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { compile, validateDefinition, schema } = require('../src/custom');
const { backtest } = require('../src/backtest');
const { openDb } = require('../src/db');
const { Broker } = require('../src/broker');
const { BotManager } = require('../src/bots');

const candles = (prices) => prices.map((p, i) => [i * 3600e3, i ? prices[i - 1] : p, Math.max(p, i ? prices[i - 1] : p), Math.min(p, i ? prices[i - 1] : p), p, 10]);

test('constructor: cruces y comparaciones con números', () => {
  const s = compile({
    name: 'Test',
    entry: { mode: 'all', conditions: [{ type: 'compare', left: { ind: 'close' }, op: 'crossAbove', right: { ind: 'value', value: 100 } }] },
    exit: { mode: 'any', conditions: [{ type: 'compare', left: { ind: 'close' }, op: 'lt', right: { ind: 'value', value: 95 } }] },
  });
  const { signals } = s.run(candles([90, 95, 99, 101, 105, 98, 94, 93]));
  assert.deepEqual(signals, ['sell', null, null, 'buy', null, null, 'sell', 'sell']);
});

test('constructor: modo "cualquiera" y condiciones ICT/horario', () => {
  const s = compile({
    name: 'Flags',
    entry: { mode: 'any', conditions: [{ type: 'flag', key: 'bull_candle' }, { type: 'flag', key: 'kz_any' }] },
    exit: { mode: 'all', conditions: [] },
  });
  const { signals } = s.run(candles([10, 11, 10, 12]));
  assert.equal(signals[1], 'buy');
  assert.equal(signals[3], 'buy');
});

test('constructor: valida las definiciones', () => {
  assert.throws(() => validateDefinition({ name: '', entry: { conditions: [{ type: 'flag', key: 'trend_up' }] } }), /nombre/);
  assert.throws(() => validateDefinition({ name: 'x', entry: { conditions: [] } }), /al menos una/);
  assert.throws(() => validateDefinition({ name: 'x', entry: { conditions: [{ type: 'flag', key: 'hack' }] } }), /inválida/);
  assert.throws(() => validateDefinition({ name: 'x', entry: { conditions: [{ type: 'compare', left: { ind: 'sma', period: 9999 }, op: 'gt', right: { ind: 'close' } }] } }), /Periodo/);
  // Todas las plantillas son válidas y ejecutables.
  const c = candles(Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 10) * 10 + i / 10));
  for (const t of schema().templates) assert.equal(compile(t).run(c).signals.length, 300);
});

test('backtest con definición personalizada y trailing stop', () => {
  const prices = [100, 100, 100, 101, 110, 120, 130, 125, 118, 110, 105];
  const def = { name: 'Ruptura', entry: { mode: 'all', conditions: [{ type: 'compare', left: { ind: 'close' }, op: 'crossAbove', right: { ind: 'value', value: 100.5 } }] } };
  const r = backtest(candles(prices), { definition: def, feeRate: 0, trailing: 5 });
  assert.equal(r.strategy.name, 'Ruptura');
  assert.equal(r.trades[0].reason, 'Trailing stop');
  assert.ok(r.trades[0].exitPrice >= 130 * 0.95 - 1e-9 && r.trades[0].exitPrice <= 125);
});

function setup(price = 100) {
  const market = new EventEmitter();
  market.symbols = ['BTC/USD'];
  market.tickers = { 'BTC/USD': { last: price, bid: price, ask: price } };
  market.price = (s) => market.tickers[s]?.last;
  market.ohlcv = async () => [];
  const db = openDb(':memory:');
  const broker = new Broker(db, market, { initialCash: 10000, feeRate: 0 });
  const user = broker.userByToken(broker.register('bots_user', 'secreto1'));
  const bots = new BotManager(db, market, broker);
  const setPrice = (p) => { market.tickers['BTC/USD'] = { last: p, bid: p, ask: p }; bots.onTick(); };
  return { db, broker, bots, user, setPrice };
}

test('bot DCA: compra inicial, compra en caída y take-profit sobre el precio medio', () => {
  const { bots, user, setPrice, broker } = setup(100);
  const b = bots.create(user.id, { type: 'dca', symbol: 'BTC/USD', amount: 1000, intervalHours: 24, dropPct: 10, takeProfit: 5 });
  assert.equal(b.qty, 10);
  setPrice(90); // cae 10 % → compra extra
  let s = bots.get(user.id, b.id);
  assert.equal(s.config.state.buys, 2);
  assert.ok(Math.abs(s.entry_price - 2000 / (10 + 1000 / 90)) < 1e-9);
  setPrice(95); // no llega al TP (media ≈ 94,7 → TP ≈ 99,4)
  assert.ok(bots.get(user.id, b.id).qty > 0);
  setPrice(100);
  s = bots.get(user.id, b.id);
  assert.equal(s.qty, 0);
  assert.ok(s.realized > 0);
  assert.equal(s.config.state.buys, 0);
  assert.ok(broker.portfolio(user.id).cash > 10000);
  // La siguiente compra periódica no ocurre antes del intervalo.
  bots.runDca(bots.raw(b.id));
  assert.equal(bots.get(user.id, b.id).qty, 0);
});

test('bot grid: compra al bajar de nivel y vende un nivel más arriba', () => {
  const { bots, user, setPrice } = setup(105);
  const b = bots.create(user.id, { type: 'grid', symbol: 'BTC/USD', low: 90, high: 120, grids: 3, investment: 300 });
  // Niveles 90, 100, 110, 120. Precio 105 → la celda [110,120] se compra al inicio.
  let s = bots.get(user.id, b.id);
  assert.deepEqual(s.config.cells.map((c) => c.state), ['buy', 'buy', 'sell']);
  setPrice(99); // toca 100 → compra la celda [100,110]
  s = bots.get(user.id, b.id);
  assert.deepEqual(s.config.cells.map((c) => c.state), ['buy', 'sell', 'sell']);
  setPrice(111); // toca 110 → vende la celda [100,110] con ganancia
  s = bots.get(user.id, b.id);
  assert.deepEqual(s.config.cells.map((c) => c.state), ['buy', 'buy', 'sell']);
  assert.ok(s.realized > 9 && s.realized < 13, String(s.realized));
  setPrice(121); // vende la celda superior
  assert.equal(bots.get(user.id, b.id).qty, 0);
});

test('editar un bot y registro de eventos', () => {
  const { bots, user } = setup(100);
  const b = bots.create(user.id, { type: 'signal', symbol: 'BTC/USD', strategy: 'sma_cross', params: { fast: 5, slow: 20 }, amount: 100 });
  const u = bots.update(user.id, b.id, { amount: 250, trailing: 3, params: { fast: 8, slow: 21 }, name: 'Mi bot' });
  assert.equal(u.amount, 250);
  assert.equal(u.trailing, 3);
  assert.deepEqual(u.params, { fast: 8, slow: 21 });
  assert.equal(u.name, 'Mi bot');
  assert.ok(bots.events(user.id, b.id).some((e) => /actualizada/.test(e.message)));
  assert.throws(() => bots.create(user.id, { type: 'grid', symbol: 'BTC/USD', low: 100, high: 90, grids: 5, investment: 100 }), /Rango/);
  const g = bots.create(user.id, { type: 'grid', symbol: 'BTC/USD', low: 90, high: 110, grids: 4, investment: 400 });
  assert.throws(() => bots.update(user.id, g.id, { low: 80 }), /no se puede cambiar/);
});

test('bot con estrategia personalizada guarda una copia de la definición', () => {
  const { bots, user } = setup(100);
  const def = { name: 'Mi RSI', entry: { mode: 'all', conditions: [{ type: 'compare', left: { ind: 'rsi', period: 14 }, op: 'lt', right: { ind: 'value', value: 30 } }] } };
  const b = bots.create(user.id, { type: 'signal', symbol: 'BTC/USD', definition: def, amount: 100 });
  assert.equal(b.strategy, 'custom');
  assert.equal(b.strategyName, 'Mi RSI');
});

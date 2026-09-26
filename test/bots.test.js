const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { openDb } = require('../src/db');
const { Broker } = require('../src/broker');
const { BotManager } = require('../src/bots');

function setup() {
  const market = new EventEmitter();
  market.symbols = ['BTC/USD'];
  market.tickers = { 'BTC/USD': { last: 100, bid: 100, ask: 100 } };
  market.price = (s) => market.tickers[s]?.last;
  market.candles = [];
  market.ohlcv = async () => market.candles;
  const db = openDb(':memory:');
  const broker = new Broker(db, market, { initialCash: 10000, feeRate: 0 });
  const user = broker.userByToken(broker.register('bot_user', 'secreto1'));
  const bots = new BotManager(db, market, broker);
  const setPrice = (p) => { market.tickers['BTC/USD'] = { last: p, bid: p, ask: p }; };
  // Velas horarias ya cerradas que terminan con los precios dados.
  const setCandles = (prices) => {
    const step = 3600e3;
    const end = Math.floor(Date.now() / step) * step - step;
    market.candles = prices.map((p, i) => [end - (prices.length - 1 - i) * step, p, p, p, p, 1]);
  };
  return { db, broker, bots, user, market, setPrice, setCandles };
}

test('bot compra con señal, respeta su monto y vende con take-profit', async () => {
  const { broker, bots, user, setPrice, setCandles } = setup();
  // Ruptura: 20 velas planas y la última rompe el máximo.
  setCandles([...Array(20).fill(100), 110]);
  setPrice(110);
  const bot = bots.create(user.id, { symbol: 'BTC/USD', strategy: 'breakout', params: { entry: 5, exit: 5 }, amount: 1100, takeProfit: 10 });
  await bots.runBot(bots.get(user.id, bot.id));
  let b = bots.get(user.id, bot.id);
  assert.ok(Math.abs(b.qty - 10) < 1e-9);
  assert.equal(b.entry_price, 110);
  assert.ok(Math.abs(broker.portfolio(user.id).cash - 8900) < 1e-6);

  // La misma vela no se evalúa dos veces.
  await bots.runBot(b);
  assert.equal(bots.get(user.id, bot.id).trade_count, 1);

  setPrice(122);
  bots.checkRisk();
  b = bots.get(user.id, bot.id);
  assert.equal(b.qty, 0);
  assert.ok(Math.abs(b.realized - 120) < 1e-6);
  assert.match(b.last_event, /Take-profit/);
});

test('bot no vende las compras manuales del usuario', async () => {
  const { broker, bots, user, setPrice } = setup();
  broker.marketOrder(user.id, 'BTC/USD', 'buy', 5);
  const bot = bots.create(user.id, { symbol: 'BTC/USD', strategy: 'rsi', amount: 100 });
  setPrice(100);
  bots.sell(bots.get(user.id, bot.id), 'test');
  assert.equal(broker.portfolio(user.id).holdings[0].qty, 5);
});

test('valida los datos del bot', () => {
  const { bots, user } = setup();
  assert.throws(() => bots.create(user.id, { symbol: 'ETH/USD', strategy: 'rsi', amount: 100 }), /no soportado/);
  assert.throws(() => bots.create(user.id, { symbol: 'BTC/USD', strategy: 'rsi', amount: 0 }), /Monto/);
  assert.throws(() => bots.create(user.id, { symbol: 'BTC/USD', strategy: 'xx', amount: 10 }), /desconocida/);
});

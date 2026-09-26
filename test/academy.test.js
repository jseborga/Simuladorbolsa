const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { Broker } = require('../src/broker');
const { Academy } = require('../src/academy');
const { LESSONS, MODULES } = require('../public/courses');

function setup(price = 100) {
  const market = {
    symbols: ['BTC/USD', 'EUR/USD', 'ETH/USD'],
    tickers: { 'BTC/USD': { last: price, bid: price, ask: price }, 'EUR/USD': { last: 1.1, bid: 1.1, ask: 1.1 }, 'ETH/USD': { last: 10, bid: 10, ask: 10 } },
    price(s) { return this.tickers[s]?.last ?? null; },
  };
  const db = openDb(':memory:');
  const broker = new Broker(db, market, { initialCash: 10000, feeRate: 0 });
  const user = broker.userByToken(broker.register('alumno', 'secreto1'));
  const setPrice = (p) => { market.tickers['BTC/USD'] = { last: p, bid: p, ask: p }; return broker.processOrders(); };
  return { db, broker, user, setPrice, academy: new Academy(db) };
}

test('orden con stop y objetivo (OCO): al tocar el objetivo se cancela el stop', () => {
  const { broker, user, setPrice } = setup(100);
  const r = broker.bracketBuy(user.id, 'BTC/USD', 10, 95, 110);
  assert.equal(r.trade.qty, 10);
  assert.equal(r.stopOrder.oco, r.targetOrder.oco);
  setPrice(111);
  const orders = broker.orders(user.id);
  assert.equal(orders.find((o) => o.type === 'limit').status, 'filled');
  const stop = orders.find((o) => o.type === 'stop');
  assert.equal(stop.status, 'cancelled');
  assert.match(stop.note, /OCO/);
  assert.equal(broker.portfolio(user.id).holdings.length, 0);
});

test('OCO: al tocar el stop se cancela el objetivo', () => {
  const { broker, user, setPrice } = setup(100);
  broker.bracketBuy(user.id, 'BTC/USD', 10, 95, 110);
  setPrice(94);
  const orders = broker.orders(user.id);
  assert.equal(orders.find((o) => o.type === 'stop').status, 'filled');
  assert.equal(orders.find((o) => o.type === 'limit').status, 'cancelled');
});

test('orden con stop: valida niveles', () => {
  const { broker, user } = setup(100);
  assert.throws(() => broker.bracketBuy(user.id, 'BTC/USD', 1, 105, 110), /stop-loss/);
  assert.throws(() => broker.bracketBuy(user.id, 'BTC/USD', 1, 95, 90), /objetivo/);
  assert.equal(broker.portfolio(user.id).tradeCount, 0);
});

test('Academia: contenido bien formado', () => {
  const ids = new Set();
  for (const l of LESSONS) {
    assert.ok(!ids.has(l.id), 'id duplicado ' + l.id);
    ids.add(l.id);
    assert.ok(l.quiz.length >= 3);
    for (const q of l.quiz) assert.ok(q.answer >= 0 && q.answer < q.options.length, l.id + ': ' + q.q);
  }
  assert.ok(MODULES.length >= 6);
});

test('Academia: quiz corregido en el servidor y tarea práctica obligatoria', () => {
  const { academy, broker, user } = setup(100);
  const l1 = LESSONS.find((l) => l.id === 'l1');
  const right = l1.quiz.map((q) => q.answer);
  // Aprueba el quiz pero falta la tarea (hacer una compra).
  let r = academy.submit(user.id, 'l1', right);
  assert.equal(r.passed, true);
  assert.equal(r.completed, false);
  broker.marketOrder(user.id, 'BTC/USD', 'buy', 1);
  r = academy.submit(user.id, 'l1', right);
  assert.equal(r.completed, true);
  assert.ok(r.progress.badges.includes('first_trade'));
  // Suspende con respuestas incorrectas.
  const l8 = LESSONS.find((l) => l.id === 'l8');
  r = academy.submit(user.id, 'l8', l8.quiz.map((q) => (q.answer + 1) % q.options.length));
  assert.equal(r.passed, false);
  assert.equal(r.progress.completed, 1);
  assert.throws(() => academy.submit(user.id, 'nope', []), /no encontrada/);
});

test('Academia: comprobaciones de tareas', () => {
  const { academy, broker, user, db } = setup(100);
  let c = academy.checks(user.id);
  assert.equal(c.diversify3, false);
  broker.marketOrder(user.id, 'BTC/USD', 'buy', 1);
  broker.marketOrder(user.id, 'EUR/USD', 'buy', 100);
  broker.marketOrder(user.id, 'ETH/USD', 'buy', 1);
  db.prepare("INSERT INTO journal (trade_id, user_id, notes) VALUES (1, ?, 'entré por ruptura')").run(user.id);
  academy.logActivity(user.id, 'backtest');
  c = academy.checks(user.id);
  assert.equal(c.diversify3, true);
  assert.equal(c.forex_trade, true);
  assert.equal(c.journal, true);
  assert.equal(c.backtest, true);
  assert.equal(c.replay, false);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { Broker } = require('../src/broker');

function setup(price = 100) {
  const market = {
    symbols: ['BTC/USD'],
    tickers: { 'BTC/USD': { last: price, bid: price, ask: price } },
    price(s) { return this.tickers[s]?.last ?? null; },
  };
  const broker = new Broker(openDb(':memory:'), market, { initialCash: 10000, feeRate: 0.001 });
  const token = broker.register('ana', 'secreto1');
  const user = broker.userByToken(token);
  const setPrice = (p) => { market.tickers['BTC/USD'] = { last: p, bid: p, ask: p }; };
  return { broker, user, setPrice };
}

test('registro y login', () => {
  const { broker } = setup();
  assert.throws(() => broker.register('ana', 'otra123'), /ya existe/);
  assert.throws(() => broker.login('ana', 'mala'), /incorrectos/);
  assert.ok(broker.userByToken(broker.login('ANA', 'secreto1')));
});

test('compra y venta a mercado con comisión y G/P realizada', () => {
  const { broker, user, setPrice } = setup(100);
  broker.marketOrder(user.id, 'BTC/USD', 'buy', 10);
  let p = broker.portfolio(user.id);
  assert.equal(p.cash, 10000 - 1000 - 1);
  assert.equal(p.holdings[0].qty, 10);
  setPrice(120);
  const t = broker.marketOrder(user.id, 'BTC/USD', 'sell', 10);
  assert.equal(t.realized, 200 - 1.2);
  p = broker.portfolio(user.id);
  assert.equal(p.holdings.length, 0);
  assert.ok(Math.abs(p.cash - (10000 - 1001 + 1198.8)) < 1e-9);
});

test('rechaza saldo insuficiente y ventas en descubierto', () => {
  const { broker, user } = setup(100);
  assert.throws(() => broker.marketOrder(user.id, 'BTC/USD', 'buy', 1000), /Saldo insuficiente/);
  assert.throws(() => broker.marketOrder(user.id, 'BTC/USD', 'sell', 1), /No tienes suficiente/);
  assert.throws(() => broker.marketOrder(user.id, 'ETH/USD', 'buy', 1), /no soportado/);
});

test('orden límite de compra se ejecuta cuando el precio baja', () => {
  const { broker, user, setPrice } = setup(100);
  const o = broker.placeOrder(user.id, 'BTC/USD', 'buy', 'limit', 5, 90);
  assert.equal(o.status, 'open');
  setPrice(95);
  assert.deepEqual(broker.processOrders(), []);
  setPrice(89);
  assert.deepEqual(broker.processOrders(), [o.id]);
  assert.equal(broker.trades(user.id)[0].price, 89);
});

test('stop-loss vende cuando el precio cae', () => {
  const { broker, user, setPrice } = setup(100);
  broker.marketOrder(user.id, 'BTC/USD', 'buy', 5);
  const o = broker.placeOrder(user.id, 'BTC/USD', 'sell', 'stop', 5, 95);
  setPrice(94);
  assert.deepEqual(broker.processOrders(), [o.id]);
  assert.equal(broker.portfolio(user.id).holdings.length, 0);
});

test('reinicio de cuenta y ranking', () => {
  const { broker, user } = setup(100);
  broker.register('luis', 'secreto2');
  broker.marketOrder(user.id, 'BTC/USD', 'buy', 10);
  assert.equal(broker.leaderboard().length, 2);
  broker.resetAccount(user.id);
  const p = broker.portfolio(user.id);
  assert.equal(p.cash, 10000);
  assert.equal(p.tradeCount, 0);
});

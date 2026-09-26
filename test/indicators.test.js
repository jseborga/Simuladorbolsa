const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../public/indicators');
const { backtest } = require('../src/backtest');

const close = (a, b) => Math.abs(a - b) < 1e-6;

test('SMA y EMA', () => {
  assert.deepEqual(I.sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  const e = I.ema([1, 2, 3, 4, 5], 3);
  assert.equal(e[1], null);
  assert.equal(e[2], 2);
  assert.ok(close(e[3], 3) && close(e[4], 4));
});

test('RSI: 100 en subida continua y ~0 en bajada', () => {
  const up = Array.from({ length: 30 }, (_, i) => i + 1);
  assert.equal(I.rsi(up, 14).at(-1), 100);
  assert.ok(I.rsi(up.slice().reverse(), 14).at(-1) < 1);
});

test('Bollinger: banda plana con precio constante', () => {
  const b = I.bollinger(Array(25).fill(10), 20, 2);
  assert.equal(b.upper.at(-1), 10);
  assert.equal(b.lower.at(-1), 10);
});

test('MACD tiene la misma longitud que la entrada', () => {
  const v = Array.from({ length: 60 }, (_, i) => Math.sin(i / 5) * 10 + 100);
  const m = I.macd(v);
  assert.equal(m.hist.length, 60);
  assert.ok(m.hist.at(-1) != null);
});

// Precio que baja y luego sube: el cruce de medias debe comprar en la subida.
function vCandles() {
  const prices = [...Array.from({ length: 40 }, (_, i) => 200 - i * 2), ...Array.from({ length: 60 }, (_, i) => 120 + i * 3)];
  return prices.map((p, i) => [i * 3600e3, p, p * 1.01, p * 0.99, p, 1]);
}

test('backtest: cruce de medias gana en una tendencia alcista y ejecuta en la vela siguiente', () => {
  const c = vCandles();
  const r = backtest(c, { strategy: 'sma_cross', params: { fast: 3, slow: 8 }, initialCash: 1000, feeRate: 0.001 });
  assert.ok(r.metrics.trades >= 1);
  assert.ok(r.metrics.totalReturn > 0);
  const buy = r.markers.find((m) => m.side === 'buy');
  assert.equal(buy.price, c[buy.i][1]); // precio de apertura
  assert.equal(r.equity.length, c.length);
});

test('backtest: stop-loss corta la pérdida', () => {
  const prices = [100, 100, 100, 100, 100, 101, 102, 103, 80, 70, 60, 50];
  const c = prices.map((p, i) => [i, p, p, p, p, 1]);
  const r = backtest(c, { strategy: 'breakout', params: { entry: 3, exit: 5 }, initialCash: 1000, feeRate: 0, stopLoss: 5 });
  const t = r.trades[0];
  assert.equal(t.reason, 'Stop-loss');
  assert.ok(t.pnlPct > -25); // sin stop habría perdido ~50 %
});

test('backtest: rechaza estrategia desconocida', () => {
  assert.throws(() => backtest(vCandles(), { strategy: 'nope' }), /desconocida/);
});

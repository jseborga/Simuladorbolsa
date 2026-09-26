const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../public/indicators');
const { backtest } = require('../src/backtest');
const { Broker } = require('../src/broker');
const { openDb } = require('../src/db');

// Vela plana [ts, o, h, l, c, v]
const k = (i, o, h, l, c) => [i * 3600e3, o, h, l, c, 1];

test('FVG alcista: hueco entre el máximo de la vela 1 y el mínimo de la vela 3, y su relleno', () => {
  const c = [
    k(0, 10, 10.5, 9.5, 10), k(1, 10, 10.5, 9.5, 10),
    k(2, 10, 11, 10, 11), // vela 1: máximo 11
    k(3, 11, 14, 11, 14), // impulso
    k(4, 14, 15, 12, 15), // vela 3: mínimo 12 > 11 → FVG [11, 12]
    k(5, 15, 15, 11.5, 12), // toca el FVG
    k(6, 12, 12, 10.5, 11), // lo rellena
  ];
  const g = I.fvgs(c, 0).find((x) => x.dir === 'up' && x.top === 12);
  assert.deepEqual([g.bottom, g.top, g.i, g.touched, g.filled], [11, 12, 3, 5, 6]);
});

test('estructura: BOS alcista y luego CHoCH bajista', () => {
  const p = [10, 11, 12, 15, 12, 11, 10, 11, 12, 13, 14, 16, 17, 14, 12, 11, 9, 8, 7, 6];
  const c = p.map((x, i) => k(i, i ? p[i - 1] : x, Math.max(x, i ? p[i - 1] : x) + 0.1, Math.min(x, i ? p[i - 1] : x) - 0.1, x));
  const st = I.structure(c, 2);
  const kinds = st.events.map((e) => `${e.kind}-${e.dir}`);
  assert.ok(kinds.includes('BOS-up'), kinds.join());
  assert.ok(kinds.includes('CHoCH-down'), kinds.join());
  const ob = I.orderBlocks(c, st.events);
  assert.ok(ob.length >= 1);
  assert.ok(st.events.every((e) => e.to > e.from));
});

test('liquidez: máximos iguales (EQH) y barrida', () => {
  const p = [10, 11, 12, 11, 10, 11, 12, 11, 10, 9, 10];
  const c = p.map((x, i) => k(i, x, x, x - 0.1, x));
  c.push(k(11, 11, 12.5, 11, 11.5)); // mecha por encima de 12 y cierre dentro
  const sw = I.swings(c, 2);
  const lq = I.liquidity(c, sw, 1);
  assert.equal(lq.equal[0].type, 'EQH');
  assert.equal(lq.equal[0].swept, 11);
  assert.ok(lq.sweeps.some((s) => s.label === 'Barrida BSL' && s.i === 11));
});

test('kill zones y horarios de mercado (con horario de verano)', () => {
  // 2026-07-01 12:30 UTC = 08:30 NY (EDT) → kill zone de Nueva York
  assert.ok(I.inKillzone(Date.UTC(2026, 6, 1, 12, 30), ['ny']));
  // 2026-01-14 12:30 UTC = 07:30 NY (EST) → también
  assert.ok(I.inKillzone(Date.UTC(2026, 0, 14, 12, 30), ['ny']));
  assert.ok(!I.inKillzone(Date.UTC(2026, 0, 14, 18, 0), ['ny', 'london']));
  const nyse = I.EXCHANGES.find((e) => e.tz === 'America/New_York');
  // Miércoles 15:00 UTC = 11:00 NY → abierta, cierra en 5 h
  let s = I.marketStatus(nyse, Date.UTC(2026, 6, 1, 15, 0));
  assert.equal(s.open, true);
  assert.equal(s.minutesToChange, 300);
  // Sábado → cerrada, abre el lunes 9:30
  s = I.marketStatus(nyse, Date.UTC(2026, 6, 4, 13, 30));
  assert.equal(s.open, false);
  assert.equal(s.minutesToChange, 2 * 1440);
  // Tokio en pausa de almuerzo (12:00 JST = 03:00 UTC)
  const tse = I.EXCHANGES.find((e) => e.tz === 'Asia/Tokyo');
  s = I.marketStatus(tse, Date.UTC(2026, 6, 1, 3, 0));
  assert.equal(s.lunch, true);
  // Forex: abierto un martes, cerrado un sábado
  const fx = { tz: 'America/New_York', forex: true };
  assert.equal(I.marketStatus(fx, Date.UTC(2026, 6, 7, 12)).open, true);
  assert.equal(I.marketStatus(fx, Date.UTC(2026, 6, 4, 12)).open, false);
});

test('cajas de sesión de Londres', () => {
  // Martes 2026-07-07, velas de 1 h desde 00:00 UTC. Londres (BST) 08:00–17:00 = 07:00–16:00 UTC.
  const start = Date.UTC(2026, 6, 7);
  const c = Array.from({ length: 24 }, (_, i) => [start + i * 3600e3, 1, 1 + i / 100, 1 - i / 100, 1, 1]);
  const box = I.sessionBoxes(c, ['london'])[0];
  assert.equal(box.i1, 7);
  assert.equal(box.i2, 15);
});

test('estrategia ICT en backtest devuelve zonas y segmentos', () => {
  const c = [];
  let p = 100;
  for (let i = 0; i < 400; i++) {
    const o = p;
    p = p * (1 + Math.sin(i / 15) * 0.01 + (i % 7 === 0 ? 0.01 : -0.002));
    c.push([i * 3600e3, o, Math.max(o, p) * 1.002, Math.min(o, p) * 0.998, p, 1]);
  }
  const r = backtest(c, { strategy: 'ict_fvg', params: { swing: 3, minAtr: 0 } });
  assert.ok(r.zones.length > 0);
  assert.ok(r.segments.length > 0);
  assert.equal(r.equity.length, 400);
});

test('comisión por categoría: forex más barato que cripto', () => {
  const market = {
    symbols: ['BTC/USD', 'EUR/USD'],
    tickers: { 'BTC/USD': { last: 100, bid: 100, ask: 100 }, 'EUR/USD': { last: 1.1, bid: 1.1, ask: 1.1 } },
    price(s) { return this.tickers[s].last; },
  };
  const b = new Broker(openDb(':memory:'), market, { feeRate: 0.001, categoryFees: { Forex: 0.0001 } });
  const u = b.userByToken(b.register('fx_user', 'secreto1'));
  assert.ok(Math.abs(b.marketOrder(u.id, 'EUR/USD', 'buy', 1000).fee - 0.11) < 1e-9);
  assert.ok(Math.abs(b.marketOrder(u.id, 'BTC/USD', 'buy', 1).fee - 0.1) < 1e-9);
});

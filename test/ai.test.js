const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Anthropic = require('@anthropic-ai/sdk');
const { openDb } = require('../src/db');
const { Broker } = require('../src/broker');
const { BotManager } = require('../src/bots');
const { AIAdvisor, marketContext } = require('../src/ai');

// Cliente real del SDK con un fetch simulado que captura la petición.
function fakeClient(reply, captured) {
  return new Anthropic({
    apiKey: 'test-key',
    maxRetries: 0,
    fetch: async (url, init) => {
      captured.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
}

const msg = (text, stop_reason = 'end_turn') => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', stop_reason, stop_sequence: null,
  content: text ? [{ type: 'text', text }] : [], usage: { input_tokens: 10, output_tokens: 5 },
});

const candles = (n = 120, p0 = 100) => Array.from({ length: n }, (_, i) => {
  const p = p0 + Math.sin(i / 8) * 5 + i * 0.1;
  return [Date.UTC(2026, 0, 5) + i * 3600e3, p - 0.5, p + 1, p - 1, p, 10];
});

function user(db) {
  const market = { symbols: ['BTC/USD'], tickers: {}, price: () => 100 };
  const b = new Broker(db, market);
  return b.userByToken(b.register('ia_user', 'secreto1'));
}

test('decide(): petición correcta al API y respuesta estructurada', async () => {
  const db = openDb(':memory:');
  const u = user(db);
  const captured = [];
  const decision = { action: 'buy', size_pct: 50, stop_loss: 95, take_profit: 110, confidence: 0.7, reasoning: 'Rebote en soporte', key_factors: ['RSI bajo'] };
  const ai = new AIAdvisor(db, { client: fakeClient(msg(JSON.stringify(decision)), captured) });
  const d = await ai.decide(u.id, { context: marketContext('BTC/USD', '1h', candles()), position: { open: false }, account: {}, instructions: 'conservador', memory: [] });
  assert.equal(d.action, 'buy');
  assert.equal(d.stop_loss, 95);
  const req = captured[0];
  assert.match(req.url, /\/v1\/messages/);
  assert.equal(req.body.model, 'claude-opus-5');
  assert.equal(req.body.fallbacks, 'default');
  assert.deepEqual(req.body.thinking, { type: 'adaptive' });
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.deepEqual(req.body.output_config.format.schema.required.sort(), ['action', 'confidence', 'key_factors', 'reasoning', 'size_pct', 'stop_loss', 'take_profit']);
  assert.ok(!('betas' in req.body));
  const beta = req.headers instanceof Headers ? req.headers.get('anthropic-beta') : req.headers['anthropic-beta'];
  assert.match(beta, /server-side-fallback-2026-07-01/);
  assert.match(req.body.messages[0].content, /<instrucciones>conservador<\/instrucciones>/);
  assert.equal(ai.usage(u.id), 1);
});

test('límite diario, IA desactivada y rechazos', async () => {
  const db = openDb(':memory:');
  const u = user(db);
  const ai = new AIAdvisor(db, { client: fakeClient(msg('hola'), []), dailyLimit: 1 });
  assert.equal((await ai.explain(u.id, 'explica', {})).text, 'hola');
  await assert.rejects(ai.explain(u.id, 'otra', {}), /límite diario/);
  const off = new AIAdvisor(db, { client: null });
  off.client = null;
  assert.equal(off.enabled, false);
  await assert.rejects(off.explain(u.id, 'x', {}), /no está configurada/);
  const refusing = new AIAdvisor(db, { client: fakeClient(msg('', 'refusal'), []) });
  await assert.rejects(refusing.explain(u.id, 'x', {}).catch((e) => { throw e; }), /declinó|límite/);
});

test('contexto de mercado compacto con indicadores e ICT', () => {
  const c = marketContext('EUR/USD', '1h', candles(200, 1.1));
  assert.equal(c.candles_recent.length, 40);
  assert.ok(c.indicators.rsi14 > 0);
  assert.ok(['alcista', 'bajista', 'indefinida'].includes(c.ict.structure_trend));
  assert.ok(c.time_context.kill_zone);
});

function botSetup(decisions) {
  const market = new EventEmitter();
  market.symbols = ['BTC/USD'];
  market.tickers = { 'BTC/USD': { last: 100, bid: 100, ask: 100 } };
  market.price = (s) => market.tickers[s]?.last;
  market.ohlcv = async () => candles(120).map((c, i, a) => [Date.now() - (a.length - i + 1) * 3600e3, ...c.slice(1)]);
  const db = openDb(':memory:');
  const broker = new Broker(db, market, { initialCash: 10000, feeRate: 0 });
  const u = broker.userByToken(broker.register('bot_ia', 'secreto1'));
  const queue = [...decisions];
  const advisor = { enabled: true, decide: async () => ({ model: 'fake', ...queue.shift() }) };
  const bots = new BotManager(db, market, broker, { advisor });
  const setPrice = (p) => { market.tickers['BTC/USD'] = { last: p, bid: p, ask: p }; bots.onTick(); };
  const nextCandle = (id) => db.prepare('UPDATE bots SET last_candle = NULL WHERE id = ?').run(id);
  return { db, broker, bots, u, setPrice, nextCandle };
}

const D = (o) => ({ action: 'hold', size_pct: 0, stop_loss: 0, take_profit: 0, confidence: 0.5, reasoning: 'r', key_factors: [], ...o });

test('bot IA: respeta la confianza mínima y recorta un stop demasiado lejano', async () => {
  const { bots, u, nextCandle, broker } = botSetup([
    D({ action: 'buy', size_pct: 100, stop_loss: 50, confidence: 0.4 }),
    D({ action: 'buy', size_pct: 50, stop_loss: 50, take_profit: 120, confidence: 0.8 }),
  ]);
  const bot = bots.create(u.id, { type: 'ai', symbol: 'BTC/USD', timeframe: '1h', amount: 1000, minConfidence: 0.6, maxStopPct: 5 });
  await new Promise((r) => setTimeout(r, 20)); // primera decisión (al crear)
  let b = bots.get(u.id, bot.id);
  assert.equal(b.qty, 0);
  assert.match(bots.decisions(u.id, bot.id)[0].note, /Confianza 40 %/);
  nextCandle(bot.id);
  await bots.runAi(bots.raw(bot.id));
  b = bots.get(u.id, bot.id);
  assert.equal(b.qty, 5); // 50 % de 1000 USD a 100
  assert.equal(b.config.stop, 95); // recortado al 5 %
  assert.equal(b.config.target, 120);
  assert.match(bots.decisions(u.id, bot.id)[0].note, /recortado/);
  assert.equal(broker.portfolio(u.id).cash, 9500);
});

test('bot IA: sube el stop (nunca lo baja) y el stop se ejecuta', async () => {
  const { bots, u, nextCandle, setPrice } = botSetup([
    D({ action: 'buy', size_pct: 100, stop_loss: 96, confidence: 0.9 }),
    D({ action: 'hold', stop_loss: 90 }), // intento de bajar el stop: ignorado
    D({ action: 'hold', stop_loss: 99 }), // sube el stop
  ]);
  const bot = bots.create(u.id, { type: 'ai', symbol: 'BTC/USD', amount: 1000 });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(bots.get(u.id, bot.id).config.stop, 96);
  setPrice(105);
  nextCandle(bot.id); await bots.runAi(bots.raw(bot.id));
  assert.equal(bots.get(u.id, bot.id).config.stop, 96);
  nextCandle(bot.id); await bots.runAi(bots.raw(bot.id));
  assert.equal(bots.get(u.id, bot.id).config.stop, 99);
  setPrice(98.5);
  const b = bots.get(u.id, bot.id);
  assert.equal(b.qty, 0);
  assert.match(b.last_event, /Stop-loss de la IA/);
  assert.ok(b.realized < 0);
});

test('bot IA: requiere IA configurada y temporalidad de 15m o más', () => {
  const { bots, u } = botSetup([]);
  assert.throws(() => bots.create(u.id, { type: 'ai', symbol: 'BTC/USD', timeframe: '5m', amount: 100 }), /15m/);
  bots.advisor = { enabled: false };
  assert.throws(() => bots.create(u.id, { type: 'ai', symbol: 'BTC/USD', amount: 100 }), /no está configurada/);
});

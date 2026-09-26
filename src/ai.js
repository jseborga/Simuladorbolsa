// Integración con Claude (Anthropic) para aprender con IA:
//  - decide(): el "agente IA" de un bot recibe un resumen del mercado y devuelve una
//    decisión estructurada (comprar / vender / mantener) con su razonamiento.
//  - explain(): análisis educativo del gráfico o revisión de una operación del diario.
// La IA nunca opera sin límites: el BotManager valida y recorta cada decisión.
const Anthropic = require('@anthropic-ai/sdk');
const I = require('../public/indicators');
const { BrokerError } = require('./broker');

const MODEL = process.env.AI_MODEL || 'claude-opus-5';
const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 100; // llamadas por usuario y día

// Esquema de la decisión: la API garantiza que la respuesta lo cumple.
const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['buy', 'sell', 'hold'] },
    size_pct: { type: 'number', description: '% del presupuesto del bot a usar al comprar (0-100)' },
    stop_loss: { type: 'number', description: 'Precio del stop-loss; 0 si no aplica' },
    take_profit: { type: 'number', description: 'Precio objetivo; 0 si no aplica' },
    confidence: { type: 'number', description: 'Confianza de 0 a 1' },
    reasoning: { type: 'string', description: 'Explicación breve en español para un alumno' },
    key_factors: { type: 'array', items: { type: 'string' }, description: 'Factores clave (máx. 5)' },
  },
  required: ['action', 'size_pct', 'stop_loss', 'take_profit', 'confidence', 'reasoning', 'key_factors'],
  additionalProperties: false,
};

const DECISION_SYSTEM = `Eres un agente de trading dentro de un simulador educativo con dinero virtual.
Cada vez que cierra una vela recibes un resumen del mercado (velas recientes, indicadores, conceptos ICT, horario) y el estado de tu posición, y decides UNA acción:
- "buy": abrir una compra (sólo si no hay posición). Indica size_pct (0-100 % del presupuesto), un stop_loss por debajo del precio y, si quieres, un take_profit por encima.
- "sell": cerrar la posición abierta.
- "hold": no hacer nada. Si hay posición, puedes subir el stop_loss para proteger ganancias (nunca bajarlo); si no, pon 0.
Reglas:
- Sólo se opera en largo (comprar y luego vender). No hay apalancamiento.
- Protege el capital: el stop es obligatorio al comprar. Prefiere no operar a operar sin ventaja clara; "hold" es una respuesta válida y frecuente.
- Ten en cuenta las comisiones: movimientos esperados muy pequeños no compensan.
- Sigue las instrucciones de estilo del alumno si son razonables, pero nunca ignores la gestión del riesgo.
- Revisa tus decisiones anteriores y su resultado para no repetir errores.
- confidence refleja honestamente tu incertidumbre (0 = ninguna, 1 = total).
- reasoning: 2-4 frases claras en español, pensadas para que un principiante aprenda por qué decides eso.`;

const EXPLAIN_SYSTEM = `Eres un profesor de trading dentro de un simulador educativo con dinero virtual.
Explicas en español, con claridad y sin jerga innecesaria (si usas un término técnico, explícalo en una frase).
No das asesoramiento financiero ni prometes resultados: hablas de escenarios, probabilidades y gestión del riesgo.
Responde con Markdown sencillo (títulos cortos con ##, listas) y un máximo de ~300 palabras.`;

const round = (v) => (v == null || !Number.isFinite(v) ? null : Number(v.toPrecision(6)));

// Resumen compacto del mercado que se envía a la IA.
function marketContext(symbol, timeframe, candles) {
  const n = candles.length;
  const cl = candles.map((c) => c[4]);
  const last = candles[n - 1];
  const at = (arr) => round(arr[n - 1]);
  const macd = I.macd(cl);
  const bb = I.bollinger(cl, 20, 2);
  const st = I.structure(candles, 5);
  const lastEvents = st.events.slice(-3).map((e) => `${e.kind} ${e.dir === 'up' ? 'alcista' : 'bajista'} en ${round(e.price)} (hace ${n - 1 - e.to} velas)`);
  const gaps = I.fvgs(candles, 0.1).filter((g) => g.filled == null).slice(-4)
    .map((g) => `FVG ${g.dir === 'up' ? 'alcista' : 'bajista'} ${round(g.bottom)}–${round(g.top)}`);
  const obs = I.orderBlocks(candles, st.events).filter((b) => b.broken == null).slice(-3)
    .map((b) => `OB ${b.dir === 'up' ? 'alcista' : 'bajista'} ${round(b.bottom)}–${round(b.top)}`);
  const lq = I.liquidity(candles, st.swings);
  const liq = lq.equal.filter((q) => q.swept == null).slice(-3).map((q) => `${q.type} en ${round(q.price)}`);
  const pd = I.premiumDiscount(candles, Math.max(0, n - 50));
  const kz = I.KILLZONES.find((k) => I.inKillzone(last[0], [k.id]));
  const sessions = I.SESSIONS.filter((s) => I.marketStatus(s, last[0]).open).map((s) => s.name);
  return {
    symbol, timeframe,
    time_utc: new Date(last[0]).toISOString(),
    price: round(last[4]),
    candles_recent: candles.slice(-40).map((c) => [new Date(c[0]).toISOString().slice(5, 16), round(c[1]), round(c[2]), round(c[3]), round(c[4]), round(c[5])]),
    candles_format: '[fecha UTC, apertura, máximo, mínimo, cierre, volumen]',
    indicators: {
      sma20: at(I.sma(cl, 20)), sma50: at(I.sma(cl, 50)), ema200: at(I.ema(cl, 200)),
      rsi14: at(I.rsi(cl, 14)), macd: at(macd.macd), macd_signal: at(macd.signal), macd_hist: at(macd.hist),
      bb_upper: at(bb.upper), bb_lower: at(bb.lower), atr14: at(I.atr(candles, 14)),
      change_24_candles_pct: n > 24 ? round(((last[4] - candles[n - 25][4]) / candles[n - 25][4]) * 100) : null,
    },
    ict: {
      structure_trend: st.trend[n - 1] === 1 ? 'alcista' : st.trend[n - 1] === -1 ? 'bajista' : 'indefinida',
      last_structure_events: lastEvents,
      unfilled_fvgs: gaps,
      active_order_blocks: obs,
      pending_liquidity: liq,
      range_50_candles: { high: round(pd.high), low: round(pd.low), equilibrium: round(pd.eq), zone: last[4] > pd.eq ? 'premium' : 'discount' },
    },
    time_context: { kill_zone: kz ? kz.name : 'ninguna', forex_sessions_open: sessions },
  };
}

class AIAdvisor {
  constructor(db, { client, model = MODEL, dailyLimit = DAILY_LIMIT } = {}) {
    this.db = db;
    this.model = model;
    this.dailyLimit = dailyLimit;
    // Sin clave no se crea el cliente: la IA queda desactivada y la interfaz lo explica.
    this.client = client || (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? new Anthropic() : null);
  }

  get enabled() {
    return !!this.client;
  }

  info(userId) {
    const used = userId ? this.usage(userId) : 0;
    return { enabled: this.enabled, model: this.model, dailyLimit: this.dailyLimit, usedToday: used };
  }

  usage(userId) {
    const row = this.db.prepare("SELECT calls FROM ai_usage WHERE user_id = ? AND day = date('now')").get(userId);
    return row?.calls ?? 0;
  }

  // Controla el gasto: cada usuario tiene un máximo de llamadas al día.
  consume(userId) {
    if (!this.enabled) throw new BrokerError('La IA no está configurada en este servidor: define la variable ANTHROPIC_API_KEY', 503);
    if (this.usage(userId) >= this.dailyLimit) throw new BrokerError(`Has alcanzado el límite diario de ${this.dailyLimit} consultas a la IA`, 429);
    this.db
      .prepare("INSERT INTO ai_usage (user_id, day, calls) VALUES (?, date('now'), 1) ON CONFLICT(user_id, day) DO UPDATE SET calls = calls + 1")
      .run(userId);
  }

  async call(params) {
    try {
      // fallbacks "default": si el modelo rechaza la petición, la API la reintenta en otro modelo.
      return await this.client.beta.messages.create({
        model: this.model,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        ...params,
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new BrokerError('La clave de la API de Anthropic no es válida', 503);
      if (e instanceof Anthropic.RateLimitError) throw new BrokerError('La IA está saturada, inténtalo en un momento', 429);
      if (e instanceof Anthropic.APIError) throw new BrokerError(`Error de la IA (${e.status ?? 'red'}): ${e.message}`, 502);
      throw e;
    }
  }

  static text(msg) {
    if (msg.stop_reason === 'refusal') throw new BrokerError('La IA declinó responder a esta petición', 502);
    return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  }

  // Decisión de trading estructurada para un bot IA.
  async decide(userId, { context, position, account, instructions, memory }) {
    this.consume(userId);
    const prompt = [
      '# Mercado', JSON.stringify(context),
      '# Tu posición', JSON.stringify(position),
      '# Cuenta del bot', JSON.stringify(account),
      '# Tus últimas decisiones y qué pasó después', memory.length ? JSON.stringify(memory) : 'Ninguna todavía.',
      '# Instrucciones de estilo del alumno', instructions ? `<instrucciones>${instructions}</instrucciones>` : 'Ninguna: usa tu criterio.',
      'Decide ahora para la vela que acaba de cerrar.',
    ].join('\n\n');
    const msg = await this.call({
      max_tokens: 16000,
      system: [{ type: 'text', text: DECISION_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
      output_config: { format: { type: 'json_schema', schema: DECISION_SCHEMA } },
    });
    const raw = AIAdvisor.text(msg);
    let d;
    try {
      d = JSON.parse(raw);
    } catch {
      throw new BrokerError('La IA devolvió una respuesta que no se pudo interpretar', 502);
    }
    return { ...d, usage: msg.usage, model: msg.model };
  }

  // Explicación libre (análisis del gráfico o revisión de una operación).
  async explain(userId, task, data) {
    this.consume(userId);
    const msg = await this.call({
      max_tokens: 16000,
      system: [{ type: 'text', text: EXPLAIN_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `${task}\n\n${JSON.stringify(data)}` }],
    });
    return { text: AIAdvisor.text(msg), model: msg.model };
  }
}

module.exports = { AIAdvisor, marketContext, DECISION_SCHEMA };

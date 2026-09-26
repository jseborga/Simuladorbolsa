// Estrategias de trading para backtesting y bots.
// Cada estrategia recibe velas [ts, open, high, low, close, volume] y devuelve
// una señal por vela: 'buy', 'sell' o null, además de líneas para dibujar.
const I = require('../public/indicators');

const closes = (c) => c.map((x) => x[4]);
const crossUp = (a, b, i) => a[i - 1] != null && b[i - 1] != null && a[i] != null && b[i] != null && a[i - 1] <= b[i - 1] && a[i] > b[i];
const crossDown = (a, b, i) => crossUp(b, a, i);

const STRATEGIES = [
  {
    id: 'sma_cross',
    name: 'Cruce de medias simples (SMA)',
    description: 'Compra cuando la media rápida cruza por encima de la lenta ("cruce dorado") y vende en el cruce contrario. Estrategia clásica de seguimiento de tendencia.',
    params: [
      { key: 'fast', label: 'SMA rápida', default: 10, min: 2, max: 200 },
      { key: 'slow', label: 'SMA lenta', default: 30, min: 3, max: 400 },
    ],
    run(c, p) {
      const cl = closes(c);
      const f = I.sma(cl, p.fast), s = I.sma(cl, p.slow);
      return {
        signals: c.map((_, i) => (crossUp(f, s, i) ? 'buy' : crossDown(f, s, i) ? 'sell' : null)),
        plots: [{ label: `SMA ${p.fast}`, values: f }, { label: `SMA ${p.slow}`, values: s }],
      };
    },
  },
  {
    id: 'ema_cross',
    name: 'Cruce de medias exponenciales (EMA)',
    description: 'Igual que el cruce de SMA pero con medias exponenciales, que reaccionan más rápido a los cambios de precio (más señales, también más falsas).',
    params: [
      { key: 'fast', label: 'EMA rápida', default: 9, min: 2, max: 200 },
      { key: 'slow', label: 'EMA lenta', default: 21, min: 3, max: 400 },
    ],
    run(c, p) {
      const cl = closes(c);
      const f = I.ema(cl, p.fast), s = I.ema(cl, p.slow);
      return {
        signals: c.map((_, i) => (crossUp(f, s, i) ? 'buy' : crossDown(f, s, i) ? 'sell' : null)),
        plots: [{ label: `EMA ${p.fast}`, values: f }, { label: `EMA ${p.slow}`, values: s }],
      };
    },
  },
  {
    id: 'rsi',
    name: 'RSI sobreventa / sobrecompra',
    description: 'Compra cuando el RSI sale de la zona de sobreventa (cruza hacia arriba el nivel bajo) y vende cuando sale de sobrecompra (cruza hacia abajo el nivel alto). Estrategia de reversión a la media.',
    params: [
      { key: 'period', label: 'Periodo RSI', default: 14, min: 2, max: 100 },
      { key: 'low', label: 'Nivel de sobreventa', default: 30, min: 1, max: 50 },
      { key: 'high', label: 'Nivel de sobrecompra', default: 70, min: 50, max: 99 },
    ],
    run(c, p) {
      const r = I.rsi(closes(c), p.period);
      const lo = r.map(() => p.low), hi = r.map(() => p.high);
      return {
        signals: c.map((_, i) => (crossUp(r, lo, i) ? 'buy' : crossDown(r, hi, i) ? 'sell' : null)),
        plots: [],
        panels: ['rsi'],
      };
    },
  },
  {
    id: 'macd',
    name: 'Cruce MACD',
    description: 'Compra cuando la línea MACD cruza por encima de su línea de señal y vende cuando cruza por debajo. Mide el impulso (momentum) de la tendencia.',
    params: [
      { key: 'fast', label: 'EMA rápida', default: 12, min: 2, max: 100 },
      { key: 'slow', label: 'EMA lenta', default: 26, min: 3, max: 200 },
      { key: 'signal', label: 'Señal', default: 9, min: 2, max: 50 },
    ],
    run(c, p) {
      const m = I.macd(closes(c), p.fast, p.slow, p.signal);
      return {
        signals: c.map((_, i) => (crossUp(m.macd, m.signal, i) ? 'buy' : crossDown(m.macd, m.signal, i) ? 'sell' : null)),
        plots: [],
        panels: ['macd'],
      };
    },
  },
  {
    id: 'bollinger',
    name: 'Rebote en bandas de Bollinger',
    description: 'Compra cuando el precio cierra por debajo de la banda inferior (muy "barato" respecto a su media) y vende cuando vuelve a la banda superior.',
    params: [
      { key: 'period', label: 'Periodo', default: 20, min: 5, max: 200 },
      { key: 'mult', label: 'Desviaciones', default: 2, min: 0.5, max: 4, step: 0.1 },
    ],
    run(c, p) {
      const cl = closes(c);
      const b = I.bollinger(cl, p.period, p.mult);
      return {
        signals: c.map((_, i) => (b.lower[i] == null ? null : cl[i] < b.lower[i] ? 'buy' : cl[i] > b.upper[i] ? 'sell' : null)),
        plots: [{ label: 'BB sup', values: b.upper }, { label: 'BB media', values: b.mid }, { label: 'BB inf', values: b.lower }],
      };
    },
  },
  {
    id: 'breakout',
    name: 'Ruptura de canal (Donchian)',
    description: 'Compra cuando el precio supera el máximo de las últimas N velas y vende cuando pierde el mínimo de las últimas M. Es la base de las famosas "tortugas" del trading.',
    params: [
      { key: 'entry', label: 'Velas para entrada', default: 20, min: 2, max: 200 },
      { key: 'exit', label: 'Velas para salida', default: 10, min: 2, max: 200 },
    ],
    run(c, p) {
      const hi = c.map((x) => x[2]), lo = c.map((x) => x[3]), cl = closes(c);
      const up = I.donchian(hi, lo, p.entry).upper;
      const dn = I.donchian(hi, lo, p.exit).lower;
      return {
        signals: c.map((_, i) => (up[i] != null && cl[i] > up[i] ? 'buy' : dn[i] != null && cl[i] < dn[i] ? 'sell' : null)),
        plots: [{ label: `Máx ${p.entry}`, values: up }, { label: `Mín ${p.exit}`, values: dn }],
      };
    },
  },
];

const byId = Object.fromEntries(STRATEGIES.map((s) => [s.id, s]));

function getStrategy(id) {
  const s = byId[id];
  if (!s) throw Object.assign(new Error('Estrategia desconocida'), { status: 400 });
  return s;
}

// Valida y completa los parámetros con sus valores por defecto.
function normalizeParams(strategy, raw = {}) {
  const out = {};
  for (const p of strategy.params) {
    let v = raw[p.key] === undefined || raw[p.key] === '' ? p.default : Number(raw[p.key]);
    if (!Number.isFinite(v)) throw Object.assign(new Error(`Parámetro inválido: ${p.label}`), { status: 400 });
    v = Math.min(Math.max(v, p.min), p.max);
    out[p.key] = p.step ? v : Math.round(v);
  }
  return out;
}

function publicList() {
  return STRATEGIES.map(({ id, name, description, params }) => ({ id, name, description, params }));
}

module.exports = { STRATEGIES, getStrategy, normalizeParams, publicList };

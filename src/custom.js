// Estrategias personalizadas creadas con el constructor visual.
// Una definición es JSON:
// {
//   name, description,
//   entry: { mode: 'all'|'any', conditions: [cond] },
//   exit:  { mode: 'all'|'any', conditions: [cond] },
// }
// cond = { type: 'compare', left: operand, op: 'gt'|'lt'|'crossAbove'|'crossBelow', right: operand }
//      | { type: 'flag', key: <FLAGS> }
// operand = { ind: <OPERANDS>, period?, period2?, value? }
const I = require('../public/indicators');

const OPERANDS = {
  close: { label: 'Precio (cierre)' },
  open: { label: 'Apertura' },
  high: { label: 'Máximo' },
  low: { label: 'Mínimo' },
  volume: { label: 'Volumen' },
  volume_sma: { label: 'Media del volumen', period: 20 },
  sma: { label: 'SMA', period: 20 },
  ema: { label: 'EMA', period: 20 },
  rsi: { label: 'RSI', period: 14 },
  macd: { label: 'MACD (línea)' },
  macd_signal: { label: 'MACD (señal)' },
  macd_hist: { label: 'MACD (histograma)' },
  bb_upper: { label: 'Bollinger superior', period: 20, period2: 2 },
  bb_mid: { label: 'Bollinger media', period: 20, period2: 2 },
  bb_lower: { label: 'Bollinger inferior', period: 20, period2: 2 },
  stoch_k: { label: 'Estocástico %K', period: 14 },
  stoch_d: { label: 'Estocástico %D', period: 14 },
  atr: { label: 'ATR', period: 14 },
  vwap: { label: 'VWAP diario' },
  donchian_high: { label: 'Máximo de N velas', period: 20 },
  donchian_low: { label: 'Mínimo de N velas', period: 20 },
  change_pct: { label: 'Variación % en N velas', period: 1 },
  value: { label: 'Número fijo' },
};

const OPS = {
  gt: 'es mayor que',
  lt: 'es menor que',
  crossAbove: 'cruza por encima de',
  crossBelow: 'cruza por debajo de',
};

const FLAGS = {
  bull_candle: 'Vela alcista (cierre > apertura)',
  bear_candle: 'Vela bajista (cierre < apertura)',
  trend_up: 'ICT: estructura alcista',
  trend_down: 'ICT: estructura bajista',
  break_up: 'ICT: BOS o CHoCH alcista en esta vela',
  break_down: 'ICT: BOS o CHoCH bajista en esta vela',
  choch_up: 'ICT: CHoCH alcista en esta vela',
  choch_down: 'ICT: CHoCH bajista en esta vela',
  in_bull_fvg: 'ICT: el precio toca un FVG alcista sin rellenar',
  in_bear_fvg: 'ICT: el precio toca un FVG bajista sin rellenar',
  in_bull_ob: 'ICT: el precio toca un Order Block alcista',
  in_bear_ob: 'ICT: el precio toca un Order Block bajista',
  sweep_ssl: 'ICT: barrida de liquidez vendedora (SSL)',
  sweep_bsl: 'ICT: barrida de liquidez compradora (BSL)',
  discount: 'ICT: precio en zona discount (últimas 50 velas)',
  premium: 'ICT: precio en zona premium (últimas 50 velas)',
  kz_asia: 'Horario: kill zone de Asia',
  kz_london: 'Horario: kill zone de Londres',
  kz_ny: 'Horario: kill zone de Nueva York',
  kz_any: 'Horario: cualquier kill zone',
  session_tokyo: 'Horario: sesión de Tokio',
  session_london: 'Horario: sesión de Londres',
  session_ny: 'Horario: sesión de Nueva York',
};

const MAX_CONDITIONS = 10;

const invalid = (msg) => Object.assign(new Error(msg), { status: 400 });

function validOperand(o, where) {
  if (!o || !OPERANDS[o.ind]) throw invalid(`Indicador inválido en ${where}`);
  const def = OPERANDS[o.ind];
  const out = { ind: o.ind };
  if (o.ind === 'value') {
    const v = Number(o.value);
    if (!Number.isFinite(v)) throw invalid(`Número inválido en ${where}`);
    out.value = v;
  }
  if (def.period !== undefined) {
    const p = Math.round(Number(o.period ?? def.period));
    if (!(p >= 1 && p <= 500)) throw invalid(`Periodo inválido en ${where} (1–500)`);
    out.period = p;
  }
  if (def.period2 !== undefined) {
    const p = Number(o.period2 ?? def.period2);
    if (!(p > 0 && p <= 10)) throw invalid(`Desviaciones inválidas en ${where}`);
    out.period2 = p;
  }
  return out;
}

function validBlock(b, label, required) {
  const mode = b?.mode === 'any' ? 'any' : 'all';
  const list = Array.isArray(b?.conditions) ? b.conditions : [];
  if (required && list.length === 0) throw invalid(`Añade al menos una condición de ${label}`);
  if (list.length > MAX_CONDITIONS) throw invalid(`Máximo ${MAX_CONDITIONS} condiciones de ${label}`);
  const conditions = list.map((c, k) => {
    const where = `${label} #${k + 1}`;
    if (c?.type === 'flag') {
      if (!FLAGS[c.key]) throw invalid(`Condición inválida en ${where}`);
      return { type: 'flag', key: c.key };
    }
    if (!OPS[c?.op]) throw invalid(`Comparación inválida en ${where}`);
    return { type: 'compare', left: validOperand(c.left, where), op: c.op, right: validOperand(c.right, where) };
  });
  return { mode, conditions };
}

// Valida y limpia una definición recibida del usuario.
function validateDefinition(d) {
  if (!d || typeof d !== 'object') throw invalid('Definición de estrategia inválida');
  const name = String(d.name ?? '').trim().slice(0, 60);
  if (!name) throw invalid('La estrategia necesita un nombre');
  return {
    name,
    description: String(d.description ?? '').trim().slice(0, 500),
    entry: validBlock(d.entry, 'entrada', true),
    exit: validBlock(d.exit, 'salida', false),
  };
}

function operandKey(o) {
  return [o.ind, o.period, o.period2, o.value].join('|');
}

function series(c, o, cache) {
  const key = operandKey(o);
  if (cache[key]) return cache[key];
  const cl = c.map((x) => x[4]);
  let s;
  switch (o.ind) {
    case 'close': s = cl; break;
    case 'open': s = c.map((x) => x[1]); break;
    case 'high': s = c.map((x) => x[2]); break;
    case 'low': s = c.map((x) => x[3]); break;
    case 'volume': s = c.map((x) => x[5] || 0); break;
    case 'volume_sma': s = I.sma(c.map((x) => x[5] || 0), o.period); break;
    case 'sma': s = I.sma(cl, o.period); break;
    case 'ema': s = I.ema(cl, o.period); break;
    case 'rsi': s = I.rsi(cl, o.period); break;
    case 'macd': s = I.macd(cl).macd; break;
    case 'macd_signal': s = I.macd(cl).signal; break;
    case 'macd_hist': s = I.macd(cl).hist; break;
    case 'bb_upper': s = I.bollinger(cl, o.period, o.period2).upper; break;
    case 'bb_mid': s = I.bollinger(cl, o.period, o.period2).mid; break;
    case 'bb_lower': s = I.bollinger(cl, o.period, o.period2).lower; break;
    case 'stoch_k': s = I.stochastic(c, o.period, 3).k; break;
    case 'stoch_d': s = I.stochastic(c, o.period, 3).d; break;
    case 'atr': s = I.atr(c, o.period); break;
    case 'vwap': s = I.vwap(c); break;
    case 'donchian_high': s = I.donchian(c.map((x) => x[2]), c.map((x) => x[3]), o.period).upper; break;
    case 'donchian_low': s = I.donchian(c.map((x) => x[2]), c.map((x) => x[3]), o.period).lower; break;
    case 'change_pct': s = cl.map((v, i) => (i >= o.period ? ((v - cl[i - o.period]) / cl[i - o.period]) * 100 : null)); break;
    case 'value': s = c.map(() => o.value); break;
    default: s = c.map(() => null);
  }
  cache[key] = s;
  return s;
}

// Series booleanas de las condiciones ICT / horarias (sin mirar al futuro).
function flagSeries(c, key, cache) {
  if (cache['flag:' + key]) return cache['flag:' + key];
  const n = c.length;
  const st = () => (cache.st ||= I.structure(c, 5));
  let s = new Array(n).fill(false);
  const nyZone = (id) => c.map((x) => I.inKillzone(x[0], id ? [id] : undefined));
  const session = (id) => {
    const out = new Array(n).fill(false);
    for (const b of I.sessionBoxes(c, [id])) for (let i = b.i1; i <= b.i2; i++) out[i] = true;
    return out;
  };
  const touching = (zones, getEnd) => {
    const out = new Array(n).fill(false);
    for (const z of zones) {
      const end = getEnd(z) ?? n;
      for (let i = z.created + 1; i < Math.min(end + 1, n); i++) {
        if (c[i][3] <= z.top && c[i][2] >= z.bottom) out[i] = true;
      }
    }
    return out;
  };
  switch (key) {
    case 'bull_candle': s = c.map((x) => x[4] > x[1]); break;
    case 'bear_candle': s = c.map((x) => x[4] < x[1]); break;
    case 'trend_up': s = st().trend.map((t) => t === 1); break;
    case 'trend_down': s = st().trend.map((t) => t === -1); break;
    case 'break_up': case 'break_down': case 'choch_up': case 'choch_down': {
      const dir = key.endsWith('up') ? 'up' : 'down';
      for (const e of st().events) if (e.dir === dir && (key.startsWith('break') || e.kind === 'CHoCH')) s[e.to] = true;
      break;
    }
    case 'in_bull_fvg': case 'in_bear_fvg': {
      const gaps = (cache.fvg ||= I.fvgs(c, 0.1)).filter((g) => g.dir === (key === 'in_bull_fvg' ? 'up' : 'down'));
      s = touching(gaps, (g) => g.filled);
      break;
    }
    case 'in_bull_ob': case 'in_bear_ob': {
      const obs = (cache.ob ||= I.orderBlocks(c, st().events)).filter((b) => b.dir === (key === 'in_bull_ob' ? 'up' : 'down'));
      s = touching(obs, (b) => b.broken);
      break;
    }
    case 'sweep_ssl': case 'sweep_bsl': {
      const lq = (cache.lq ||= I.liquidity(c, st().swings));
      for (const w of lq.sweeps) if (w.dir === (key === 'sweep_ssl' ? 'up' : 'down')) s[w.i] = true;
      break;
    }
    case 'discount': case 'premium':
      s = c.map((x, i) => {
        if (i < 10) return false;
        const pd = I.premiumDiscount(c, Math.max(0, i - 49), i);
        return key === 'discount' ? x[4] < pd.eq : x[4] > pd.eq;
      });
      break;
    case 'kz_asia': s = nyZone('asia'); break;
    case 'kz_london': s = nyZone('london'); break;
    case 'kz_ny': s = nyZone('ny'); break;
    case 'kz_any': s = nyZone(); break;
    case 'session_tokyo': s = session('tokyo'); break;
    case 'session_london': s = session('london'); break;
    case 'session_ny': s = session('newyork'); break;
    default: break;
  }
  cache['flag:' + key] = s;
  return s;
}

function evalBlock(c, block, cache) {
  const n = c.length;
  if (!block.conditions.length) return new Array(n).fill(false);
  const parts = block.conditions.map((cond) => {
    if (cond.type === 'flag') return flagSeries(c, cond.key, cache);
    const a = series(c, cond.left, cache);
    const b = series(c, cond.right, cache);
    return a.map((v, i) => {
      const w = b[i];
      if (v == null || w == null) return false;
      if (cond.op === 'gt') return v > w;
      if (cond.op === 'lt') return v < w;
      if (i === 0 || a[i - 1] == null || b[i - 1] == null) return false;
      return cond.op === 'crossAbove' ? a[i - 1] <= b[i - 1] && v > w : a[i - 1] >= b[i - 1] && v < w;
    });
  });
  return c.map((_, i) => (block.mode === 'any' ? parts.some((p) => p[i]) : parts.every((p) => p[i])));
}

// Convierte una definición en un objeto con la misma forma que las estrategias predefinidas.
function compile(def) {
  const d = validateDefinition(def);
  return {
    id: 'custom',
    name: d.name,
    description: d.description,
    params: [],
    definition: d,
    run(c) {
      const cache = {};
      const entry = evalBlock(c, d.entry, cache);
      const exit = evalBlock(c, d.exit, cache);
      // Dibuja en el gráfico las medias / bandas que use la estrategia.
      const plots = [];
      const seen = new Set();
      for (const cond of [...d.entry.conditions, ...d.exit.conditions]) {
        if (cond.type !== 'compare') continue;
        for (const o of [cond.left, cond.right]) {
          if (!['sma', 'ema', 'bb_upper', 'bb_mid', 'bb_lower', 'vwap', 'donchian_high', 'donchian_low'].includes(o.ind)) continue;
          const k = operandKey(o);
          if (seen.has(k)) continue;
          seen.add(k);
          plots.push({ label: `${OPERANDS[o.ind].label}${o.period ? ' ' + o.period : ''}`, values: series(c, o, cache) });
        }
      }
      const inds = [...d.entry.conditions, ...d.exit.conditions].filter((x) => x.type === 'compare').flatMap((x) => [x.left.ind, x.right.ind]);
      const panels = [];
      if (inds.includes('rsi')) panels.push('rsi');
      if (inds.some((x) => x.startsWith('macd'))) panels.push('macd');
      if (inds.some((x) => x.startsWith('stoch'))) panels.push('stoch');
      if (inds.includes('atr')) panels.push('atr');
      return {
        signals: c.map((_, i) => (entry[i] ? 'buy' : exit[i] ? 'sell' : null)),
        plots,
        panels,
      };
    },
  };
}

// Plantillas para empezar rápido en el constructor.
const cmp = (left, op, right) => ({ type: 'compare', left, op, right });
const flag = (key) => ({ type: 'flag', key });
const TEMPLATES = [
  {
    name: 'RSI en sobreventa a favor de la tendencia',
    description: 'Compra cuando el RSI baja de 30 pero el precio sigue por encima de la EMA 200 (tendencia alcista de fondo). Vende cuando el RSI supera 70.',
    entry: { mode: 'all', conditions: [cmp({ ind: 'rsi', period: 14 }, 'lt', { ind: 'value', value: 30 }), cmp({ ind: 'close' }, 'gt', { ind: 'ema', period: 200 })] },
    exit: { mode: 'any', conditions: [cmp({ ind: 'rsi', period: 14 }, 'gt', { ind: 'value', value: 70 })] },
  },
  {
    name: 'Cruce dorado con confirmación de volumen',
    description: 'Compra cuando la SMA 50 cruza por encima de la SMA 200 y el volumen supera su media. Vende en el cruce contrario.',
    entry: { mode: 'all', conditions: [cmp({ ind: 'sma', period: 50 }, 'crossAbove', { ind: 'sma', period: 200 }), cmp({ ind: 'volume' }, 'gt', { ind: 'volume_sma', period: 20 })] },
    exit: { mode: 'any', conditions: [cmp({ ind: 'sma', period: 50 }, 'crossBelow', { ind: 'sma', period: 200 })] },
  },
  {
    name: 'ICT: FVG alcista en discount dentro de kill zone',
    description: 'Dentro de una kill zone, con el precio en zona discount, compra cuando el precio toca un FVG alcista sin rellenar y la vela cierra en verde. Sale en un CHoCH bajista o al llegar a premium.',
    entry: { mode: 'all', conditions: [flag('kz_any'), flag('discount'), flag('in_bull_fvg'), flag('bull_candle')] },
    exit: { mode: 'any', conditions: [flag('choch_down'), flag('premium')] },
  },
  {
    name: 'ICT: retroceso a Order Block alcista',
    description: 'Con estructura alcista, compra cuando el precio vuelve a un Order Block alcista y cierra en verde. Sale con un CHoCH bajista.',
    entry: { mode: 'all', conditions: [flag('trend_up'), flag('in_bull_ob'), flag('bull_candle')] },
    exit: { mode: 'any', conditions: [flag('choch_down')] },
  },
  {
    name: 'Rebote en Bollinger con RSI',
    description: 'Compra cuando el precio cierra bajo la banda inferior y el RSI está por debajo de 35. Vende al volver a la media.',
    entry: { mode: 'all', conditions: [cmp({ ind: 'close' }, 'lt', { ind: 'bb_lower', period: 20, period2: 2 }), cmp({ ind: 'rsi', period: 14 }, 'lt', { ind: 'value', value: 35 })] },
    exit: { mode: 'any', conditions: [cmp({ ind: 'close' }, 'crossAbove', { ind: 'bb_mid', period: 20, period2: 2 })] },
  },
  {
    name: 'Ruptura en la sesión de Londres',
    description: 'Compra cuando, durante la sesión de Londres, el precio rompe el máximo de las últimas 12 velas con MACD positivo. Vende al perder el mínimo de 6 velas.',
    entry: { mode: 'all', conditions: [flag('session_london'), cmp({ ind: 'close' }, 'gt', { ind: 'donchian_high', period: 12 }), cmp({ ind: 'macd_hist' }, 'gt', { ind: 'value', value: 0 })] },
    exit: { mode: 'any', conditions: [cmp({ ind: 'close' }, 'lt', { ind: 'donchian_low', period: 6 })] },
  },
];

function schema() {
  return {
    operands: Object.entries(OPERANDS).map(([id, o]) => ({ id, ...o })),
    ops: Object.entries(OPS).map(([id, label]) => ({ id, label })),
    flags: Object.entries(FLAGS).map(([id, label]) => ({ id, label })),
    templates: TEMPLATES.map((t) => validateDefinition(t)),
  };
}

module.exports = { compile, validateDefinition, schema, TEMPLATES };

// Indicadores técnicos. Funciona en el navegador (window.Indicators) y en Node (require).
// Todas las funciones devuelven arrays alineados con la entrada (null donde no hay datos suficientes).
(function (root) {
  'use strict';

  function sma(values, n) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= n) sum -= values[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  function ema(values, n) {
    const out = new Array(values.length).fill(null);
    const k = 2 / (n + 1);
    let prev = null;
    for (let i = 0; i < values.length; i++) {
      if (values[i] == null) continue;
      if (prev == null) {
        // Se inicializa con la SMA de los primeros n valores válidos.
        const start = values.findIndex((v) => v != null);
        if (i - start + 1 < n) continue;
        let s = 0;
        for (let j = i - n + 1; j <= i; j++) s += values[j];
        prev = s / n;
      } else {
        prev = values[i] * k + prev * (1 - k);
      }
      out[i] = prev;
    }
    return out;
  }

  // RSI de Wilder.
  function rsi(values, n = 14) {
    const out = new Array(values.length).fill(null);
    let gain = 0, loss = 0;
    for (let i = 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      const g = Math.max(d, 0), l = Math.max(-d, 0);
      if (i <= n) {
        gain += g; loss += l;
        if (i === n) { gain /= n; loss /= n; }
        else continue;
      } else {
        gain = (gain * (n - 1) + g) / n;
        loss = (loss * (n - 1) + l) / n;
      }
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    return out;
  }

  function macd(values, fast = 12, slow = 26, signal = 9) {
    const f = ema(values, fast), s = ema(values, slow);
    const line = values.map((_, i) => (f[i] != null && s[i] != null ? f[i] - s[i] : null));
    const sig = ema(line, signal);
    const hist = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i] : null));
    return { macd: line, signal: sig, hist };
  }

  function bollinger(values, n = 20, mult = 2) {
    const mid = sma(values, n);
    const upper = [], lower = [];
    for (let i = 0; i < values.length; i++) {
      if (mid[i] == null) { upper.push(null); lower.push(null); continue; }
      let v = 0;
      for (let j = i - n + 1; j <= i; j++) v += (values[j] - mid[i]) ** 2;
      const sd = Math.sqrt(v / n);
      upper.push(mid[i] + mult * sd);
      lower.push(mid[i] - mult * sd);
    }
    return { mid, upper, lower };
  }

  // Máximo / mínimo de las n velas ANTERIORES (sin incluir la actual).
  function donchian(highs, lows, n = 20) {
    const upper = [], lower = [];
    for (let i = 0; i < highs.length; i++) {
      if (i < n) { upper.push(null); lower.push(null); continue; }
      upper.push(Math.max(...highs.slice(i - n, i)));
      lower.push(Math.min(...lows.slice(i - n, i)));
    }
    return { upper, lower };
  }

  // ---------- Otros indicadores clásicos ----------

  // candles: [ts, open, high, low, close, volume]
  function atr(candles, n = 14) {
    const tr = candles.map((c, i) => (i === 0 ? c[2] - c[3] : Math.max(c[2] - c[3], Math.abs(c[2] - candles[i - 1][4]), Math.abs(c[3] - candles[i - 1][4]))));
    const out = new Array(candles.length).fill(null);
    let prev = null;
    for (let i = 0; i < tr.length; i++) {
      if (i < n - 1) continue;
      if (prev == null) prev = tr.slice(0, n).reduce((a, b) => a + b, 0) / n;
      else prev = (prev * (n - 1) + tr[i]) / n;
      out[i] = prev;
    }
    return out;
  }

  // VWAP diario (se reinicia cada día UTC).
  function vwap(candles) {
    let day = null, pv = 0, vol = 0;
    return candles.map((c) => {
      const d = Math.floor(c[0] / 86400e3);
      if (d !== day) { day = d; pv = 0; vol = 0; }
      const v = c[5] || 0;
      pv += ((c[2] + c[3] + c[4]) / 3) * v;
      vol += v;
      return vol ? pv / vol : c[4];
    });
  }

  function stochastic(candles, n = 14, d = 3) {
    const k = candles.map((c, i) => {
      if (i < n - 1) return null;
      let hi = -Infinity, lo = Infinity;
      for (let j = i - n + 1; j <= i; j++) { hi = Math.max(hi, candles[j][2]); lo = Math.min(lo, candles[j][3]); }
      return hi === lo ? 50 : ((c[4] - lo) / (hi - lo)) * 100;
    });
    const dd = k.map((_, i) => (i < n + d - 2 ? null : k.slice(i - d + 1, i + 1).reduce((a, b) => a + b, 0) / d));
    return { k, d: dd };
  }

  // ---------- Horarios: sesiones, kill zones y bolsas ----------

  const fmtCache = {};
  // Fecha/hora "de pared" de un instante en una zona horaria (maneja el horario de verano).
  function zoned(ts, tz) {
    const f = (fmtCache[tz] ||= new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }));
    const p = {};
    for (const x of f.formatToParts(new Date(ts))) p[x.type] = x.value;
    const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
    return { wd, h: Number(p.hour), m: Number(p.minute), min: Number(p.hour) * 60 + Number(p.minute), day: `${p.year}-${p.month}-${p.day}` };
  }

  const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

  // Sesiones de forex (hora local de cada centro financiero).
  const SESSIONS = [
    { id: 'tokyo', name: 'Tokio', tz: 'Asia/Tokyo', open: '09:00', close: '18:00', color: '#b17cff' },
    { id: 'london', name: 'Londres', tz: 'Europe/London', open: '08:00', close: '17:00', color: '#22c3e6' },
    { id: 'newyork', name: 'Nueva York', tz: 'America/New_York', open: '08:00', close: '17:00', color: '#f5a524' },
  ];

  // Kill zones de ICT (hora de Nueva York).
  const KILLZONES = [
    { id: 'asia', name: 'KZ Asia', open: '20:00', close: '00:00', color: '#b17cff' },
    { id: 'london', name: 'KZ Londres', open: '02:00', close: '05:00', color: '#22c3e6' },
    { id: 'ny', name: 'KZ Nueva York', open: '07:00', close: '10:00', color: '#f5a524' },
    { id: 'lclose', name: 'KZ Cierre Londres', open: '10:00', close: '12:00', color: '#ff7eb6' },
  ];

  // Bolsas de valores (horario regular, lunes a viernes; no incluye festivos).
  const EXCHANGES = [
    { name: 'Sídney (ASX)', tz: 'Australia/Sydney', open: '10:00', close: '16:00' },
    { name: 'Tokio (TSE)', tz: 'Asia/Tokyo', open: '09:00', close: '15:30', lunch: ['11:30', '12:30'] },
    { name: 'Hong Kong (HKEX)', tz: 'Asia/Hong_Kong', open: '09:30', close: '16:00', lunch: ['12:00', '13:00'] },
    { name: 'Fráncfort (Xetra)', tz: 'Europe/Berlin', open: '09:00', close: '17:30' },
    { name: 'Londres (LSE)', tz: 'Europe/London', open: '08:00', close: '16:30' },
    { name: 'Nueva York (NYSE/Nasdaq)', tz: 'America/New_York', open: '09:30', close: '16:00' },
    { name: 'São Paulo (B3)', tz: 'America/Sao_Paulo', open: '10:00', close: '17:00' },
  ];

  // ¿Está abierto un horario (open/close en minutos locales, admite cruzar medianoche)?
  function inWindow(min, open, close) {
    return open < close ? min >= open && min < close : min >= open || min < close;
  }

  function inKillzone(ts, ids) {
    const z = zoned(ts, 'America/New_York');
    return KILLZONES.some((k) => (!ids || ids.includes(k.id)) && inWindow(z.min, hm(k.open), hm(k.close)));
  }

  // Estado de un mercado en `now`: { open, lunch, minutesToChange }.
  // Trabaja con "minutos de la semana" en hora local.
  function marketStatus(ex, now = Date.now()) {
    const z = zoned(now, ex.tz);
    const t = z.wd * 1440 + z.min;
    const iv = [];
    if (ex.forex) {
      iv.push([hm('17:00'), 5 * 1440 + hm('17:00')]); // domingo 17:00 → viernes 17:00 (NY)
    } else {
      for (let d = 1; d <= 5; d++) {
        if (ex.lunch) {
          iv.push([d * 1440 + hm(ex.open), d * 1440 + hm(ex.lunch[0])]);
          iv.push([d * 1440 + hm(ex.lunch[1]), d * 1440 + hm(ex.close)]);
        } else iv.push([d * 1440 + hm(ex.open), d * 1440 + hm(ex.close)]);
      }
    }
    const open = iv.some(([a, b]) => t >= a && t < b);
    const bounds = iv.flat().map((b) => (b - t + 10080) % 10080).filter((d) => d > 0);
    const lunch = !open && ex.lunch && z.wd >= 1 && z.wd <= 5 && inWindow(z.min, hm(ex.lunch[0]), hm(ex.lunch[1]));
    return { open, lunch, minutesToChange: Math.min(...bounds), localTime: `${String(z.h).padStart(2, '0')}:${String(z.m).padStart(2, '0')}` };
  }

  // Cajas de sesión sobre el gráfico: [{ name, color, i1, i2, high, low }]
  function sessionBoxes(candles, ids) {
    const out = [];
    for (const s of SESSIONS) {
      if (ids && !ids.includes(s.id)) continue;
      let box = null;
      candles.forEach((c, i) => {
        const z = zoned(c[0], s.tz);
        const on = z.wd >= 1 && z.wd <= 5 && inWindow(z.min, hm(s.open), hm(s.close));
        if (on && box && box.day === z.day) {
          box.i2 = i; box.high = Math.max(box.high, c[2]); box.low = Math.min(box.low, c[3]);
        } else if (on) {
          box = { name: s.name, color: s.color, day: z.day, i1: i, i2: i, high: c[2], low: c[3] };
          out.push(box);
        } else box = null;
      });
    }
    return out;
  }

  // Franjas de kill zones: [{ name, color, i1, i2 }]
  function killzoneBands(candles) {
    const out = [];
    for (const k of KILLZONES) {
      let band = null;
      candles.forEach((c, i) => {
        const z = zoned(c[0], 'America/New_York');
        if (inWindow(z.min, hm(k.open), hm(k.close))) {
          if (band && band.i2 === i - 1) band.i2 = i;
          else { band = { name: k.name, color: k.color, i1: i, i2: i }; out.push(band); }
        }
      });
    }
    return out;
  }

  // Máximo/mínimo del día y semana anteriores + apertura de medianoche de NY.
  function periodLevels(candles) {
    const days = [], weeks = [];
    let d = null, w = null;
    candles.forEach((c, i) => {
      const z = zoned(c[0], 'America/New_York');
      // La semana de forex empieza el domingo a las 17:00 de NY.
      const weekKey = Math.floor((c[0] - Date.UTC(1970, 0, 4, 22)) / (7 * 86400e3));
      if (!d || d.key !== z.day) { d = { key: z.day, i1: i, i2: i, high: c[2], low: c[3], open: c[1] }; days.push(d); }
      else { d.i2 = i; d.high = Math.max(d.high, c[2]); d.low = Math.min(d.low, c[3]); }
      if (!w || w.key !== weekKey) { w = { key: weekKey, i1: i, i2: i, high: c[2], low: c[3] }; weeks.push(w); }
      else { w.i2 = i; w.high = Math.max(w.high, c[2]); w.low = Math.min(w.low, c[3]); }
    });
    const prev = (arr) => arr.slice(1).map((p, k) => ({ i1: p.i1, i2: p.i2, high: arr[k].high, low: arr[k].low, open: p.open }));
    return { days: prev(days), weeks: prev(weeks), currentDays: days };
  }

  // ---------- ICT / Smart Money Concepts ----------

  // Pivotes: máximo/mínimo con `len` velas más bajas/altas a cada lado.
  // `confirmed` es la vela en la que el pivote ya se conoce (sin mirar al futuro).
  function swings(candles, len = 5) {
    const out = [];
    for (let i = len; i < candles.length - len; i++) {
      let hi = true, lo = true;
      // Estrictamente por encima de las velas de la izquierda y >= que las de la derecha
      // (así un techo con máximos repetidos cuenta una sola vez).
      for (let j = i - len; j <= i + len; j++) {
        if (j === i) continue;
        const left = j < i;
        if (left ? candles[j][2] >= candles[i][2] : candles[j][2] > candles[i][2]) hi = false;
        if (left ? candles[j][3] <= candles[i][3] : candles[j][3] < candles[i][3]) lo = false;
      }
      if (hi) out.push({ type: 'high', i, price: candles[i][2], confirmed: i + len });
      if (lo) out.push({ type: 'low', i, price: candles[i][3], confirmed: i + len });
    }
    return out;
  }

  // Estructura de mercado: BOS (ruptura a favor de la tendencia) y CHoCH (cambio de carácter).
  function structure(candles, len = 5) {
    const sw = swings(candles, len).sort((a, b) => a.confirmed - b.confirmed);
    const events = [];
    const trend = new Array(candles.length).fill(0);
    let lastHigh = null, lastLow = null, t = 0, k = 0;
    for (let i = 0; i < candles.length; i++) {
      while (k < sw.length && sw[k].confirmed <= i) {
        if (sw[k].type === 'high') lastHigh = sw[k]; else lastLow = sw[k];
        k++;
      }
      const close = candles[i][4];
      if (lastHigh && close > lastHigh.price) {
        events.push({ dir: 'up', kind: t === -1 ? 'CHoCH' : 'BOS', from: lastHigh.i, to: i, price: lastHigh.price });
        t = 1; lastHigh = null;
      } else if (lastLow && close < lastLow.price) {
        events.push({ dir: 'down', kind: t === 1 ? 'CHoCH' : 'BOS', from: lastLow.i, to: i, price: lastLow.price });
        t = -1; lastLow = null;
      }
      trend[i] = t;
    }
    return { swings: sw, events, trend };
  }

  // Fair Value Gaps (imbalances): hueco entre la mecha de la vela 1 y la de la vela 3.
  // minAtr filtra huecos pequeños (tamaño mínimo en múltiplos del ATR).
  function fvgs(candles, minAtr = 0.1) {
    const a = atr(candles, 14);
    const out = [];
    for (let i = 2; i < candles.length; i++) {
      const min = (a[i] ?? 0) * minAtr;
      const h0 = candles[i - 2][2], l0 = candles[i - 2][3];
      const { 2: h2, 3: l2 } = candles[i];
      let g = null;
      if (l2 > h0 && l2 - h0 >= min) g = { dir: 'up', top: l2, bottom: h0 };
      else if (h2 < l0 && l0 - h2 >= min) g = { dir: 'down', top: l0, bottom: h2 };
      if (!g) continue;
      g.i = i - 1; g.created = i; g.touched = null; g.filled = null;
      for (let j = i + 1; j < candles.length; j++) {
        const [, , hj, lj] = candles[j];
        if (g.dir === 'up') {
          if (g.touched == null && lj <= g.top) g.touched = j;
          if (lj <= g.bottom) { g.filled = j; break; }
        } else {
          if (g.touched == null && hj >= g.bottom) g.touched = j;
          if (hj >= g.top) { g.filled = j; break; }
        }
      }
      out.push(g);
    }
    return out;
  }

  // Order blocks: última vela contraria antes del movimiento que rompe la estructura.
  function orderBlocks(candles, events) {
    const out = [];
    const seen = new Set();
    for (const e of events) {
      const bull = e.dir === 'up';
      let ob = null;
      for (let j = e.to - 1; j >= Math.max(e.from - 10, 0); j--) {
        const c = candles[j];
        if (bull ? c[4] < c[1] : c[4] > c[1]) { ob = j; break; }
      }
      if (ob == null || seen.has(ob)) continue;
      seen.add(ob);
      const c = candles[ob];
      const b = { dir: e.dir, i: ob, created: e.to, top: c[2], bottom: c[3], broken: null, kind: e.kind };
      for (let j = e.to + 1; j < candles.length; j++) {
        if (bull ? candles[j][4] < b.bottom : candles[j][4] > b.top) { b.broken = j; break; }
      }
      out.push(b);
    }
    return out;
  }

  // Liquidez: máximos/mínimos iguales (EQH/EQL) y barridas de liquidez (mecha que
  // supera un pivote pero cierra de vuelta dentro).
  function liquidity(candles, sw, tolAtr = 0.15) {
    const a = atr(candles, 14);
    const equal = [], sweeps = [];
    for (const type of ['high', 'low']) {
      const pts = sw.filter((s) => s.type === type).sort((x, y) => x.i - y.i);
      for (let k = 1; k < pts.length; k++) {
        const p1 = pts[k - 1], p2 = pts[k];
        const tol = (a[p2.i] ?? Math.abs(p2.price) * 0.001) * tolAtr;
        if (Math.abs(p1.price - p2.price) <= tol) {
          const level = type === 'high' ? Math.max(p1.price, p2.price) : Math.min(p1.price, p2.price);
          let swept = null;
          for (let j = p2.confirmed; j < candles.length; j++) {
            if (type === 'high' ? candles[j][2] > level : candles[j][3] < level) { swept = j; break; }
          }
          equal.push({ type: type === 'high' ? 'EQH' : 'EQL', i1: p1.i, i2: p2.i, price: level, swept });
        }
      }
      for (const s of pts) {
        for (let j = s.confirmed; j < candles.length; j++) {
          const c = candles[j];
          if (type === 'high' && c[2] > s.price) { if (c[4] < s.price) sweeps.push({ i: j, dir: 'down', price: s.price, from: s.i, label: 'Barrida BSL' }); break; }
          if (type === 'low' && c[3] < s.price) { if (c[4] > s.price) sweeps.push({ i: j, dir: 'up', price: s.price, from: s.i, label: 'Barrida SSL' }); break; }
        }
      }
    }
    return { equal, sweeps };
  }

  // Zonas premium / discount del rango [from, to].
  function premiumDiscount(candles, from = 0, to = candles.length - 1) {
    let hi = -Infinity, lo = Infinity;
    for (let i = Math.max(from, 0); i <= to; i++) { hi = Math.max(hi, candles[i][2]); lo = Math.min(lo, candles[i][3]); }
    return { high: hi, low: lo, eq: (hi + lo) / 2 };
  }

  const api = {
    sma, ema, rsi, macd, bollinger, donchian, atr, vwap, stochastic,
    zoned, inKillzone, marketStatus, sessionBoxes, killzoneBands, periodLevels, SESSIONS, KILLZONES, EXCHANGES,
    swings, structure, fvgs, orderBlocks, liquidity, premiumDiscount,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Indicators = api;
})(this);

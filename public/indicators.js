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

  const api = { sma, ema, rsi, macd, bollinger, donchian };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Indicators = api;
})(this);

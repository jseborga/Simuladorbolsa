// Gráficos en canvas sin dependencias: velas con indicadores, paneles de
// RSI / MACD, marcadores de compra/venta, cruz de precio y líneas dibujadas.
(function (root) {
  'use strict';

  const C = {
    grid: '#2a3542', text: '#8b98a8', up: '#1fbf75', down: '#f0525c', bg: '#171e27',
    accent: '#4f8cff', warn: '#f5a524',
    series: ['#f5a524', '#b17cff', '#22c3e6', '#ff7eb6', '#8bd450'],
  };
  const MAIN_H = 300, PANEL_H = 90, PAD_R = 72, PAD_B = 22, PAD_T = 8;

  function fmt(p) {
    if (p == null || !isFinite(p)) return '—';
    const a = Math.abs(p);
    return a >= 1000 ? p.toFixed(0) : a >= 1 ? p.toFixed(2) : p.toPrecision(4);
  }

  function timeLabel(ts, long) {
    const d = new Date(ts);
    return long
      ? d.toLocaleDateString('es', { day: '2-digit', month: 'short' })
      : d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  }

  class CandleChart {
    constructor(canvas, { onPriceClick } = {}) {
      this.cv = canvas;
      this.opts = { candles: [] };
      this.hover = null;
      this.onPriceClick = onPriceClick;
      this.drawMode = false;
      canvas.addEventListener('mousemove', (e) => {
        const r = canvas.getBoundingClientRect();
        this.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
        this.render();
      });
      canvas.addEventListener('mouseleave', () => { this.hover = null; this.render(); });
      canvas.addEventListener('click', (e) => {
        if (!this.drawMode || !this.onPriceClick || !this.yMain) return;
        const r = canvas.getBoundingClientRect();
        const y = e.clientY - r.top;
        if (y > MAIN_H - PAD_B) return;
        this.onPriceClick(this.yMain.inv(y));
      });
    }

    // opts: { candles, overlays:[{label,values,color}], band:{upper,lower},
    //         markers:[{i,side,price}], hlines:[{price,color,label}], panels:['volume','rsi','macd'], timeframe }
    set(opts) {
      this.opts = { ...this.opts, ...opts };
      this.render();
    }

    render() {
      const { candles: all = [], panels = [], hlines = [], timeframe = '1h', visible } = this.opts;
      // Los indicadores se calculan con todo el histórico y sólo se dibujan las últimas `visible` velas.
      const off = visible ? Math.max(0, all.length - visible) : 0;
      const cut = (arr) => arr.slice(off);
      const candles = cut(all);
      const overlays = (this.opts.overlays || []).map((o) => ({ ...o, values: cut(o.values) }));
      const band = this.opts.band && { upper: cut(this.opts.band.upper), lower: cut(this.opts.band.lower) };
      const markers = (this.opts.markers || []).filter((m) => m.i >= off).map((m) => ({ ...m, i: m.i - off }));
      const cv = this.cv;
      if (cv.offsetParent === null) return;
      const sub = panels.filter((p) => p === 'rsi' || p === 'macd');
      const H = MAIN_H + sub.length * PANEL_H;
      const W = cv.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      cv.style.height = H + 'px';
      cv.width = W * dpr;
      cv.height = H * dpr;
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      g.font = '11px system-ui';
      cv.style.cursor = this.drawMode ? 'crosshair' : 'default';
      if (!candles.length) {
        g.fillStyle = C.text;
        g.fillText('Cargando gráfico…', 12, 20);
        return;
      }

      const n = candles.length;
      const plotW = W - PAD_R;
      const cw = plotW / n;
      const xOf = (i) => i * cw + cw / 2;

      // ----- Panel principal -----
      let min = Infinity, max = -Infinity;
      for (const c of candles) { min = Math.min(min, c[3]); max = Math.max(max, c[2]); }
      for (const o of overlays) for (const v of o.values) if (v != null) { min = Math.min(min, v); max = Math.max(max, v); }
      const pad = (max - min || max * 0.01) * 0.06;
      min -= pad; max += pad;
      const mainBottom = MAIN_H - PAD_B;
      const y = (p) => PAD_T + (1 - (p - min) / (max - min)) * (mainBottom - PAD_T);
      y.inv = (yy) => min + (1 - (yy - PAD_T) / (mainBottom - PAD_T)) * (max - min);
      this.yMain = y;

      g.strokeStyle = C.grid; g.fillStyle = C.text; g.lineWidth = 1;
      for (let i = 0; i <= 5; i++) {
        const p = min + ((max - min) * i) / 5;
        const yy = Math.round(y(p)) + 0.5;
        g.beginPath(); g.moveTo(0, yy); g.lineTo(plotW, yy); g.stroke();
        g.fillText(fmt(p), plotW + 6, yy + 4);
      }
      const long = ['4h', '1d'].includes(timeframe);
      const step = Math.max(1, Math.ceil(n / 6));
      for (let i = 0; i < n; i += step) g.fillText(timeLabel(candles[i][0], long), i * cw + 2, MAIN_H - 6);

      // Volumen (20 % inferior del panel principal)
      if (panels.includes('volume')) {
        const vmax = Math.max(...candles.map((c) => c[5] || 0)) || 1;
        const vh = (mainBottom - PAD_T) * 0.2;
        candles.forEach((c, i) => {
          g.fillStyle = (c[4] >= c[1] ? C.up : C.down) + '44';
          const h = ((c[5] || 0) / vmax) * vh;
          g.fillRect(xOf(i) - Math.max(cw * 0.35, 0.5), mainBottom - h, Math.max(cw * 0.7, 1), h);
        });
      }

      // Banda (Bollinger)
      if (band) {
        g.fillStyle = C.accent + '14';
        g.beginPath();
        let started = false;
        band.upper.forEach((v, i) => { if (v == null) return; started ? g.lineTo(xOf(i), y(v)) : g.moveTo(xOf(i), y(v)); started = true; });
        for (let i = n - 1; i >= 0; i--) if (band.lower[i] != null) g.lineTo(xOf(i), y(band.lower[i]));
        g.closePath(); g.fill();
      }

      // Velas
      candles.forEach(([, o, h, l, c], i) => {
        const x = xOf(i);
        g.strokeStyle = g.fillStyle = c >= o ? C.up : C.down;
        g.beginPath(); g.moveTo(x, y(h)); g.lineTo(x, y(l)); g.stroke();
        const top = y(Math.max(o, c));
        g.fillRect(x - Math.max(cw * 0.35, 0.5), top, Math.max(cw * 0.7, 1), Math.max(y(Math.min(o, c)) - top, 1));
      });

      // Indicadores superpuestos
      overlays.forEach((o, k) => {
        o.color = o.color || C.series[k % C.series.length];
        if (this.opts.overlays[k]) this.opts.overlays[k].color = o.color;
        this.line(g, o.values, xOf, y, o.color, 1.5);
      });

      // Marcadores de compra / venta
      for (const m of markers) {
        const x = xOf(m.i);
        const buy = m.side === 'buy';
        const yy = buy ? y(candles[m.i][3]) + 6 : y(candles[m.i][2]) - 6;
        g.fillStyle = buy ? C.up : C.down;
        g.beginPath();
        if (buy) { g.moveTo(x, yy); g.lineTo(x - 5, yy + 9); g.lineTo(x + 5, yy + 9); }
        else { g.moveTo(x, yy); g.lineTo(x - 5, yy - 9); g.lineTo(x + 5, yy - 9); }
        g.fill();
      }

      // Líneas horizontales (precio actual, precio medio, líneas del usuario)
      for (const h of hlines) {
        if (h.price == null || h.price < min || h.price > max) continue;
        const yy = Math.round(y(h.price)) + 0.5;
        g.setLineDash(h.solid ? [] : [4, 4]); g.strokeStyle = h.color;
        g.beginPath(); g.moveTo(0, yy); g.lineTo(plotW, yy); g.stroke(); g.setLineDash([]);
        g.fillStyle = h.color; g.fillRect(plotW, yy - 9, PAD_R, 18);
        g.fillStyle = '#0f141b'; g.fillText(h.label ?? fmt(h.price), plotW + 4, yy + 4);
      }

      // Leyenda
      let lx = 6;
      overlays.forEach((o) => {
        g.fillStyle = o.color; g.fillRect(lx, 6, 10, 3);
        g.fillText(o.label, lx + 14, 11);
        lx += g.measureText(o.label).width + 26;
      });

      // ----- Subpaneles -----
      const closes = all.map((c) => c[4]);
      const panelsY = [];
      sub.forEach((p, k) => {
        const top = MAIN_H + k * PANEL_H + 4;
        const bottom = top + PANEL_H - 10;
        g.strokeStyle = C.grid;
        g.beginPath(); g.moveTo(0, top - 4 + 0.5); g.lineTo(W, top - 4 + 0.5); g.stroke();
        if (p === 'rsi') {
          const r = cut(root.Indicators.rsi(closes, 14));
          const yr = (v) => top + (1 - v / 100) * (bottom - top);
          g.fillStyle = C.accent + '14'; g.fillRect(0, yr(70), plotW, yr(30) - yr(70));
          g.setLineDash([3, 3]); g.strokeStyle = C.grid;
          [30, 70].forEach((lv) => { g.beginPath(); g.moveTo(0, yr(lv)); g.lineTo(plotW, yr(lv)); g.stroke(); g.fillStyle = C.text; g.fillText(lv, plotW + 6, yr(lv) + 4); });
          g.setLineDash([]);
          this.line(g, r, xOf, yr, '#b17cff', 1.5);
          g.fillStyle = C.text; g.fillText(`RSI 14: ${fmt(r[n - 1])}`, 6, top + 10);
          panelsY.push({ p, top, bottom, values: { RSI: r } });
        } else {
          const mm = root.Indicators.macd(closes);
          const m = { macd: cut(mm.macd), signal: cut(mm.signal), hist: cut(mm.hist) };
          const all = [...m.macd, ...m.signal, ...m.hist].filter((v) => v != null);
          const ext = Math.max(...all.map(Math.abs)) || 1;
          const ym = (v) => top + (1 - (v + ext) / (2 * ext)) * (bottom - top);
          m.hist.forEach((v, i) => {
            if (v == null) return;
            g.fillStyle = (v >= 0 ? C.up : C.down) + '88';
            const y0 = ym(0), y1 = ym(v);
            g.fillRect(xOf(i) - Math.max(cw * 0.35, 0.5), Math.min(y0, y1), Math.max(cw * 0.7, 1), Math.abs(y1 - y0) || 1);
          });
          this.line(g, m.macd, xOf, ym, '#22c3e6', 1.5);
          this.line(g, m.signal, xOf, ym, '#f5a524', 1.5);
          g.fillStyle = C.text; g.fillText(`MACD 12/26/9: ${fmt(m.macd[n - 1])} · señal ${fmt(m.signal[n - 1])}`, 6, top + 10);
          panelsY.push({ p, top, bottom, values: { MACD: m.macd, Señal: m.signal } });
        }
      });

      // ----- Cruz de precio y datos de la vela -----
      if (this.hover && this.hover.x < plotW) {
        const i = Math.min(n - 1, Math.max(0, Math.floor(this.hover.x / cw)));
        const c = candles[i];
        const x = Math.round(xOf(i)) + 0.5;
        g.setLineDash([3, 3]); g.strokeStyle = '#8b98a8aa';
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
        if (this.hover.y < mainBottom) {
          const yy = Math.round(this.hover.y) + 0.5;
          g.beginPath(); g.moveTo(0, yy); g.lineTo(plotW, yy); g.stroke();
          g.setLineDash([]);
          g.fillStyle = '#3b4756'; g.fillRect(plotW, yy - 9, PAD_R, 18);
          g.fillStyle = '#fff'; g.fillText(fmt(y.inv(this.hover.y)), plotW + 4, yy + 4);
        }
        g.setLineDash([]);
        const chg = ((c[4] - c[1]) / c[1]) * 100;
        const lines = [
          new Date(c[0]).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }),
          `A ${fmt(c[1])}  M ${fmt(c[2])}  m ${fmt(c[3])}  C ${fmt(c[4])}`,
          `Var ${chg >= 0 ? '+' : ''}${chg.toFixed(2)} %  Vol ${fmt(c[5])}`,
          ...overlays.map((o) => `${o.label}: ${fmt(o.values[i])}`),
          ...panelsY.flatMap((pp) => Object.entries(pp.values).map(([k, v]) => `${k}: ${fmt(v[i])}`)),
        ];
        const bw = Math.max(...lines.map((l) => g.measureText(l).width)) + 16;
        const bx = this.hover.x + bw + 20 < plotW ? this.hover.x + 12 : this.hover.x - bw - 12;
        const by = 22;
        g.fillStyle = '#0f141bee'; g.strokeStyle = C.grid;
        g.fillRect(bx, by, bw, lines.length * 15 + 8); g.strokeRect(bx + 0.5, by + 0.5, bw, lines.length * 15 + 8);
        lines.forEach((l, k) => { g.fillStyle = k === 0 ? '#fff' : '#c9d4df'; g.fillText(l, bx + 8, by + 16 + k * 15); });
      }
    }

    line(g, values, xOf, y, color, w) {
      g.strokeStyle = color; g.lineWidth = w;
      g.beginPath();
      let started = false;
      values.forEach((v, i) => {
        if (v == null) { started = false; return; }
        started ? g.lineTo(xOf(i), y(v)) : g.moveTo(xOf(i), y(v));
        started = true;
      });
      g.stroke();
      g.lineWidth = 1;
    }
  }

  // Gráfico de líneas simple (curva de capital).
  function lineChart(cv, { times, series }) {
    if (cv.offsetParent === null) return;
    const W = cv.clientWidth, H = 220;
    const dpr = window.devicePixelRatio || 1;
    cv.style.height = H + 'px';
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.font = '11px system-ui';
    const all = series.flatMap((s) => s.values);
    let min = Math.min(...all), max = Math.max(...all);
    const pad = (max - min || max * 0.01) * 0.08;
    min -= pad; max += pad;
    const plotW = W - PAD_R;
    const y = (v) => PAD_T + 16 + (1 - (v - min) / (max - min)) * (H - PAD_B - PAD_T - 16);
    const x = (i) => (i / Math.max(times.length - 1, 1)) * plotW;
    g.strokeStyle = C.grid; g.fillStyle = C.text;
    for (let i = 0; i <= 4; i++) {
      const v = min + ((max - min) * i) / 4;
      const yy = Math.round(y(v)) + 0.5;
      g.beginPath(); g.moveTo(0, yy); g.lineTo(plotW, yy); g.stroke();
      g.fillText(fmt(v), plotW + 6, yy + 4);
    }
    const step = Math.max(1, Math.ceil(times.length / 6));
    for (let i = 0; i < times.length; i += step) g.fillText(timeLabel(times[i], true), x(i) + 2, H - 6);
    let lx = 6;
    series.forEach((s) => {
      g.strokeStyle = s.color; g.lineWidth = 2;
      g.beginPath();
      s.values.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))));
      g.stroke();
      g.lineWidth = 1;
      g.fillStyle = s.color; g.fillRect(lx, 6, 10, 3);
      g.fillStyle = C.text; g.fillText(s.label, lx + 14, 11);
      lx += g.measureText(s.label).width + 26;
    });
  }

  root.Charts = { CandleChart, lineChart, fmt };
})(this);

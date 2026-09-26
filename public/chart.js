// Gráficos en canvas sin dependencias: velas con indicadores, paneles de
// RSI / MACD / Estocástico / ATR, zonas (FVG, order blocks, sesiones),
// segmentos (estructura, liquidez, niveles), cruz de precio y dibujos del usuario.
(function (root) {
  'use strict';

  const C = {
    grid: '#2a3542', text: '#8b98a8', up: '#1fbf75', down: '#f0525c',
    accent: '#4f8cff', warn: '#f5a524',
    series: ['#f5a524', '#b17cff', '#22c3e6', '#ff7eb6', '#8bd450'],
  };
  const MAIN_H = 340, PANEL_H = 90, PAD_R = 72, PAD_B = 22, PAD_T = 8;
  const FIB_LEVELS = [-0.618, -0.27, 0, 0.236, 0.382, 0.5, 0.618, 0.705, 0.79, 1];

  function fmt(p) {
    if (p == null || !isFinite(p)) return '—';
    const a = Math.abs(p);
    return a >= 1000 ? p.toFixed(0) : a >= 100 ? p.toFixed(2) : a >= 10 ? p.toFixed(3) : a >= 0.1 ? p.toFixed(5) : p.toPrecision(4);
  }

  function timeLabel(ts, long) {
    const d = new Date(ts);
    return long
      ? d.toLocaleDateString('es', { day: '2-digit', month: 'short' })
      : d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  }

  const alpha = (hex, a) => {
    const h = hex.slice(0, 7);
    return h + Math.round(a * 255).toString(16).padStart(2, '0');
  };

  class CandleChart {
    constructor(canvas, { onDraw } = {}) {
      this.cv = canvas;
      this.opts = { candles: [] };
      this.hover = null;
      this.onDraw = onDraw;
      this.tool = null; // null | 'hline' | 'trend' | 'fib' | 'rect'
      this.anchor = null; // primer punto de un dibujo de dos clics
      const pos = (e) => {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      };
      canvas.addEventListener('mousemove', (e) => { this.hover = pos(e); this.render(); });
      canvas.addEventListener('mouseleave', () => { this.hover = null; this.render(); });
      canvas.addEventListener('click', (e) => this.click(pos(e)));
      canvas.addEventListener('contextmenu', (e) => {
        if (!this.tool) return;
        e.preventDefault();
        this.setTool(null);
      });
    }

    setTool(tool) {
      this.tool = tool;
      this.anchor = null;
      this.render();
      this.onToolChange?.(tool);
    }

    click({ x, y }) {
      if (!this.tool || !this.map || y > MAIN_H - PAD_B || x > this.map.plotW) return;
      const pt = { t: this.map.timeOfX(x), p: this.map.y.inv(y) };
      if (this.tool === 'hline') {
        this.onDraw?.({ type: 'hline', p1: pt.p });
        this.setTool(null);
      } else if (!this.anchor) {
        this.anchor = pt;
      } else {
        this.onDraw?.({ type: this.tool, t1: this.anchor.t, p1: this.anchor.p, t2: pt.t, p2: pt.p });
        this.setTool(null);
      }
    }

    set(opts) {
      this.opts = { ...this.opts, ...opts };
      this.render();
    }

    render() {
      const o = this.opts;
      const all = o.candles || [];
      const cv = this.cv;
      if (cv.offsetParent === null) return;
      const sub = (o.panels || []).filter((p) => ['rsi', 'macd', 'stoch', 'atr'].includes(p));
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
      g.lineWidth = 1;
      cv.style.cursor = this.tool ? 'crosshair' : 'default';
      if (!all.length) {
        g.fillStyle = C.text;
        g.fillText('Cargando gráfico…', 12, 20);
        return;
      }

      // Los indicadores se calculan con todo el histórico y sólo se dibujan las últimas `visible` velas.
      const off = o.visible ? Math.max(0, all.length - o.visible) : 0;
      const candles = all.slice(off);
      const n = candles.length;
      const plotW = W - PAD_R;
      const cw = plotW / n;
      const xOf = (i) => (i - off) * cw + cw / 2; // i = índice en `all`
      const last = all.length - 1;
      const ts = all.map((c) => c[0]);
      const step = all.length > 1 ? ts[1] - ts[0] : 60e3;
      // Tiempo ⇄ índice (fraccionario). Sirve aunque falten velas (fines de semana en forex).
      const idxOfTime = (t) => {
        if (t <= ts[0]) return (t - ts[0]) / step;
        if (t >= ts[last]) return last + (t - ts[last]) / step;
        let lo = 0, hi = last;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; }
        return lo + (t - ts[lo]) / (ts[hi] - ts[lo]);
      };
      const timeOfX = (x) => {
        const i = (x - cw / 2) / cw + off;
        const k = Math.max(0, Math.min(last, Math.floor(i)));
        return ts[k] + (i - k) * (k < last ? ts[k + 1] - ts[k] : step);
      };
      const xOfTime = (t) => xOf(idxOfTime(t));
      const vis = (i1, i2) => i2 >= off && i1 <= last;
      const clipX = (x) => Math.max(0, Math.min(plotW, x));

      // ----- Escala del panel principal -----
      // Mechas anómalas (datos erróneos o "flash crashes") no deben aplastar la escala:
      // se limitan a 4 ATR por fuera del cuerpo de la vela.
      const atrs = root.Indicators.atr(all, 14);
      let min = Infinity, max = -Infinity;
      for (let i = off; i <= last; i++) {
        const [, op, h, l, c] = all[i];
        const a = (atrs[i] ?? atrs.find((v) => v != null) ?? Math.abs(h - l)) * 4;
        min = Math.min(min, Math.max(l, Math.min(op, c) - a));
        max = Math.max(max, Math.min(h, Math.max(op, c) + a));
      }
      for (const ov of o.overlays || []) for (let i = off; i < ov.values.length; i++) { const v = ov.values[i]; if (v != null) { min = Math.min(min, v); max = Math.max(max, v); } }
      const pad = (max - min || max * 0.01) * 0.06;
      min -= pad; max += pad;
      const mainBottom = MAIN_H - PAD_B;
      const y = (p) => PAD_T + (1 - (p - min) / (max - min)) * (mainBottom - PAD_T);
      y.inv = (yy) => min + (1 - (yy - PAD_T) / (mainBottom - PAD_T)) * (max - min);
      this.map = { y, timeOfX, plotW };

      // Evita que las etiquetas se amontonen: no se dibuja una etiqueta que pise a otra.
      const placed = [];
      const text = (t, x, yy, color) => {
        const w = g.measureText(t).width;
        const r = [x - 1, yy - 10, x + w + 1, yy + 2];
        if (placed.some((p) => r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1])) return;
        placed.push(r);
        g.fillStyle = color;
        g.fillText(t, x, yy);
      };

      g.save();
      g.beginPath(); g.rect(0, 0, plotW, mainBottom); g.clip();

      // Franjas verticales (kill zones)
      for (const b of o.vbands || []) {
        if (!vis(b.i1, b.i2)) continue;
        const x1 = clipX(xOf(b.i1) - cw / 2), x2 = clipX(xOf(b.i2) + cw / 2);
        g.fillStyle = alpha(b.color, 0.08);
        g.fillRect(x1, PAD_T, x2 - x1, mainBottom - PAD_T);
        g.fillStyle = alpha(b.color, 0.9);
        g.fillRect(x1, mainBottom - 3, x2 - x1, 3);
        if (x2 - x1 > 40) text(b.name, x1 + 3, mainBottom - 6, alpha(b.color, 0.8));
      }

      // Premium / discount
      if (o.pd) {
        const { high, low, eq } = o.pd;
        g.fillStyle = alpha(C.down, 0.05); g.fillRect(0, y(high), plotW, y(eq) - y(high));
        g.fillStyle = alpha(C.up, 0.05); g.fillRect(0, y(eq), plotW, y(low) - y(eq));
        g.setLineDash([6, 4]); g.strokeStyle = alpha(C.text, 0.7);
        g.beginPath(); g.moveTo(0, y(eq)); g.lineTo(plotW, y(eq)); g.stroke(); g.setLineDash([]);
        g.fillStyle = alpha(C.down, 0.8); g.fillText('Premium', 6, y(high) + 26);
        g.fillStyle = alpha(C.up, 0.8); g.fillText('Discount', 6, y(low) - 6);
        g.fillStyle = C.text; g.fillText('Equilibrio 50 %', 6, y(eq) - 4);
      }

      // Zonas (FVG, order blocks, cajas de sesión)
      for (const z of o.zones || []) {
        if (!vis(z.i1, z.i2)) continue;
        const x1 = clipX(xOf(z.i1) - cw / 2), x2 = clipX(xOf(z.i2) + cw / 2);
        const y1 = y(z.top), y2 = y(z.bottom);
        g.fillStyle = alpha(z.color, z.fill ?? 0.16);
        g.fillRect(x1, y1, x2 - x1, y2 - y1);
        if (z.border) { g.strokeStyle = alpha(z.color, 0.7); g.strokeRect(x1 + 0.5, y1 + 0.5, x2 - x1, y2 - y1); }
        if (z.label && x2 - x1 > 18) text(z.label, x1 + 3, z.labelBottom ? y2 - 3 : y1 + 11, alpha(z.color, 0.95));
      }

      // Volumen (20 % inferior del panel principal)
      if ((o.panels || []).includes('volume')) {
        const vmax = Math.max(...candles.map((c) => c[5] || 0)) || 1;
        const vh = (mainBottom - PAD_T) * 0.2;
        candles.forEach((c, k) => {
          g.fillStyle = alpha(c[4] >= c[1] ? C.up : C.down, 0.27);
          const h = ((c[5] || 0) / vmax) * vh;
          g.fillRect(k * cw + cw / 2 - Math.max(cw * 0.35, 0.5), mainBottom - h, Math.max(cw * 0.7, 1), h);
        });
      }

      // Banda (Bollinger)
      if (o.band) {
        g.fillStyle = alpha(C.accent, 0.08);
        g.beginPath();
        let started = false;
        for (let i = off; i <= last; i++) { const v = o.band.upper[i]; if (v == null) continue; started ? g.lineTo(xOf(i), y(v)) : g.moveTo(xOf(i), y(v)); started = true; }
        for (let i = last; i >= off; i--) if (o.band.lower[i] != null) g.lineTo(xOf(i), y(o.band.lower[i]));
        g.closePath(); g.fill();
      }

      // Velas
      candles.forEach(([, op, h, l, c], k) => {
        const x = k * cw + cw / 2;
        g.strokeStyle = g.fillStyle = c >= op ? C.up : C.down;
        g.beginPath(); g.moveTo(x, y(h)); g.lineTo(x, y(l)); g.stroke();
        const top = y(Math.max(op, c));
        g.fillRect(x - Math.max(cw * 0.35, 0.5), top, Math.max(cw * 0.7, 1), Math.max(y(Math.min(op, c)) - top, 1));
      });

      // Indicadores superpuestos
      (o.overlays || []).forEach((ov, k) => {
        ov.color = ov.color || C.series[k % C.series.length];
        this.line(g, ov.values, off, xOf, y, ov.color, 1.5);
      });

      // Segmentos (estructura, liquidez, niveles del día/semana)
      for (const s of o.segments || []) {
        if (!vis(s.i1, s.i2)) continue;
        const x1 = xOf(s.i1), x2 = xOf(s.i2);
        g.strokeStyle = s.color; g.lineWidth = s.width || 1;
        g.setLineDash(s.dash ? [5, 4] : []);
        g.beginPath(); g.moveTo(x1, y(s.p1)); g.lineTo(x2, y(s.p2)); g.stroke();
        g.setLineDash([]); g.lineWidth = 1;
        if (s.label) {
          const tw = g.measureText(s.label).width;
          const lx = s.labelAt === 'end' ? Math.min(x2 - tw - 2, plotW - tw - 4) : clipX((x1 + x2) / 2 - tw / 2);
          text(s.label, Math.max(lx, 2), y(s.p2) + (s.below ? 12 : -3), s.color);
        }
      }

      // Etiquetas puntuales (barridas de liquidez)
      for (const lb of o.labels || []) {
        if (lb.i < off) continue;
        const x = xOf(lb.i), yy = y(lb.price);
        g.fillStyle = lb.color;
        g.beginPath(); g.moveTo(x, yy - 4); g.lineTo(x + 4, yy); g.lineTo(x, yy + 4); g.lineTo(x - 4, yy); g.fill();
        text(lb.text, x + 6, yy + (lb.below ? 12 : -4), lb.color);
      }

      // Marcadores de compra / venta (backtesting)
      for (const m of o.markers || []) {
        if (m.i < off) continue;
        const x = xOf(m.i);
        const buy = m.side === 'buy';
        const yy = buy ? y(all[m.i][3]) + 6 : y(all[m.i][2]) - 6;
        g.fillStyle = buy ? C.up : C.down;
        g.beginPath();
        if (buy) { g.moveTo(x, yy); g.lineTo(x - 5, yy + 9); g.lineTo(x + 5, yy + 9); }
        else { g.moveTo(x, yy); g.lineTo(x - 5, yy - 9); g.lineTo(x + 5, yy - 9); }
        g.fill();
      }

      // Dibujos del usuario (+ vista previa del que se está dibujando)
      const drawings = [...(o.drawings || [])];
      if (this.anchor && this.hover) drawings.push({ type: this.tool, t1: this.anchor.t, p1: this.anchor.p, t2: timeOfX(this.hover.x), p2: y.inv(this.hover.y), preview: true });
      for (const d of drawings) this.drawShape(g, d, { xOfTime, y, plotW });
      g.restore();

      // Etiquetas a la derecha: líneas horizontales (precio actual, tu media, etc.)
      for (const h of o.hlines || []) {
        if (h.price == null || h.price < min || h.price > max) continue;
        const yy = Math.round(y(h.price)) + 0.5;
        g.setLineDash(h.solid ? [] : [4, 4]); g.strokeStyle = h.color;
        g.beginPath(); g.moveTo(0, yy); g.lineTo(plotW, yy); g.stroke(); g.setLineDash([]);
        g.fillStyle = h.color; g.fillRect(plotW, yy - 9, PAD_R, 18);
        g.fillStyle = '#0f141b'; g.fillText(h.label ?? fmt(h.price), plotW + 4, yy + 4);
      }

      // Rejilla y ejes (encima de los fondos, debajo del texto flotante)
      g.strokeStyle = alpha(C.grid, 0.6); g.fillStyle = C.text;
      for (let i = 0; i <= 5; i++) {
        const p = min + ((max - min) * i) / 5;
        const yy = Math.round(y(p)) + 0.5;
        g.beginPath(); g.moveTo(0, yy); g.lineTo(plotW, yy); g.stroke();
        g.fillText(fmt(p), plotW + 6, yy + 4);
      }
      const long = ['4h', '1d'].includes(o.timeframe);
      const tstep = Math.max(1, Math.ceil(n / 6));
      for (let k = 0; k < n; k += tstep) g.fillText(timeLabel(candles[k][0], long), k * cw + 2, MAIN_H - 6);

      // Leyenda
      let lx = 6;
      (o.overlays || []).forEach((ov) => {
        if (ov.hideLegend) return;
        g.fillStyle = ov.color; g.fillRect(lx, 6, 10, 3);
        g.fillText(ov.label, lx + 14, 11);
        lx += g.measureText(ov.label).width + 26;
      });

      // ----- Subpaneles -----
      const closes = all.map((c) => c[4]);
      const panelVals = [];
      sub.forEach((p, k) => {
        const top = MAIN_H + k * PANEL_H + 4;
        const bottom = top + PANEL_H - 10;
        g.strokeStyle = C.grid;
        g.beginPath(); g.moveTo(0, top - 4 + 0.5); g.lineTo(W, top - 4 + 0.5); g.stroke();
        const levels = (yv, lvls) => {
          g.setLineDash([3, 3]); g.strokeStyle = C.grid;
          lvls.forEach((lv) => { g.beginPath(); g.moveTo(0, yv(lv)); g.lineTo(plotW, yv(lv)); g.stroke(); g.fillStyle = C.text; g.fillText(lv, plotW + 6, yv(lv) + 4); });
          g.setLineDash([]);
        };
        const scale = (arrs) => {
          const vals = arrs.flatMap((a) => a.slice(off)).filter((v) => v != null);
          const lo = Math.min(...vals), hi = Math.max(...vals);
          return (v) => top + 12 + (1 - (v - lo) / (hi - lo || 1)) * (bottom - top - 12);
        };
        if (p === 'rsi') {
          const r = root.Indicators.rsi(closes, 14);
          const yr = (v) => top + (1 - v / 100) * (bottom - top);
          g.fillStyle = alpha(C.accent, 0.08); g.fillRect(0, yr(70), plotW, yr(30) - yr(70));
          levels(yr, [30, 70]);
          this.line(g, r, off, xOf, yr, '#b17cff', 1.5);
          g.fillStyle = C.text; g.fillText(`RSI 14: ${fmt(r[last])}`, 6, top + 10);
          panelVals.push({ RSI: r });
        } else if (p === 'stoch') {
          const s = root.Indicators.stochastic(all, 14, 3);
          const ys = (v) => top + (1 - v / 100) * (bottom - top);
          levels(ys, [20, 80]);
          this.line(g, s.k, off, xOf, ys, '#22c3e6', 1.5);
          this.line(g, s.d, off, xOf, ys, '#f5a524', 1.5);
          g.fillStyle = C.text; g.fillText(`Estocástico 14/3: %K ${fmt(s.k[last])} · %D ${fmt(s.d[last])}`, 6, top + 10);
          panelVals.push({ '%K': s.k, '%D': s.d });
        } else if (p === 'atr') {
          const a = root.Indicators.atr(all, 14);
          const ya = scale([a]);
          this.line(g, a, off, xOf, ya, '#ff7eb6', 1.5);
          g.fillStyle = C.text; g.fillText(`ATR 14: ${fmt(a[last])} (volatilidad media por vela)`, 6, top + 10);
          panelVals.push({ ATR: a });
        } else {
          const m = root.Indicators.macd(closes);
          const vals = [...m.macd, ...m.signal, ...m.hist].slice(0).filter((v, i) => v != null);
          const ext = Math.max(...vals.map(Math.abs)) || 1;
          const ym = (v) => top + 12 + (1 - (v + ext) / (2 * ext)) * (bottom - top - 12);
          for (let i = off; i <= last; i++) {
            const v = m.hist[i];
            if (v == null) continue;
            g.fillStyle = alpha(v >= 0 ? C.up : C.down, 0.55);
            const y0 = ym(0), y1 = ym(v);
            g.fillRect(xOf(i) - Math.max(cw * 0.35, 0.5), Math.min(y0, y1), Math.max(cw * 0.7, 1), Math.abs(y1 - y0) || 1);
          }
          this.line(g, m.macd, off, xOf, ym, '#22c3e6', 1.5);
          this.line(g, m.signal, off, xOf, ym, '#f5a524', 1.5);
          g.fillStyle = C.text; g.fillText(`MACD 12/26/9: ${fmt(m.macd[last])} · señal ${fmt(m.signal[last])}`, 6, top + 10);
          panelVals.push({ MACD: m.macd, Señal: m.signal });
        }
      });

      // ----- Cruz de precio y datos de la vela -----
      if (this.hover && this.hover.x < plotW) {
        const k = Math.min(n - 1, Math.max(0, Math.floor(this.hover.x / cw)));
        const i = k + off;
        const c = all[i];
        const x = Math.round(k * cw + cw / 2) + 0.5;
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
        if (!this.tool) {
          const chg = ((c[4] - c[1]) / c[1]) * 100;
          const lines = [
            new Date(c[0]).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }),
            `A ${fmt(c[1])}  M ${fmt(c[2])}  m ${fmt(c[3])}  C ${fmt(c[4])}`,
            `Var ${chg >= 0 ? '+' : ''}${chg.toFixed(2)} %  Vol ${fmt(c[5])}`,
            ...(o.overlays || []).filter((ov) => !ov.hideLegend).map((ov) => `${ov.label}: ${fmt(ov.values[i])}`),
            ...panelVals.flatMap((pv) => Object.entries(pv).map(([key, v]) => `${key}: ${fmt(v[i])}`)),
          ];
          const bw = Math.max(...lines.map((l) => g.measureText(l).width)) + 16;
          const bx = this.hover.x + bw + 20 < plotW ? this.hover.x + 12 : this.hover.x - bw - 12;
          const by = 22;
          g.fillStyle = '#0f141bee'; g.strokeStyle = C.grid;
          g.fillRect(bx, by, bw, lines.length * 15 + 8); g.strokeRect(bx + 0.5, by + 0.5, bw, lines.length * 15 + 8);
          lines.forEach((l, j) => { g.fillStyle = j === 0 ? '#fff' : '#c9d4df'; g.fillText(l, bx + 8, by + 16 + j * 15); });
        }
      }
    }

    drawShape(g, d, { xOfTime, y, plotW }) {
      const col = d.color || (d.preview ? '#f5a524' : '#e6edf3');
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.5;
      if (d.type === 'hline') {
        const yy = y(d.p1);
        g.beginPath(); g.moveTo(0, yy); g.lineTo(plotW, yy); g.stroke();
        g.fillText(fmt(d.p1), plotW - g.measureText(fmt(d.p1)).width - 4, yy - 3);
      } else if (d.type === 'trend') {
        const x1 = xOfTime(d.t1), x2 = xOfTime(d.t2), y1 = y(d.p1), y2 = y(d.p2);
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        [[x1, y1], [x2, y2]].forEach(([a, b]) => { g.beginPath(); g.arc(a, b, 3, 0, Math.PI * 2); g.fill(); });
        const pctChg = ((d.p2 - d.p1) / d.p1) * 100;
        g.fillText(`${pctChg >= 0 ? '+' : ''}${pctChg.toFixed(2)} %`, x2 + 6, y2 - 4);
      } else if (d.type === 'rect') {
        const x1 = xOfTime(d.t1), x2 = xOfTime(d.t2), y1 = y(d.p1), y2 = y(d.p2);
        g.fillStyle = alpha('#4f8cff', 0.15); g.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        g.strokeStyle = '#4f8cff'; g.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      } else if (d.type === 'fib') {
        const x1 = Math.min(xOfTime(d.t1), xOfTime(d.t2));
        const lv = (l) => d.p2 - (d.p2 - d.p1) * l;
        // Zona OTE de ICT (retroceso 62 %–79 %)
        g.fillStyle = alpha('#f5a524', 0.12);
        g.fillRect(x1, Math.min(y(lv(0.618)), y(lv(0.79))), plotW - x1, Math.abs(y(lv(0.79)) - y(lv(0.618))));
        for (const l of FIB_LEVELS) {
          const yy = y(lv(l));
          const key = l === 0.5 || l === 0 || l === 1;
          g.strokeStyle = l < 0 ? '#ff7eb6' : l >= 0.618 && l <= 0.79 ? '#f5a524' : key ? '#e6edf3' : '#8b98a8';
          g.lineWidth = key ? 1.2 : 1;
          g.beginPath(); g.moveTo(x1, yy); g.lineTo(plotW, yy); g.stroke();
          g.fillStyle = g.strokeStyle;
          g.fillText(`${l} (${fmt(lv(l))})${l === 0.705 ? ' OTE' : ''}`, x1 + 4, yy - 3);
        }
        g.setLineDash([3, 3]); g.strokeStyle = '#8b98a8';
        g.beginPath(); g.moveTo(xOfTime(d.t1), y(d.p1)); g.lineTo(xOfTime(d.t2), y(d.p2)); g.stroke(); g.setLineDash([]);
      }
      g.lineWidth = 1;
    }

    line(g, values, off, xOf, y, color, w) {
      g.strokeStyle = color; g.lineWidth = w;
      g.beginPath();
      let started = false;
      for (let i = off; i < values.length; i++) {
        const v = values[i];
        if (v == null) { started = false; continue; }
        started ? g.lineTo(xOf(i), y(v)) : g.moveTo(xOf(i), y(v));
        started = true;
      }
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

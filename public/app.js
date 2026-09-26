'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  token: localStorage.getItem('token'),
  config: null,
  tickers: {},
  me: null,
  symbol: null,
  timeframe: '1h',
  side: 'buy',
  candles: [],
  authMode: 'login',
  view: 'market',
};

// ---------- Formato ----------
const usd = (n) => (n == null || isNaN(n) ? '—' : n.toLocaleString('es', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }));
// Precios: más decimales para activos baratos (p. ej. DOGE).
const px = (n) => (n == null || isNaN(n) ? '—' : n.toLocaleString('es', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 10 ? 5 : 2 }));
const feeOf = (s) => state.config.feeRates?.[s] ?? state.config.feeRate;
const isForex = (s) => state.config?.categories?.[s] === 'Forex';
const num = (n, d = 8) => (n == null ? '—' : Number(n).toLocaleString('es', { maximumFractionDigits: d }));
const pct = (n) => (n == null || isNaN(n) ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)} %`);
const cls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
const base = (s) => s.split('/')[0];
const date = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('es');

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token && path !== '/login') {
    logoutLocal();
  }
  if (!res.ok) throw new Error(data.error || 'Error ' + res.status);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 3500);
}

// ---------- Acceso ----------
function showAuth() {
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
}

function logoutLocal() {
  state.token = null;
  state.me = null;
  localStorage.removeItem('token');
  showAuth();
}

$$('[data-auth]').forEach((b) =>
  b.addEventListener('click', () => {
    state.authMode = b.dataset.auth;
    $$('[data-auth]').forEach((x) => x.classList.toggle('active', x === b));
    $('#auth-submit').textContent = state.authMode === 'login' ? 'Entrar' : 'Crear cuenta';
    $('#auth-error').textContent = '';
  })
);

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const { token } = await api('/' + state.authMode, { method: 'POST', body: { username: f.get('username'), password: f.get('password') } });
    state.token = token;
    localStorage.setItem('token', token);
    e.target.reset();
    await enterApp();
  } catch (err) {
    $('#auth-error').textContent = err.message;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' }).catch(() => {});
  logoutLocal();
});

// ---------- Navegación ----------
$$('.nav').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

function showView(v) {
  state.view = v;
  $$('.nav').forEach((x) => x.classList.toggle('active', x.dataset.view === v));
  $$('.view').forEach((x) => x.classList.toggle('hidden', x.id !== 'view-' + v));
  if (v === 'orders') loadOrders();
  if (v === 'history') loadTrades();
  if (v === 'ranking') loadRanking();
  if (v === 'market') drawChart();
  if (v === 'backtest' && state.bt) drawBacktest();
  if (v === 'bots') loadBots(true);
  if (v === 'builder' && !$('#sb-form').name.value && !$$('#sb-entry .cond').length) $('#sb-new').click();
}

// ---------- Datos ----------
async function loadConfig() {
  state.config = await api('/config');
  const live = state.config.mode === 'live';
  const b = $('#source-badge');
  b.textContent = live ? `● En vivo · ${state.config.exchange}` : '● Mercado simulado';
  b.className = 'badge ' + (live ? 'live' : 'sim');
  $('#fee-text').textContent = `${(state.config.feeRate * 100).toFixed(2)} % del importe en cripto; ${((state.config.feeRates?.['EUR/USD'] ?? state.config.feeRate) * 100).toFixed(3)} % en forex, similar al spread de un bróker`;
  $('#auth-bonus').textContent = `Cada cuenta nueva recibe ${usd(state.config.initialCash)} virtuales.`;
  if (!state.symbol) state.symbol = state.config.symbols[0];
}

async function loadTickers() {
  state.tickers = await api('/tickers');
  renderTickers();
  renderChartHeader();
  updatePreview();
}

async function loadMe() {
  state.me = await api('/me');
  renderSummary();
  renderPortfolio();
  updatePreview();
}

let candlesReq = 0;
async function loadCandles() {
  // Si el usuario cambia de par o temporalidad mientras carga, se descarta la respuesta vieja.
  const req = ++candlesReq;
  const key = `${state.symbol}|${state.timeframe}`;
  if (state.candlesKey !== key) {
    state.candles = [];
    drawChart();
  }
  try {
    const data = await api(`/ohlcv?symbol=${encodeURIComponent(state.symbol)}&timeframe=${state.timeframe}&limit=300`);
    if (req !== candlesReq) return;
    state.candles = data;
    state.candlesKey = key;
  } catch (e) {
    if (req !== candlesReq) return;
    state.candles = [];
    toast('No se pudo cargar el gráfico: ' + e.message);
  }
  drawChart();
}

async function loadOrders() {
  const orders = await api('/orders');
  const labels = { open: 'Abierta', filled: 'Ejecutada', cancelled: 'Cancelada', rejected: 'Rechazada' };
  $('#orders-table tbody').innerHTML = orders.length
    ? orders
        .map(
          (o) => `<tr>
        <td>${o.id}</td><td>${date(o.created_at)}</td><td>${esc(o.symbol)}</td>
        <td><span class="pill ${o.side}">${o.side === 'buy' ? 'Compra' : 'Venta'}</span></td>
        <td>${o.type === 'limit' ? 'Límite' : 'Stop'}</td>
        <td class="r">${num(o.qty)}</td><td class="r">${px(o.price)}</td>
        <td title="${esc(o.note || '')}">${labels[o.status]}${o.note ? ' ⓘ' : ''}</td>
        <td>${o.status === 'open' ? `<button class="link" data-cancel="${o.id}">Cancelar</button>` : ''}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="9" class="muted">No hay órdenes. Crea una orden límite o stop desde la pestaña Mercado.</td></tr>';
}

$('#orders-table').addEventListener('click', async (e) => {
  const id = e.target.dataset.cancel;
  if (!id) return;
  try {
    await api('/orders/' + id, { method: 'DELETE' });
    toast('Orden cancelada');
    loadOrders();
  } catch (err) {
    toast(err.message);
  }
});

async function loadTrades() {
  const trades = await api('/trades');
  $('#trades-table tbody').innerHTML = trades.length
    ? trades
        .map(
          (t) => `<tr>
        <td>${date(t.created_at)}</td><td>${esc(t.symbol)}${t.bot_id ? ` <span title="Operación del bot #${t.bot_id}">🤖</span>` : ""}</td>
        <td><span class="pill ${t.side}">${t.side === 'buy' ? 'Compra' : 'Venta'}</span></td>
        <td class="r">${num(t.qty)}</td><td class="r">${px(t.price)}</td><td class="r">${usd(t.qty * t.price)}</td>
        <td class="r">${usd(t.fee)}</td>
        <td class="r ${cls(t.realized)}">${t.side === 'sell' ? usd(t.realized) : ''}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="8" class="muted">Todavía no has operado.</td></tr>';
}

async function loadRanking() {
  const rows = await api('/leaderboard');
  const me = state.me?.user.username;
  $('#ranking-table tbody').innerHTML = rows
    .map(
      (r, i) => `<tr${r.username === me ? ' style="background:var(--panel-2)"' : ''}>
      <td>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td><td>${esc(r.username)}${r.username === me ? ' (tú)' : ''}</td>
      <td class="r">${usd(r.equity)}</td><td class="r ${cls(r.returnPct)}">${pct(r.returnPct)}</td><td class="r">${r.trades}</td></tr>`
    )
    .join('');
}

// ---------- Render ----------
function renderSummary() {
  const m = state.me;
  $('#username').textContent = m.user.username;
  $('#s-equity').textContent = usd(m.equity);
  $('#s-cash').textContent = usd(m.cash);
  $('#s-value').textContent = usd(m.marketValue);
  const u = $('#s-unreal');
  u.textContent = usd(m.unrealized);
  u.className = cls(m.unrealized);
  const r = $('#s-return');
  r.textContent = pct(m.returnPct);
  r.className = cls(m.returnPct);
}

function renderPortfolio() {
  const m = state.me;
  $('#holdings-empty').classList.toggle('hidden', m.holdings.length > 0);
  $('#holdings-table tbody').innerHTML = m.holdings
    .map(
      (h) => `<tr>
      <td><strong>${esc(base(h.symbol))}</strong></td><td class="r">${num(h.qty)}</td>
      <td class="r">${px(h.avg_price)}</td><td class="r">${px(h.price)}</td><td class="r">${usd(h.value)}</td>
      <td class="r ${cls(h.pnl)}">${usd(h.pnl)} (${pct(h.pnlPct)})</td><td class="r">${h.weight.toFixed(1)} %</td>
      <td><button class="link" data-sell="${esc(h.symbol)}">Vender</button></td></tr>`
    )
    .join('');
  $('#portfolio-kv').innerHTML = `
    <dt>Saldo inicial</dt><dd>${usd(m.initialCash)}</dd>
    <dt>Patrimonio actual</dt><dd>${usd(m.equity)}</dd>
    <dt>Efectivo</dt><dd>${usd(m.cash)}</dd>
    <dt>Coste de las posiciones</dt><dd>${usd(m.invested)}</dd>
    <dt>G/P no realizada</dt><dd class="${cls(m.unrealized)}">${usd(m.unrealized)}</dd>
    <dt>G/P realizada</dt><dd class="${cls(m.realized)}">${usd(m.realized)}</dd>
    <dt>Comisiones pagadas</dt><dd>${usd(m.fees)}</dd>
    <dt>Operaciones</dt><dd>${m.tradeCount}</dd>
    <dt>Rentabilidad total</dt><dd class="${cls(m.returnPct)}">${pct(m.returnPct)}</dd>`;
}

$('#holdings-table').addEventListener('click', (e) => {
  const s = e.target.dataset.sell;
  if (!s) return;
  selectSymbol(s);
  setSide('sell');
  showView('market');
});

function renderTickers() {
  let lastCat = null;
  const rows = state.config.symbols
    .map((s) => {
      const t = state.tickers[s];
      if (!t) return '';
      const cat = state.config.categories?.[s] || '';
      const head = cat !== lastCat ? `<tr class="cat"><td colspan="3">${esc(cat)}</td></tr>` : '';
      lastCat = cat;
      return head + `<tr data-symbol="${esc(s)}" class="${s === state.symbol ? 'sel' : ''}">
        <td><strong>${esc(base(s))}</strong><span class="muted">/${esc(s.split('/')[1])}</span></td>
        <td class="r">${px(t.last)}</td><td class="r ${cls(t.percentage)}">${pct(t.percentage)}</td></tr>`;
    })
    .join('');
  $('#ticker-table tbody').innerHTML = rows;
}

$('#ticker-table').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-symbol]');
  if (tr) selectSymbol(tr.dataset.symbol);
});

function selectSymbol(s) {
  state.symbol = s;
  renderTickers();
  renderChartHeader();
  $('#base-asset').textContent = `(${base(s)})`;
  $('#trade-form').qty.value = '';
  $('#trade-form').usd.value = '';
  setSide(state.side);
  loadCandles();
}

function renderChartHeader() {
  const t = state.tickers[state.symbol];
  $('#chart-title').textContent = state.symbol;
  $('#chart-price').textContent = t ? px(t.last) : '—';
  const c = $('#chart-change');
  c.textContent = t ? pct(t.percentage) + ' (24h)' : '';
  c.className = t ? cls(t.percentage) : '';
}

$$('[data-tf]').forEach((b) =>
  b.addEventListener('click', () => {
    state.timeframe = b.dataset.tf;
    $$('[data-tf]').forEach((x) => x.classList.toggle('active', x === b));
    loadCandles();
  })
);

// ---------- Gráfico de velas con indicadores ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
const fmtAxis = Charts.fmt;
state.indicators = store.get('indicators', { volume: true, sma20: true });
// Dibujos por símbolo: { type: 'hline'|'trend'|'fib'|'rect', t1, p1, t2, p2 }
state.drawings = store.get('drawings', {});
// Migra las líneas horizontales de la versión anterior.
for (const [sym, prices] of Object.entries(store.get('lines', {}))) {
  (state.drawings[sym] ||= []).push(...prices.map((p) => ({ type: 'hline', p1: p })));
}
store.set('lines', {});
store.set('drawings', state.drawings);

const TOOL_HINTS = {
  hline: 'Haz clic en el precio donde quieras la línea (soporte / resistencia). Clic derecho para cancelar.',
  trend: 'Clic en el punto inicial y luego en el final de la línea de tendencia. Clic derecho para cancelar.',
  fib: 'Clic en el inicio del impulso y luego en su final. La zona OTE (62–79 %) queda sombreada. Clic derecho para cancelar.',
  rect: 'Clic en una esquina y luego en la opuesta para marcar una zona. Clic derecho para cancelar.',
};

const mainChart = new Charts.CandleChart($('#chart'), {
  onDraw(d) {
    (state.drawings[state.symbol] ||= []).push(d);
    store.set('drawings', state.drawings);
    drawChart();
  },
});
mainChart.onToolChange = (tool) => {
  $$('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  $('#tool-hint').textContent = tool ? TOOL_HINTS[tool] : 'Pasa el ratón por el gráfico para ver la cruz de precio y los datos de cada vela.';
};
$$('[data-tool]').forEach((b) =>
  b.addEventListener('click', () => mainChart.setTool(mainChart.tool === b.dataset.tool ? null : b.dataset.tool))
);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && mainChart.tool) mainChart.setTool(null); });
$('#tool-undo').addEventListener('click', () => {
  state.drawings[state.symbol]?.pop();
  store.set('drawings', state.drawings);
  drawChart();
});
$('#tool-clear').addEventListener('click', () => {
  if (!state.drawings[state.symbol]?.length || !confirm(`¿Borrar todos los dibujos de ${state.symbol}?`)) return;
  delete state.drawings[state.symbol];
  store.set('drawings', state.drawings);
  drawChart();
});

function updateIndCount() {
  const n = Object.values(state.indicators).filter(Boolean).length;
  $('#ind-count').textContent = n ? `(${n})` : '';
}

$$('[data-ind]').forEach((cb) => {
  cb.checked = !!state.indicators[cb.dataset.ind];
  cb.addEventListener('change', () => {
    state.indicators[cb.dataset.ind] = cb.checked;
    store.set('indicators', state.indicators);
    updateIndCount();
    drawChart();
  });
});
updateIndCount();
document.addEventListener('click', (e) => {
  const m = $('#ind-menu');
  if (m.open && !m.contains(e.target)) m.open = false;
});

// Velas visibles según el ancho del gráfico (~5 px por vela, entre 60 y 150).
const visibleCount = () => Math.max(60, Math.min(150, Math.floor(($('#chart').clientWidth || 750) / 5)));
const UP = '#1fbf75', DOWN = '#f0525c';

// Construye zonas, segmentos y etiquetas ICT / de horarios para el gráfico.
function ictLayers(c, ind, tf) {
  const zones = [], segments = [], labels = [], vbands = [];
  const n = c.length;
  const from = Math.max(0, n - visibleCount());
  const intraday = ['1m', '5m', '15m', '1h'].includes(tf);
  if (ind.sessions && intraday) {
    for (const b of Indicators.sessionBoxes(c)) {
      zones.push({ i1: b.i1, i2: b.i2, top: b.high, bottom: b.low, color: b.color, fill: 0.07, border: true, label: b.name });
    }
  }
  if (ind.killzones && intraday) vbands.push(...Indicators.killzoneBands(c));
  if (ind.levels) {
    const lv = Indicators.periodLevels(c);
    const lastOf = (arr) => arr[arr.length - 1];
    if (tf !== '1d') {
      for (const d of lv.days) {
        const isLast = d === lastOf(lv.days);
        segments.push({ i1: d.i1, i2: d.i2, p1: d.high, p2: d.high, color: '#e6edf3aa', dash: true, label: isLast ? 'PDH' : null, labelAt: 'end' });
        segments.push({ i1: d.i1, i2: d.i2, p1: d.low, p2: d.low, color: '#e6edf3aa', dash: true, label: isLast ? 'PDL' : null, labelAt: 'end', below: true });
      }
      if (intraday) {
        for (const d of lv.currentDays) {
          const isLast = d === lastOf(lv.currentDays);
          segments.push({ i1: d.i1, i2: d.i2, p1: d.open, p2: d.open, color: '#4f8cffcc', label: isLast ? 'Apertura 00:00 NY' : null, labelAt: 'end' });
        }
      }
    }
    for (const w of lv.weeks) {
      const isLast = w === lastOf(lv.weeks);
      segments.push({ i1: w.i1, i2: w.i2, p1: w.high, p2: w.high, color: '#b17cff', dash: true, width: 1.5, label: isLast ? 'PWH' : null, labelAt: 'end' });
      segments.push({ i1: w.i1, i2: w.i2, p1: w.low, p2: w.low, color: '#b17cff', dash: true, width: 1.5, label: isLast ? 'PWL' : null, labelAt: 'end', below: true });
    }
  }
  let st = null;
  if (ind.structure || ind.ob || ind.liquidity) st = Indicators.structure(c, 5);
  if (ind.fvg) {
    // Sólo huecos sin rellenar o rellenados dentro de la parte visible.
    for (const g of Indicators.fvgs(c, 0.1)) {
      if (g.filled != null && g.filled < from) continue;
      zones.push({ i1: g.i, i2: g.filled ?? n - 1, top: g.top, bottom: g.bottom, color: g.dir === 'up' ? UP : DOWN, fill: g.filled != null ? 0.08 : 0.2, label: g.filled != null ? null : 'FVG', labelBottom: g.dir === 'down' });
    }
  }
  if (ind.ob) {
    for (const b of Indicators.orderBlocks(c, st.events)) {
      if (b.broken != null) continue;
      zones.push({ i1: b.i, i2: n - 1, top: b.top, bottom: b.bottom, color: b.dir === 'up' ? '#22c3e6' : '#ff7eb6', fill: 0.18, border: true, label: b.dir === 'up' ? 'OB+' : 'OB−' });
    }
  }
  if (ind.structure) {
    for (const e of st.events) {
      if (e.to < from) continue;
      segments.push({ i1: e.from, i2: e.to, p1: e.price, p2: e.price, color: e.dir === 'up' ? UP : DOWN, dash: e.kind === 'BOS', label: e.kind, below: e.dir === 'down' });
    }
  }
  if (ind.liquidity) {
    const lq = Indicators.liquidity(c, st.swings);
    // Liquidez pendiente destacada; la ya barrida, tenue y sólo si fue en la parte visible.
    for (const q of lq.equal) {
      if (q.swept != null && q.swept < from) continue;
      const swept = q.swept != null;
      segments.push({ i1: q.i1, i2: q.swept ?? n - 1, p1: q.price, p2: q.price, color: swept ? '#f5a52466' : '#f5a524', dash: true, width: swept ? 1 : 1.5, label: swept ? null : q.type === 'EQH' ? 'EQH (BSL)' : 'EQL (SSL)', labelAt: 'end', below: q.type === 'EQL' });
    }
    // Sólo las 6 barridas más recientes visibles.
    lq.sweeps.filter((w) => w.i >= from).sort((a, b) => b.i - a.i).slice(0, 6)
      .forEach((w) => labels.push({ i: w.i, price: w.price, text: w.label, color: '#f5a524', below: w.dir === 'up' }));
  }
  const pd = ind.pd ? Indicators.premiumDiscount(c, from) : null;
  return { zones, segments, labels, vbands, pd };
}

function drawChart() {
  const c = state.candles;
  const cl = c.map((x) => x[4]);
  const ind = state.indicators;
  const overlays = [];
  if (ind.sma20) overlays.push({ label: 'SMA 20', values: Indicators.sma(cl, 20), color: '#f5a524' });
  if (ind.sma50) overlays.push({ label: 'SMA 50', values: Indicators.sma(cl, 50), color: '#b17cff' });
  if (ind.ema20) overlays.push({ label: 'EMA 20', values: Indicators.ema(cl, 20), color: '#22c3e6' });
  if (ind.ema200) overlays.push({ label: 'EMA 200', values: Indicators.ema(cl, 200), color: '#ff7eb6' });
  if (ind.vwap && c.length) overlays.push({ label: 'VWAP', values: Indicators.vwap(c), color: '#8bd450' });
  let band = null;
  if (ind.bb) {
    band = Indicators.bollinger(cl, 20, 2);
    overlays.push({ label: 'BB sup', values: band.upper, color: '#4f8cff99' }, { label: 'BB inf', values: band.lower, color: '#4f8cff99' });
  }
  const holding = state.me?.holdings.find((h) => h.symbol === state.symbol);
  const hlines = [];
  if (holding) hlines.push({ price: holding.avg_price, color: '#f5a524', label: 'Tu media' });
  hlines.push({ price: state.tickers[state.symbol]?.last, color: '#4f8cff' });
  mainChart.set({
    candles: c, overlays, band, hlines, timeframe: state.timeframe, visible: visibleCount(),
    panels: ['volume', 'rsi', 'macd', 'stoch', 'atr'].filter((k) => ind[k]),
    drawings: state.drawings[state.symbol] || [],
    ...(c.length ? ictLayers(c, ind, state.timeframe) : {}),
  });
}

window.addEventListener('resize', () => {
  drawChart();
  if (state.bt) drawBacktest();
});

// ---------- Formulario de operación ----------
const form = $('#trade-form');
const HINTS = {
  market: { buy: 'Se compra ahora al precio de venta (ask) del mercado.', sell: 'Se vende ahora al precio de compra (bid) del mercado.' },
  limit: { buy: 'Se comprará sólo si el precio BAJA hasta tu precio objetivo o menos.', sell: 'Se venderá sólo si el precio SUBE hasta tu precio objetivo o más (toma de ganancias).' },
  stop: { buy: 'Se comprará a mercado si el precio SUBE hasta tu nivel (entrada por ruptura).', sell: 'Stop-loss: se venderá a mercado si el precio CAE hasta tu nivel, para limitar pérdidas.' },
};

$$('[data-side]').forEach((b) => b.addEventListener('click', () => setSide(b.dataset.side)));

function setSide(side) {
  state.side = side;
  $$('[data-side]').forEach((x) => x.classList.toggle('active', x.dataset.side === side));
  const btn = $('#trade-submit');
  btn.textContent = side === 'buy' ? `Comprar ${base(state.symbol)}` : `Vender ${base(state.symbol)}`;
  btn.className = 'primary ' + side;
  updatePreview();
}

form.type.addEventListener('change', () => {
  const isMarket = form.type.value === 'market';
  $('#price-field').classList.toggle('hidden', isMarket);
  if (!isMarket && !form.price.value) form.price.value = fmtAxis(state.tickers[state.symbol]?.last || 0);
  updatePreview();
});

function execPrice() {
  const t = state.tickers[state.symbol];
  if (form.type.value !== 'market' && Number(form.price.value) > 0) return Number(form.price.value);
  if (!t) return null;
  return state.side === 'buy' ? t.ask || t.last : t.bid || t.last;
}

form.usd.addEventListener('input', () => {
  const p = execPrice();
  form.qty.value = p && form.usd.value ? +(Number(form.usd.value) / p).toFixed(8) : '';
  updatePreview(false);
});
form.qty.addEventListener('input', () => {
  const p = execPrice();
  form.usd.value = p && form.qty.value ? +(Number(form.qty.value) * p).toFixed(2) : '';
  updatePreview(false);
});
form.price.addEventListener('input', () => updatePreview());

$$('[data-pct]').forEach((b) =>
  b.addEventListener('click', () => {
    const f = Number(b.dataset.pct) / 100;
    const p = execPrice();
    if (!p || !state.me) return;
    if (state.side === 'buy') {
      const spend = (state.me.cash * f) / (1 + feeOf(state.symbol));
      form.qty.value = +(Math.floor((spend / p) * 1e8) / 1e8).toFixed(8);
    } else {
      const h = state.me.holdings.find((x) => x.symbol === state.symbol);
      form.qty.value = h ? +(Math.floor(h.qty * f * 1e8) / 1e8).toFixed(8) : 0;
    }
    form.usd.value = +(Number(form.qty.value) * p).toFixed(2);
    updatePreview(false);
  })
);

function updatePreview(syncQty = true) {
  if (!state.config || !state.symbol) return;
  $('#type-hint').textContent = HINTS[form.type.value][state.side];
  const p = execPrice();
  // Si el usuario escribió un monto en USD, recalcula la cantidad con el nuevo precio.
  if (syncQty && p && form.usd.value && document.activeElement !== form.qty) {
    form.qty.value = +(Number(form.usd.value) / p).toFixed(8);
  }
  const qty = Number(form.qty.value) || 0;
  const notional = qty * (p || 0);
  const fee = notional * feeOf(state.symbol);
  const h = state.me?.holdings.find((x) => x.symbol === state.symbol);
  $$('.pip-row').forEach((el) => el.classList.toggle('hidden', !isForex(state.symbol)));
  if (isForex(state.symbol)) $('#p-pip').textContent = `${usd(qty * 0.0001)} (${num(qty / 100000, 3)} lotes)`;
  $('#p-avail').textContent = state.side === 'buy' ? usd(state.me?.cash) : `${num(h?.qty || 0)} ${base(state.symbol)}`;
  $('#p-price').textContent = px(p);
  $('#p-fee').textContent = usd(fee);
  $('#p-total').textContent = usd(state.side === 'buy' ? notional + fee : notional - fee);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#trade-error').textContent = '';
  $('#trade-ok').textContent = '';
  const body = { symbol: state.symbol, side: state.side, type: form.type.value, qty: Number(form.qty.value) };
  if (body.type !== 'market') body.price = Number(form.price.value);
  try {
    const r = await api('/orders', { method: 'POST', body });
    if (r.trade) {
      const t = r.trade;
      $('#trade-ok').textContent = `${t.side === 'buy' ? 'Compraste' : 'Vendiste'} ${num(t.qty)} ${base(t.symbol)} a ${px(t.price)}` +
        (t.side === 'sell' ? ` · G/P: ${usd(t.realized)}` : '');
    } else if (r.order.status === 'filled') {
      $('#trade-ok').textContent = `Orden #${r.order.id} ejecutada al instante.`;
    } else {
      $('#trade-ok').textContent = `Orden #${r.order.id} creada. Se ejecutará cuando el precio llegue a ${px(r.order.price)}.`;
    }
    form.qty.value = '';
    form.usd.value = '';
    await loadMe();
    drawChart();
  } catch (err) {
    $('#trade-error').textContent = err.message;
  }
});

$('#reset').addEventListener('click', async () => {
  if (!confirm('¿Seguro? Se borrarán tus posiciones, órdenes e historial.')) return;
  await api('/reset', { method: 'POST' });
  toast('Cuenta reiniciada. ¡Suerte con tu nueva estrategia!');
  await loadMe();
});

// ---------- Estrategias (predefinidas y personalizadas) ----------
// Valor del <select>: id predefinido ('sma_cross'), 'custom:ID' o 'draft' (borrador del constructor).
state.custom = { mine: [], community: [] };
state.draft = null;

async function loadStrategies() {
  if (!state.strategies) {
    [state.strategies, state.schema] = await Promise.all([api('/strategies'), api('/strategy-schema')]);
    for (const f of [$('#bt-form'), $('#bot-form')]) {
      f.symbol.innerHTML = state.config.symbols.map((x) => `<option>${esc(x)}</option>`).join('');
    }
    $('#sb-template').innerHTML += state.schema.templates.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join('');
  }
  await loadCustom();
}

async function loadCustom() {
  state.custom = await api('/custom-strategies');
  for (const prefix of ['bt', 'bot']) fillStrategySelect(prefix);
  renderStrategyLists();
}

function fillStrategySelect(prefix, value) {
  const sel = $(`#${prefix}-form`).strategy;
  const prev = value ?? sel.value;
  const opt = (v, label) => `<option value="${esc(v)}">${esc(label)}</option>`;
  let html = `<optgroup label="Predefinidas">${state.strategies.map((x) => opt(x.id, x.name)).join('')}</optgroup>`;
  if (state.draft) html += `<optgroup label="Constructor">${opt('draft', '✏️ Borrador: ' + state.draft.name)}</optgroup>`;
  if (state.custom.mine.length) html += `<optgroup label="Mis estrategias">${state.custom.mine.map((x) => opt('custom:' + x.id, x.name)).join('')}</optgroup>`;
  if (state.custom.community.length) html += `<optgroup label="Comunidad">${state.custom.community.map((x) => opt('custom:' + x.id, `${x.name} · ${x.author}`)).join('')}</optgroup>`;
  sel.innerHTML = html;
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  renderParams(prefix);
}

function customById(id) {
  return [...state.custom.mine, ...state.custom.community].find((x) => x.id === id);
}

// Definición de la estrategia elegida en un <select> (sólo personalizadas y borrador).
function selectedDefinition(value) {
  if (value === 'draft') return state.draft;
  if (value.startsWith('custom:')) return customById(Number(value.slice(7)))?.definition;
  return null;
}

function renderParams(prefix, values = {}) {
  const f = $(`#${prefix}-form`);
  const v = f.strategy.value;
  const def = selectedDefinition(v);
  if (def) {
    $(`#${prefix}-desc`).innerHTML = `${esc(def.description || 'Estrategia personalizada.')}<br><span class="muted">${esc(describeDefinition(def))}</span>`;
    $(`#${prefix}-params`).innerHTML = v.startsWith('custom:') && state.custom.mine.some((x) => 'custom:' + x.id === v)
      ? `<p class="hint"><a href="#" data-edit-custom="${v.slice(7)}">✏️ Editar en el constructor</a></p>` : '';
    return;
  }
  const st = state.strategies.find((x) => x.id === v);
  if (!st) return;
  $(`#${prefix}-desc`).textContent = st.description;
  $(`#${prefix}-params`).innerHTML = st.params
    .map((p) => `<label>${esc(p.label)} <input type="number" data-param="${p.key}" value="${values[p.key] ?? p.default}" min="${p.min}" max="${p.max}" step="${p.step ?? 1}"></label>`)
    .join('');
}

function readParams(prefix) {
  const out = {};
  $$(`#${prefix}-params [data-param]`).forEach((i) => (out[i.dataset.param] = Number(i.value)));
  return out;
}

// Campos de estrategia para enviar al servidor.
function strategyPayload(prefix) {
  const v = $(`#${prefix}-form`).strategy.value;
  if (v === 'draft') return { definition: state.draft };
  if (v.startsWith('custom:')) return { customId: Number(v.slice(7)) };
  return { strategy: v, params: readParams(prefix) };
}

$('#bt-form').strategy.addEventListener('change', () => renderParams('bt'));
$('#bot-form').strategy.addEventListener('change', () => renderParams('bot'));
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-edit-custom], .goto-builder');
  if (!a) return;
  e.preventDefault();
  if (a.dataset.editCustom) openCustom(Number(a.dataset.editCustom));
  showView('builder');
});

// ---------- Constructor de estrategias ----------
const opLabel = (id) => state.schema.ops.find((o) => o.id === id)?.label ?? id;
const operandDef = (id) => state.schema.operands.find((o) => o.id === id);

function operandText(o) {
  if (o.ind === 'value') return String(o.value);
  const d = operandDef(o.ind);
  const args = [o.period, o.ind.startsWith('bb_') ? o.period2 : undefined].filter((x) => x !== undefined);
  return `${d.label}${args.length ? ` (${args.join(', ')})` : ''}`;
}

function describeBlock(b) {
  const join = b.mode === 'any' ? ' O ' : ' Y ';
  return b.conditions.map((c) => (c.type === 'flag'
    ? state.schema.flags.find((f) => f.id === c.key)?.label
    : `${operandText(c.left)} ${opLabel(c.op)} ${operandText(c.right)}`)).join(join);
}

function describeDefinition(d) {
  const exit = d.exit?.conditions?.length ? `Vender si ${describeBlock(d.exit)}.` : 'Salida sólo por stop-loss / take-profit / trailing.';
  return `Comprar si ${describeBlock(d.entry)}. ${exit}`;
}

function operandEditor(o, side) {
  const d = operandDef(o.ind);
  const opts = state.schema.operands.map((x) => `<option value="${x.id}"${x.id === o.ind ? ' selected' : ''}>${esc(x.label)}</option>`).join('');
  let html = `<select data-f="${side}.ind">${opts}</select>`;
  if (o.ind === 'value') html += `<input type="number" step="any" data-f="${side}.value" value="${o.value ?? 0}">`;
  if (d.period !== undefined) html += `<input type="number" min="1" max="500" data-f="${side}.period" value="${o.period ?? d.period}" title="Periodo">`;
  if (d.period2 !== undefined) html += `<input type="number" step="0.1" min="0.1" max="10" data-f="${side}.period2" value="${o.period2 ?? d.period2}" title="Desviaciones">`;
  return html;
}

function condRow(c) {
  if (c.type === 'flag') {
    const opts = state.schema.flags.map((f) => `<option value="${f.id}"${f.id === c.key ? ' selected' : ''}>${esc(f.label)}</option>`).join('');
    return `<div class="cond" data-kind="flag"><select data-f="key">${opts}</select><button type="button" class="x" title="Quitar">✕</button></div>`;
  }
  const ops = state.schema.ops.map((o) => `<option value="${o.id}"${o.id === c.op ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  return `<div class="cond" data-kind="compare">${operandEditor(c.left, 'left')}<select data-f="op">${ops}</select>${operandEditor(c.right, 'right')}<button type="button" class="x" title="Quitar">✕</button></div>`;
}

function readCond(row) {
  const get = (f) => row.querySelector(`[data-f="${f}"]`)?.value;
  if (row.dataset.kind === 'flag') return { type: 'flag', key: get('key') };
  const operand = (side) => {
    const o = { ind: get(`${side}.ind`) };
    for (const k of ['period', 'period2', 'value']) if (get(`${side}.${k}`) !== undefined) o[k] = Number(get(`${side}.${k}`));
    return o;
  };
  return { type: 'compare', left: operand('left'), op: get('op'), right: operand('right') };
}

function readDefinition() {
  const f = $('#sb-form');
  return {
    name: f.name.value.trim(),
    description: f.description.value.trim(),
    entry: { mode: f.entryMode.value, conditions: [...$$('#sb-entry .cond')].map(readCond) },
    exit: { mode: f.exitMode.value, conditions: [...$$('#sb-exit .cond')].map(readCond) },
  };
}

function loadDefinition(def, { id = null, isPublic = false } = {}) {
  const f = $('#sb-form');
  state.sbId = id;
  f.name.value = def.name || '';
  f.description.value = def.description || '';
  f.entryMode.value = def.entry?.mode || 'all';
  f.exitMode.value = def.exit?.mode || 'any';
  f.public.checked = isPublic;
  $('#sb-entry').innerHTML = (def.entry?.conditions || []).map(condRow).join('');
  $('#sb-exit').innerHTML = (def.exit?.conditions || []).map(condRow).join('');
  $('#sb-title').textContent = id ? 'Editar estrategia' : 'Nueva estrategia';
  $('#sb-delete').classList.toggle('hidden', !id);
  $('#sb-error').textContent = '';
  $('#sb-status').textContent = '';
  updateSummary();
  renderStrategyLists();
}

function openCustom(id) {
  const s = state.custom.mine.find((x) => x.id === id);
  if (s) loadDefinition(s.definition, { id: s.id, isPublic: s.public });
}

function updateSummary() {
  const d = readDefinition();
  $('#sb-summary').textContent = d.entry.conditions.length ? '📝 ' + describeDefinition(d) : 'Añade al menos una condición de compra.';
}

// Al cambiar el indicador de un operando se regenera la fila (cambian los campos de periodo/valor).
$('#sb-form').addEventListener('change', (e) => {
  const f = e.target.dataset.f;
  if (f && f.endsWith('.ind')) {
    const row = e.target.closest('.cond');
    row.outerHTML = condRow(readCond(row));
  }
  updateSummary();
});
$('#sb-form').addEventListener('input', updateSummary);
$('#sb-form').addEventListener('click', (e) => {
  if (e.target.classList.contains('x')) {
    e.target.closest('.cond').remove();
    updateSummary();
  }
  const add = e.target.dataset.add;
  if (!add) return;
  const c = e.target.dataset.kind === 'flag'
    ? { type: 'flag', key: 'trend_up' }
    : add === 'entry'
      ? { type: 'compare', left: { ind: 'rsi', period: 14 }, op: 'lt', right: { ind: 'value', value: 30 } }
      : { type: 'compare', left: { ind: 'rsi', period: 14 }, op: 'gt', right: { ind: 'value', value: 70 } };
  $(`#sb-${add}`).insertAdjacentHTML('beforeend', condRow(c));
  updateSummary();
});

$('#sb-new').addEventListener('click', () => loadDefinition({ name: '', entry: { mode: 'all', conditions: [{ type: 'compare', left: { ind: 'close' }, op: 'crossAbove', right: { ind: 'ema', period: 50 } }] }, exit: { mode: 'any', conditions: [] } }));
$('#sb-template').addEventListener('change', (e) => {
  if (e.target.value === '') return;
  loadDefinition(state.schema.templates[Number(e.target.value)]);
  e.target.value = '';
  toast('Plantilla cargada. Modifícala a tu gusto y guárdala.');
});

$('#sb-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#sb-error').textContent = '';
  const body = { definition: readDefinition(), public: $('#sb-form').public.checked };
  try {
    const saved = state.sbId
      ? await api('/custom-strategies/' + state.sbId, { method: 'PUT', body })
      : await api('/custom-strategies', { method: 'POST', body });
    state.sbId = saved.id;
    await loadCustom();
    loadDefinition(saved.definition, { id: saved.id, isPublic: saved.public });
    $('#sb-status').textContent = '✔ Guardada';
    toast('Estrategia guardada. Ya puedes usarla en Backtesting y Bots.');
  } catch (err) {
    $('#sb-error').textContent = err.message;
  }
});

// Usa la estrategia del editor (aunque no esté guardada) en el backtest o en un bot.
function useDraft(prefix) {
  const def = readDefinition();
  if (!def.name) def.name = 'Sin nombre';
  if (!def.entry.conditions.length) {
    $('#sb-error').textContent = 'Añade al menos una condición de compra';
    return false;
  }
  state.draft = def;
  const value = state.sbId ? 'custom:' + state.sbId : 'draft';
  // Si está guardada pero con cambios, se usa el borrador.
  const saved = state.sbId && customById(state.sbId);
  const useSaved = saved && JSON.stringify(saved.definition) === JSON.stringify({ ...def, description: def.description });
  for (const p of ['bt', 'bot']) fillStrategySelect(p, useSaved ? value : 'draft');
  if (prefix === 'bot') setBotType('signal');
  return true;
}
$('#sb-test').addEventListener('click', () => {
  if (!useDraft('bt')) return;
  showView('backtest');
  $('#bt-form').requestSubmit();
});
$('#sb-bot').addEventListener('click', () => {
  if (!useDraft('bot')) return;
  showView('bots');
  toast('Elige el par, la temporalidad y el monto, y pulsa «Activar bot»');
});
$('#sb-delete').addEventListener('click', async () => {
  if (!state.sbId || !confirm('¿Eliminar esta estrategia? Los bots que ya la usan seguirán funcionando con su copia.')) return;
  await api('/custom-strategies/' + state.sbId, { method: 'DELETE' });
  await loadCustom();
  $('#sb-new').click();
});

function renderStrategyLists() {
  $('#sb-mine').innerHTML = state.custom.mine.length
    ? state.custom.mine.map((s) => `<div class="sb-item${s.id === state.sbId ? ' sel' : ''}" data-open="${s.id}">
        <strong>${esc(s.name)}</strong> ${s.public ? '<span class="pill buy">Compartida</span>' : ''}
        <div class="meta">${esc(describeDefinition(s.definition)).slice(0, 140)}</div></div>`).join('')
    : '<p class="muted small">Todavía no tienes estrategias. Crea una nueva o empieza desde una plantilla.</p>';
  $('#sb-community').innerHTML = state.custom.community.length
    ? state.custom.community.map((s) => `<div class="sb-item">
        <strong>${esc(s.name)}</strong> <span class="muted small">por ${esc(s.author)}</span>
        <div class="meta">${esc(s.definition.description || describeDefinition(s.definition)).slice(0, 140)}</div>
        <div class="acts"><button type="button" data-copy="${s.id}">📋 Copiar a las mías</button><button type="button" data-try="${s.id}">▶ Backtest</button></div></div>`).join('')
    : '<p class="muted small">Nadie ha compartido estrategias todavía. ¡Sé el primero!</p>';
}

$('#view-builder').addEventListener('click', async (e) => {
  const t = e.target;
  const item = t.closest('[data-open]');
  if (item) return openCustom(Number(item.dataset.open));
  if (t.dataset.copy) {
    const s = await api(`/custom-strategies/${t.dataset.copy}/copy`, { method: 'POST' });
    await loadCustom();
    loadDefinition(s.definition, { id: s.id });
    toast('Copiada a «Mis estrategias»');
  }
  if (t.dataset.try) {
    fillStrategySelect('bt', 'custom:' + t.dataset.try);
    showView('backtest');
    $('#bt-form').requestSubmit();
  }
});

// ---------- Backtesting ----------
const btChart = new Charts.CandleChart($('#bt-chart'));

$('#bt-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('button[type=submit]');
  $('#bt-error').textContent = '';
  btn.disabled = true;
  btn.textContent = 'Calculando…';
  try {
    state.bt = await api('/backtest', {
      method: 'POST',
      body: {
        symbol: f.symbol.value, timeframe: f.timeframe.value, limit: Number(f.limit.value),
        ...strategyPayload('bt'),
        stopLoss: Number(f.stopLoss.value), takeProfit: Number(f.takeProfit.value),
        trailing: Number(f.trailing.value), positionPct: Number(f.positionPct.value),
      },
    });
    state.bt.request = {
      symbol: f.symbol.value, timeframe: f.timeframe.value, strategyValue: f.strategy.value,
      stopLoss: f.stopLoss.value, takeProfit: f.takeProfit.value, trailing: f.trailing.value,
    };
    renderBacktest();
  } catch (err) {
    $('#bt-error').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ Ejecutar backtest';
  }
});

function renderBacktest() {
  const r = state.bt;
  const m = r.metrics;
  $('#bt-empty').classList.add('hidden');
  $('#bt-out').classList.remove('hidden');
  $('#bt-title').textContent = `${r.strategy.name} · ${r.request.symbol} · ${r.request.timeframe}`;
  const tile = (label, value, c = '') => `<div class="metric"><span>${label}</span><strong class="${c}">${value}</strong></div>`;
  $('#bt-metrics').innerHTML = [
    tile('Resultado de la estrategia', pct(m.totalReturn), cls(m.totalReturn)),
    tile('Comprar y mantener', pct(m.buyHoldReturn), cls(m.buyHoldReturn)),
    tile('Capital final', usd(m.finalEquity)),
    tile('Máxima caída', `-${m.maxDrawdown.toFixed(2)} %`, m.maxDrawdown > 0 ? 'down' : ''),
    tile('Operaciones', m.trades),
    tile('% ganadoras', m.trades ? `${m.winRate.toFixed(1)} %` : '—'),
    tile('Factor de beneficio', m.profitFactor == null ? '∞' : m.profitFactor.toFixed(2)),
    tile('Media por operación', m.trades ? pct(m.avgTrade) : '—', cls(m.avgTrade)),
    tile('Mejor / peor', m.trades ? `${pct(m.bestTrade)} / ${pct(m.worstTrade)}` : '—'),
    tile('Tiempo invertido', `${m.exposure.toFixed(0)} %`),
  ].join('');
  const beat = m.totalReturn > m.buyHoldReturn;
  $('#bt-verdict').textContent =
    `Periodo: ${new Date(m.from).toLocaleString('es')} → ${new Date(m.to).toLocaleString('es')} (${m.candles} velas). ` +
    (m.trades === 0 ? 'La estrategia no generó ninguna operación: prueba otros parámetros o más velas. '
      : beat ? `La estrategia superó a «comprar y mantener» en ${(m.totalReturn - m.buyHoldReturn).toFixed(2)} puntos. `
      : `La estrategia quedó ${(m.buyHoldReturn - m.totalReturn).toFixed(2)} puntos por debajo de «comprar y mantener». `) +
    (m.openAtEnd ? 'La última posición seguía abierta y se cerró al final del periodo. ' : '') +
    'Recuerda: los resultados pasados no garantizan resultados futuros.';
  $('#bt-trades tbody').innerHTML = r.trades.length
    ? r.trades.map((t, i) => `<tr><td>${i + 1}</td>
        <td>${new Date(t.entryTime).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}</td>
        <td>${new Date(t.exitTime).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}</td>
        <td class="r">${px(t.entryPrice)}</td><td class="r">${px(t.exitPrice)}</td><td class="r">${t.bars}</td>
        <td>${esc(t.reason)}</td><td class="r ${cls(t.pnl)}">${usd(t.pnl)} (${pct(t.pnlPct)})</td></tr>`).join('')
    : '<tr><td colspan="8" class="muted">Sin operaciones.</td></tr>';
  drawBacktest();
}

function drawBacktest() {
  const r = state.bt;
  btChart.set({
    candles: r.candles,
    overlays: r.plots.map((p) => ({ label: p.label, values: p.values })),
    markers: r.markers,
    zones: r.zones || [],
    segments: r.segments || [],
    panels: ['volume', ...r.panels],
    hlines: [],
    timeframe: r.request.timeframe,
  });
  Charts.lineChart($('#bt-equity'), {
    times: r.candles.map((c) => c[0]),
    series: [
      { label: 'Estrategia', values: r.equity, color: '#4f8cff' },
      { label: 'Comprar y mantener', values: r.buyHold, color: '#8b98a8' },
    ],
  });
}

$('#bt-to-bot').addEventListener('click', () => {
  const r = state.bt;
  const f = $('#bot-form');
  setBotType('signal');
  f.symbol.value = r.request.symbol;
  f.timeframe.value = r.request.timeframe;
  fillStrategySelect('bot', r.request.strategyValue);
  renderParams('bot', r.strategy.params);
  f.stopLoss.value = r.request.stopLoss;
  f.takeProfit.value = r.request.takeProfit;
  f.trailing.value = r.request.trailing;
  showView('bots');
  toast('Revisa el monto por operación y pulsa «Activar bot»');
});

// ---------- Bots ----------
const BOT_TYPES = {
  signal: 'Opera según una estrategia (predefinida o creada en «Estrategias»): al cerrar cada vela evalúa las reglas y compra o vende.',
  dca: 'Compra una cantidad fija cada cierto tiempo (Dollar Cost Averaging). Puede comprar extra en las caídas y vender todo al alcanzar el take-profit sobre el precio medio.',
  grid: 'Reparte la inversión en niveles dentro de un rango: compra cada vez que el precio baja un nivel y vende al subir al siguiente. Ideal para mercados laterales.',
};
state.botType = 'signal';
state.botPanels = {}; // id -> 'edit' | 'log'

function setBotType(type) {
  state.botType = type;
  $$('[data-bot-type]').forEach((b) => b.classList.toggle('active', b.dataset.botType === type));
  $$('#bot-form [data-for]').forEach((el) => el.classList.toggle('hidden', !el.dataset.for.split(' ').includes(type)));
  $('#bot-type-desc').textContent = BOT_TYPES[type];
  if (type === 'grid') prefillGrid();
}
$$('[data-bot-type]').forEach((b) => b.addEventListener('click', () => setBotType(b.dataset.botType)));

function prefillGrid(force = false) {
  const f = $('#bot-form');
  const p = state.tickers[f.symbol.value]?.last;
  if (!p) return;
  if (force || !f.low.value) f.low.value = fmtAxis(p * 0.9);
  if (force || !f.high.value) f.high.value = fmtAxis(p * 1.1);
  gridHint();
}

function gridHint() {
  const f = $('#bot-form');
  const low = Number(f.low.value), high = Number(f.high.value), n = Number(f.grids.value), inv = Number(f.investment.value);
  if (!(low > 0 && high > low && n >= 2)) { $('#grid-hint').textContent = ''; return; }
  const stepPct = ((high - low) / n / low) * 100;
  const fee = feeOf(f.symbol.value) * 200;
  const p = state.tickers[f.symbol.value]?.last;
  $('#grid-hint').textContent = `Cada nivel: ${usd(inv / n)} · separación ≈ ${stepPct.toFixed(2)} % · ganancia por nivel ≈ ${(stepPct - fee).toFixed(2)} % tras comisiones.` +
    (p && (p < low || p > high) ? ' ⚠️ El precio actual está fuera del rango.' : '');
}
$('#bot-form').symbol.addEventListener('change', () => state.botType === 'grid' && prefillGrid(true));
for (const k of ['low', 'high', 'grids', 'investment']) $('#bot-form')[k].addEventListener('input', gridHint);

$('#bot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('#bot-error').textContent = '';
  const type = state.botType;
  const body = { type, name: f.name.value, symbol: f.symbol.value, stopLoss: Number(f.stopLoss.value) };
  if (type === 'signal') {
    Object.assign(body, strategyPayload('bot'), {
      timeframe: f.timeframe.value, amount: Number(f.amount.value),
      takeProfit: Number(f.takeProfit.value), trailing: Number(f.trailing.value),
    });
  } else if (type === 'dca') {
    Object.assign(body, {
      amount: Number(f.amount.value), intervalHours: Number(f.intervalHours.value),
      dropPct: Number(f.dropPct.value), maxBuys: Number(f.maxBuys.value), takeProfit: Number(f.takeProfit.value),
    });
  } else {
    Object.assign(body, { low: Number(f.low.value), high: Number(f.high.value), grids: Number(f.grids.value), investment: Number(f.investment.value) });
  }
  try {
    await api('/bots', { method: 'POST', body });
    toast('🤖 Bot activado');
    f.name.value = '';
    await Promise.all([loadBots(true), loadMe()]);
  } catch (err) {
    $('#bot-error').textContent = err.message;
  }
});

const TF_NAME = { '1m': '1 minuto', '5m': '5 minutos', '15m': '15 minutos', '1h': '1 hora', '4h': '4 horas', '1d': '1 día' };
const TYPE_BADGE = { signal: '🧠 Señales', dca: '📅 DCA', grid: '🔲 Grid' };

function botDetails(b) {
  const pos = b.qty > 0
    ? `${num(b.qty)} ${esc(base(b.symbol))} · medio ${px(b.entry_price)} <span class="${cls(b.unrealized)}">(${usd(b.unrealized)})</span>`
    : 'Sin posición';
  const risk = [b.stop_loss ? `SL ${b.stop_loss} %` : '', b.take_profit && b.type !== 'grid' ? `TP ${b.take_profit} %` : '', b.trailing ? `Trailing ${b.trailing} %` : ''].filter(Boolean).join(' · ') || '—';
  let rows = '';
  if (b.type === 'signal') {
    const params = b.strategy === 'custom' ? describeDefinition(b.params.definition) : Object.entries(b.params).map(([k, v]) => `${k}=${v}`).join(', ');
    rows = `<dt>Estrategia</dt><dd>${esc(b.strategyName)} · velas de ${TF_NAME[b.timeframe]}</dd>
      <dt>Reglas</dt><dd>${esc(params)}</dd>
      <dt>Por operación</dt><dd>${usd(b.amount)}</dd>`;
  } else if (b.type === 'dca') {
    const c = b.config, st = c.state || {};
    const next = st.lastBuyAt ? Math.max(0, st.lastBuyAt + c.intervalHours * 3600e3 - Date.now()) : 0;
    rows = `<dt>Plan</dt><dd>${usd(b.amount)} cada ${c.intervalHours} h${c.dropPct ? ` · extra si cae ${c.dropPct} %` : ''}${c.maxBuys ? ` · máx. ${c.maxBuys} compras` : ''}</dd>
      <dt>Ciclo actual</dt><dd>${st.buys || 0} compras · invertido ${usd(st.cost || 0)}</dd>
      <dt>Próxima compra</dt><dd>${c.maxBuys && st.buys >= c.maxBuys ? 'Límite alcanzado' : next ? `en ${fmtDuration(Math.ceil(next / 60000))}` : 'en breve'}</dd>`;
  } else {
    const c = b.config;
    const cells = (c.cells || []).map((x) => `<span class="${x.state}" title="${x.state === 'sell' ? 'Comprado, esperando para vender' : 'Esperando para comprar'}"></span>`).join('');
    rows = `<dt>Rango</dt><dd>${px(c.low)} – ${px(c.high)} · ${c.grids} niveles de ${usd(c.investment / c.grids)}</dd>
      <dt>Niveles</dt><dd><div class="grid-cells">${cells}</div><span class="muted small">verde = comprado, esperando para vender</span></dd>`;
  }
  return `${rows}
    <dt>Riesgo</dt><dd>${risk}</dd>
    <dt>Posición</dt><dd>${pos}</dd>
    <dt>G/P realizada</dt><dd class="${cls(b.realized)}">${usd(b.realized)} · ${b.trade_count} operaciones</dd>
    <dt>Último evento</dt><dd>${esc(b.last_event || '—')}</dd>`;
}

function botEditForm(b) {
  const field = (label, name, value, extra = '') => `<label>${label} <input name="${name}" value="${esc(value ?? '')}" ${extra}></label>`;
  let html = field('Nombre', 'name', b.name ?? '', 'maxlength="40"') + field('Stop-loss %', 'stopLoss', b.stop_loss, 'type="number" step="any" min="0"');
  if (b.type !== 'grid') html += field(b.type === 'dca' ? 'USD por compra' : 'USD por operación', 'amount', b.amount, 'type="number" step="any" min="1"') + field('Take-profit %', 'takeProfit', b.take_profit, 'type="number" step="any" min="0"');
  if (b.type === 'signal') {
    html += field('Trailing stop %', 'trailing', b.trailing, 'type="number" step="any" min="0"');
    html += `<label>Temporalidad <select name="timeframe">${Object.keys(TF_NAME).map((t) => `<option${t === b.timeframe ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;
    if (b.strategy !== 'custom') {
      const st = state.strategies.find((x) => x.id === b.strategy);
      html += (st?.params || []).map((p) => field(esc(p.label), 'p:' + p.key, b.params[p.key], `type="number" step="${p.step ?? 1}" min="${p.min}" max="${p.max}"`)).join('');
    }
  }
  if (b.type === 'dca') {
    html += field('Cada (horas)', 'intervalHours', b.config.intervalHours, 'type="number" step="any" min="0.1"')
      + field('Extra si cae %', 'dropPct', b.config.dropPct, 'type="number" step="any" min="0"')
      + field('Máx. compras', 'maxBuys', b.config.maxBuys, 'type="number" min="0"');
  }
  if (b.type === 'grid') html += '<p class="hint" style="grid-column:1/-1">El rango y los niveles de un grid no se pueden cambiar en marcha: elimínalo y crea otro.</p>';
  return `<form class="edit" data-edit-form="${b.id}">${html}
    <div class="btn-row"><button type="submit" class="primary">Guardar cambios</button><button type="button" data-bot-panel="${b.id}" data-panel="">Cancelar</button></div>
    <p class="error" style="grid-column:1/-1"></p></form>`;
}

async function botLog(id) {
  const [events, trades] = await Promise.all([api(`/bots/${id}/events`), api(`/bots/${id}/trades`)]);
  const el = document.querySelector(`[data-log="${id}"]`);
  if (!el) return;
  el.innerHTML = `<strong>Registro</strong>` + (events.map((e) => `<div><time>${date(e.created_at)}</time>${esc(e.message)}</div>`).join('') || '<div class="muted">Sin eventos</div>')
    + `<strong class="mt" style="display:block">Operaciones del bot</strong>` + (trades.map((t) => `<div><time>${date(t.created_at)}</time><span class="pill ${t.side}">${t.side === 'buy' ? 'Compra' : 'Venta'}</span> ${num(t.qty)} a ${px(t.price)}</div>`).join('') || '<div class="muted">Sin operaciones</div>');
}

async function loadBots(force = false) {
  // No se repinta mientras el usuario edita un bot, para no perder lo que escribe.
  if (!force && Object.values(state.botPanels).includes('edit')) return;
  const bots = await api('/bots');
  state.bots = bots;
  $('#bots-list').innerHTML = bots.length
    ? bots.map((b) => {
        const panel = state.botPanels[b.id];
        return `<div class="bot">
          <div class="bot-head">
            <div><span class="type-badge">${TYPE_BADGE[b.type]}</span><strong>#${b.id} ${esc(b.name || b.strategyName)}</strong> <span class="muted">· ${esc(b.symbol)}</span>
              <span class="status ${b.active ? 'on' : 'off'}">${b.active ? '● Activo' : '❚❚ Pausado'}</span></div>
            <div class="actions">
              <button data-bot-toggle="${b.id}" data-active="${b.active ? 0 : 1}">${b.active ? 'Pausar' : 'Reanudar'}</button>
              <button data-bot-panel="${b.id}" data-panel="edit">✏️ Editar</button>
              <button data-bot-panel="${b.id}" data-panel="log">📜 Registro</button>
              <button class="danger" data-bot-del="${b.id}" data-qty="${b.qty}">Eliminar</button>
            </div>
          </div>
          <dl class="kv">${botDetails(b)}</dl>
          ${panel === 'edit' ? botEditForm(b) : ''}
          ${panel === 'log' ? `<div class="log" data-log="${b.id}">Cargando…</div>` : ''}
        </div>`;
      }).join('')
    : '<p class="muted">No tienes bots. Crea uno a la izquierda, desde un backtest o desde el constructor de estrategias.</p>';
  for (const [id, p] of Object.entries(state.botPanels)) if (p === 'log') botLog(id);
}

$('#bots-list').addEventListener('click', async (e) => {
  const t = e.target;
  try {
    if (t.dataset.botPanel) {
      const id = t.dataset.botPanel;
      state.botPanels[id] = t.dataset.panel && state.botPanels[id] !== t.dataset.panel ? t.dataset.panel : undefined;
      return loadBots(true);
    }
    if (t.dataset.botToggle) {
      await api('/bots/' + t.dataset.botToggle, { method: 'PATCH', body: { active: t.dataset.active === '1' } });
    } else if (t.dataset.botDel) {
      if (!confirm('¿Eliminar este bot?')) return;
      const close = Number(t.dataset.qty) > 0 && confirm('El bot tiene una posición abierta. ¿Quieres venderla ahora? (Cancelar = conservarla en tu cartera)');
      await api(`/bots/${t.dataset.botDel}${close ? '?close=1' : ''}`, { method: 'DELETE' });
      delete state.botPanels[t.dataset.botDel];
      await loadMe();
    } else return;
    loadBots(true);
  } catch (err) {
    toast(err.message);
  }
});

$('#bots-list').addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-edit-form]');
  if (!form) return;
  e.preventDefault();
  const id = form.dataset.editForm;
  const body = {};
  const params = {};
  for (const el of form.querySelectorAll('input, select')) {
    if (el.name.startsWith('p:')) params[el.name.slice(2)] = Number(el.value);
    else body[el.name] = el.type === 'number' ? Number(el.value) : el.value;
  }
  if (Object.keys(params).length) body.params = params;
  try {
    await api('/bots/' + id, { method: 'PATCH', body });
    delete state.botPanels[id];
    toast('Bot actualizado');
    loadBots(true);
  } catch (err) {
    form.querySelector('.error').textContent = err.message;
  }
});

const fmtDuration = (m) => (m >= 1440 ? `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h` : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

// ---------- Horarios de mercado ----------
const FOREX_MARKET = { name: 'Forex (mercado global)', tz: 'America/New_York', forex: true };
function renderClocks() {
  const dur = fmtDuration;
  const rows = [FOREX_MARKET, ...Indicators.EXCHANGES].map((ex) => {
    const st = Indicators.marketStatus(ex);
    const label = st.open ? 'Abierta' : st.lunch ? 'Pausa' : 'Cerrada';
    const klass = st.open ? 'open' : st.lunch ? 'lunch' : 'closed';
    return `<div class="clock"><span>${esc(ex.name)} <span class="muted">${st.localTime}</span></span>
      <span class="st ${klass}">● ${label}</span>
      <span class="when">${st.open ? 'Cierra' : 'Abre'} en ${dur(st.minutesToChange)}</span></div>`;
  });
  // Sesiones de forex y kill zone activa ahora mismo.
  const now = Date.now();
  const sessions = Indicators.SESSIONS.filter((x) => Indicators.marketStatus(x, now).open).map((x) => x.name);
  const kz = Indicators.KILLZONES.find((k) => Indicators.inKillzone(now, [k.id]));
  const forexOpen = Indicators.marketStatus(FOREX_MARKET, now).open;
  rows.unshift(`<p class="small">${forexOpen ? `Sesión activa: <strong>${sessions.length ? esc(sessions.join(' + ')) : 'Sídney / transición'}</strong>` : 'Forex cerrado (fin de semana)'}${forexOpen && kz ? ` · <span style="color:${kz.color}">${esc(kz.name)}</span>` : ''}</p>`);
  $('#clocks').innerHTML = rows.join('');
}

// ---------- Arranque ----------
let pollTimer;
async function enterApp() {
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  await loadConfig();
  await Promise.all([loadTickers(), loadMe(), loadStrategies()]);
  selectSymbol(state.symbol);
  setSide(state.side);
  setBotType(state.botType);
  renderClocks();
  clearInterval(pollTimer);
  let n = 0;
  pollTimer = setInterval(async () => {
    if (!state.token) return clearInterval(pollTimer);
    try {
      await Promise.all([loadTickers(), loadMe()]);
      if (state.view === 'market') drawChart();
      if (state.view === 'orders') loadOrders();
      if (state.view === 'bots') loadBots();
      if (state.view === 'market' && n % 6 === 0) renderClocks();
      if (++n % 12 === 0 && state.view === 'market') loadCandles();
    } catch { /* se reintenta en el siguiente ciclo */ }
  }, 5000);
}

(async () => {
  try {
    await loadConfig();
  } catch { /* el servidor aún arranca */ }
  if (state.token) {
    try {
      await enterApp();
      return;
    } catch {
      logoutLocal();
    }
  }
  showAuth();
})();

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
const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

// Menú lateral: en escritorio se pliega a iconos (se recuerda la preferencia);
// en móvil se abre como cajón. Sin preferencia, se pliega solo en pantallas medianas.
function applyNavPref() {
  let pref = null;
  try { pref = localStorage.getItem('navCollapsed'); } catch { /* sin almacenamiento */ }
  document.body.classList.toggle('nav-collapsed', pref === null ? window.innerWidth < 1280 : pref === '1');
}
applyNavPref();

function setDrawer(open) {
  document.body.classList.toggle('nav-open', open);
}

$('#nav-toggle').addEventListener('click', () => {
  if (isMobile()) return setDrawer(!document.body.classList.contains('nav-open'));
  const collapsed = document.body.classList.toggle('nav-collapsed');
  try { localStorage.setItem('navCollapsed', collapsed ? '1' : '0'); } catch { /* sin almacenamiento */ }
  // Los gráficos se adaptan al nuevo ancho cuando termina la animación.
  setTimeout(() => window.dispatchEvent(new Event('resize')), 200);
});
$('#bnav-more').addEventListener('click', () => setDrawer(true));
$('#scrim').addEventListener('click', () => setDrawer(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setDrawer(false); });

$$('.nav, .bnav[data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

function showView(v) {
  state.view = v;
  $$('.nav, .bnav[data-view]').forEach((x) => x.classList.toggle('active', x.dataset.view === v));
  const navBtn = document.querySelector(`.nav[data-view="${v}"]`);
  $('#view-title').textContent = navBtn?.querySelector('.lbl')?.textContent || '';
  setDrawer(false);
  // En móvil, "Más" queda marcado cuando la sección no está en la barra inferior.
  $('#bnav-more').classList.toggle('active', !document.querySelector(`.bnav[data-view="${v}"]`));
  window.scrollTo({ top: 0 });
  $$('.view').forEach((x) => x.classList.toggle('hidden', x.id !== 'view-' + v));
  if (v === 'orders') loadOrders();
  if (v === 'history') loadTrades();
  if (v === 'ranking') loadRanking();
  if (v === 'market') drawChart();
  if (v === 'backtest' && state.bt) drawBacktest();
  if (v === 'bots') { loadBots(true); loadAiInfo(); }
  if (v === 'journal') loadJournal();
  if (v === 'replay') { loadReplaySessions(); renderReplay(); }
  if (v === 'academy') { closeLesson(); loadAcademy(); }
  if (v === 'builder' && !$('#sb-form').name.value && !$$('#sb-entry .cond').length) $('#sb-new').click();
}

// ---------- Datos ----------
async function loadConfig() {
  state.config = await api('/config');
  const live = state.config.mode === 'live';
  const b = $('#source-badge');
  b.textContent = live ? `● En vivo · ${state.config.exchange}` : '● Mercado simulado';
  b.className = 'badge ' + (live ? 'live' : 'sim');
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

// Indicadores, paneles y capas ICT activos, para cualquier serie de velas (Mercado o Replay).
function indicatorLayers(c, tf) {
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
  return {
    overlays, band,
    panels: ['volume', 'rsi', 'macd', 'stoch', 'atr'].filter((k) => ind[k]),
    zones: [], segments: [], labels: [], vbands: [], pd: null,
    ...(c.length ? ictLayers(c, ind, tf) : {}),
  };
}

function drawChart() {
  const c = state.candles;
  const holding = state.me?.holdings.find((h) => h.symbol === state.symbol);
  const hlines = [];
  if (holding) hlines.push({ price: holding.avg_price, color: '#f5a524', label: 'Tu media' });
  // Vista previa de la calculadora de riesgo.
  if (state.calc) {
    hlines.push({ price: state.calc.stop, color: '#f0525c', label: 'Stop' });
    if (state.calc.target) hlines.push({ price: state.calc.target, color: '#1fbf75', label: 'Objetivo' });
  }
  hlines.push({ price: state.tickers[state.symbol]?.last, color: '#4f8cff' });
  mainChart.set({
    candles: c, hlines, timeframe: state.timeframe, visible: visibleCount(),
    drawings: state.drawings[state.symbol] || [],
    ...indicatorLayers(c, state.timeframe),
  });
}

window.addEventListener('resize', () => {
  drawChart();
  if (state.bt) drawBacktest();
  if (state.rp && state.view === 'replay') renderReplay();
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
  updateCalc();
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
  // Stop y objetivo automáticos de la calculadora de riesgo.
  if (state.calc && form.bracket.checked && body.type === 'market' && body.side === 'buy') {
    body.stop = state.calc.stop;
    if (state.calc.target) body.target = state.calc.target;
  }
  if (body.type === 'market' && (form.jSetup.value || form.jEmotion.value || form.jNotes.value.trim())) {
    body.journal = { setup: form.jSetup.value, emotion: form.jEmotion.value, notes: form.jNotes.value.trim() };
  }
  try {
    const r = await api('/orders', { method: 'POST', body });
    if (r.trade) {
      const t = r.trade;
      $('#trade-ok').textContent = `${t.side === 'buy' ? 'Compraste' : 'Vendiste'} ${num(t.qty)} ${base(t.symbol)} a ${px(t.price)}` +
        (t.side === 'sell' ? ` · G/P: ${usd(t.realized)}` : '') +
        (r.stopOrder ? ` · Stop en ${px(r.stopOrder.price)}${r.targetOrder ? ` y objetivo en ${px(r.targetOrder.price)} (OCO)` : ''}` : '') +
        (body.journal ? ' · 📓 anotada en el diario' : '');
      form.jSetup.value = ''; form.jEmotion.value = ''; form.jNotes.value = '';
      if (r.stopOrder) {
        $('#risk-calc').open = false;
        form.stop.value = ''; form.target.value = '';
        state.calc = null;
      }
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
  ai: 'Un agente de IA (Claude) recibe al cierre de cada vela un resumen del mercado (velas, indicadores, ICT, horario) y decide comprar, vender o mantener, explicando su razonamiento. El servidor aplica tus límites: confianza mínima, stop obligatorio y distancia máxima del stop. Compáralo con tus otros bots para ver si realmente decide mejor.',
};
state.botType = 'signal';
state.botPanels = {}; // id -> 'edit' | 'log'

function setBotType(type) {
  state.botType = type;
  $$('[data-bot-type]').forEach((b) => b.classList.toggle('active', b.dataset.botType === type));
  $$('#bot-form [data-for]').forEach((el) => el.classList.toggle('hidden', !el.dataset.for.split(' ').includes(type)));
  $('#bot-type-desc').textContent = BOT_TYPES[type];
  const aiOff = type === 'ai' && !state.ai?.enabled;
  $('#bot-form .ai-off').classList.toggle('hidden', !aiOff);
  $('#bot-form button[type=submit]').disabled = aiOff;
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
  } else if (type === 'ai') {
    Object.assign(body, {
      amount: Number(f.amount.value), timeframe: f.aiTimeframe.value, instructions: f.instructions.value,
      minConfidence: Number(f.minConfidence.value), maxStopPct: Number(f.maxStopPct.value),
    });
  } else {
    Object.assign(body, { low: Number(f.low.value), high: Number(f.high.value), grids: Number(f.grids.value), investment: Number(f.investment.value) });
  }
  try {
    await api('/bots', { method: 'POST', body });
    toast('🤖 Bot activado');
    f.name.value = '';
    await Promise.all([loadBots(true), loadMe()]);
    if (type === 'ai') setTimeout(() => { loadBots(true); loadMe(); loadAiInfo(); }, 3000); // la primera decisión tarda unos segundos
  } catch (err) {
    $('#bot-error').textContent = err.message;
  }
});

const TF_NAME = { '1m': '1 minuto', '5m': '5 minutos', '15m': '15 minutos', '1h': '1 hora', '4h': '4 horas', '1d': '1 día' };
const TYPE_BADGE = { signal: '🧠 Señales', dca: '📅 DCA', grid: '🔲 Grid', ai: '✨ IA' };

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
  } else if (b.type === 'ai') {
    const c = b.config;
    rows = `<dt>Agente</dt><dd>Claude · velas de ${TF_NAME[b.timeframe]} · ${usd(b.amount)} por operación</dd>
      <dt>Instrucciones</dt><dd>${esc(c.instructions || 'Ninguna: decide con su criterio')}</dd>
      <dt>Límites</dt><dd>Confianza mínima ${(c.minConfidence * 100).toFixed(0)} % · stop máx. ${c.maxStopPct} %</dd>
      ${b.qty > 0 ? `<dt>Stop / objetivo IA</dt><dd>${c.stop ? px(c.stop) : '—'} / ${c.target ? px(c.target) : '—'}</dd>` : ''}`;
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
  if (b.type === 'ai') {
    html += `<label>Temporalidad <select name="timeframe">${['15m', '1h', '4h', '1d'].map((t) => `<option${t === b.timeframe ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`
      + `<label>Confianza mínima <select name="minConfidence">${[0.5, 0.6, 0.7, 0.8].map((v) => `<option value="${v}"${v === b.config.minConfidence ? ' selected' : ''}>${v * 100} %</option>`).join('')}</select></label>`
      + field('Stop máximo %', 'maxStopPct', b.config.maxStopPct, 'type="number" step="any" min="0.2" max="30"')
      + `<label style="grid-column:1/-1">Instrucciones <textarea name="instructions" rows="2" maxlength="1000">${esc(b.config.instructions || '')}</textarea></label>`;
  }
  return `<form class="edit" data-edit-form="${b.id}">${html}
    <div class="btn-row"><button type="submit" class="primary">Guardar cambios</button><button type="button" data-bot-panel="${b.id}" data-panel="">Cancelar</button></div>
    <p class="error" style="grid-column:1/-1"></p></form>`;
}

const ACTION = { buy: 'Comprar', sell: 'Vender', hold: 'Mantener' };

// Razonamiento de cada decisión del agente IA: lo más educativo del bot.
async function aiLog(id) {
  const list = await api(`/bots/${id}/decisions`);
  const el = document.querySelector(`[data-ai-log="${id}"]`);
  if (!el) return;
  el.innerHTML = '<strong>Decisiones de la IA</strong>' + (list.length ? list.map((d) => `<div class="decision">
      <div class="top"><time>${date(d.created_at)}</time>
        <span class="pill ${d.action === 'hold' ? 'hold' : d.action}">${ACTION[d.action]}</span>
        a ${px(d.price)} · confianza <span class="conf"><span style="width:${d.confidence * 100}%"></span></span> ${(d.confidence * 100).toFixed(0)} %
        ${d.executed ? '<span class="tag">✔ ejecutada</span>' : ''}</div>
      <p>${esc(d.reasoning)}</p>
      ${d.factors.length ? `<div class="factors">${d.factors.map((f) => `<span class="tag">${esc(f)}</span>`).join('')}</div>` : ''}
      ${d.note ? `<p class="muted small">🛡️ ${esc(d.note)}</p>` : ''}
    </div>`).join('') : '<div class="muted">Todavía no hay decisiones: la IA decide al cierre de cada vela.</div>');
}

// Comparativa: ¿qué bot va mejor? (útil para ver si la IA supera a los algoritmos)
function renderBotCompare(bots) {
  if (bots.length < 2) { $('#bots-compare').innerHTML = ''; return; }
  const rows = bots.map((b) => {
    const ref = b.type === 'grid' ? b.config.investment : b.amount;
    const total = b.realized + b.unrealized;
    return { b, total, pctRef: ref ? (total / ref) * 100 : 0 };
  }).sort((x, y) => y.total - x.total);
  $('#bots-compare').innerHTML = `<table class="list compare"><thead><tr><th>Comparativa</th><th>Tipo</th><th class="r">G/P total</th><th class="r">% sobre lo invertido</th><th class="r">Operaciones</th></tr></thead><tbody>
    ${rows.map(({ b, total, pctRef }, i) => `<tr><td>${i === 0 ? '🥇 ' : ''}#${b.id} ${esc(b.name || b.strategyName)}</td><td>${TYPE_BADGE[b.type]}</td>
      <td class="r ${cls(total)}">${usd(total)}</td><td class="r ${cls(pctRef)}">${pct(pctRef)}</td><td class="r">${b.trade_count}</td></tr>`).join('')}
    </tbody></table>`;
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
              ${b.type === 'ai' ? `<button data-bot-panel="${b.id}" data-panel="ai">🧠 Decisiones</button>` : ''}
              <button data-bot-panel="${b.id}" data-panel="log">📜 Registro</button>
              <button class="danger" data-bot-del="${b.id}" data-qty="${b.qty}">Eliminar</button>
            </div>
          </div>
          <dl class="kv">${botDetails(b)}</dl>
          ${panel === 'edit' ? botEditForm(b) : ''}
          ${panel === 'log' ? `<div class="log" data-log="${b.id}">Cargando…</div>` : ''}
          ${panel === 'ai' ? `<div class="log" data-ai-log="${b.id}">Cargando…</div>` : ''}
        </div>`;
      }).join('')
    : '<p class="muted">No tienes bots. Crea uno a la izquierda, desde un backtest o desde el constructor de estrategias.</p>';
  for (const [id, p] of Object.entries(state.botPanels)) {
    if (p === 'log') botLog(id);
    if (p === 'ai') aiLog(id);
  }
  renderBotCompare(bots);
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
  for (const el of form.querySelectorAll('input, select, textarea')) {
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

// ---------- Calculadora de riesgo ----------
// Cantidad = (patrimonio × % de riesgo) ÷ (entrada − stop). Sólo para compras a mercado.
function updateCalc() {
  const box = $('#risk-calc');
  const usable = state.side === 'buy' && form.type.value === 'market';
  box.classList.toggle('hidden', !usable);
  if (!usable || !box.open || !state.me) {
    if (state.calc) { state.calc = null; drawChart(); }
    return;
  }
  const entry = execPrice();
  // Stop sugerido: 1,5 ATR por debajo del precio (fuera del "ruido" normal).
  if (!form.stop.value && entry && state.candles.length > 20) {
    const atr = Indicators.atr(state.candles, 14).at(-1);
    if (atr) form.stop.value = fmtAxis(entry - atr * 1.5);
  }
  const stop = Number(form.stop.value);
  const riskPct = Number(form.riskPct.value);
  const out = $('#calc-out');
  if (!(entry && stop > 0 && stop < entry && riskPct > 0)) {
    out.innerHTML = '<dt>El stop debe estar por debajo del precio de entrada</dt><dd></dd>';
    state.calc = null;
    drawChart();
    return;
  }
  const dist = entry - stop;
  let target = Number(form.target.value) || null;
  if (form.rr.value && document.activeElement !== form.target) {
    target = entry + dist * Number(form.rr.value);
    form.target.value = fmtAxis(target);
  }
  const riskUsd = (state.me.equity * riskPct) / 100;
  const fee = feeOf(state.symbol);
  const ideal = riskUsd / (dist + entry * fee * 2);
  // No se puede comprar más de lo que permite el efectivo: en ese caso el riesgo real es menor.
  const maxQty = Math.floor(((state.me.cash / (entry * (1 + fee))) * 0.999) * 1e8) / 1e8;
  const capped = ideal > maxQty;
  const qty = capped ? maxQty : ideal;
  const realRisk = qty * (dist + entry * fee * 2);
  const value = qty * entry;
  const rr = target ? (target - entry) / dist : null;
  state.calc = { qty, stop, target: target > entry ? target : null };
  out.innerHTML = `
    <dt>Pérdida máxima (stop)</dt><dd class="down">−${usd(realRisk)}</dd>
    ${capped ? `<dt class="muted">Riesgo que querías</dt><dd class="muted">−${usd(riskUsd)}</dd>` : ''}
    <dt>Cantidad</dt><dd>${num(qty, 6)} ${esc(base(state.symbol))}</dd>
    <dt>Valor de la posición</dt><dd>${usd(value)} (${((value / state.me.equity) * 100).toFixed(1)} %)</dd>
    <dt>Distancia al stop</dt><dd>${((dist / entry) * 100).toFixed(2)} %</dd>
    ${target ? `<dt>Ganancia si llega al objetivo</dt><dd class="up">+${usd(qty * (target - entry))}</dd><dt>Relación R:R</dt><dd>1:${rr.toFixed(2)}</dd>` : ''}
    ${capped ? '<dt class="warn-text">⚠️ Cantidad limitada por tu efectivo. El stop está muy cerca: aléjalo (p. ej. bajo un mínimo reciente) para arriesgar lo que querías.</dt><dd></dd>' : ''}`;
  drawChart();
}

$('#risk-calc').addEventListener('toggle', updateCalc);
for (const k of ['riskPct', 'stop', 'target', 'rr']) {
  form[k].addEventListener('input', () => {
    if (k === 'target') form.rr.value = '';
    updateCalc();
  });
}
$('#calc-apply').addEventListener('click', () => {
  if (!state.calc) return;
  form.qty.value = +state.calc.qty.toFixed(8);
  form.usd.value = +(state.calc.qty * execPrice()).toFixed(2);
  updatePreview(false);
});

// ---------- Diario de trading ----------
async function loadJournalMeta() {
  if (state.journalMeta) return;
  const j = await api('/journal');
  state.journalMeta = { setups: j.setups, emotions: j.emotions };
  const opts = (list) => '<option value="">—</option>' + list.map((x) => `<option>${esc(x)}</option>`).join('');
  form.jSetup.innerHTML = opts(j.setups);
  form.jEmotion.innerHTML = opts(j.emotions);
}

// Estadísticas agrupadas de operaciones cerradas (ventas con G/P realizada).
function groupStats(rows, keyFn) {
  const groups = {};
  for (const r of rows) {
    const k = keyFn(r) || 'Sin anotar';
    (groups[k] ||= []).push(r.realized);
  }
  return Object.entries(groups).map(([key, pnl]) => {
    const wins = pnl.filter((x) => x > 0);
    const loss = -pnl.filter((x) => x <= 0).reduce((a, b) => a + b, 0);
    const total = pnl.reduce((a, b) => a + b, 0);
    return { key, n: pnl.length, winRate: (wins.length / pnl.length) * 100, total, avg: total / pnl.length, pf: loss ? wins.reduce((a, b) => a + b, 0) / loss : wins.length ? Infinity : 0 };
  }).sort((a, b) => b.total - a.total);
}

function statsTable(el, rows) {
  $(el).innerHTML = `<thead><tr><th></th><th class="r">Ops.</th><th class="r">% ganadoras</th><th class="r">G/P total</th><th class="r">Media</th><th class="r">F. beneficio</th></tr></thead><tbody>` +
    (rows.length ? rows.map((r) => `<tr><td>${esc(r.key)}</td><td class="r">${r.n}</td><td class="r">${r.winRate.toFixed(0)} %</td>
      <td class="r ${cls(r.total)}">${usd(r.total)}</td><td class="r ${cls(r.avg)}">${usd(r.avg)}</td><td class="r">${r.pf === Infinity ? '∞' : r.pf.toFixed(2)}</td></tr>`).join('')
      : '<tr><td colspan="6" class="muted">Todavía no hay operaciones cerradas.</td></tr>') + '</tbody>';
}

async function loadJournal() {
  const j = await api('/journal');
  state.journal = j;
  // Las ventas heredan setup/emoción/hora de entrada de la última compra del mismo activo.
  const asc = [...j.trades].sort((a, b) => a.id - b.id);
  const lastBuy = {};
  const closed = [];
  for (const t of asc) {
    if (t.side === 'buy') {
      lastBuy[t.symbol] = { setup: t.setup || (t.bot_id ? `Bot #${t.bot_id}` : null), emotion: t.emotion, at: t.created_at };
      continue;
    }
    const b = lastBuy[t.symbol] || {};
    closed.push({ ...t, setup: t.setup || b.setup || (t.bot_id ? `Bot #${t.bot_id}` : null), emotion: t.emotion || b.emotion, entryAt: b.at || t.created_at });
  }
  const all = groupStats(closed, () => 'Total')[0];
  const wins = closed.filter((t) => t.realized > 0), losses = closed.filter((t) => t.realized <= 0);
  const avgWin = wins.length ? wins.reduce((a, t) => a + t.realized, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, t) => a + t.realized, 0) / losses.length : 0;
  const noted = j.trades.filter((t) => t.setup || t.notes || t.emotion).length;
  const tile = (label, value, c = '') => `<div class="metric"><span>${label}</span><strong class="${c}">${value}</strong></div>`;
  $('#j-metrics').innerHTML = [
    tile('Operaciones cerradas', closed.length),
    tile('% ganadoras', all ? `${all.winRate.toFixed(0)} %` : '—'),
    tile('G/P realizada', all ? usd(all.total) : '—', cls(all?.total)),
    tile('Ganancia media', wins.length ? usd(avgWin) : '—', 'up'),
    tile('Pérdida media', losses.length ? usd(avgLoss) : '—', 'down'),
    tile('Esperanza por operación', all ? usd(all.avg) : '—', cls(all?.avg)),
    tile('Operaciones anotadas', `${noted} / ${j.trades.length}`),
  ].join('');

  const bySetup = groupStats(closed, (t) => t.setup);
  const byEmotion = groupStats(closed, (t) => t.emotion);
  const bySymbol = groupStats(closed, (t) => t.symbol);
  const byTime = groupStats(closed, (t) => {
    const ts = Date.parse(t.entryAt.replace(' ', 'T') + 'Z');
    return Indicators.KILLZONES.find((k) => Indicators.inKillzone(ts, [k.id]))?.name || 'Fuera de kill zones';
  });
  statsTable('#j-by-setup', bySetup);
  statsTable('#j-by-emotion', byEmotion);
  statsTable('#j-by-symbol', bySymbol);
  statsTable('#j-by-time', byTime);

  // Conclusiones automáticas.
  const tips = [];
  const known = (rows) => rows.filter((r) => r.key !== 'Sin anotar' && r.n >= 2);
  const bestSetup = known(bySetup)[0];
  const worstSetup = known(bySetup).at(-1);
  if (bestSetup && bestSetup.total > 0) tips.push(`✅ Tu mejor setup es <strong>${esc(bestSetup.key)}</strong>: ${bestSetup.n} operaciones, ${bestSetup.winRate.toFixed(0)} % ganadoras y ${usd(bestSetup.total)} en total.`);
  if (worstSetup && worstSetup.total < 0 && worstSetup !== bestSetup) tips.push(`⚠️ El setup <strong>${esc(worstSetup.key)}</strong> te está costando dinero (${usd(worstSetup.total)}). ¿Deberías dejar de usarlo o revisarlo?`);
  const badEmotion = known(byEmotion).filter((r) => r.total < 0).sort((a, b) => a.total - b.total)[0];
  if (badEmotion) tips.push(`🧠 Cuando operas sintiéndote <strong>${esc(badEmotion.key)}</strong> pierdes de media ${usd(badEmotion.avg)} por operación.`);
  if (wins.length && losses.length && Math.abs(avgLoss) > avgWin) tips.push(`📉 Tu pérdida media (${usd(avgLoss)}) es mayor que tu ganancia media (${usd(avgWin)}): revisa si mueves los stops o cierras las ganancias demasiado pronto.`);
  if (j.trades.length >= 3 && noted / j.trades.length < 0.5) tips.push('📓 Anotas menos de la mitad de tus operaciones. Cuantas más anotes, más útiles serán estas estadísticas.');
  if (!closed.length) tips.push('Cierra algunas operaciones (vende) para empezar a ver estadísticas. Añade una nota al abrirlas desde el panel Operar.');
  $('#j-insights').innerHTML = tips.map((t) => `<p>${t}</p>`).join('');
  renderJournalList();
}

function renderJournalList() {
  const only = $('#j-only-empty').checked;
  const rows = state.journal.trades.filter((t) => !only || !(t.setup || t.notes || t.emotion));
  const stars = (n) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '');
  $('#j-list').innerHTML = rows.length
    ? rows.map((t) => `<div class="jrow" data-j="${t.id}">
        <div class="head">
          <span class="muted">${date(t.created_at)}</span>
          <span class="pill ${t.side}">${t.side === 'buy' ? 'Compra' : 'Venta'}</span>
          <strong>${esc(t.symbol)}</strong> ${num(t.qty)} a ${px(t.price)}
          ${t.side === 'sell' ? `<span class="${cls(t.realized)}">${usd(t.realized)}</span>` : ''}
          ${t.bot_id ? `<span class="tag">🤖 Bot #${t.bot_id}</span>` : ''}
          <span class="tags">${t.setup ? `<span class="tag">${esc(t.setup)}</span>` : ''}${t.emotion ? `<span class="tag">${esc(t.emotion)}</span>` : ''}</span>
          <span class="stars">${stars(t.rating)}</span>
          <button class="link" data-j-edit="${t.id}">${t.setup || t.notes || t.emotion ? '✏️ Editar' : '📝 Anotar'}</button>
          <button class="link" data-j-ai="${t.id}">✨ Revisar con IA</button>
        </div>
        ${t.notes ? `<div class="note">${esc(t.notes)}</div>` : ''}
        ${t.lesson ? `<div class="note">💡 ${esc(t.lesson)}</div>` : ''}
      </div>`).join('')
    : '<p class="muted">No hay operaciones.</p>';
}

$('#j-only-empty').addEventListener('change', renderJournalList);
$('#j-list').addEventListener('click', (e) => {
  const id = e.target.dataset.jEdit;
  if (!id) return;
  const t = state.journal.trades.find((x) => x.id === Number(id));
  const row = e.target.closest('.jrow');
  if (row.querySelector('form')) return;
  const opts = (list, v) => '<option value="">—</option>' + list.map((x) => `<option${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('');
  row.insertAdjacentHTML('beforeend', `<form data-j-form="${id}">
    <label>Setup <select name="setup">${opts(state.journal.setups, t.setup)}</select></label>
    <label>Emoción <select name="emotion">${opts(state.journal.emotions, t.emotion)}</select></label>
    <label>Valoración de la ejecución <select name="rating"><option value="">—</option>${[5, 4, 3, 2, 1].map((n) => `<option value="${n}"${t.rating === n ? ' selected' : ''}>${'★'.repeat(n)}</option>`).join('')}</select></label>
    <label class="wide">¿Por qué entraste o saliste? <textarea name="notes" rows="2" maxlength="2000">${esc(t.notes || '')}</textarea></label>
    <label class="wide">¿Qué aprendiste? <textarea name="lesson" rows="2" maxlength="1000">${esc(t.lesson || '')}</textarea></label>
    <div class="btn-row wide"><button type="submit" class="primary">Guardar</button><button type="button" data-j-cancel>Cancelar</button></div>
  </form>`);
});
$('#j-list').addEventListener('click', (e) => {
  if (e.target.dataset.jCancel !== undefined) e.target.closest('form').remove();
});
$('#j-list').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/journal/' + f.dataset.jForm, {
      method: 'PUT',
      body: { setup: f.setup.value, emotion: f.emotion.value, rating: Number(f.rating.value) || null, notes: f.notes.value, lesson: f.lesson.value },
    });
    toast('Nota guardada en el diario');
    loadJournal();
  } catch (err) {
    toast(err.message);
  }
});

// ---------- Modo Replay ----------
const TF_MS = { '5m': 300e3, '15m': 900e3, '1h': 3600e3, '4h': 14400e3, '1d': 86400e3 };
const WARMUP = 150; // velas previas visibles al empezar (para los indicadores)
const rpChart = new Charts.CandleChart($('#rp-chart'));
state.rp = null;

function toLocalInput(ts) {
  const d = new Date(ts);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

$$('[data-rp-date]').forEach((b) => b.addEventListener('click', () => {
  $('#rp-form').start.value = b.dataset.rpDate;
  $('#rp-form').symbol.value = 'BTC/USD';
}));
$('#rp-random').addEventListener('click', () => {
  const from = Date.UTC(2020, 0, 1), to = Date.now() - 45 * 86400e3;
  $('#rp-form').start.value = toLocalInput(from + Math.random() * (to - from));
  $('#rp-form').blind.checked = true;
  toast('Fecha aleatoria elegida y oculta: ¡no hagas trampa!');
});

$('#rp-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('#rp-error').textContent = '';
  if (state.rp && !state.rp.ended && state.rp.trades.length && !confirm('Hay una sesión en curso. ¿Empezar otra sin guardarla?')) return;
  const tf = f.timeframe.value;
  const start = f.start.value ? new Date(f.start.value).getTime() : NaN;
  if (!Number.isFinite(start)) { $('#rp-error').textContent = 'Elige una fecha de inicio'; return; }
  const count = Math.min(Math.max(Number(f.count.value) || 400, 50), 1500);
  if (start + count * TF_MS[tf] > Date.now()) { $('#rp-error').textContent = 'La fecha es demasiado reciente para jugar tantas velas'; return; }
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Cargando histórico…';
  try {
    const h = await api(`/history?symbol=${encodeURIComponent(f.symbol.value)}&timeframe=${tf}&since=${start - WARMUP * TF_MS[tf]}&limit=${WARMUP + count}`);
    const candles = h.candles;
    const startIdx = Math.max(20, candles.findIndex((c) => c[0] >= start));
    stopReplay();
    state.rp = {
      symbol: f.symbol.value, tf, candles, idx: startIdx, startIdx, source: h.source, blind: f.blind.checked,
      initial: state.config.initialCash, cash: state.config.initialCash, qty: 0, entry: null, entryIdx: null, entryFee: 0,
      sl: null, tp: null, trades: [], equity: [state.config.initialCash], peak: state.config.initialCash, maxDD: 0, ended: false,
    };
    $('#rp-trade').classList.remove('hidden');
    $('#rp-summary').classList.add('hidden');
    for (const id of ['#rp-play', '#rp-step', '#rp-step10', '#rp-end']) $(id).disabled = false;
    const simulated = h.source === 'Simulado';
    $('#rp-source').textContent = simulated ? '⚠️ Datos simulados (no hay histórico real para esa fecha)' : `Histórico real · ${h.source}`;
    $('#rp-source').className = 'badge ' + (simulated ? 'sim' : 'live');
    renderReplay();
  } catch (err) {
    $('#rp-error').textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = '▶ Empezar sesión';
  }
});

function rpFee() {
  return feeOf(state.rp.symbol);
}

function rpEquity() {
  const r = state.rp;
  return r.cash + r.qty * r.candles[r.idx][4];
}

function rpClose(price, reason) {
  const r = state.rp;
  const gross = r.qty * price;
  const fee = gross * rpFee();
  r.cash += gross - fee;
  const cost = r.qty * r.entry + r.entryFee;
  const pnl = gross - fee - cost;
  r.trades.push({ entryIdx: r.entryIdx, exitIdx: r.idx, entry: r.entry, exit: price, qty: r.qty, pnl, pct: (pnl / cost) * 100, reason });
  r.qty = 0; r.entry = null; r.entryIdx = null; r.sl = null; r.tp = null;
  $('#rp-sl').value = ''; $('#rp-tp').value = '';
}

// Avanza una vela: revisa stop / objetivo con el mínimo y máximo de la nueva vela.
function rpStep() {
  const r = state.rp;
  if (!r || r.ended) return;
  if (r.idx >= r.candles.length - 1) { endReplay(); return; }
  r.idx++;
  const [, open, high, low] = r.candles[r.idx];
  if (r.qty > 0) {
    if (r.sl && low <= r.sl) rpClose(Math.min(open, r.sl), 'Stop-loss');
    else if (r.tp && high >= r.tp) rpClose(Math.max(open, r.tp), 'Objetivo');
  }
  const eq = rpEquity();
  r.equity.push(eq);
  r.peak = Math.max(r.peak, eq);
  r.maxDD = Math.max(r.maxDD, (r.peak - eq) / r.peak);
}

function renderReplay() {
  const r = state.rp;
  if (!r) return;
  const c = r.candles.slice(0, r.idx + 1);
  const last = c[c.length - 1];
  const hlines = [];
  if (r.qty > 0) {
    hlines.push({ price: r.entry, color: '#f5a524', label: 'Entrada' });
    if (r.sl) hlines.push({ price: r.sl, color: '#f0525c', label: 'Stop' });
    if (r.tp) hlines.push({ price: r.tp, color: '#1fbf75', label: 'Objetivo' });
  }
  hlines.push({ price: last[4], color: '#4f8cff' });
  const markers = [];
  for (const t of r.trades) markers.push({ i: t.entryIdx, side: 'buy' }, { i: t.exitIdx, side: 'sell' });
  if (r.qty > 0) markers.push({ i: r.entryIdx, side: 'buy' });
  const hide = r.blind && !r.ended;
  rpChart.set({ candles: c, hlines, markers, timeframe: r.tf, visible: 120, hideTime: hide, ...indicatorLayers(c, r.tf) });
  $('#rp-title').textContent = hide ? `${r.symbol} · ${r.tf} · fecha oculta` : `${r.symbol} · ${r.tf}`;
  $('#rp-price').textContent = px(last[4]);
  $('#rp-date').textContent = hide ? '' : new Date(last[0]).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
  const played = r.idx - r.startIdx, total = r.candles.length - 1 - r.startIdx;
  $('#rp-bar').style.width = `${(played / Math.max(total, 1)) * 100}%`;
  const eq = rpEquity();
  const unreal = r.qty > 0 ? r.qty * (last[4] - r.entry) : 0;
  $('#rp-account').innerHTML = `
    <dt>Vela</dt><dd>${played} / ${total}</dd>
    <dt>Patrimonio</dt><dd class="${cls(eq - r.initial)}">${usd(eq)} (${pct(((eq - r.initial) / r.initial) * 100)})</dd>
    <dt>Efectivo</dt><dd>${usd(r.cash)}</dd>
    <dt>Posición</dt><dd>${r.qty > 0 ? `${num(r.qty, 6)} a ${px(r.entry)}` : 'Sin posición'}</dd>
    ${r.qty > 0 ? `<dt>G/P abierta</dt><dd class="${cls(unreal)}">${usd(unreal)}</dd>` : ''}`;
  $('#rp-buy').disabled = r.ended || r.qty > 0;
  $('#rp-sell').disabled = r.ended || r.qty === 0;
  $('#rp-trades tbody').innerHTML = r.trades.length
    ? r.trades.map((t, i) => {
        const d = (k) => (hide ? `vela ${k - r.startIdx}` : new Date(r.candles[k][0]).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }));
        return `<tr><td>${i + 1}</td><td>${d(t.entryIdx)}</td><td>${d(t.exitIdx)}</td><td class="r">${px(t.entry)}</td><td class="r">${px(t.exit)}</td>
          <td>${esc(t.reason)}</td><td class="r ${cls(t.pnl)}">${usd(t.pnl)} (${pct(t.pct)})</td></tr>`;
      }).join('')
    : '<tr><td colspan="7" class="muted">Aún no has operado en esta sesión.</td></tr>';
}

function stopReplay() {
  clearInterval(state.rpTimer);
  state.rpTimer = null;
  $('#rp-play').textContent = '▶';
}

$('#rp-play').addEventListener('click', () => {
  if (state.rpTimer) return stopReplay();
  $('#rp-play').textContent = '⏸';
  state.rpTimer = setInterval(() => {
    if (!state.rp || state.rp.ended || state.view !== 'replay') return stopReplay();
    rpStep();
    renderReplay();
  }, 1000 / Number($('#rp-speed').value));
});
$('#rp-speed').addEventListener('change', () => {
  if (state.rpTimer) { stopReplay(); $('#rp-play').click(); }
});
$('#rp-step').addEventListener('click', () => { rpStep(); renderReplay(); });
$('#rp-step10').addEventListener('click', () => { for (let i = 0; i < 10; i++) rpStep(); renderReplay(); });
document.addEventListener('keydown', (e) => {
  if (state.view !== 'replay' || !state.rp || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); rpStep(); renderReplay(); }
  if (e.key === ' ') { e.preventDefault(); $('#rp-play').click(); }
});

$$('[data-rp-pct]').forEach((b) => b.addEventListener('click', () => {
  if (!state.rp) return;
  $('#rp-usd').value = Math.floor((state.rp.cash * Number(b.dataset.rpPct)) / 100 / (1 + rpFee()));
}));

$('#rp-buy').addEventListener('click', () => {
  const r = state.rp;
  $('#rp-trade-error').textContent = '';
  if (!r || r.ended || r.qty > 0) return;
  const price = r.candles[r.idx][4];
  const usdAmt = Math.min(Number($('#rp-usd').value), r.cash / (1 + rpFee()));
  const sl = Number($('#rp-sl').value) || null, tp = Number($('#rp-tp').value) || null;
  if (!(usdAmt >= 1)) { $('#rp-trade-error').textContent = 'Monto inválido'; return; }
  if (sl && sl >= price) { $('#rp-trade-error').textContent = 'El stop debe estar por debajo del precio actual'; return; }
  if (tp && tp <= price) { $('#rp-trade-error').textContent = 'El objetivo debe estar por encima del precio actual'; return; }
  r.qty = usdAmt / price;
  r.entryFee = usdAmt * rpFee();
  r.cash -= usdAmt + r.entryFee;
  r.entry = price; r.entryIdx = r.idx; r.sl = sl; r.tp = tp;
  renderReplay();
});
$('#rp-sell').addEventListener('click', () => {
  const r = state.rp;
  if (!r || r.qty === 0) return;
  rpClose(r.candles[r.idx][4], 'Manual');
  renderReplay();
});
for (const [id, key] of [['#rp-sl', 'sl'], ['#rp-tp', 'tp']]) {
  $(id).addEventListener('input', () => {
    if (state.rp?.qty > 0) { state.rp[key] = Number($(id).value) || null; renderReplay(); }
  });
}

async function endReplay() {
  const r = state.rp;
  if (!r || r.ended) return;
  stopReplay();
  if (r.qty > 0) rpClose(r.candles[r.idx][4], 'Fin de la sesión');
  r.ended = true;
  for (const id of ['#rp-play', '#rp-step', '#rp-step10', '#rp-end']) $(id).disabled = true;
  const final = r.cash;
  const wins = r.trades.filter((t) => t.pnl > 0);
  const start = r.candles[r.startIdx], end = r.candles[r.idx];
  const bh = ((end[4] - start[4]) / start[4]) * 100;
  const ret = ((final - r.initial) / r.initial) * 100;
  const tile = (label, value, c = '') => `<div class="metric"><span>${label}</span><strong class="${c}">${value}</strong></div>`;
  $('#rp-metrics').innerHTML = [
    tile('Tu resultado', pct(ret), cls(ret)),
    tile('Comprar y mantener', pct(bh), cls(bh)),
    tile('Operaciones', r.trades.length),
    tile('% ganadoras', r.trades.length ? `${((wins.length / r.trades.length) * 100).toFixed(0)} %` : '—'),
    tile('Máxima caída', `-${(r.maxDD * 100).toFixed(2)} %`, r.maxDD ? 'down' : ''),
    tile('Mejor / peor', r.trades.length ? `${pct(Math.max(...r.trades.map((t) => t.pct)))} / ${pct(Math.min(...r.trades.map((t) => t.pct)))}` : '—'),
  ].join('');
  $('#rp-verdict').textContent = `${r.symbol} ${r.tf} del ${new Date(start[0]).toLocaleString('es')} al ${new Date(end[0]).toLocaleString('es')}. ` +
    (r.trades.length === 0 ? 'No operaste: a veces no operar también es una decisión, pero para practicar ¡lánzate!'
      : ret > bh ? '¡Superaste a comprar y mantener!' : 'Comprar y mantener habría dado más: revisa tus entradas y salidas.');
  $('#rp-summary').classList.remove('hidden');
  renderReplay();
  try {
    await api('/replay-sessions', {
      method: 'POST',
      body: {
        symbol: r.symbol, timeframe: r.tf, start_ts: start[0], end_ts: end[0], initial: r.initial, final,
        trades: r.trades.length, win_rate: r.trades.length ? (wins.length / r.trades.length) * 100 : 0, max_dd: r.maxDD * 100,
        data: r.trades.map((t) => ({ ...t, entryTime: r.candles[t.entryIdx][0], exitTime: r.candles[t.exitIdx][0] })),
      },
    });
    toast('Sesión guardada');
    loadReplaySessions();
  } catch (err) {
    toast('No se pudo guardar la sesión: ' + err.message);
  }
}
$('#rp-end').addEventListener('click', () => {
  if (confirm('¿Terminar la sesión? Se cerrará la posición abierta y se guardará el resultado.')) endReplay();
});

async function loadReplaySessions() {
  const list = await api('/replay-sessions');
  $('#rp-sessions').innerHTML = list.length
    ? list.map((s) => {
        const ret = ((s.final - s.initial) / s.initial) * 100;
        return `<div class="sess"><strong>${esc(s.symbol)}</strong> ${esc(s.timeframe)} · <span class="${cls(ret)}">${pct(ret)}</span>
          <div class="muted small">${new Date(s.start_ts).toLocaleDateString('es')} → ${new Date(s.end_ts).toLocaleDateString('es')} · ${s.trades} ops · ${s.win_rate.toFixed(0)} % ganadoras · caída máx. ${s.max_dd.toFixed(1)} %</div></div>`;
      }).join('')
    : '<p class="muted small">Todavía no has completado ninguna sesión.</p>';
}

// ---------- Academia ----------
async function loadAcademy() {
  state.ac = await api('/academy');
  const pctDone = Math.round((state.ac.completed / state.ac.total) * 100);
  $('#academy-pct').textContent = pctDone ? `${pctDone} %` : '';
  if (state.view === 'academy') renderAcademy();
}

const level = (xp) => Math.floor(xp / 300) + 1;

function renderAcademy() {
  const ac = state.ac;
  if (!ac) return;
  const pctDone = (ac.completed / ac.total) * 100;
  $('#ac-bar').style.width = pctDone + '%';
  $('#ac-xp').textContent = `Nivel ${level(ac.xp)} · ${ac.xp} XP`;
  $('#ac-summary').textContent = `${ac.completed} de ${ac.total} lecciones completadas (${pctDone.toFixed(0)} %) · ${ac.badges.length} de ${Courses.BADGES.length} insignias`;
  $('#ac-badges').innerHTML = Courses.BADGES.map((b) => `<div class="badge-item${ac.badges.includes(b.id) ? ' on' : ''}" title="${esc(b.desc)}"><span class="ic">${b.icon}</span><span><strong>${esc(b.name)}</strong><br><span class="muted">${esc(b.desc)}</span></span></div>`).join('');
  $('#ac-modules').innerHTML = Courses.MODULES.map((m) => {
    const done = m.lessons.filter((l) => ac.lessons[l.id]).length;
    return `<div class="card module"><h3>${m.icon} ${esc(m.title)}</h3><p class="muted small">${esc(m.intro)}</p>
      <div class="bar"><div style="width:${(done / m.lessons.length) * 100}%"></div></div>
      ${m.lessons.map((l) => {
        const ok = !!ac.lessons[l.id];
        const taskPending = !ok && l.task && !ac.checks[l.task.id];
        return `<div class="lesson-link${ok ? ' done' : ''}" data-lesson="${l.id}"><span>${esc(l.title)}</span>
          <span class="st">${ok ? '✅ Completada' : taskPending ? '🛠️ Tarea pendiente' : '○'}</span></div>`;
      }).join('')}</div>`;
  }).join('');
}

function openLesson(id) {
  const l = Courses.LESSONS.find((x) => x.id === id);
  const ac = state.ac;
  const idx = Courses.LESSONS.indexOf(l);
  const next = Courses.LESSONS[idx + 1];
  const done = !!ac.lessons[id];
  const taskOk = l.task && ac.checks[l.task.id];
  $('#ac-modules').classList.add('hidden');
  const el = $('#ac-lesson');
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="chart-head"><button type="button" data-ac-back>← Volver a la Academia</button><span class="muted small">Lección ${idx + 1} de ${Courses.LESSONS.length}</span></div>
    <h2 class="mt">${esc(l.title)} ${done ? '✅' : ''}</h2>
    <div class="body">${l.body}</div>
    ${l.action ? `<button type="button" data-goto="${l.action.view}">${esc(l.action.label)} →</button>` : ''}
    ${l.task ? `<div class="task${taskOk ? ' ok' : ''}"><strong>🛠️ Tarea práctica</strong><p>${esc(l.task.text)}</p>
      <p class="small">${taskOk ? '✅ ¡Hecha!' : '⏳ Todavía no se ha detectado.'} <button type="button" class="link" data-ac-recheck="${id}">Comprobar de nuevo</button></p></div>` : ''}
    <form class="quiz" data-quiz="${id}"><h3>📝 Quiz</h3>
      ${l.quiz.map((q, i) => `<div class="q">${i + 1}. ${esc(q.q)}</div>
        ${q.options.map((o, k) => `<label class="opt"><input type="radio" name="q${i}" value="${k}" required> ${esc(o)}</label>`).join('')}
        <div class="explain hidden" data-explain="${i}"></div>`).join('')}
      <button type="submit" class="primary" style="width:auto;margin-top:12px">Enviar respuestas</button>
    </form>
    <div id="ac-result"></div>
    ${next ? `<button type="button" data-lesson="${next.id}">Siguiente: ${esc(next.title)} →</button>` : ''}`;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeLesson() {
  $('#ac-lesson').classList.add('hidden');
  $('#ac-modules').classList.remove('hidden');
  renderAcademy();
}

$('#view-academy').addEventListener('click', async (e) => {
  const t = e.target;
  const lesson = t.closest('[data-lesson]');
  if (lesson) return openLesson(lesson.dataset.lesson);
  if (t.dataset.acBack !== undefined) return closeLesson();
  if (t.dataset.goto) return showView(t.dataset.goto);
  if (t.dataset.acRecheck) {
    await loadAcademy();
    openLesson(t.dataset.acRecheck);
  }
});

$('#view-academy').addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-quiz]');
  if (!f) return;
  e.preventDefault();
  const id = f.dataset.quiz;
  const l = Courses.LESSONS.find((x) => x.id === id);
  const answers = l.quiz.map((_, i) => Number(f.querySelector(`input[name=q${i}]:checked`)?.value));
  try {
    const r = await api(`/academy/lessons/${id}`, { method: 'POST', body: { answers } });
    r.results.forEach((res, i) => {
      f.querySelectorAll(`input[name=q${i}]`).forEach((inp) => {
        const lab = inp.closest('label');
        lab.classList.toggle('right', Number(inp.value) === res.answer);
        lab.classList.toggle('wrong', inp.checked && !res.correct);
      });
      const ex = f.querySelector(`[data-explain="${i}"]`);
      ex.textContent = (res.correct ? '✔ ' : '✘ ') + res.explain;
      ex.classList.remove('hidden');
    });
    const score = `${Math.round(r.score * l.quiz.length)}/${l.quiz.length}`;
    $('#ac-result').innerHTML = `<div class="result">${r.completed ? `🎉 <strong>¡Lección completada!</strong> Quiz ${score}. +100 XP`
      : r.passed ? `✅ Quiz aprobado (${score}). Te falta la <strong>tarea práctica</strong>: hazla y vuelve a enviar el quiz.`
      : `📚 ${score}: necesitas al menos ${Math.ceil(Courses.PASS * l.quiz.length)} aciertos. Repasa la lección y vuelve a intentarlo.`}</div>`;
    const before = state.ac.badges.length;
    state.ac = r.progress;
    $('#academy-pct').textContent = `${Math.round((r.progress.completed / r.progress.total) * 100)} %`;
    renderAcademy();
    const newBadges = r.progress.badges.slice(before);
    if (newBadges.length) toast('🏅 ¡Nueva insignia! ' + newBadges.map((b) => Courses.BADGES.find((x) => x.id === b)?.name).join(', '));
  } catch (err) {
    $('#ac-result').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
});

// ---------- IA: estado, análisis del gráfico y revisión de operaciones ----------
function md(text) {
  // Markdown mínimo y seguro: se escapa todo y sólo se interpretan títulos, listas y negritas.
  const lines = esc(text).split('\n');
  let html = '', list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    let m;
    if ((m = line.match(/^#{1,4}\s+(.*)/))) { close(); html += `<h4>${m[1]}</h4>`; }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${m[1]}</li>`; }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${m[1]}</li>`; }
    else if (line.trim()) { close(); html += `<p>${line}</p>`; }
  }
  close();
  return html;
}

async function loadAiInfo() {
  try { state.ai = await api('/ai'); } catch { state.ai = { enabled: false }; }
  const a = state.ai;
  $('#ai-usage').textContent = a.enabled ? `Consultas a la IA hoy: ${a.usedToday} de ${a.dailyLimit} · modelo ${a.model}. Cada vela cerrada de un bot IA es una consulta.` : '';
  $('#ai-analyze').title = a.enabled ? 'Pide a la IA un análisis educativo de este gráfico' : 'La IA no está configurada en este servidor (falta ANTHROPIC_API_KEY)';
}

const AI_OFF_MSG = 'La IA no está configurada en este servidor: quien lo administre debe definir ANTHROPIC_API_KEY.';

$('#ai-analyze').addEventListener('click', async () => {
  const box = $('#ai-analysis');
  box.classList.remove('hidden');
  if (!state.ai?.enabled) { box.innerHTML = `<p>${esc(AI_OFF_MSG)}</p>`; return; }
  const btn = $('#ai-analyze');
  btn.disabled = true;
  box.innerHTML = `<div class="ai-head">✨ Analizando ${esc(state.symbol)} (${state.timeframe})…</div>`;
  try {
    const r = await api('/ai/analyze', { method: 'POST', body: { symbol: state.symbol, timeframe: state.timeframe } });
    box.innerHTML = `<div class="ai-head"><span>✨ Análisis de ${esc(state.symbol)} · ${state.timeframe} · ${esc(r.model)}</span><button type="button" class="link" id="ai-close">Cerrar</button></div>${md(r.text)}
      <p class="muted small">La IA puede equivocarse. Úsalo para aprender a leer el gráfico, no como consejo de inversión.</p>`;
    $('#ai-close').addEventListener('click', () => box.classList.add('hidden'));
  } catch (err) {
    box.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
    loadAiInfo();
  }
});

$('#j-list').addEventListener('click', async (e) => {
  const id = e.target.dataset.jAi;
  if (!id) return;
  const row = e.target.closest('.jrow');
  let box = row.querySelector('.ai-box');
  if (!box) { row.insertAdjacentHTML('beforeend', '<div class="ai-box"></div>'); box = row.querySelector('.ai-box'); }
  if (!state.ai?.enabled) { box.innerHTML = `<p>${esc(AI_OFF_MSG)}</p>`; return; }
  box.innerHTML = '<div class="ai-head">✨ Revisando la operación…</div>';
  try {
    const r = await api('/ai/review/' + id, { method: 'POST' });
    box.innerHTML = `<div class="ai-head">✨ Revisión de tu mentor IA · ${esc(r.model)}</div>${md(r.text)}`;
  } catch (err) {
    box.innerHTML = `<p class="error">${esc(err.message)}</p>`;
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
  await Promise.all([loadTickers(), loadMe(), loadStrategies(), loadJournalMeta(), loadAcademy(), loadAiInfo()]);
  $('#rp-form').symbol.innerHTML = state.config.symbols.map((x) => `<option>${esc(x)}</option>`).join('');
  if (!$('#rp-form').start.value) $('#rp-form').start.value = '2022-11-05T00:00';
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

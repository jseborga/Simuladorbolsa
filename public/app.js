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
const px = (n) => (n == null || isNaN(n) ? '—' : n.toLocaleString('es', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1 ? 6 : 2 }));
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
  if (v === 'bots') loadBots();
}

// ---------- Datos ----------
async function loadConfig() {
  state.config = await api('/config');
  const live = state.config.mode === 'live';
  const b = $('#source-badge');
  b.textContent = live ? `● En vivo · ${state.config.exchange}` : '● Mercado simulado';
  b.className = 'badge ' + (live ? 'live' : 'sim');
  $('#fee-text').textContent = `${(state.config.feeRate * 100).toFixed(2)} % del importe`;
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

async function loadCandles() {
  try {
    state.candles = await api(`/ohlcv?symbol=${encodeURIComponent(state.symbol)}&timeframe=${state.timeframe}&limit=300`);
  } catch (e) {
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
  const rows = state.config.symbols
    .map((s) => {
      const t = state.tickers[s];
      if (!t) return '';
      return `<tr data-symbol="${esc(s)}" class="${s === state.symbol ? 'sel' : ''}">
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
  updatePreview();
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
state.lines = store.get('lines', {}); // símbolo -> [precios]

const mainChart = new Charts.CandleChart($('#chart'), {
  onPriceClick(price) {
    (state.lines[state.symbol] ||= []).push(price);
    store.set('lines', state.lines);
    mainChart.drawMode = false;
    $('#tool-line').classList.remove('active');
    drawChart();
  },
});

$$('[data-ind]').forEach((cb) => {
  cb.checked = !!state.indicators[cb.dataset.ind];
  cb.addEventListener('change', () => {
    state.indicators[cb.dataset.ind] = cb.checked;
    store.set('indicators', state.indicators);
    drawChart();
  });
});

$('#tool-line').addEventListener('click', () => {
  mainChart.drawMode = !mainChart.drawMode;
  $('#tool-line').classList.toggle('active', mainChart.drawMode);
  if (mainChart.drawMode) toast('Haz clic en el gráfico al precio donde quieras la línea');
  drawChart();
});
$('#tool-clear').addEventListener('click', () => {
  delete state.lines[state.symbol];
  store.set('lines', state.lines);
  drawChart();
});

function drawChart() {
  const c = state.candles;
  const cl = c.map((x) => x[4]);
  const ind = state.indicators;
  const overlays = [];
  if (ind.sma20) overlays.push({ label: 'SMA 20', values: Indicators.sma(cl, 20), color: '#f5a524' });
  if (ind.sma50) overlays.push({ label: 'SMA 50', values: Indicators.sma(cl, 50), color: '#b17cff' });
  if (ind.ema20) overlays.push({ label: 'EMA 20', values: Indicators.ema(cl, 20), color: '#22c3e6' });
  if (ind.ema200) overlays.push({ label: 'EMA 200', values: Indicators.ema(cl, 200), color: '#ff7eb6' });
  let band = null;
  if (ind.bb) {
    band = Indicators.bollinger(cl, 20, 2);
    overlays.push({ label: 'BB sup', values: band.upper, color: '#4f8cff99' }, { label: 'BB inf', values: band.lower, color: '#4f8cff99' });
  }
  const holding = state.me?.holdings.find((h) => h.symbol === state.symbol);
  const hlines = (state.lines[state.symbol] || []).map((p) => ({ price: p, color: '#8b98a8', label: fmtAxis(p), solid: true }));
  if (holding) hlines.push({ price: holding.avg_price, color: '#f5a524', label: 'Tu media' });
  hlines.push({ price: state.tickers[state.symbol]?.last, color: '#4f8cff' });
  mainChart.set({
    candles: c, overlays, band, hlines, timeframe: state.timeframe, visible: 150,
    panels: ['volume', 'rsi', 'macd'].filter((k) => ind[k]),
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
      const spend = (state.me.cash * f) / (1 + state.config.feeRate);
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
  const fee = notional * state.config.feeRate;
  const h = state.me?.holdings.find((x) => x.symbol === state.symbol);
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

// ---------- Estrategias (compartidas por backtesting y bots) ----------
async function loadStrategies() {
  if (state.strategies) return;
  state.strategies = await api('/strategies');
  for (const f of [$('#bt-form'), $('#bot-form')]) {
    f.symbol.innerHTML = state.config.symbols.map((x) => `<option>${esc(x)}</option>`).join('');
    f.strategy.innerHTML = state.strategies.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  }
  renderParams('bt');
  renderParams('bot');
}

function renderParams(prefix, values = {}) {
  const f = $(`#${prefix}-form`);
  const st = state.strategies.find((x) => x.id === f.strategy.value);
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

$('#bt-form').strategy.addEventListener('change', () => renderParams('bt'));
$('#bot-form').strategy.addEventListener('change', () => renderParams('bot'));

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
        strategy: f.strategy.value, params: readParams('bt'),
        stopLoss: Number(f.stopLoss.value), takeProfit: Number(f.takeProfit.value), positionPct: Number(f.positionPct.value),
      },
    });
    state.bt.request = { symbol: f.symbol.value, timeframe: f.timeframe.value, stopLoss: f.stopLoss.value, takeProfit: f.takeProfit.value };
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
  f.symbol.value = r.request.symbol;
  f.timeframe.value = r.request.timeframe;
  f.strategy.value = r.strategy.id;
  f.stopLoss.value = r.request.stopLoss;
  f.takeProfit.value = r.request.takeProfit;
  renderParams('bot', r.strategy.params);
  showView('bots');
  toast('Revisa el monto por operación y pulsa «Activar bot»');
});

// ---------- Bots ----------
$('#bot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('#bot-error').textContent = '';
  try {
    await api('/bots', {
      method: 'POST',
      body: {
        symbol: f.symbol.value, timeframe: f.timeframe.value, strategy: f.strategy.value, params: readParams('bot'),
        amount: Number(f.amount.value), stopLoss: Number(f.stopLoss.value), takeProfit: Number(f.takeProfit.value),
      },
    });
    toast('🤖 Bot activado. Evaluará la estrategia al cierre de cada vela.');
    loadBots();
  } catch (err) {
    $('#bot-error').textContent = err.message;
  }
});

async function loadBots() {
  const bots = await api('/bots');
  const tfName = { '1m': '1 minuto', '5m': '5 minutos', '15m': '15 minutos', '1h': '1 hora', '4h': '4 horas', '1d': '1 día' };
  $('#bots-list').innerHTML = bots.length
    ? bots.map((b) => {
        const params = Object.entries(b.params).map(([k, v]) => `${k}=${v}`).join(', ');
        const pos = b.qty > 0
          ? `${num(b.qty)} ${esc(base(b.symbol))} a ${px(b.entry_price)} <span class="${cls(b.unrealized)}">(${usd(b.unrealized)})</span>`
          : 'Sin posición';
        return `<div class="bot">
          <div class="bot-head">
            <div><strong>#${b.id} ${esc(b.strategyName)}</strong> <span class="muted">· ${esc(b.symbol)} · velas de ${tfName[b.timeframe]}</span>
              <span class="status ${b.active ? 'on' : 'off'}">${b.active ? '● Activo' : '❚❚ Pausado'}</span></div>
            <div class="actions">
              <button data-bot-toggle="${b.id}" data-active="${b.active ? 0 : 1}">${b.active ? 'Pausar' : 'Reanudar'}</button>
              <button class="danger" data-bot-del="${b.id}" data-qty="${b.qty}">Eliminar</button>
            </div>
          </div>
          <dl class="kv">
            <dt>Parámetros</dt><dd>${esc(params)}</dd>
            <dt>Por operación</dt><dd>${usd(b.amount)}${b.stop_loss ? ` · SL ${b.stop_loss} %` : ''}${b.take_profit ? ` · TP ${b.take_profit} %` : ''}</dd>
            <dt>Posición</dt><dd>${pos}</dd>
            <dt>G/P realizada</dt><dd class="${cls(b.realized)}">${usd(b.realized)} · ${b.trade_count} operaciones</dd>
            <dt>Último evento</dt><dd>${esc(b.last_event || '—')}</dd>
            <dt>Última revisión</dt><dd>${b.last_run ? date(b.last_run) : '—'}</dd>
          </dl>
        </div>`;
      }).join('')
    : '<p class="muted">No tienes bots. Crea uno a la izquierda o desde un backtest que te haya gustado.</p>';
}

$('#bots-list').addEventListener('click', async (e) => {
  const t = e.target;
  try {
    if (t.dataset.botToggle) {
      await api('/bots/' + t.dataset.botToggle, { method: 'PATCH', body: { active: t.dataset.active === '1' } });
    } else if (t.dataset.botDel) {
      if (!confirm('¿Eliminar este bot?')) return;
      const close = Number(t.dataset.qty) > 0 && confirm('El bot tiene una posición abierta. ¿Quieres venderla ahora? (Cancelar = conservarla en tu cartera)');
      await api(`/bots/${t.dataset.botDel}${close ? '?close=1' : ''}`, { method: 'DELETE' });
      await loadMe();
    } else return;
    loadBots();
  } catch (err) {
    toast(err.message);
  }
});

// ---------- Arranque ----------
let pollTimer;
async function enterApp() {
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  await loadConfig();
  await Promise.all([loadTickers(), loadMe(), loadStrategies()]);
  selectSymbol(state.symbol);
  setSide(state.side);
  clearInterval(pollTimer);
  let n = 0;
  pollTimer = setInterval(async () => {
    if (!state.token) return clearInterval(pollTimer);
    try {
      await Promise.all([loadTickers(), loadMe()]);
      if (state.view === 'market') drawChart();
      if (state.view === 'orders') loadOrders();
      if (state.view === 'bots') loadBots();
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

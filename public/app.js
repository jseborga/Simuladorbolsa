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
    state.candles = await api(`/ohlcv?symbol=${encodeURIComponent(state.symbol)}&timeframe=${state.timeframe}&limit=120`);
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
        <td>${date(t.created_at)}</td><td>${esc(t.symbol)}</td>
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

// ---------- Gráfico de velas (canvas) ----------
function drawChart() {
  const cv = $('#chart');
  if (!cv || cv.offsetParent === null) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth;
  const H = 320;
  cv.width = W * dpr;
  cv.height = H * dpr;
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, W, H);
  const data = state.candles;
  if (!data.length) {
    g.fillStyle = '#8b98a8';
    g.fillText('Cargando gráfico…', 12, 20);
    return;
  }
  const padR = 70, padB = 22, padT = 8;
  const lows = data.map((c) => c[3]);
  const highs = data.map((c) => c[2]);
  const holding = state.me?.holdings.find((h) => h.symbol === state.symbol);
  let min = Math.min(...lows), max = Math.max(...highs);
  const range = max - min || max * 0.01;
  min -= range * 0.05;
  max += range * 0.05;
  const y = (p) => padT + (1 - (p - min) / (max - min)) * (H - padT - padB);
  const cw = (W - padR) / data.length;

  // Rejilla y eje de precios
  g.font = '11px system-ui';
  g.strokeStyle = '#2a3542';
  g.fillStyle = '#8b98a8';
  g.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const p = min + ((max - min) * i) / 5;
    const yy = Math.round(y(p)) + 0.5;
    g.beginPath(); g.moveTo(0, yy); g.lineTo(W - padR, yy); g.stroke();
    g.fillText(fmtAxis(p), W - padR + 6, yy + 4);
  }
  // Eje de tiempo
  const step = Math.ceil(data.length / 6);
  for (let i = 0; i < data.length; i += step) {
    const d = new Date(data[i][0]);
    const label = ['1d', '4h'].includes(state.timeframe) ? d.toLocaleDateString('es', { day: '2-digit', month: 'short' }) : d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    g.fillText(label, i * cw + 2, H - 6);
  }
  // Velas
  data.forEach(([, o, h, l, c], i) => {
    const x = i * cw + cw / 2;
    g.strokeStyle = g.fillStyle = c >= o ? '#1fbf75' : '#f0525c';
    g.beginPath(); g.moveTo(x, y(h)); g.lineTo(x, y(l)); g.stroke();
    const top = y(Math.max(o, c));
    g.fillRect(x - Math.max(cw * 0.35, 0.5), top, Math.max(cw * 0.7, 1), Math.max(y(Math.min(o, c)) - top, 1));
  });
  // Precio actual y precio medio de compra
  const last = state.tickers[state.symbol]?.last;
  const hline = (p, color, text) => {
    if (p == null || p < min || p > max) return;
    const yy = Math.round(y(p)) + 0.5;
    g.setLineDash([4, 4]); g.strokeStyle = color;
    g.beginPath(); g.moveTo(0, yy); g.lineTo(W - padR, yy); g.stroke(); g.setLineDash([]);
    g.fillStyle = color; g.fillRect(W - padR, yy - 9, padR, 18);
    g.fillStyle = '#0f141b'; g.fillText(text, W - padR + 4, yy + 4);
  };
  if (holding) hline(holding.avg_price, '#f5a524', 'Tu media');
  hline(last, '#4f8cff', fmtAxis(last));
}

function fmtAxis(p) {
  return p >= 1000 ? p.toFixed(0) : p >= 1 ? p.toFixed(2) : p.toPrecision(4);
}

window.addEventListener('resize', drawChart);

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

// ---------- Arranque ----------
let pollTimer;
async function enterApp() {
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  await loadConfig();
  await Promise.all([loadTickers(), loadMe()]);
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

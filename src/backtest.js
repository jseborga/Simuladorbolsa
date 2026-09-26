// Motor de backtesting: prueba una estrategia sobre velas históricas.
// Reglas (para que sea realista y sin "mirar al futuro"):
//  - La señal se calcula al CIERRE de una vela y la orden se ejecuta en la APERTURA de la siguiente.
//  - Stop-loss / take-profit / trailing stop se revisan dentro de cada vela con su mínimo / máximo.
//  - Sólo posiciones largas (comprar y luego vender), con comisión en cada lado.
const { resolve } = require('./strategies');

function backtest(candles, { strategy: id, params, definition, initialCash = 10000, feeRate = 0.001, positionPct = 100, stopLoss = 0, takeProfit = 0, trailing = 0 } = {}) {
  const { strategy, params: p } = resolve({ strategy: id, params, definition });
  if (candles.length < 10) throw Object.assign(new Error('No hay suficientes velas para el backtest'), { status: 400 });
  const { signals, plots, panels = [], zones = [], segments = [] } = strategy.run(candles, p);
  const sl = Math.max(Number(stopLoss) || 0, 0) / 100;
  const tp = Math.max(Number(takeProfit) || 0, 0) / 100;
  const tr = Math.min(Math.max(Number(trailing) || 0, 0), 90) / 100;
  let trailPeak = 0;
  const sizeFrac = Math.min(Math.max(Number(positionPct) || 100, 1), 100) / 100;

  let cash = initialCash;
  let qty = 0;
  let entry = null; // { i, price, cost }
  const trades = [];
  const markers = [];
  const equity = [];

  const buy = (i, price) => {
    const spend = cash * sizeFrac;
    qty = spend / (price * (1 + feeRate));
    const fee = qty * price * feeRate;
    cash -= qty * price + fee;
    entry = { i, price, cost: qty * price + fee };
    trailPeak = price;
    markers.push({ i, side: 'buy', price });
  };
  const sell = (i, price, reason) => {
    const gross = qty * price;
    const fee = gross * feeRate;
    cash += gross - fee;
    const pnl = gross - fee - entry.cost;
    trades.push({
      entryTime: candles[entry.i][0], exitTime: candles[i][0], entryPrice: entry.price, exitPrice: price,
      qty, pnl, pnlPct: (pnl / entry.cost) * 100, bars: i - entry.i, reason,
    });
    markers.push({ i, side: 'sell', price, reason });
    qty = 0;
    entry = null;
  };

  let pending = null; // señal del cierre anterior
  for (let i = 0; i < candles.length; i++) {
    const [, open, high, low, close] = candles[i];
    if (pending === 'buy' && qty === 0) buy(i, open);
    else if (pending === 'sell' && qty > 0) sell(i, open, 'Señal');
    pending = null;

    if (qty > 0) {
      const slPrice = sl ? entry.price * (1 - sl) : null;
      const tpPrice = tp ? entry.price * (1 + tp) : null;
      // El trailing stop sigue al máximo alcanzado (con el máximo de la vela anterior, para no mirar dentro de la vela).
      const trPrice = tr ? trailPeak * (1 - tr) : null;
      // Si en la misma vela se tocan varios niveles, asumimos lo peor (primero los stops).
      if (slPrice && low <= slPrice) sell(i, Math.min(open, slPrice), 'Stop-loss');
      else if (trPrice && low <= trPrice) sell(i, Math.min(open, trPrice), 'Trailing stop');
      else if (tpPrice && high >= tpPrice) sell(i, Math.max(open, tpPrice), 'Take-profit');
      if (qty > 0) trailPeak = Math.max(trailPeak, high);
    }

    pending = signals[i];
    equity.push(cash + qty * close);
  }
  // Cierra la posición abierta al final para medir el resultado.
  const openAtEnd = qty > 0;
  if (openAtEnd) sell(candles.length - 1, candles[candles.length - 1][4], 'Fin del periodo');

  const finalEquity = cash;
  let peak = -Infinity, maxDD = 0;
  for (const e of equity) {
    peak = Math.max(peak, e);
    maxDD = Math.max(maxDD, (peak - e) / peak);
  }
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.pnl, 0);
  const firstOpen = candles[0][1];
  const lastClose = candles[candles.length - 1][4];
  const bhQty = initialCash / (firstOpen * (1 + feeRate));
  const buyHold = candles.map((c) => bhQty * c[4]);
  const barsIn = trades.reduce((a, t) => a + t.bars, 0);

  return {
    strategy: { id: strategy.id, name: strategy.name, params: p, definition: strategy.definition },
    metrics: {
      initialCash,
      finalEquity,
      totalReturn: ((finalEquity - initialCash) / initialCash) * 100,
      buyHoldReturn: ((bhQty * lastClose * (1 - feeRate) - initialCash) / initialCash) * 100,
      maxDrawdown: maxDD * 100,
      trades: trades.length,
      winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : wins.length ? null : 0,
      avgTrade: trades.length ? trades.reduce((a, t) => a + t.pnlPct, 0) / trades.length : 0,
      bestTrade: trades.length ? Math.max(...trades.map((t) => t.pnlPct)) : 0,
      worstTrade: trades.length ? Math.min(...trades.map((t) => t.pnlPct)) : 0,
      exposure: (barsIn / candles.length) * 100,
      openAtEnd,
      from: candles[0][0],
      to: candles[candles.length - 1][0],
      candles: candles.length,
    },
    trades,
    markers,
    equity,
    buyHold,
    plots,
    panels,
    zones,
    segments,
  };
}

module.exports = { backtest };

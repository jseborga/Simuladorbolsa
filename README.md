# 📈 Simulador de Trading (paper trading)

Simulador de inversión **multiusuario** para aprender a operar con **precios reales del mercado** y **dinero virtual**. Nadie arriesga dinero de verdad: cada usuario recibe un saldo ficticio (10 000 USD por defecto) y puede comprar, vender, poner órdenes límite y stop-loss, y compararse con los demás en un ranking.

Los precios y las velas se obtienen con [CCXT](https://github.com/ccxt/ccxt) (librería de código abierto, licencia MIT) usando sólo endpoints públicos: **no hace falta ninguna API key y nunca se envían órdenes reales a un exchange**. CCXT se usa como **dependencia de npm** (se descarga en `node_modules/` al hacer `npm install`) en lugar de copiar su código en este repositorio: CCXT pesa cientos de MB, se actualiza casi a diario con cambios de los exchanges y así se obtienen esas actualizaciones con un simple `npm update ccxt`.

## Funciones

- **Cuentas de usuario**: registro/inicio de sesión (contraseñas con `scrypt`), cada usuario con su propia cartera.
- **Mercado en vivo**: 10 criptomonedas (BTC, ETH, SOL, XRP, ADA, DOGE, LTC, DOT, LINK, AVAX) actualizadas cada 5 s.
- **Gráfico de velas** (5m, 15m, 1h, 4h, 1d) con tu precio medio de compra marcado.
- **Indicadores técnicos**: SMA 20/50, EMA 20/200, Bandas de Bollinger, Volumen, RSI y MACD (paneles inferiores).
- **Herramientas de gráfico**: cruz de precio con datos OHLC e indicadores de cada vela, y líneas horizontales para marcar soportes/resistencias (se guardan por par).
- **Backtesting**: prueba 6 estrategias con datos históricos reales (hasta 1000 velas), con comisiones, stop-loss, take-profit y tamaño de posición. Muestra las operaciones sobre el gráfico, la curva de capital frente a «comprar y mantener», máxima caída, % de aciertos, factor de beneficio, etc.
- **Bots de trading**: activa una estrategia para que opere sola con tu dinero virtual al cierre de cada vela (1m a 1d), con stop-loss/take-profit. Sólo vende lo que el propio bot compró. Se puede crear un bot directamente desde un backtest.
- **Órdenes**:
  - A mercado (compra al *ask*, vende al *bid*, como en un exchange real).
  - Límite (comprar barato / tomar ganancias).
  - Stop (stop-loss o entrada por ruptura).
- **Comisión** configurable (0,1 % por defecto) para aprender su impacto.
- **Cartera**: posiciones, precio medio, G/P realizada y no realizada, % de la cartera, comisiones pagadas.
- **Historial** de operaciones y de órdenes.
- **Ranking** entre todos los usuarios.
- **Aprende**: guía con conceptos básicos y ejercicios propuestos.
- **Reiniciar cuenta** para volver a empezar con otra estrategia.
- **Estrategias incluidas**: cruce de SMA, cruce de EMA, RSI sobreventa/sobrecompra, cruce MACD, rebote en Bollinger y ruptura de canal Donchian.
- **Modo simulado**: si ningún exchange responde (sin internet o bloqueo regional), la app sigue funcionando con precios simulados.

## Requisitos

- Node.js **22.13 o superior** (usa el SQLite integrado `node:sqlite`; no hay que instalar base de datos).

## Uso

```bash
npm install
npm start
# abre http://localhost:3000
```

Tests:

```bash
npm test
```

## Configuración (variables de entorno)

| Variable       | Por defecto                 | Descripción |
|----------------|-----------------------------|-------------|
| `PORT`         | `3000`                      | Puerto HTTP |
| `DB_FILE`      | `data/simulador.db`         | Archivo SQLite |
| `EXCHANGES`    | `kraken,coinbase,binance`   | Exchanges de CCXT a probar, en orden (se usa el primero que responda) |
| `SIMULATED`    | —                           | `1` para forzar precios simulados |
| `POLL_MS`      | `5000`                      | Intervalo de actualización de precios |
| `INITIAL_CASH` | `10000`                     | Saldo virtual inicial de cada cuenta |
| `FEE_RATE`     | `0.001`                     | Comisión por operación (0,1 %) |
| `BOT_INTERVAL_MS` | `20000`                  | Cada cuánto revisan los bots si cerró una vela |

> Nota: Binance bloquea algunas regiones (error 451); por eso se prueba primero Kraken.

## Estructura

```
src/
  server.js   API REST (Express) y arranque
  market.js   Precios vía CCXT + modo simulado
  broker.js   Motor de paper trading: usuarios, órdenes, cartera, ranking
  strategies.js  Estrategias de trading (señales de compra/venta)
  backtest.js Motor de backtesting
  bots.js     Bots que ejecutan estrategias en vivo sobre la cuenta virtual
  db.js       Esquema SQLite
public/
  indicators.js  Indicadores técnicos (compartidos por navegador y servidor)
  chart.js    Gráficos en canvas (velas, indicadores, cruz de precio, curva de capital)
  app.js, index.html, styles.css  Interfaz web (sin dependencias)
test/         Tests de órdenes, indicadores, backtesting y bots
```

## API

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/register` · `/api/login` | `{username, password}` → `{token}` |
| GET  | `/api/config` · `/api/tickers` · `/api/ohlcv?symbol=&timeframe=` | Datos de mercado |
| GET  | `/api/me` · `/api/trades` · `/api/orders` | Cartera del usuario (header `Authorization: Bearer <token>`) |
| POST | `/api/orders` | `{symbol, side: buy\|sell, type: market\|limit\|stop, qty, price?}` |
| DELETE | `/api/orders/:id` | Cancelar orden abierta |
| POST | `/api/reset` | Reiniciar la cuenta |
| GET  | `/api/strategies` | Estrategias disponibles y sus parámetros |
| POST | `/api/backtest` | `{symbol, timeframe, limit, strategy, params, stopLoss?, takeProfit?, positionPct?}` |
| GET/POST | `/api/bots` | Listar / crear bots `{symbol, timeframe, strategy, params, amount, stopLoss?, takeProfit?}` |
| PATCH | `/api/bots/:id` | `{active: true\|false}` pausar o reanudar |
| DELETE | `/api/bots/:id?close=1` | Eliminar bot (con `close=1` vende su posición) |
| GET  | `/api/leaderboard` | Ranking |

⚠️ Herramienta educativa. Los resultados simulados no garantizan resultados reales y nada aquí es asesoramiento financiero.

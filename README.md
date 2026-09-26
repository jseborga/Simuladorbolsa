# 📈 Simulador de Trading (paper trading)

Simulador de inversión **multiusuario** para aprender a operar con **precios reales del mercado** y **dinero virtual**. Nadie arriesga dinero de verdad: cada usuario recibe un saldo ficticio (10 000 USD por defecto) y puede comprar, vender, poner órdenes límite y stop-loss, y compararse con los demás en un ranking.

Los precios y las velas se obtienen con [CCXT](https://github.com/ccxt/ccxt) (librería de código abierto, licencia MIT) usando sólo endpoints públicos: **no hace falta ninguna API key y nunca se envían órdenes reales a un exchange**. CCXT se usa como **dependencia de npm** (se descarga en `node_modules/` al hacer `npm install`) en lugar de copiar su código en este repositorio: CCXT pesa cientos de MB, se actualiza casi a diario con cambios de los exchanges y así se obtienen esas actualizaciones con un simple `npm update ccxt`.

## Funciones

### Para aprender
- **🎓 Academia**: 6 módulos y 20 lecciones (fundamentos, gestión del riesgo, análisis técnico, forex y horarios, ICT / Smart Money, estrategias y bots). Cada lección tiene teoría, un **quiz corregido en el servidor** y, en muchas, una **tarea práctica** que se comprueba automáticamente con lo que haces en el simulador (por ejemplo: «abre una compra con stop y objetivo», «ten 3 activos a la vez», «completa una sesión de Replay»). Progreso, XP, niveles y 13 **insignias**.
- **⏪ Modo Replay**: viaja a una fecha pasada y opera vela a vela (paso a paso o reproducción a 1–10 velas/s) con **histórico real** de Bitstamp, Bitfinex o Coinbase. Incluye accesos a fechas famosas (crash COVID 2020, máximo de BTC 2021, caída de FTX 2022), **fecha aleatoria** y **modo a ciegas** que oculta las fechas hasta el final. Stop y objetivo por operación, estadísticas frente a «comprar y mantener» y sesiones guardadas.
- **📓 Diario de trading**: anota setup, emoción, motivo, valoración y lección de cada operación (también al abrirla desde el panel Operar). Estadísticas por setup, emoción, activo y kill zone, con **conclusiones automáticas** («tu mejor setup es…», «cuando operas con FOMO pierdes de media…»).
- **🧮 Calculadora de riesgo**: eliges el % del patrimonio que arriesgas y el stop (sugerido a 1,5 ATR); calcula la cantidad, la pérdida máxima y la relación R:R, dibuja stop y objetivo en el gráfico y abre la compra con **stop-loss y objetivo enlazados (OCO)**: al ejecutarse uno se cancela el otro.

### Aprender con IA (Claude)
- **✨ Bot IA**: un agente de IA recibe al cierre de cada vela un resumen del mercado (últimas 40 velas, indicadores, estructura ICT, FVG, order blocks, liquidez, kill zone), su posición y sus últimas 5 decisiones con lo que pasó después, más tus instrucciones de estilo («sé conservador», «usa ICT»…). Devuelve una decisión estructurada (comprar / vender / mantener, tamaño, stop, objetivo, confianza, razonamiento y factores clave).
- **El servidor manda, no la IA**: sólo compra si supera tu confianza mínima; el stop es obligatorio y se recorta a una distancia máxima; al «mantener» sólo puede subir el stop, nunca bajarlo; nunca usa más del presupuesto del bot. Cada decisión queda registrada con su razonamiento y las correcciones aplicadas.
- **Comparativa de bots**: tabla que ordena todos tus bots (IA, señales, DCA, grid) por resultado para comprobar si la IA decide mejor que un algoritmo.
- **✨ Analizar con IA** (gráfico): explicación educativa de tendencia, niveles clave, escenarios alcista/bajista y qué vigilar.
- **✨ Revisar con IA** (diario): un «mentor» revisa una operación tuya (entrada, stop, tamaño, salida, emociones) y te deja una lección concreta.
- Lección de la Academia sobre ventajas y límites del trading con IA (por qué no hay backtest honesto de un LLM, exceso de confianza, costes).

Se usa el SDK oficial de Anthropic con el modelo `claude-opus-5`, salidas estructuradas (JSON Schema) para las decisiones y `fallbacks: "default"` por si el modelo rechaza una petición. Sin `ANTHROPIC_API_KEY` todo lo demás funciona igual y la interfaz explica cómo activarla.

### Para operar

- **Cuentas de usuario**: registro/inicio de sesión (contraseñas con `scrypt`), cada usuario con su propia cartera.
- **Mercado en vivo** (actualizado cada 5 s):
  - **Cripto**: BTC, ETH, SOL, XRP, ADA, DOGE, LTC, DOT, LINK, AVAX.
  - **Forex**: EUR/USD, GBP/USD, AUD/USD (con valor del pip y tamaño en lotes al operar).
  - **Oro**: PAXG/USD (token respaldado por oro físico, sigue a XAU/USD).
- **Gráfico de velas** (5m, 15m, 1h, 4h, 1d) con tu precio medio de compra marcado.
- **Indicadores clásicos**: SMA 20/50, EMA 20/200, Bandas de Bollinger, VWAP diario, Volumen; osciladores RSI, MACD, Estocástico y ATR.
- **Indicadores ICT / Smart Money**:
  - Fair Value Gaps (imbalances) alcistas y bajistas, visibles hasta que se rellenan.
  - Order Blocks (última vela contraria antes de la ruptura de estructura), hasta que se invalidan.
  - Estructura de mercado: BOS y CHoCH.
  - Liquidez: máximos/mínimos iguales (EQH/EQL = BSL/SSL) y barridas de liquidez.
  - Zonas Premium / Discount con el equilibrio del 50 %.
  - PDH/PDL, PWH/PWL y apertura de medianoche de Nueva York.
- **Horarios**:
  - Cajas de las sesiones de Tokio, Londres y Nueva York sobre el gráfico.
  - Kill zones de ICT (Asia, Londres, Nueva York, cierre de Londres).
  - Panel «Horarios de mercado» con el estado en tiempo real (abierta / cerrada / pausa de almuerzo y cuánto falta) del forex y de las bolsas de Sídney, Tokio, Hong Kong, Fráncfort, Londres, Nueva York y São Paulo. El horario de verano se maneja automáticamente; los festivos no.
- **Herramientas de dibujo**: línea horizontal, línea de tendencia (con % de variación), Fibonacci (con zona OTE 62–79 % y extensiones −0,27 / −0,62) y rectángulo de zona. Se guardan por par, con deshacer y borrar todo.
- **Cruz de precio** con datos OHLC e indicadores de cada vela.
- **Constructor visual de estrategias**: crea tus propias reglas de compra y venta sin programar, combinando comparaciones («RSI 14 es menor que 30», «precio cruza por encima de EMA 50»…) con modo Y/O y condiciones ICT u horarias («toca un FVG alcista», «CHoCH bajista», «kill zone de Londres», «zona discount»…). Incluye plantillas, resumen en lenguaje natural, y se pueden **compartir con la comunidad** y copiar las de otros usuarios.
- **Backtesting**: prueba las estrategias predefinidas o las tuyas con datos históricos reales (hasta 1000 velas), con comisiones, stop-loss, take-profit, trailing stop y tamaño de posición. Muestra las operaciones sobre el gráfico, la curva de capital frente a «comprar y mantener», máxima caída, % de aciertos, factor de beneficio, etc.
- **Bots de trading** (como en 3Commas, Pionex o Binance), que operan solos con tu dinero virtual y sólo venden lo que ellos mismos compraron:
  - 🧠 **Señales**: ejecuta una estrategia (predefinida o del constructor) al cierre de cada vela (1m a 1d), con stop-loss, take-profit y trailing stop.
  - 📅 **DCA**: compra periódica de una cantidad fija, compras extra en caídas y take-profit sobre el precio medio del ciclo.
  - 🔲 **Grid**: reparte la inversión en N niveles de un rango; compra al bajar un nivel y vende al subir al siguiente.
  - Se pueden **editar en marcha** (monto, riesgo, temporalidad, parámetros…), pausar, y cada uno tiene un **registro** de eventos y operaciones.
  - Se crean desde la pestaña Bots, desde un backtest o desde el constructor.
- **Órdenes**:
  - A mercado (compra al *ask*, vende al *bid*, como en un exchange real).
  - Límite (comprar barato / tomar ganancias).
  - Stop (stop-loss o entrada por ruptura).
- **Comisión** configurable por tipo de activo: 0,1 % en cripto, 0,01 % en forex (similar al spread de un bróker) y 0,05 % en oro.
- **Cartera**: posiciones, precio medio, G/P realizada y no realizada, % de la cartera, comisiones pagadas.
- **Historial** de operaciones y de órdenes.
- **Ranking** entre todos los usuarios.
- **Reiniciar cuenta** para volver a empezar con otra estrategia.
- **Estrategias incluidas**: cruce de SMA, cruce de EMA, RSI sobreventa/sobrecompra, cruce MACD, rebote en Bollinger, ruptura de canal Donchian e **ICT: estructura + Fair Value Gap** (con filtro opcional de kill zones).
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
| `FEE_RATE`     | `0.001`                     | Comisión por operación en cripto (0,1 %) |
| `FEE_RATE_FOREX` | `0.0001`                  | Comisión en forex (0,01 %) |
| `FEE_RATE_GOLD`  | `0.0005`                  | Comisión en oro (0,05 %) |
| `BOT_INTERVAL_MS` | `20000`                  | Cada cuánto revisan los bots si cerró una vela |
| `ANTHROPIC_API_KEY` | —                      | Clave de la API de Anthropic: activa el bot IA y los análisis con IA |
| `AI_MODEL`     | `claude-opus-5`             | Modelo de Claude a usar |
| `AI_DAILY_LIMIT` | `100`                     | Consultas a la IA por usuario y día (control de gasto) |

> **Coste de la IA**: cada vela cerrada de un bot IA es una consulta (unos pocos miles de tokens de entrada). Por eso los bots IA usan velas de 15m o más, hay un máximo de 3 bots IA por usuario y un límite diario de consultas. Con velas de 1h, un bot hace unas 24 consultas al día.

> Nota: Binance bloquea algunas regiones (error 451); por eso se prueba primero Kraken, que además ofrece los pares de forex y oro.
> Sólo se operan pares cotizados en USD (el saldo de las cuentas está en USD); por eso no hay USD/JPY ni USD/CAD.

## Estructura

```
src/
  server.js   API REST (Express) y arranque
  market.js   Precios vía CCXT + modo simulado
  broker.js   Motor de paper trading: usuarios, órdenes, cartera, ranking
  strategies.js  Estrategias predefinidas (señales de compra/venta)
  custom.js   Constructor de estrategias: validación, plantillas y evaluación de reglas
  academy.js  Academia: corrección de quizzes, tareas prácticas e insignias
  ai.js       Integración con Claude: contexto de mercado, decisiones estructuradas, análisis y revisiones
  backtest.js Motor de backtesting
  bots.js     Bots de señales, DCA y grid sobre la cuenta virtual
  db.js       Esquema SQLite
public/
  indicators.js  Indicadores técnicos, ICT y horarios de mercado (compartidos por navegador y servidor)
  courses.js  Contenido de la Academia: módulos, lecciones, quizzes e insignias
  chart.js    Gráficos en canvas (velas, indicadores, zonas, dibujos, cruz de precio, curva de capital)
  app.js, index.html, styles.css  Interfaz web (sin dependencias)
test/         Tests de órdenes (incl. OCO), indicadores, ICT, horarios, constructor, backtesting, bots, Academia e IA
```

## API

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/register` · `/api/login` | `{username, password}` → `{token}` |
| GET  | `/api/config` · `/api/tickers` · `/api/ohlcv?symbol=&timeframe=` | Datos de mercado |
| GET  | `/api/me` · `/api/trades` · `/api/orders` | Cartera del usuario (header `Authorization: Bearer <token>`) |
| POST | `/api/orders` | `{symbol, side: buy\|sell, type: market\|limit\|stop, qty, price?, stop?, target?, journal?}` (con `stop` abre una compra con stop y objetivo OCO) |
| GET  | `/api/journal` · PUT `/api/journal/:tradeId` | Diario: operaciones con sus notas / anotar una operación |
| GET  | `/api/history?symbol=&timeframe=&since=&limit=` | Histórico antiguo para el Replay |
| GET/POST | `/api/replay-sessions` | Sesiones de Replay guardadas |
| GET  | `/api/academy` · POST `/api/academy/lessons/:id` | Progreso de la Academia / enviar respuestas `{answers}` |
| GET  | `/api/ai` | Estado de la IA y consultas usadas hoy |
| POST | `/api/ai/analyze` · `/api/ai/review/:tradeId` | Análisis del gráfico `{symbol, timeframe}` / revisión de una operación |
| GET  | `/api/bots/:id/decisions` | Decisiones razonadas de un bot IA |
| DELETE | `/api/orders/:id` | Cancelar orden abierta |
| POST | `/api/reset` | Reiniciar la cuenta |
| GET  | `/api/strategies` | Estrategias disponibles y sus parámetros |
| GET  | `/api/strategy-schema` | Indicadores, comparaciones, condiciones ICT y plantillas del constructor |
| GET/POST | `/api/custom-strategies` | Mis estrategias y las de la comunidad / crear `{definition, public}` |
| PUT/DELETE | `/api/custom-strategies/:id` | Editar / eliminar una estrategia propia |
| POST | `/api/custom-strategies/:id/copy` | Copiar una estrategia de la comunidad |
| POST | `/api/backtest` | `{symbol, timeframe, limit, strategy+params \| customId \| definition, stopLoss?, takeProfit?, trailing?, positionPct?}` |
| GET/POST | `/api/bots` | Listar / crear bots. `type`: `signal` (estrategia), `dca` (`amount, intervalHours, dropPct, maxBuys, takeProfit`) o `grid` (`low, high, grids, investment`) |
| PATCH | `/api/bots/:id` | Pausar/reanudar (`active`) o cambiar la configuración |
| GET | `/api/bots/:id/events` · `/api/bots/:id/trades` | Registro y operaciones de un bot |
| DELETE | `/api/bots/:id?close=1` | Eliminar bot (con `close=1` vende su posición) |
| GET  | `/api/leaderboard` | Ranking |

⚠️ Herramienta educativa. Los resultados simulados no garantizan resultados reales y nada aquí es asesoramiento financiero.

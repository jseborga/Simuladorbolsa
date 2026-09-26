# 📈 Simulador de Trading (paper trading)

Simulador de inversión **multiusuario** para aprender a operar con **precios reales del mercado** y **dinero virtual**. Nadie arriesga dinero de verdad: cada usuario recibe un saldo ficticio (10 000 USD por defecto) y puede comprar, vender, poner órdenes límite y stop-loss, y compararse con los demás en un ranking.

Los precios y las velas se obtienen con [CCXT](https://github.com/ccxt/ccxt) (librería de código abierto, licencia MIT) usando sólo endpoints públicos: **no hace falta ninguna API key y nunca se envían órdenes reales a un exchange**. CCXT se usa como dependencia de npm en lugar de copiar su código, así recibe actualizaciones con un simple `npm update`.

## Funciones

- **Cuentas de usuario**: registro/inicio de sesión (contraseñas con `scrypt`), cada usuario con su propia cartera.
- **Mercado en vivo**: 10 criptomonedas (BTC, ETH, SOL, XRP, ADA, DOGE, LTC, DOT, LINK, AVAX) actualizadas cada 5 s.
- **Gráfico de velas** (5m, 15m, 1h, 4h, 1d) con tu precio medio de compra marcado.
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

> Nota: Binance bloquea algunas regiones (error 451); por eso se prueba primero Kraken.

## Estructura

```
src/
  server.js   API REST (Express) y arranque
  market.js   Precios vía CCXT + modo simulado
  broker.js   Motor de paper trading: usuarios, órdenes, cartera, ranking
  db.js       Esquema SQLite
public/       Interfaz web (HTML/CSS/JS sin dependencias)
test/         Tests del motor de órdenes
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
| GET  | `/api/leaderboard` | Ranking |

⚠️ Herramienta educativa. Los resultados simulados no garantizan resultados reales y nada aquí es asesoramiento financiero.

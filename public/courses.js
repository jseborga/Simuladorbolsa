// Contenido de la Academia: módulos → lecciones con teoría, quiz y tarea práctica.
// Se usa en el navegador (window.Courses) y en el servidor (para validar el progreso).
// task: id de una comprobación automática en el servidor (ver src/academy.js).
// action: botón para ir a la pestaña donde se practica.
(function (root) {
  'use strict';

  const MODULES = [
    {
      id: 'm1', icon: '🌱', title: 'Fundamentos',
      intro: 'Qué es el trading, cómo se lee un precio y cómo funcionan las órdenes.',
      lessons: [
        {
          id: 'l1', title: '¿Qué es el trading?',
          body: `
<p>Hacer <strong>trading</strong> es comprar y vender activos buscando ganar con las variaciones de precio. En este simulador puedes operar tres tipos de mercado:</p>
<ul>
  <li><strong>Criptomonedas</strong> (BTC, ETH…): cotizan 24/7 y son muy volátiles; un 10 % en un día es normal.</li>
  <li><strong>Forex</strong> (EUR/USD, GBP/USD…): una divisa contra otra. Es el mercado más grande del mundo y se mueve mucho menos en porcentaje.</li>
  <li><strong>Oro</strong> (PAXG/USD): un token respaldado por oro físico que sigue su precio.</li>
</ul>
<p>Cada activo tiene dos precios: el <strong>ask</strong> (lo que piden los vendedores; al que tú compras) y el <strong>bid</strong> (lo que ofrecen los compradores; al que tú vendes). La diferencia es el <strong>spread</strong>, un coste oculto de cada operación.</p>
<p>Aquí usas precios reales de exchanges, pero con <strong>dinero virtual</strong>: puedes equivocarte todo lo que necesites para aprender.</p>`,
          quiz: [
            { q: 'Si quieres comprar ahora mismo, ¿a qué precio lo haces?', options: ['Al bid', 'Al ask', 'Al precio medio'], answer: 1, explain: 'Compras a lo que piden los vendedores: el ask.' },
            { q: '¿Qué es el spread?', options: ['La comisión del exchange', 'La diferencia entre ask y bid', 'La variación en 24 h'], answer: 1, explain: 'Es la diferencia entre el precio de compra y el de venta.' },
            { q: '¿Qué mercado está abierto 24 horas los 7 días?', options: ['Forex', 'Bolsa de Nueva York', 'Criptomonedas'], answer: 2, explain: 'El forex cierra el fin de semana y la bolsa tiene horario; las cripto nunca cierran.' },
          ],
          task: { id: 'trade', text: 'Haz tu primera compra en la pestaña Mercado (por ejemplo, 500 USD de BTC).' },
          action: { label: 'Ir a Mercado', view: 'market' },
        },
        {
          id: 'l2', title: 'Tipos de órdenes',
          body: `
<ul>
  <li><strong>A mercado</strong>: se ejecuta al instante al mejor precio disponible. Rápida, pero no controlas el precio exacto.</li>
  <li><strong>Límite</strong>: fijas el precio. Una compra límite sólo se ejecuta si el precio <em>baja</em> hasta tu nivel; una venta límite sólo si <em>sube</em>. Sirve para «comprar barato» o tomar ganancias.</li>
  <li><strong>Stop</strong>: se activa al tocar un nivel y ejecuta a mercado. Una venta stop por debajo del precio es un <strong>stop-loss</strong>: limita la pérdida si el mercado va en tu contra.</li>
</ul>
<p>Las órdenes límite y stop quedan pendientes en la pestaña <em>Órdenes</em> hasta que el precio llega o las cancelas.</p>`,
          quiz: [
            { q: 'BTC está a 60 000. Quieres comprar sólo si baja a 58 000. ¿Qué orden usas?', options: ['Compra a mercado', 'Compra límite a 58 000', 'Compra stop a 58 000'], answer: 1, explain: 'La compra límite se ejecuta cuando el precio baja hasta tu nivel.' },
            { q: 'Tienes ETH comprado a 3 000 y no quieres perder más de un 5 %. ¿Qué pones?', options: ['Venta stop a 2 850', 'Venta límite a 2 850', 'Compra stop a 3 150'], answer: 0, explain: 'Un stop-loss es una venta stop por debajo del precio.' },
            { q: '¿Qué orden te garantiza la ejecución inmediata?', options: ['Límite', 'Stop', 'A mercado'], answer: 2, explain: 'La orden a mercado se ejecuta al instante; a cambio no controlas el precio exacto.' },
          ],
          task: { id: 'limit_order', text: 'Coloca una orden límite de compra un poco por debajo del precio actual.' },
          action: { label: 'Ir a Mercado', view: 'market' },
        },
        {
          id: 'l3', title: 'Comisiones y ganancias',
          body: `
<p>Cada operación paga una <strong>comisión</strong> (aquí: 0,1 % en cripto, 0,01 % en forex, 0,05 % en oro). Comprar y vender cuesta el doble. Operar muchas veces con importes pequeños hace que las comisiones se coman tus ganancias.</p>
<ul>
  <li><strong>G/P no realizada</strong>: lo que ganarías o perderías si vendieras ahora. Cambia con cada movimiento del precio.</li>
  <li><strong>G/P realizada</strong>: el resultado ya cerrado de tus ventas, con comisiones incluidas. Es la única que cuenta de verdad.</li>
  <li><strong>Precio medio</strong>: si compras varias veces, tu coste es la media ponderada de todas las compras.</li>
</ul>`,
          quiz: [
            { q: 'Compras 1 BTC a 50 000 y ahora vale 52 000, pero no vendes. Esos 2 000 USD son…', options: ['Ganancia realizada', 'Ganancia no realizada', 'Comisión'], answer: 1, explain: 'Hasta que vendes, la ganancia es sólo potencial: no realizada.' },
            { q: 'Compras 1 ETH a 2 000 y otro a 3 000. ¿Tu precio medio?', options: ['2 000', '2 500', '3 000'], answer: 1, explain: '(2 000 + 3 000) / 2 = 2 500.' },
            { q: '¿Por qué conviene no operar en exceso?', options: ['Porque el exchange te bloquea', 'Porque las comisiones se acumulan', 'Porque el precio sube'], answer: 1, explain: 'Cada operación paga comisión; muchas operaciones pequeñas suman un coste grande.' },
          ],
          task: { id: 'sell', text: 'Vende (total o parcialmente) algún activo que hayas comprado y observa tu G/P realizada.' },
          action: { label: 'Ir a Mi cartera', view: 'portfolio' },
        },
      ],
    },
    {
      id: 'm2', icon: '🛡️', title: 'Gestión del riesgo',
      intro: 'La parte más importante: cuánto arriesgar, dónde salir y cómo controlar las emociones.',
      lessons: [
        {
          id: 'l4', title: 'Tamaño de posición: la regla del 1 %',
          body: `
<p>Los traders profesionales no deciden «cuánto comprar», sino <strong>cuánto están dispuestos a perder</strong> si se equivocan. Una regla clásica: no arriesgar más del <strong>1–2 % de la cuenta</strong> por operación.</p>
<p>Fórmula: <code>cantidad = (patrimonio × % de riesgo) ÷ (precio de entrada − precio del stop)</code></p>
<p>Ejemplo: con 10 000 USD y un riesgo del 1 % puedes perder 100 USD. Si compras BTC a 60 000 con stop en 58 000 (2 000 de distancia), la cantidad es 100 / 2 000 = <strong>0,05 BTC</strong> (3 000 USD de posición).</p>
<p>Así, aunque falles 10 veces seguidas, sólo pierdes ~10 % de la cuenta. La <strong>calculadora de riesgo</strong> del panel Operar hace este cálculo por ti y coloca el stop y el objetivo automáticamente.</p>`,
          quiz: [
            { q: 'Cuenta de 10 000 USD, riesgo 1 %. ¿Cuánto puedes perder como máximo en la operación?', options: ['10 USD', '100 USD', '1 000 USD'], answer: 1, explain: '1 % de 10 000 = 100 USD.' },
            { q: 'Riesgo de 100 USD, entrada 50, stop 48. ¿Cantidad?', options: ['2 unidades', '50 unidades', '100 unidades'], answer: 1, explain: '100 / (50 − 48) = 50 unidades.' },
            { q: 'Si acercas el stop a la entrada, con el mismo riesgo en USD la cantidad…', options: ['Aumenta', 'Disminuye', 'No cambia'], answer: 0, explain: 'Menos distancia al stop ⇒ más unidades para arriesgar lo mismo.' },
          ],
          task: { id: 'bracket', text: 'Usa la calculadora de riesgo y abre una compra con stop-loss y objetivo automáticos.' },
          action: { label: 'Ir a Mercado', view: 'market' },
        },
        {
          id: 'l5', title: 'Stop-loss, take-profit y relación R:R',
          body: `
<p>La <strong>relación riesgo/beneficio (R:R)</strong> compara lo que puedes ganar con lo que arriesgas. Si arriesgas 100 para ganar 200, es 1:2.</p>
<p>Con un R:R de 1:2 sólo necesitas acertar <strong>más de un 33 %</strong> de las veces para ganar dinero a largo plazo. Con 1:1 necesitas más del 50 %.</p>
<p>Por eso es habitual buscar operaciones con al menos 1:2 y poner <strong>siempre</strong> el stop-loss al entrar, no «cuando empiece a perder».</p>
<ul>
  <li>Pon el stop donde tu idea queda invalidada (por ejemplo, bajo un mínimo reciente), no a una distancia arbitraria.</li>
  <li>Una orden con stop y objetivo enlazados (OCO) cancela uno cuando se ejecuta el otro.</li>
  <li>El <strong>trailing stop</strong> sube el stop a medida que el precio sube: protege lo ganado y deja correr la tendencia.</li>
</ul>`,
          quiz: [
            { q: 'Arriesgas 50 USD para ganar 150 USD. ¿Tu R:R?', options: ['1:1', '1:3', '3:1'], answer: 1, explain: 'Ganas 3 veces lo que arriesgas: 1:3.' },
            { q: 'Con R:R 1:2, ¿qué % de aciertos necesitas para no perder dinero (sin comisiones)?', options: ['Más del 33 %', 'Más del 50 %', 'Más del 66 %'], answer: 0, explain: '1 acierto (+2) compensa 2 fallos (−1 −1). El punto de equilibrio es 1/3.' },
            { q: '¿Cuándo se debe colocar el stop-loss?', options: ['Al entrar en la operación', 'Cuando ya se pierde un 10 %', 'Nunca, hay que aguantar'], answer: 0, explain: 'Se decide antes de entrar, con la cabeza fría.' },
          ],
          task: { id: 'stop_order', text: 'Ten al menos una orden stop (stop-loss) en la pestaña Órdenes.' },
          action: { label: 'Ir a Órdenes', view: 'orders' },
        },
        {
          id: 'l6', title: 'Diversificación',
          body: `
<p>Poner todo el capital en un solo activo multiplica el riesgo: si ese activo cae un 50 %, tu cuenta también. <strong>Diversificar</strong> es repartir entre activos que no se mueven igual.</p>
<ul>
  <li>Las criptomonedas suelen moverse juntas (si BTC cae, casi todas caen). Diversificar sólo entre cripto ayuda poco.</li>
  <li>Forex y oro se comportan de forma distinta a las cripto: combinarlos reduce la volatilidad total.</li>
  <li>Mira la columna «% cartera» en <em>Mi cartera</em>: ningún activo debería dominar tu patrimonio sin una razón clara.</li>
</ul>`,
          quiz: [
            { q: '¿Qué cartera está más diversificada?', options: ['100 % BTC', '50 % BTC + 50 % ETH', '40 % BTC + 30 % EUR/USD + 30 % oro'], answer: 2, explain: 'Combina activos de mercados distintos, que no se mueven igual.' },
            { q: 'Si BTC cae con fuerza, normalmente las demás criptomonedas…', options: ['Suben', 'También caen', 'No se ven afectadas'], answer: 1, explain: 'Las cripto están muy correlacionadas con BTC.' },
            { q: 'Diversificar sirve sobre todo para…', options: ['Ganar más en cada operación', 'Reducir el riesgo total', 'Pagar menos comisiones'], answer: 1, explain: 'El objetivo es que un mal activo no hunda toda la cuenta.' },
          ],
          task: { id: 'diversify3', text: 'Ten posiciones abiertas en al menos 3 activos distintos a la vez.' },
          action: { label: 'Ir a Mercado', view: 'market' },
        },
        {
          id: 'l7', title: 'Psicología y diario de trading',
          body: `
<p>La mayoría de errores no son técnicos, sino emocionales:</p>
<ul>
  <li><strong>FOMO</strong> (miedo a quedarse fuera): comprar tarde porque «todo el mundo gana».</li>
  <li><strong>Revancha</strong>: operar más grande tras una pérdida para recuperarla rápido.</li>
  <li><strong>Mover el stop</strong> para no aceptar una pérdida pequeña… que se vuelve grande.</li>
  <li><strong>Cerrar las ganancias demasiado pronto</strong> por miedo a perderlas.</li>
</ul>
<p>La mejor herramienta contra esto es un <strong>diario de trading</strong>: anota en cada operación el setup, el motivo y cómo te sentías. Con el tiempo, las estadísticas del diario te dirán qué setups funcionan y en qué estado emocional pierdes dinero.</p>`,
          quiz: [
            { q: 'Pierdes 200 USD y abres enseguida una operación el doble de grande para recuperarlos. Eso es…', options: ['Buena gestión', 'Trading de revancha', 'Diversificación'], answer: 1, explain: 'Es uno de los errores emocionales más caros.' },
            { q: '¿Para qué sirve un diario de trading?', options: ['Para pagar impuestos', 'Para detectar patrones en tus aciertos y errores', 'Para copiar a otros'], answer: 1, explain: 'Te da datos sobre tu propio comportamiento.' },
            { q: 'El precio se acerca a tu stop. ¿Qué haces según tu plan?', options: ['Lo alejo para darle margen', 'Lo dejo donde está', 'Lo quito'], answer: 1, explain: 'El stop se decidió con la cabeza fría: se respeta.' },
          ],
          task: { id: 'journal', text: 'Escribe una nota en el diario sobre alguna de tus operaciones.' },
          action: { label: 'Ir al Diario', view: 'journal' },
        },
      ],
    },
    {
      id: 'm3', icon: '📈', title: 'Análisis técnico',
      intro: 'Leer el gráfico: velas, tendencias, indicadores, soportes y resistencias.',
      lessons: [
        {
          id: 'l8', title: 'Velas japonesas y temporalidades',
          body: `
<p>Cada <strong>vela</strong> resume un periodo (1 minuto, 1 hora, 1 día…) con cuatro precios: <strong>apertura, máximo, mínimo y cierre</strong>. El cuerpo va de la apertura al cierre; las <strong>mechas</strong> marcan el máximo y el mínimo.</p>
<ul>
  <li>Vela <span class="up">verde</span>: cerró por encima de la apertura (subió).</li>
  <li>Vela <span class="down">roja</span>: cerró por debajo (bajó).</li>
  <li>Mecha larga inferior: el precio bajó mucho pero los compradores lo devolvieron arriba (rechazo).</li>
</ul>
<p>La <strong>temporalidad</strong> cambia la perspectiva: en 5m ves ruido; en 1d ves la tendencia de fondo. Una práctica común es mirar la tendencia en una temporalidad alta (4h/1d) y buscar la entrada en una baja (15m/1h).</p>
<p>Pasa el ratón por el gráfico de Mercado: la cruz de precio te muestra los datos de cada vela.</p>`,
          quiz: [
            { q: 'Una vela abre en 100, sube a 110, baja a 95 y cierra en 105. ¿Su máximo?', options: ['100', '105', '110'], answer: 2, explain: 'El máximo es el precio más alto alcanzado: 110.' },
            { q: 'Esa misma vela, ¿de qué color es?', options: ['Verde', 'Roja'], answer: 0, explain: 'Cerró (105) por encima de la apertura (100).' },
            { q: 'Para ver la tendencia de fondo es mejor una temporalidad…', options: ['Baja (1m)', 'Alta (1d)'], answer: 1, explain: 'Las temporalidades altas filtran el ruido.' },
          ],
        },
        {
          id: 'l9', title: 'Tendencia y medias móviles',
          body: `
<p>Una <strong>tendencia alcista</strong> hace máximos y mínimos cada vez más altos; una bajista, cada vez más bajos. «La tendencia es tu amiga»: operar a favor suele ser más fácil que en contra.</p>
<ul>
  <li><strong>SMA</strong> (media móvil simple): promedio de los últimos N cierres. Suaviza el precio. La SMA 50 y la SMA 200 son las más vigiladas.</li>
  <li><strong>EMA</strong> (exponencial): da más peso a los precios recientes y reacciona antes.</li>
  <li><strong>Cruce dorado</strong>: la media corta cruza por encima de la larga (señal alcista). <strong>Cruce de la muerte</strong>: al revés.</li>
  <li><strong>VWAP</strong>: precio medio ponderado por volumen del día; muy usado por institucionales como referencia de «precio justo».</li>
</ul>
<p>Actívalas en el menú <em>Indicadores</em> del gráfico.</p>`,
          quiz: [
            { q: 'Máximos y mínimos cada vez más altos indican…', options: ['Tendencia alcista', 'Tendencia bajista', 'Rango lateral'], answer: 0, explain: 'Es la definición de tendencia alcista.' },
            { q: '¿Qué media reacciona más rápido a un cambio de precio?', options: ['SMA 20', 'EMA 20'], answer: 1, explain: 'La EMA da más peso a los precios recientes.' },
            { q: 'La SMA 50 cruza por encima de la SMA 200. Se conoce como…', options: ['Cruce de la muerte', 'Cruce dorado', 'Divergencia'], answer: 1, explain: 'Es el famoso cruce dorado.' },
          ],
          action: { label: 'Ir al gráfico', view: 'market' },
        },
        {
          id: 'l10', title: 'Osciladores: RSI, MACD y Estocástico',
          body: `
<ul>
  <li><strong>RSI</strong> (0–100): mide la fuerza de las subidas frente a las bajadas. Por encima de 70 = «sobrecompra»; por debajo de 30 = «sobreventa». En tendencias fuertes puede quedarse mucho tiempo en esas zonas.</li>
  <li><strong>MACD</strong>: diferencia entre la EMA 12 y la EMA 26, con una línea de señal (EMA 9). Cuando el MACD cruza su señal hacia arriba indica impulso alcista; el histograma muestra la fuerza.</li>
  <li><strong>Estocástico</strong> (0–100): dónde está el cierre dentro del rango de las últimas N velas. Por encima de 80, cerca de los máximos; por debajo de 20, cerca de los mínimos.</li>
  <li><strong>Divergencia</strong>: el precio hace un máximo más alto pero el oscilador uno más bajo. Avisa de que el impulso se agota.</li>
</ul>`,
          quiz: [
            { q: 'Un RSI de 25 se considera…', options: ['Sobrecompra', 'Sobreventa', 'Neutral'], answer: 1, explain: 'Por debajo de 30 es zona de sobreventa.' },
            { q: 'El MACD cruza su línea de señal hacia arriba. Indica…', options: ['Impulso alcista', 'Impulso bajista', 'Nada'], answer: 0, explain: 'Es la señal clásica de impulso alcista.' },
            { q: 'El precio marca un máximo más alto pero el RSI uno más bajo. Es una…', options: ['Confirmación', 'Divergencia bajista', 'Ruptura'], answer: 1, explain: 'El impulso no acompaña al precio: divergencia bajista.' },
          ],
          action: { label: 'Ir al gráfico', view: 'market' },
        },
        {
          id: 'l11', title: 'Volatilidad, soportes, resistencias y Fibonacci',
          body: `
<ul>
  <li><strong>Bandas de Bollinger</strong>: media de 20 velas ± 2 desviaciones típicas. Bandas estrechas anuncian un movimiento fuerte; el precio fuera de las bandas es un movimiento extremo.</li>
  <li><strong>ATR</strong>: cuánto se mueve de media una vela. Útil para poner el stop fuera del «ruido» normal (por ejemplo, a 1,5 ATR).</li>
  <li><strong>Soporte</strong>: nivel donde el precio rebotó hacia arriba varias veces. <strong>Resistencia</strong>: donde rebotó hacia abajo. Cuando se rompen, suelen intercambiar papeles.</li>
  <li><strong>Fibonacci</strong>: tras un impulso, el precio suele retroceder al 38,2 %, 50 % o 61,8 % antes de continuar.</li>
</ul>
<p>Practica con las herramientas de dibujo: <em>Horizontal</em> para soportes y resistencias, <em>Fibonacci</em> sobre el último impulso.</p>`,
          quiz: [
            { q: 'Las bandas de Bollinger se estrechan mucho. Suele anunciar…', options: ['Un movimiento fuerte próximo', 'Que el mercado cierra', 'Una comisión alta'], answer: 0, explain: 'Baja volatilidad suele preceder a una expansión.' },
            { q: 'Un soporte roto con fuerza a menudo se convierte en…', options: ['Resistencia', 'Un soporte más fuerte', 'Nada'], answer: 0, explain: 'Los niveles rotos suelen cambiar de papel.' },
            { q: '¿Qué indicador usarías para decidir la distancia del stop según la volatilidad?', options: ['RSI', 'ATR', 'VWAP'], answer: 1, explain: 'El ATR mide el movimiento medio por vela.' },
          ],
          action: { label: 'Ir al gráfico', view: 'market' },
        },
      ],
    },
    {
      id: 'm4', icon: '💱', title: 'Forex y horarios',
      intro: 'Pips, lotes, sesiones de mercado y kill zones.',
      lessons: [
        {
          id: 'l12', title: 'Forex: pips y lotes',
          body: `
<ul>
  <li>En <strong>EUR/USD</strong> compras euros pagando dólares: si sube, el euro se revaloriza frente al dólar.</li>
  <li><strong>Pip</strong>: la cuarta cifra decimal (0,0001). De 1,1000 a 1,1025 hay 25 pips.</li>
  <li><strong>Lotes</strong>: 1 lote estándar = 100 000 unidades (1 pip ≈ 10 USD), 1 mini lote = 10 000 (≈ 1 USD), 1 micro lote = 1 000 (≈ 0,10 USD).</li>
  <li>Como el forex se mueve poco en %, los brokers ofrecen <strong>apalancamiento</strong>. Aumenta ganancias y pérdidas por igual: la causa principal de que los principiantes pierdan su cuenta.</li>
</ul>
<p>Al operar forex, el panel Operar te muestra el valor de 1 pip y el tamaño en lotes.</p>`,
          quiz: [
            { q: 'EUR/USD pasa de 1,0850 a 1,0900. ¿Cuántos pips?', options: ['5', '50', '500'], answer: 1, explain: '0,0050 = 50 pips.' },
            { q: 'Con 1 lote estándar, ¿cuánto vale aproximadamente 1 pip en EUR/USD?', options: ['0,10 USD', '1 USD', '10 USD'], answer: 2, explain: '100 000 × 0,0001 = 10 USD.' },
            { q: 'El apalancamiento…', options: ['Sólo aumenta las ganancias', 'Aumenta ganancias y pérdidas', 'Reduce el riesgo'], answer: 1, explain: 'Multiplica ambas por igual.' },
          ],
          task: { id: 'forex_trade', text: 'Haz una operación en un par de forex (EUR/USD, GBP/USD o AUD/USD).' },
          action: { label: 'Ir a Mercado', view: 'market' },
        },
        {
          id: 'l13', title: 'Sesiones, kill zones y horarios de bolsa',
          body: `
<ul>
  <li><strong>Sesiones de forex</strong> (hora local): Tokio 9:00–18:00, Londres 8:00–17:00, Nueva York 8:00–17:00. El forex abre el domingo a las 17:00 y cierra el viernes a las 17:00 (hora de NY).</li>
  <li>La mayor liquidez y volatilidad está en el <strong>solape Londres–Nueva York</strong>.</li>
  <li><strong>Kill zones de ICT</strong> (hora de NY): Asia 20:00–00:00, Londres 2:00–5:00, Nueva York 7:00–10:00, cierre de Londres 10:00–12:00. Es cuando suelen formarse los movimientos importantes del día.</li>
  <li>Idea típica: marcar el rango de Asia y esperar a que Londres o Nueva York barran uno de sus extremos.</li>
</ul>
<p>Activa <em>Sesiones</em> y <em>Kill zones</em> en el menú de indicadores (velas de 1h o menos) y mira el panel <em>Horarios de mercado</em>.</p>`,
          quiz: [
            { q: '¿Cuándo suele haber más liquidez en forex?', options: ['En la sesión de Asia', 'En el solape Londres–Nueva York', 'El sábado'], answer: 1, explain: 'Coinciden los dos centros financieros más grandes.' },
            { q: 'La kill zone de Londres de ICT es (hora de NY)…', options: ['2:00–5:00', '8:00–17:00', '20:00–00:00'], answer: 0, explain: 'De 2:00 a 5:00 hora de Nueva York.' },
            { q: '¿Cuándo cierra el forex?', options: ['Cada día a medianoche', 'El viernes a las 17:00 (NY)', 'Nunca'], answer: 1, explain: 'Cierra el fin de semana: de viernes 17:00 a domingo 17:00.' },
          ],
          action: { label: 'Ir al gráfico', view: 'market' },
        },
      ],
    },
    {
      id: 'm5', icon: '🎯', title: 'ICT / Smart Money',
      intro: 'Conceptos de Inner Circle Trader: estructura, imbalances, order blocks y liquidez.',
      lessons: [
        {
          id: 'l14', title: 'Estructura de mercado: BOS y CHoCH',
          body: `
<ul>
  <li>Los <strong>pivotes</strong> (swing highs / swing lows) son máximos y mínimos locales. La estructura se lee con ellos.</li>
  <li><strong>BOS</strong> (<em>Break of Structure</em>): el precio cierra más allá del último pivote <em>a favor</em> de la tendencia. Confirma que continúa.</li>
  <li><strong>CHoCH</strong> (<em>Change of Character</em>): la primera ruptura <em>en contra</em>. Avisa de un posible cambio de tendencia.</li>
</ul>
<p>En una tendencia alcista esperas BOS alcistas; el primer CHoCH bajista es la señal para ser prudente o cerrar compras.</p>`,
          quiz: [
            { q: 'En tendencia alcista, el precio rompe el último máximo. Es un…', options: ['BOS', 'CHoCH', 'FVG'], answer: 0, explain: 'Ruptura a favor de la tendencia: BOS.' },
            { q: 'En tendencia alcista, el precio rompe el último mínimo relevante. Es un…', options: ['BOS', 'CHoCH'], answer: 1, explain: 'Primera ruptura en contra: CHoCH.' },
            { q: 'Tras un CHoCH bajista, lo prudente con tus compras es…', options: ['Comprar más', 'Proteger o cerrar la posición', 'Ignorarlo'], answer: 1, explain: 'Es una señal de posible cambio de tendencia.' },
          ],
          action: { label: 'Ir al gráfico', view: 'market' },
        },
        {
          id: 'l15', title: 'Fair Value Gaps y Order Blocks',
          body: `
<ul>
  <li><strong>Fair Value Gap (FVG) o imbalance</strong>: en un movimiento fuerte de tres velas, el hueco entre la mecha de la vela 1 y la de la vela 3. El precio suele volver a «rellenarlo». En el gráfico aparecen en verde (alcistas) o rojo (bajistas) hasta que se rellenan.</li>
  <li><strong>Order Block (OB)</strong>: la última vela contraria antes del impulso que rompió la estructura. Se considera zona de órdenes institucionales; al volver a ella el precio suele reaccionar.</li>
  <li>Setup típico: tras un BOS alcista, esperar a que el precio retroceda a un FVG u OB alcista para comprar, con el stop bajo la zona.</li>
</ul>`,
          quiz: [
            { q: 'Un FVG alcista es el hueco entre…', options: ['El máximo de la vela 1 y el mínimo de la vela 3', 'La apertura y el cierre de una vela', 'Dos medias móviles'], answer: 0, explain: 'Es el hueco que deja un movimiento fuerte entre las mechas de las velas 1 y 3.' },
            { q: 'Un Order Block alcista es…', options: ['La última vela bajista antes del impulso alcista', 'Cualquier vela verde', 'El máximo del día'], answer: 0, explain: 'La última vela contraria antes de la ruptura.' },
            { q: 'Tras un BOS alcista, ¿dónde buscarías una compra?', options: ['En un FVG u OB alcista al retroceder', 'En el máximo más alto', 'En cualquier sitio'], answer: 0, explain: 'Se espera el retroceso a una zona de interés.' },
          ],
          action: { label: 'Ir al gráfico', view: 'market' },
        },
        {
          id: 'l16', title: 'Liquidez, premium/discount y OTE',
          body: `
<ul>
  <li><strong>Liquidez</strong>: por encima de máximos iguales (EQH, <em>buy-side liquidity</em>) y por debajo de mínimos iguales (EQL, <em>sell-side liquidity</em>) se acumulan stops. El precio suele ir a «barrerlos».</li>
  <li><strong>Barrida</strong>: la mecha supera el nivel y el precio vuelve dentro. A menudo marca un giro.</li>
  <li><strong>Premium / Discount</strong>: por encima del 50 % del rango el precio está «caro» (buscar ventas); por debajo, «barato» (buscar compras).</li>
  <li><strong>OTE</strong> (<em>Optimal Trade Entry</em>): retroceso del 62 %–79 % de un impulso. La herramienta Fibonacci lo sombrea en naranja.</li>
  <li><strong>PDH/PDL</strong>: máximo y mínimo del día anterior; imanes de liquidez habituales.</li>
</ul>`,
          quiz: [
            { q: '¿Dónde se acumula la liquidez compradora (BSL)?', options: ['Por encima de máximos iguales', 'Por debajo de mínimos iguales', 'En la media móvil'], answer: 0, explain: 'Ahí están los stops de quien vende y las órdenes de ruptura.' },
            { q: 'Según ICT, las compras se buscan preferentemente en zona…', options: ['Premium', 'Discount'], answer: 1, explain: 'Comprar barato: por debajo del 50 % del rango.' },
            { q: 'La zona OTE corresponde al retroceso…', options: ['23–38 %', '62–79 %', '100–127 %'], answer: 1, explain: 'Entre el 62 % y el 79 % del impulso.' },
          ],
          action: { label: 'Ir al gráfico', view: 'market' },
        },
      ],
    },
    {
      id: 'm6', icon: '🤖', title: 'Estrategias y automatización',
      intro: 'Probar ideas con datos, practicar con el pasado y automatizar con bots.',
      lessons: [
        {
          id: 'l17', title: 'Backtesting y sobreajuste',
          body: `
<p>Un <strong>backtest</strong> aplica las reglas de una estrategia a datos pasados para ver cómo habría funcionado. Aquí la señal se calcula al cierre de una vela y se ejecuta en la apertura de la siguiente, con comisiones, para no «hacer trampa».</p>
<ul>
  <li>Compara siempre con <strong>comprar y mantener</strong>: si no lo superas, ¿vale la pena?</li>
  <li><strong>Máxima caída</strong>: la peor pérdida desde un máximo. ¿La soportarías sin nervios?</li>
  <li><strong>Factor de beneficio</strong>: ganancias ÷ pérdidas. Mayor que 1 es rentable.</li>
  <li><strong>Sobreajuste</strong>: si ajustas los parámetros hasta que el pasado sale perfecto, probablemente falle en el futuro. Prueba la misma configuración en otros pares y periodos.</li>
</ul>`,
          quiz: [
            { q: 'Tu estrategia gana un 8 % y comprar y mantener un 20 % en el mismo periodo. ¿Conclusión?', options: ['Es excelente', 'Habría sido mejor comprar y mantener', 'No se puede comparar'], answer: 1, explain: 'Siempre hay que compararla con la alternativa más simple.' },
            { q: 'Un factor de beneficio de 0,8 significa que…', options: ['Gana dinero', 'Pierde dinero', 'No opera'], answer: 1, explain: 'Las pérdidas superan a las ganancias.' },
            { q: 'Ajustar parámetros hasta que el backtest sale perfecto provoca…', options: ['Sobreajuste', 'Diversificación', 'Apalancamiento'], answer: 0, explain: 'La estrategia se adapta al ruido del pasado, no a un patrón real.' },
          ],
          task: { id: 'backtest', text: 'Ejecuta un backtest de cualquier estrategia.' },
          action: { label: 'Ir a Backtesting', view: 'backtest' },
        },
        {
          id: 'l18', title: 'Modo Replay: practicar con el pasado',
          body: `
<p>El <strong>modo Replay</strong> te lleva a una fecha pasada y te muestra el gráfico vela a vela, sin saber qué viene después. Es la forma más rápida de ganar experiencia: en una tarde puedes «vivir» semanas de mercado.</p>
<ul>
  <li>Prueba fechas famosas: el crash de marzo de 2020, el máximo de BTC en noviembre de 2021, la caída de FTX en noviembre de 2022…</li>
  <li>Usa la <strong>fecha aleatoria</strong> para evitar el sesgo de saber qué pasó.</li>
  <li>Decide antes de avanzar: ¿entro, dónde pongo el stop, cuál es mi objetivo? Y luego mira qué ocurrió.</li>
  <li>Al terminar, la sesión se guarda con tus estadísticas para compararla con las siguientes.</li>
</ul>`,
          quiz: [
            { q: '¿Qué ventaja tiene el Replay frente a operar en vivo?', options: ['Ganas dinero real', 'Practicas semanas de mercado en poco tiempo', 'Ves el futuro'], answer: 1, explain: 'Puedes acelerar el tiempo y repetir situaciones.' },
            { q: '¿Por qué usar una fecha aleatoria?', options: ['Para evitar el sesgo de saber qué pasó', 'Porque es más rápido', 'Porque hay más datos'], answer: 0, explain: 'Si recuerdas lo que ocurrió, no practicas de verdad.' },
            { q: 'En el Replay, ¿cuándo decides tu stop?', options: ['Después de ver las siguientes velas', 'Antes de entrar', 'Nunca'], answer: 1, explain: 'Igual que en real: el plan se hace antes.' },
          ],
          task: { id: 'replay', text: 'Completa y guarda una sesión en el modo Replay.' },
          action: { label: 'Ir a Replay', view: 'replay' },
        },
        {
          id: 'l19', title: 'Construye tu propia estrategia',
          body: `
<p>En <strong>Estrategias</strong> puedes crear reglas sin programar, combinando condiciones con Y/O:</p>
<ul>
  <li>Comparaciones: «RSI 14 es menor que 30», «precio cruza por encima de EMA 50».</li>
  <li>Condiciones ICT y de horario: «el precio toca un FVG alcista», «kill zone de Londres», «zona discount».</li>
</ul>
<p>Buenas prácticas: una idea clara (tendencia, reversión, ruptura…), pocas condiciones, reglas de salida definidas y siempre con stop-loss. Pruébala en el backtest en varios pares y compártela con la comunidad para que otros la mejoren.</p>`,
          quiz: [
            { q: '«RSI < 30 Y precio > EMA 200» compra cuando…', options: ['Se cumple cualquiera de las dos', 'Se cumplen las dos a la vez'], answer: 1, explain: 'El modo Y exige todas las condiciones.' },
            { q: '¿Qué es mejor para una primera estrategia?', options: ['Muchas condiciones muy específicas', 'Pocas condiciones con una idea clara'], answer: 1, explain: 'Muchas condiciones suelen llevar al sobreajuste.' },
            { q: 'Si la estrategia no tiene reglas de venta, la posición se cierra…', options: ['Nunca', 'Con el stop-loss / take-profit / trailing', 'Al día siguiente'], answer: 1, explain: 'Las salidas de riesgo cierran la posición.' },
          ],
          task: { id: 'custom_strategy', text: 'Guarda una estrategia propia en el constructor.' },
          action: { label: 'Ir a Estrategias', view: 'builder' },
        },
        {
          id: 'l20', title: 'Bots: señales, DCA y grid',
          body: `
<ul>
  <li><strong>🧠 Bot de señales</strong>: ejecuta una estrategia al cierre de cada vela, con stop-loss, take-profit y trailing stop.</li>
  <li><strong>📅 Bot DCA</strong>: compra una cantidad fija cada X horas sin importar el precio; puede comprar extra en caídas y vender al alcanzar un % sobre el precio medio. Reduce el riesgo de entrar en mal momento.</li>
  <li><strong>🔲 Bot grid</strong>: reparte la inversión en niveles dentro de un rango; compra al bajar un nivel y vende al subir al siguiente. Gana en mercados laterales, pero acumula pérdidas si el precio sale del rango por abajo.</li>
</ul>
<p>Un bot no es «dinero fácil»: automatiza una estrategia, buena o mala. Pruébala antes en el backtest y vigila su registro.</p>`,
          quiz: [
            { q: '¿Qué bot funciona mejor en un mercado lateral?', options: ['Grid', 'DCA', 'Ninguno'], answer: 0, explain: 'El grid gana con las oscilaciones dentro de un rango.' },
            { q: 'Comprar 100 USD cada semana sin mirar el precio es…', options: ['Trading de ruptura', 'DCA', 'Scalping'], answer: 1, explain: 'Dollar Cost Averaging.' },
            { q: 'Si la estrategia es mala, el bot…', options: ['La mejora solo', 'La ejecuta igualmente', 'No opera'], answer: 1, explain: 'Un bot sólo automatiza reglas.' },
          ],
          task: { id: 'bot', text: 'Crea un bot de cualquier tipo.' },
          action: { label: 'Ir a Bots', view: 'bots' },
        },
      ],
    },
  ];

  // Insignias: se ganan al completar módulos o tareas concretas.
  const BADGES = [
    { id: 'first_trade', icon: '🚀', name: 'Primer paso', desc: 'Hiciste tu primera operación', task: 'trade' },
    { id: 'risk', icon: '🛡️', name: 'Gestor de riesgo', desc: 'Operaste con stop-loss y objetivo', task: 'bracket' },
    { id: 'journal', icon: '📓', name: 'Diarista', desc: 'Escribiste 5 notas en el diario', task: 'journal5' },
    { id: 'replay', icon: '⏪', name: 'Viajero en el tiempo', desc: 'Completaste una sesión de Replay', task: 'replay' },
    { id: 'architect', icon: '🏗️', name: 'Arquitecto', desc: 'Creaste tu propia estrategia', task: 'custom_strategy' },
    { id: 'robot', icon: '🤖', name: 'Programador de robots', desc: 'Pusiste un bot a trabajar', task: 'bot' },
    ...MODULES.map((m) => ({ id: 'module_' + m.id, icon: m.icon, name: m.title, desc: `Completaste el módulo «${m.title}»`, module: m.id })),
    { id: 'graduate', icon: '🎓', name: 'Graduado', desc: 'Completaste toda la Academia', all: true },
  ];

  const LESSONS = MODULES.flatMap((m) => m.lessons.map((l) => ({ ...l, module: m.id })));
  const PASS = 0.66; // % mínimo del quiz para aprobar

  const api = { MODULES, LESSONS, BADGES, PASS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Courses = api;
})(this);

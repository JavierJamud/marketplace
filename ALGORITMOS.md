# Algoritmos de posicionamiento y supervisión — Baznova

> Pedido explícito (Bloque 225): inventario enumerado de todos los algoritmos del
> código que **posicionan** (deciden qué se muestra primero/destacado) o
> **supervisan** (monitorean el sistema y actúan solos) la plataforma. Todas las
> rutas de archivo son relativas a `backend/src`, dentro de
> `C:\PROJECT\marketplace\v2\www\backend`.
>
> Última actualización: 2026-09-20 (junto con la gráfica única de ventas y el
> consejo de "mejor día de la semana" — ver Bloque 225 en
> `controllers/vendors.controller.js` y `services/vendorDailyTips.service.js`).

## Índice

- [A. Algoritmos de posicionamiento / ranking](#a-algoritmos-de-posicionamiento--ranking)
- [B. Trabajos de supervisión / monitoreo (crons)](#b-trabajos-de-supervisión--monitoreo-crons)
- [C. Umbrales y pesos — cuáles el admin puede cambiar y cuáles no](#c-umbrales-y-pesos--cuáles-el-admin-puede-cambiar-y-cuáles-no)

---

## A. Algoritmos de posicionamiento / ranking

### A1. Ranking de "Destacados" — `lib/productRanking.js`

El algoritmo central de posicionamiento del sitio. Función `rankFeaturedProducts()`
(línea 62). Combina en un solo score 0..1 seis señales reales, cada una
normalizada contra el máximo del lote consultado (min-max, se recalibra solo a
medida que crece el catálogo):

| Señal | Peso |
|---|---|
| Ventas confirmadas | 0.30 |
| Clics en la tienda | 0.15 |
| Clics desde búsqueda | 0.15 |
| Tiempo promedio en la página (dwell) | 0.10 |
| Completitud del contenido (fotos, descripción) | 0.15 |
| Calificación (reseñas) | 0.15 |

Piso de calidad (nunca se destaca sin pasar esto, sin importar las demás
señales): completitud mínima 40% en tiendas verificadas / 65% en no
verificadas (`MIN_COMPLETENESS_VERIFIED`/`MIN_COMPLETENESS_UNVERIFIED`, líneas
26-27); calificación mínima 3.0 si el producto ya tiene reseñas
(`MIN_RATING_IF_REVIEWED`, línea 32).

Arranque en frío: un producto recién activado recibe un empujón temporal de
+0.08 al score durante sus primeros 14 días (`NEW_PRODUCT_BOOST`/
`NEW_PRODUCT_BOOST_DAYS`, líneas 39-40), para que tenga una chance real de
mostrarse antes de competir 100% por mérito acumulado.

**Usado por**: Home ("Destacados") y también es el modo `sort=relevance`
(el default cuando no se elige otro orden) del buscador/catálogo — ver A2.

### A2. Búsqueda y catálogo — `controllers/search.controller.js`

- **`structuredSearch()`** (líneas 124-272): funnel de 3 niveles para el texto
  buscado — coincidencia literal sin acentos (`findProductIdsByName`, línea
  28) → si no hay resultados, corrección con IA (`correctSearchQuery`,
  `lib/ai.js`) → si sigue sin haber resultados, similitud difusa por trigramas
  de Postgres (`findProductIdsByTrigram`, línea 91, umbral `TRIGRAM_THRESHOLD
  = 0.15`, línea 86). El orden final depende del modo elegido: `price-asc`/
  `price-desc` (numérico simple), `rating` (promedio de `Review`), o el
  default/`relevance`, que delega en A1. El pool de candidatos se limita a 300
  antes de rankear y se recorta a 60 después (líneas 197 y 255).
- **`autocompleteSearch()`** (líneas 306-399): ranking propio, más simple, para
  el dropdown de autocompletar (280ms de debounce). `matchTier()` (línea 285)
  ordena productos: 0=nombre exacto, 1=nombre contiene la búsqueda, 2=coincide
  una etiqueta, 3=solo la descripción; en empates gana el que sea destacado o
  de tienda verificada (líneas 370-371). `vendorMatchTier()` (línea 297) hace
  lo mismo para tiendas: 0=nombre exacto, 1=empieza con, 2=contiene. Si no hay
  coincidencia literal, usa el orden que ya trae la búsqueda por trigramas
  (ese SQL ya ordena por similitud, líneas 362-366 explican por qué ahí no se
  vuelve a rankear).

### A3. Badge "Más vendido" — `controllers/products.controller.js`

`attachBestSellerFlag()` (línea 322), constante `BESTSELLER_WINDOW_DAYS = 30`
(línea 311). Por cada tienda, suma las unidades vendidas de cada producto en
los últimos 30 días (agrupado con `orderItem.groupBy`, líneas 327-331) y le
pone `isBestSeller: true` solo al más vendido de esa tienda (líneas 338-345).
Mismo criterio de ventana (30 días) que usa el panel de vendedor en
`vendors.controller.js` para "Productos más vendidos · este mes".

### A4. Elegibilidad de ofertas — `controllers/offers.controller.js`

No es un ranking de resultados, sino un filtro de "quién puede publicar
ahora": `cooldownStatus()`/`assertCooldownOk()` (líneas 92-111) miran si la
última oferta del vendedor sigue `ACTIVE` (un `REMOVED`/`EXPIRED` no bloquea);
la ventana de cooldown es configurable por el admin
(`SiteSettings.offerCooldownDays`, ver C). `listActiveOffers()` (línea 116)
ordena las ofertas activas por fecha de creación descendente para la franja
de ofertas del Home.

---

## B. Trabajos de supervisión / monitoreo (crons)

Todos usan `node-cron`, arrancan desde `backend/src/server.js`, y corren en
horario `America/Havana` salvo que se indique lo contrario.

### B1. Vencimiento de ventas rápidas — `jobs/customerListingExpiry.job.js`

`runCustomerListingExpiryJob()` (línea 42) → `deleteExpiredListings()` (línea
21): busca `CustomerListing` con `expiresAt` vencido, borra sus fotos del
disco y BORRA la fila (el único cron del proyecto que elimina datos de
verdad, en vez de solo cambiar un estado). Corre a las **7:00am**.

### B2. Stock bajo — `jobs/lowStock.job.js`

`runLowStockJob()` (línea 22): busca productos activos con seguimiento de
stock entre 1 y `LOW_STOCK_THRESHOLD` (=3) unidades que todavía no fueron
avisados, agrupa por tienda y manda un correo por vendedor; también limpia la
marca de "ya avisado" en los productos que se repusieron, para que la próxima
vez que bajen vuelvan a avisar. Corre a las **7:30am**.

### B3. Ciclo de vida del vendedor — `jobs/vendorLifecycle.job.js`

`runVendorLifecycleJob()` (línea 147), 3 pasos:
1. Recordatorio de inactividad a los 7 días sin entrar al panel.
2. **Auto-suspensión** de la tienda (`Vendor.status = "SUSPENDED"`) a los 90
   días de inactividad, con registro en `VendorStatusLog`.
3. Correos de reactivación ("winback") a clientes con exactamente 1 pedido de
   hace 30+ días, si esa tienda publicó una oferta nueva en las últimas 24h.

Corre a las **8:00am**. Es el cron más antiguo del proyecto.

### B4. Cobro y vencimiento de verificación — `jobs/verificationPayment.job.js`

`runVerificationPaymentJob()` (línea 151), para tiendas que NO pagan por
Stripe (esas las gobierna el webhook de Stripe aparte):
1. Finaliza cancelaciones diferidas que ya llegaron a su fecha.
2. Recordatorio de pago 7 días antes del vencimiento.
3. **Auto-vence** la verificación (`PAYMENT_FAILED`) si pasó la fecha sin
   pago confirmado.

Corre a las **8:30am**. Aparte, `expireStalePendingPaymentApprovals()` (línea
123) **auto-rechaza** a una tienda si quedó más de 24h en `PENDING_PAYMENT`
después de que el admin ya aprobó sus documentos — corre **cada hora**
(`"0 * * * *"`), más seguido que el resto, justo para que esa promesa de 24h
se cumpla de verdad y no se demore hasta 48h.

### B5. Reportes de fraude — `jobs/fraudReports.job.js`

`runFraudReportsJob()` (línea 74), sobre reportes en estado
`EVIDENCE_REQUESTED`:
1. Recordatorio 1 día antes de que venza el plazo de evidencia (plazo
   configurable por el admin, default 5 días — ver C).
2. **Auto-resuelve con la consecuencia de fraude** (misma función que usa un
   admin al resolver a mano, `applyFraudConsequence`) a cualquier reporte
   cuyo plazo venció sin evidencia — oculta el producto, bloquea la tienda o
   suspende al cliente, según a quién apunte el reporte.

Corre a las **9:00am**.

### B6. Salud y auto-reparación de proveedores de IA — `jobs/aiHealthCheck.job.js`

`runAiHealthCheckJob()` (línea 96): por cada proveedor de IA activo
(Gemini/Groq/NVIDIA NIM), prueba el modelo configurado con un prompt trivial.
Si falla, busca en paralelo (hasta 10 candidatos) un modelo que sí funcione y,
si encuentra uno, **cambia sola** la configuración
(`SiteSettings.aiModel<Proveedor>`) y avisa al admin por correo; si no
encuentra ninguno, avisa que el proveedor está caído. El cron corre cada hora
pero se auto-limita a ejecutar de verdad una sola vez al día, a las 3am **en
el huso horario que el admin tenga configurado en ese momento** (se relee en
cada tick, porque `node-cron` fija su propio timezone al arrancar el proceso
y no seguiría un cambio posterior).

Aparte del cron, hay un camino de reparación **reactivo** (no programado):
`lib/aiModelRepair.js` → `repairProviderModel()`, que se dispara solo cuando
un pedido real de un usuario falla contra la IA en producción — vuelve a
probar el modelo roto y, si sigue mal, busca un reemplazo en caliente, con un
enfriamiento de 5 minutos por proveedor para que una ráfaga de fallos
simultáneos no dispare varias búsquedas de reemplazo a la vez.

### B7. Recordatorio de cierre de caja — `jobs/cashCloseReminder.job.js`

`runCashCloseReminderJob()` (línea 40): para vendedores con un cierre de caja
configurado (diario/semanal/mensual), revisa si hoy es el día que le toca y,
si es así, le manda al personal con permiso de "ventas-manuales" sus totales
del período. Corre a las **8:30am**.

### B8. Eliminación de cuenta con período de gracia — `jobs/accountDeletion.job.js`

`runAccountDeletionJob()` (línea 63): recordatorio 7 días antes de que se
cumplan los 30 días de gracia desde que alguien pidió eliminar su cuenta, y
**finalización automática** (anonimiza al usuario de verdad) para quien ya
cumplió esos 30 días sin arrepentirse. Corre a las **9:30am**.

### Vencimientos "perezosos" (sin cron propio, se resuelven al pedirlos)

- **Ofertas del Home** — `controllers/offers.controller.js`,
  `expireStaleOffers()` (línea 68): pasa una oferta de `ACTIVE` a `EXPIRED`
  si ya venció, la primera vez que alguien pide la lista después de vencer.
- **Ofertas de tienda** — `controllers/storeOffers.controller.js`,
  `expireStaleStoreOffers()` (línea 36): mismo criterio para `StoreOffer`,
  además desactiva cualquier código de descuento exclusivo atado a esa
  oferta.
- **Badge "Nuevo"** — `controllers/products.controller.js`,
  `expireNewBadges()` (línea 301): saca el badge "Nuevo" de un producto
  después de `SiteSettings.newBadgeDurationDays` (default 14 días,
  configurable por el admin).

---

## C. Umbrales y pesos — cuáles el admin puede cambiar y cuáles no

### Configurables desde el panel de admin (`SiteSettings`)

| Ajuste | Dónde se lee | A quién afecta |
|---|---|---|
| `offerCooldownDays`, `offerDefaultDurationDays` | `controllers/settings.controller.js` (`getOfferPolicy`) | A4 |
| `fraudReportEvidenceDeadlineDays` (default 5) | `controllers/adminReports.controller.js`, `jobs/fraudReports.job.js` | B5 |
| `newBadgeDurationDays` (default 14) | `controllers/products.controller.js` | Badge "Nuevo" |
| `timezone` | `controllers/settings.controller.js` (`getSiteTimezone`) | B6 (hora del chequeo diario) |
| `aiModelGemini` / `aiModelGroq` / `aiModelNvidia` | `lib/ai.js`, `lib/aiModelRepair.js` | B6 y la reparación reactiva escriben acá solos; el admin también puede tocarlo a mano |

### Fijos en el código (no editables desde el panel)

| Constante | Valor | Archivo |
|---|---|---|
| Pesos del ranking de Destacados (`WEIGHTS`) | ventas .30 · clics .15 · clics de búsqueda .15 · dwell .10 · completitud .15 · reseñas .15 | `lib/productRanking.js` |
| Piso de completitud verificada / no verificada | 40% / 65% | `lib/productRanking.js` |
| Calificación mínima si ya tiene reseñas | 3.0 | `lib/productRanking.js` |
| Empujón de arranque en frío | +0.08 durante 14 días | `lib/productRanking.js` |
| Umbral de similitud difusa (trigramas) | 0.15 | `controllers/search.controller.js` |
| Ventana de "Más vendido" | 30 días | `controllers/products.controller.js` |
| Umbral de stock bajo (`LOW_STOCK_THRESHOLD`) | 3 unidades — **duplicado en 3 archivos**, ver nota abajo | `jobs/lowStock.job.js`, `controllers/vendors.controller.js`, `services/vendorDailyTips.service.js` |
| Enfriamiento de reparación de IA | 5 minutos por proveedor | `lib/aiModelRepair.js` |
| Candidatos de modelo a probar | hasta 10, en paralelo | `lib/aiModelRepair.js` |
| Plazo de aprobación-pago pendiente | 24 horas | `jobs/verificationPayment.job.js` |
| Días de inactividad para recordatorio / suspensión | 7 / 90 | `jobs/vendorLifecycle.job.js` |
| Antigüedad mínima de pedido + ventana de oferta para "winback" | 30 días / 24 horas | `jobs/vendorLifecycle.job.js` |
| Período de gracia / recordatorio de eliminación de cuenta | 30 días / 7 días antes | `jobs/accountDeletion.job.js` |

> **Nota — `LOW_STOCK_THRESHOLD` duplicado**: el mismo número (3) está escrito
> a mano en 3 archivos distintos en vez de vivir en un solo lugar
> (`jobs/lowStock.job.js`, `controllers/vendors.controller.js`,
> `services/vendorDailyTips.service.js`). Si algún día se cambia ese umbral,
> hay que tocar los 3 — no es un bug hoy, pero es el tipo de cosa que
> conviene centralizar la próxima vez que se toque cualquiera de esos 3
> archivos.

### Fuera de alcance de este documento

No existe en el código ningún "score de confianza" o de riesgo de fraude
numérico — el manejo de fraude es una máquina de estados binaria
(`Report.status`), no un algoritmo con puntaje. Tampoco se incluyeron acá los
límites de frecuencia de reseñas (`reviewDedupHours`,
`maxReviewsPerProductPerPeriod`, etc., en `controllers/reviews.controller.js`)
porque regulan cada cuánto se puede escribir una reseña, no el posicionamiento
ni la supervisión automática de la plataforma.

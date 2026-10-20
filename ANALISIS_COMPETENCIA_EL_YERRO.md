# Análisis de la competencia: El Yerro (elyerromenu.com) frente a Baznova

Fecha: 19 de octubre de 2026. Fuente: solo lo que El Yerro publica en su web (`app.elyerromenu.com`, `elyerromenu.com`,
`pos.elyerromenu.com`). Los datos de Baznova salen del código y de la configuración local de los planes.

**Nota sobre el método.** Sus Condiciones Generales (sección 3) prohíben recorrer su sitio con bots o scrapers y hacer
ingeniería inversa de su código. Por eso la revisión automática se limitó a las páginas públicas de planes, ayuda, bazar,
registro y términos. No se entró a cuentas, ni a su POS, ni a ninguna API. Para ver una tienda suya por dentro, una
persona puede registrarse en su prueba gratis de una semana.

---

## 1. Quiénes son

- **Empresa:** El Yerro Apps S.R.L. (Cuba).
- **Qué venden:** "Tu catálogo online en minutos". Es un catálogo o carta digital por negocio, con pedidos, y todos
  los negocios aparecen juntos en el **Bazar de El Yerro** (`elyerromenu.com`).
- **Datos que publican:** más de 2 500 negocios activos y 5,38 millones de vistas al mes.
- **Productos aparte:** **YerroPOS** (`pos.elyerromenu.com`, versión 1.9.12), una app de punto de venta separada con
  su propio acceso.
- **Prueba gratis:** 1 semana. **No tienen plan gratis permanente.**
- **Tecnología:** Nuxt (Vue) con renderizado en el servidor, detrás de Cloudflare. Generan imágenes para compartir
  (og:image), tienen datos estructurados schema.org y un centro de ayuda escrito en Markdown (Nuxt Content). Tienen
  un error de consola en la portada ("Hydration completed but contains mismatches"); no afecta a nada, pero indica
  que el HTML del servidor y el del navegador no coinciden.

## 2. Sus planes y precios (CUP, "para residentes en Cuba")

Precio por mes según el plazo que se pague:

| Plan | Mensual | 3 meses | 6 meses | Anual | **Promedio por mes** |
|---|---|---|---|---|---|
| **Básico** | 1 500 | 1 300 (pagas 3 900) | 1 100 (pagas 6 600) | 1 000 (pagas 12 000) | **1 225** |
| **PRO** | 2 500 | 2 167 (pagas 6 500) | 1 833 (pagas 11 000) | 1 667 (pagas 20 000) | **2 042** |
| **Empresa** | 4 500 | 3 900 (pagas 11 700) | 3 300 (pagas 19 800) | 3 000 (pagas 36 000) | **3 675** |

- Descuentos por plazo: **13 %** a 3 meses, **26 %** a 6 meses y **33 %** al año.
- El plan Empresa dice "para negocios privados"; los demás, "para residentes en Cuba". Eso sugiere precios distintos
  para quien no vive en Cuba, aunque no los publican.
- El enlace de registro ya lleva el plan y el plazo elegidos (`signup?plan=pro&billing=year`).

### Qué trae cada plan

Los tres planes muestran la misma lista de 18 funciones; las que no incluye el plan aparecen marcadas con una X. Lo
confirma su propio código, que guarda cada función como `enable` o `disabled`.

| Función | Básico | PRO | Empresa |
|---|:-:|:-:|:-:|
| Perfil de negocio | ✓ | ✓ | ✓ |
| Categorías colapsables (secciones propias del catálogo) | ✓ | ✓ | ✓ |
| Gestión de productos | ✓ | ✓ | ✓ |
| Extras personalizables (complementos con precio) | ✓ | ✓ | ✓ |
| Eventos y promociones | ✓ | ✓ | ✓ |
| Roles y permisos | ✓ | ✓ | ✓ |
| Gestión de pedidos | ✓ | ✓ | ✓ |
| Múltiples monedas | ✓ | ✓ | ✓ |
| Gestión de reseñas | ✓ | ✓ | ✓ |
| Productos | hasta 600 | hasta 1 500 | hasta 1 500 |
| Cintillo publicitario (banda de anuncio en el catálogo) | ✓ | ✓ | ✓ |
| Varias imágenes por producto | ✗ | ✓ | ✓ |
| Gestión de inventario | ✗ | ✓ | ✓ |
| Costo de empaquetado | ✗ | ✓ | ✓ |
| Puede pedir verificación | ✗ | ✓ | ✓ |
| Dos vendedores gratis | ✗ | ✗ | ✓ |
| Punto de venta (POS) | ✗ | ✗ | ✓ |
| Varios almacenes | ✗ | ✗ | ✓ |

### Otras funciones que se ven en su ayuda pública

Su centro de ayuda (`/ayuda`) tiene estas secciones:

- información del negocio, categorías, productos, **extras**, **eventos**, pedidos, **vendedores**, valoraciones,
  horarios y monedas;
- **entrega a domicilio con zonas de entrega** (cada zona con su configuración);
- **recogida en el local**;
- inventario, incluido si se muestra en el catálogo público;
- **cupones**.

Además tienen tutoriales en YouTube, un programa de **referidos**, un programa de **agentes de ventas** y
atención por WhatsApp.

### Su bazar (la portada pública)

- 48 tipos de negocio para filtrar.
- "Negocios en tendencia", y colecciones de **productos de alta demanda** con página propia (`/top/ecoflow`,
  `/top/ventiladores-recargables`).
- Colecciones por lugar, a nivel de **municipio**: "Negocios en Diez de Octubre", "Ropa y accesorios en Playa",
  "Básicos de la cocina casera en Santa Clara". Cada una tiene una URL propia (`/l/...`) pensada para salir en Google.
- Cada tienda muestra su puntuación, si hace **domicilio** o **recogida**, y un **rango de precio ($–$$$$$)**.
- Una tienda desactivada sigue visible con el aviso "Cerrados temporalmente" y un botón para contactar al negocio.
  No se pierde la página ni los clientes.

---

## 3. Nuestros planes hoy (Baznova)

Esta es la configuración local de `PlanConfig`; la de producción la cambia el admin.

| | **Regular (gratis)** | **Premium (de pago)** |
|---|---|---|
| Precio | 0 | **2 500 CUP/mes** por transferencia o **25 USD/mes** con tarjeta (Stripe, cobro automático) |
| Plazos | — | 1, 3, 6 o 12 meses, **sin descuento por pagar más meses** |
| Prueba | — | **30 días gratis** del plan de pago al completar el checklist |
| Productos | 10 (el texto dice "Hasta 20") | ilimitados |
| Provincias de entrega / países | 1 / 1 | ilimitadas / 10 |
| Pedidos por WhatsApp y por el panel, perfil público, horarios | ✓ | ✓ |
| Ofertas de tienda, códigos de descuento por moneda | ✗ | ✓ |
| Menú QR y mesas (restaurantes) | ✗ | ✓ |
| Usuarios del equipo con permisos por sección | ✗ | ✓ ilimitados |
| Caja / POS con código de barras y pantalla del cliente | ✗ | ✓ |
| Programa de puntos (fidelidad) | ✗ | ✓ |
| Chat con IA de la tienda | ✗ | ✓ |
| Correos a clientes con el nombre de la tienda (pedido, factura, reseña, recordatorios) | ✗ | ✓ |
| Fotos en reseñas, chat con el admin | ✗ | ✓ |
| Sello de tienda verificada (verificación de identidad) | ✗ | ✓ |
| Destacada en la portada | ✗ | ✓ |

> **Hay que corregir:** el plan Regular dice "Hasta 20 productos" en sus beneficios, pero el límite real es 10.

---

## 4. Lo que El Yerro tiene y Baznova no (para agregar)

Ordenado de mayor a menor impacto en ventas.

| # | Función | Para qué sirve | En qué plan lo pondríamos |
|---|---|---|---|
| 1 | **Descuento por pagar más meses** (3, 6, 12) | Hoy cobramos igual por mes en cualquier plazo, y ellos dan hasta 33 % menos. Es la palanca de precio más visible. | Todos los de pago |
| 2 | **Zonas de entrega con costo** (por municipio o barrio, monto y mínimo de compra) y **recogida en el local** como opción del pedido | Hoy no cobramos ni mostramos el costo del domicilio. Para comida y tiendas es básico. | Desde el primer plan de pago (una zona en Gratis) |
| 3 | **Extras o complementos por producto** (ej.: "queso extra +50", "sin cebolla", con precio y límite) | Imprescindible para restaurantes, cafeterías y pizzerías, que son buena parte de sus tiendas. | Todos |
| 4 | **Secciones propias del catálogo** (categorías del negocio, plegables) | Hoy el producto solo usa la categoría general del marketplace; la tienda no puede ordenar su menú a su manera. | Todos |
| 5 | **Cintillo publicitario** en la tienda (banda con un mensaje: "Envío gratis hoy") | Avisos rápidos sin crear una oferta. | Básico en adelante |
| 6 | **Eventos** (fechas especiales con productos o precios propios) | Promociones con inicio y fin. Hoy tenemos ofertas, pero no eventos con fecha. | Básico en adelante |
| 7 | **Costo de empaquetado** por producto o pedido | Común en comida para llevar. | Pro en adelante |
| 8 | **Varios almacenes** (stock por local o depósito) | Negocios con más de un punto. | Empresa |
| 9 | **Vendedores con enlace propio** (`/b/tienda/seller/codigo`) y sus ventas atribuidas | Revendedores o mensajeros que comparten el catálogo y cobran comisión. | Pro o Empresa |
| 10 | **Programa de referidos** para tiendas (una tienda trae otra y gana meses gratis) | Crecimiento barato. Ellos lo anuncian; nosotros no lo tenemos. | Plataforma |
| 11 | **Páginas por municipio y por colección** que Google indexa ("Negocios en Playa", "Ventiladores recargables") | Tráfico de búsqueda. Hoy tenemos sitemap y páginas de tienda y producto para Google, pero no páginas de lugar ni de colección. | Plataforma |
| 12 | **Rango de precio ($–$$$$$)** en la tarjeta de cada tienda | El cliente sabe qué esperar antes de entrar. Se puede calcular solo con los precios reales. | Plataforma |
| 13 | **"Cerrado temporalmente"** sin perder la página | Hoy una tienda inactiva desaparece. Mantenerla visible con un botón de contacto conserva a sus clientes. | Todos |
| 14 | **Centro de ayuda por temas y tutoriales en video** | Tenemos `/ayuda`, pero no guías paso a paso por sección del panel ni videos. | Plataforma |
| 15 | **Elegir plan y plazo desde la página de precios** (registro con `?plan=&billing=`) | Menos pasos entre ver el precio y pagar. | Plataforma |

## 5. Lo que Baznova tiene y El Yerro no (nuestras ventajas para vender)

Según lo que publican. Si alguna de estas funciones la tienen sin anunciarla, aquí no aparece.

1. **Plan gratis permanente**; ellos solo dan 1 semana de prueba.
2. **30 días de prueba del plan de pago**, frente a su semana.
3. **Pago con tarjeta y cobro automático** (Stripe, en USD), además de la transferencia en CUP.
4. **Productos ilimitados**; su máximo es 1 500.
5. **POS completo**: caja con código de barras, pantalla del cliente, movimientos y cierre de caja dentro del mismo
   panel. Ellos lo dan solo en Empresa y como app aparte.
6. **Restaurantes**: menú QR por mesa, pedidos de mesa y cocina.
7. **IA**: chat de cada tienda que responde con su catálogo, chat del marketplace, consejos diarios al vendedor y
   asistente de negocio.
8. **Programa de puntos para clientes** (fidelidad).
9. **Precios por cantidad (mayoreo)**, **tallas con stock por talla** y "stock siempre disponible".
10. **Códigos de descuento que respetan la moneda** (un código en CUP no aplica a productos en USD).
11. **Verificación de identidad real** (documentos y selfie con prueba de vida) y sello de verificada.
12. **Correos al cliente con el nombre de la tienda**: confirmación y seguimiento del pedido, factura y garantía en
    PDF, pedido de reseña y recordatorios.
13. **Pedidos en tiempo real** con aviso sonoro y notificaciones push (app instalable).
14. **Carrito compartido** por enlace, **"avísame cuando haya"** para productos sin stock, y reportes de fraude.
15. **Envíos a varios países** (hasta 10 en Premium).
16. **API para socios** (integraciones externas de pedidos).
17. **Panel con análisis**: puntaje de salud de la tienda, mejor día de venta y resumen semanal escrito.
18. **Seguridad de cuenta**: verificación en dos pasos (código o app autenticadora), navegador de confianza y cierre
    por inactividad.
19. **Sin comisiones por venta**.

## 6. Propuesta de planes para Baznova

Misma estructura que ellos (tres planes de pago y cuatro plazos), **sin quitar el plan gratis**, y siempre **más de
30 % más baratos en todos los plazos**. Los nombres y montos son una propuesta para decidir.

### Precios (CUP por mes)

| Plan | Mensual | 3 meses (−15 %) | 6 meses (−25 %) | Anual (−35 %) | Frente a El Yerro |
|---|---|---|---|---|---|
| **Gratis** | 0 | — | — | — | Ellos no tienen |
| **Básico** | 990 | 842 (pagas 2 525) | 743 (pagas 4 455) | 644 (pagas 7 722) | Del 32 % al 36 % menos |
| **Pro** | 1 690 | 1 437 (pagas 4 310) | 1 268 (pagas 7 605) | 1 099 (pagas 13 182) | Del 31 % al 34 % menos |
| **Empresa** | 2 990 | 2 542 (pagas 7 625) | 2 243 (pagas 13 455) | 1 944 (pagas 23 322) | Del 32 % al 35 % menos |

Antes de publicar conviene redondear (por ejemplo, Básico anual a 7 700). Con tarjeta se puede mantener una tabla
paralela en USD.

### Qué incluiría cada plan

- **Gratis.** 20 productos (para que coincida con lo que ya se anuncia), pedidos por WhatsApp y por el panel, perfil
  público, horarios, una zona de entrega, extras y secciones del catálogo.
- **Básico.**
  - hasta 600 productos (igual que su Básico);
  - varias imágenes e inventario, que ellos reservan a PRO;
  - códigos de descuento, ofertas, cintillo, eventos y zonas de entrega;
  - correos a clientes;
  - 1 usuario del equipo.
- **Pro.**
  - productos ilimitados;
  - verificación y sello, destacada en la portada;
  - chat con IA, programa de puntos;
  - menú QR y mesas, costo de empaquetado;
  - 3 usuarios del equipo.
- **Empresa.**
  - todo lo de Pro;
  - POS completo;
  - varios almacenes, vendedores con enlace propio;
  - usuarios ilimitados, envíos a varios países;
  - API para socios y soporte prioritario.

### Cambios técnicos que hacen falta

1. **Un tercer y un cuarto plan.** Hoy `PlanType` solo tiene `REGULAR` y `BUSINESS`. Hay que agregar los nuevos
   (por ejemplo, `BASIC` y `ENTERPRISE`) en `schema.prisma`, `PlanConfig`, el admin de suscripciones, la tabla de
   comparación de planes, Stripe y los pagos en CUP.
2. **Precio por plazo.** Hoy el precio es uno solo (`cupSubscriptionPriceCup`, `cardSubscriptionPriceUsd`) multiplicado
   por los meses. Hay que guardar el precio de cada plan y el porcentaje de descuento de cada plazo, y usarlos en el
   cobro, en el monto esperado de la transferencia y en las facturas.
3. **Funciones nuevas de la sección 4**, cada una con su interruptor en `PlanConfig`, igual que las actuales.

## 7. Cosas útiles vistas en su sitio técnico

- **Imagen para compartir generada por página** (og:image dinámica). Nosotros ya generamos una por tienda; se puede
  extender a las páginas de colección y de municipio cuando existan.
- **El enlace de registro lleva el plan elegido.** Se puede copiar tal cual en nuestra página de precios.
- **Centro de ayuda en Markdown**, fácil de mantener sin tocar código.
- **Su error de consola** (hidratación) es un fallo suyo; no aporta nada para copiar.

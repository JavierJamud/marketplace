# Addendum ZeuDin — Marketplace Cuba (actualización del handoff)

> Este addendum reemplaza el contexto genérico "Apex Market" del README original.
> El diseño ahora está **rebrandeado a ZeuDin** y alineado 1:1 a tu
> `ARQUITECTURA_MARKETPLACE.md` (Cuba, CUP, WhatsApp, provincias, planes, KYC,
> restaurantes, admin). El README original sigue siendo válido para la **tabla de
> tokens de Tailwind y el patrón de traducción** (los colores/tipografías no
> cambiaron — el `tailwind.config.js` ya calza).

## Qué cambió respecto de la v1

- **Marca:** Apex Market → **ZeuDin** (logo "Z" naranja, wordmark Zeu**Din**).
- **Moneda:** `es-AR` / `$` → **CUP** (`n.toLocaleString('es-CU') + ' CUP'`).
- **Pedido:** carrito genérico → **pedido por WhatsApp** (`wa.me/<telefono>?text=...`)
  como canal primario, + contra entrega + transferencia CUP. **Sin Stripe en ventas.**
- **Ubicación:** filtrado global por **provincia + municipio** (16 provincias de Cuba);
  recomendación de **provincias adyacentes** cuando no hay stock local.
- **Planes:** Regular (gratis, 20 productos, solo WhatsApp) vs **Business** (badge,
  ilimitado, home destacada, IA, horarios). Onboarding con **KYC**.
- **Restaurantes:** mesas + **QR por mesa** + estado de cocina (Recibido → Preparando → Listo).
- **Admin:** panel completo (KYC, tiendas/bloqueo, clientes, campañas Resend,
  integraciones cifradas).

## Datos compartidos

- `zeudin-data.js` (en la raíz del proyecto de diseño) — datos que consumen todos
  los mockups. Es la **referencia del modelo de datos**.
- `cuba-seed-data.js` (en este handoff) — el **dataset de prueba de Cuba listo para
  tu `backend/prisma/seed.js`**: provincias, municipios (muestra), adyacencias,
  categorías, planes, vendedores (con owner/KYC), productos (CUP + código de barras),
  menú de restaurante con variantes, clientes, pedidos y verificaciones. Recorrelo y
  creá los registros con Prisma (hasheá passwords con bcrypt).

## Mapa completo: mockup → ruta real (`frontend/src/App.jsx`)

### Público (envuelto en `PublicLayout` — header navy + selector de ubicación)
| Mockup | Página repo | Ruta |
|---|---|---|
| `Home.dc.html` | `pages/public/Home.jsx` | `/` |
| `Shop.dc.html` | `pages/public/Shop.jsx` | `/catalogo` |
| `Product.dc.html` | `pages/public/Product.jsx` | `/producto/:vendorSlug/:productSlug` |
| `Store.dc.html` | `pages/public/Store.jsx` | `/tienda/:slug` |
| `Stores.dc.html` | `pages/public/Stores.jsx` | `/tiendas` |
| `Cart.dc.html` | `pages/public/Cart.jsx` | `/carrito` |
| `Checkout.dc.html` | `pages/public/Checkout.jsx` | `/checkout` |
| `Account.dc.html` | `pages/public/Account.jsx` | `/cuenta` |
| `VendorOnboarding.dc.html` | `pages/public/VendorOnboarding.jsx` | `/vender` |
| `TableOrder.dc.html` | `pages/public/TableOrder.jsx` | `/mesa/:qrToken` |
| `NotFound.dc.html` | `pages/public/NotFound.jsx` | `*` |

### Cliente
| `CustomerPanel.dc.html` | `pages/customer/CustomerPanel.jsx` | `/cuenta/panel` |

### Vendedor (envuelto en `VendorLayout` — sidebar navy `#0e1a28`)
| `VendorDashboard.dc.html` | `pages/vendor/VendorDashboard.jsx` | `/vendedor` (index) |
| `VendorProducts.dc.html` | `pages/vendor/VendorProducts.jsx` | `/vendedor/productos` |
| `VendorOrders.dc.html` | `pages/vendor/VendorOrders.jsx` | `/vendedor/pedidos` |
| `VendorTables.dc.html` | `pages/vendor/VendorTables.jsx` | `/vendedor/mesas` |
| `VendorVerification.dc.html` | `pages/vendor/VendorVerification.jsx` | `/vendedor/verificacion` |
| `VendorSettings.dc.html` | `pages/vendor/VendorSettings.jsx` | `/vendedor/configuracion` |

### Admin (envuelto en `AdminLayout` — sidebar teal oscuro `#001d1e`)
| `AdminDashboard.dc.html` | `pages/admin/AdminDashboard.jsx` | `/admin` (index) |
| `AdminVendors.dc.html` | `pages/admin/AdminVendors.jsx` | `/admin/tiendas` |
| `AdminVerifications.dc.html` | `pages/admin/AdminVerifications.jsx` | `/admin/verificaciones` |
| `AdminCustomers.dc.html` | `pages/admin/AdminCustomers.jsx` | `/admin/clientes` |
| `AdminCampaigns.dc.html` | `pages/admin/AdminCampaigns.jsx` | `/admin/campanas` |
| `AdminIntegrations.dc.html` | `pages/admin/AdminIntegrations.jsx` | `/admin/integraciones` |

## Notas de integración específicas de ZeuDin

- **Pedido WhatsApp:** el botón arma `wa.me/<vendor.whatsapp>?text=<detalle>` con
  el detalle del carrito. En tu repo tomá `vendor.whatsapp` real.
- **Carrito de un solo vendedor:** los mockups ya aplican la regla (si agregás de
  otra tienda, se reemplaza). En tu repo usá `CartContext` + `CartConflictModal`.
- **Layouts por sección:** hay 3 shells distintos — público (header navy),
  vendedor (sidebar `#0e1a28`), admin (sidebar `#001d1e`). Metelos en
  `PublicLayout.jsx`, `VendorLayout.jsx`, `AdminLayout.jsx` respectivamente; no
  repitas el chrome en cada página.
- **KYC / privacidad:** las pantallas de verificación tratan fotos como privadas
  y cifradas — respetá eso en el backend (nunca públicas).
- **Estados de cocina** (VendorOrders / TableOrder): `received | preparing | ready`
  → mapear a `table_orders.kitchen_status`.
- **Integraciones:** las claves se guardan cifradas y se activan desde el panel
  (no en `.env`), tal cual tu arquitectura.

## Archivos de este handoff (v2)

- `README.md` — guía base + tabla de tokens Tailwind (sigue vigente).
- `ADDENDUM_ZEUDIN.md` — este archivo (mapa completo de 25 pantallas + notas Cuba).
- `cuba-seed-data.js` — dataset de prueba para `prisma/seed.js`.
- `examples/PublicLayout.jsx`, `examples/Home.jsx` — patrón React (ajustar marca a ZeuDin).
- `design_references/` — mockups. Los ZeuDin actuales están en la **raíz del proyecto**
  (`*.dc.html`); son la fuente de verdad visual más reciente.

## Bloques aplicados

> Cada bloque fue un prompt de diseño separado que se implementó de forma
> incremental. No hay changelog ni los prompts originales guardados — esta
> lista es el resumen de una línea por bloque, para que cualquier sesión
> nueva (en esta PC o en otra) recupere contexto rápido sin releer todo el
> código. Agregá una línea nueva acá cada vez que termines un bloque nuevo.
> Bloques 1, 2, 3, 7, 8, 35 y 36 no dejaron rastro identificable en comentarios
> del código (probablemente setup inicial o trabajo absorbido por bloques
> posteriores) y se omiten a propósito, no son un error de esta lista.

- **Bloque 4:** El admin puede suspender la cuenta de un cliente desde AdminCustomers (el flag existía pero en ese momento aún no bloqueaba nada de verdad).
- **Bloque 5:** Corrección de un bug real en el envío de correos vía Resend (los errores de la API se detectan en vez de darse por enviados).
- **Bloque 6:** En el checkout, los datos de contacto y entrega del cliente pasan a ser obligatorios sin excepción.
- **Bloque 9:** Selector de país con teléfono normalizado a formato E.164, compartido entre el registro y el input de teléfono reutilizable.
- **Bloque 10:** Verificación KYC del vendedor con captura de documento solo por cámara en vivo (sin subir archivos de galería) más una validación automática básica de existencia/resolución del archivo.
- **Bloque 11:** Registro de cuenta y de tienda con todos los campos obligatorios, incluido el correo de contacto propio de la tienda.
- **Bloque 12:** Soft-delete y suspensión real de cuentas/tiendas, panel de "Uso de la plataforma" en el admin, edición básica de usuarios, buzón de sugerencias y confirmación genérica para acciones destructivas.
- **Bloque 13:** Único punto de generación de contenido con IA del proyecto — botón "Mejorar con IA" para textos de producto.
- **Bloque 14:** Se consolidan los 4 canales de pedido en 3 opciones claras de checkout y se agregan los métodos de pago aceptados (informativos) de cada tienda.
- **Bloque 15:** Analíticas de "clientes potenciales" para el vendedor más el chat interno vendedor↔admin.
- **Bloque 16:** La aprobación de verificación/cobro pasa a requerir SIEMPRE revisión humana; se suma la campanita de notificaciones del vendedor y la animación de confirmación (SuccessCheck).
- **Bloque 17:** Auditoría de seguridad del backend (sin Row Level Security), selector global de provincia/municipio, barra de progreso de navegación y slider de tiendas verificadas.
- **Bloque 18:** Catálogo de "tipo de negocio"/rubro administrable, obligatorio al registrar una tienda, con íconos y filtro propio en Tiendas.
- **Bloque 19:** Gestión de países de entrega y provincias de venta (multi) por tienda, más límites de plan (Regular/Business) expuestos al vendedor.
- **Bloque 20:** Rediseño de la pantalla /cuenta como vista propia de viewport completo, con drawer mobile que se cierra al navegar.
- **Bloque 21:** Chatbot con IA por tienda verificada (sin login del cliente), con documento privado de negocio que el vendedor puede subir para entrenarlo.
- **Bloque 22:** Favoritos de producto, sistema de reseñas/calificaciones con desglose 5→1 estrellas, moderación de comentarios por el admin y autocompletado de búsqueda.
- **Bloque 23:** Botón "Solicitar este producto" para productos agotados, tags de producto (hasta 5) y umbral de stock bajo.
- **Bloque 24:** El chatbot de tienda puede citar/recomendar productos concretos y muestra una burbuja proactiva a los 5s de entrar a la tienda.
- **Bloque 25:** Integración real de Stripe para el pago de verificación/suscripción (reemplaza el checkout simulado), con Groq como IA de respaldo de Gemini.
- **Bloque 26:** Las sesiones de chat vencen a las 24h desde el último mensaje y se corrige el logging de errores 5xx en Admin > Errores.
- **Bloque 27:** Ajuste de compatibilidad con la API de Groq (formato tipo OpenAI).
- **Bloque 28:** El bot de tienda puede agregar productos al carrito citándolos por número de catálogo, con tarjetas de producto compactas embebidas en el chat.
- **Bloque 29:** Flujo de pedidos Pendiente→Vendido con confirmación de venta manual (sin descuento automático de stock), generación de factura/garantía en PDF y edición/eliminación de pedidos pendientes.
- **Bloque 30:** Chatbot general del marketplace (Home), distinto del de cada tienda, con detección de "¿cómo va mi pedido?" y búsqueda de tiendas.
- **Bloque 31:** Consulta del estado del propio pedido dentro del chat, usando el email de sesión si el cliente está logueado.
- **Bloque 32:** Filtrado geográfico progresivo por provincia/municipio en las búsquedas del chat y transcripción de audio corto grabado por el cliente (Groq Whisper), reemplazando el reconocimiento de imágenes.
- **Bloque 33:** Registro centralizado de errores técnicos (ErrorLog) con su propio panel de Admin > Errores.
- **Bloque 34:** Sugerencias de seguimiento contextuales tras cada respuesta del bot, rediseñadas como lista vertical.
- **Bloque 37:** Serie de correcciones críticas de bugs reales en la búsqueda geográfica/por categoría del chatbot, más el panel de revisión de conversaciones con ejemplos curados (Groq no permite fine-tuning propio).
- **Bloque 38:** Sonido de notificación al recibir respuesta del bot, indicador de "escribiendo" (TypingDots) y se quita el avatar de los mensajes del bot.
- **Bloque 39:** Historial real de compras del cliente logueado dentro del chat, optimización de la búsqueda con muchos productos activos, y ondas de audio reales durante la grabación.
- **Bloque 40:** Corrección de bugs reales de búsqueda con acentos (se activa `unaccent` en Postgres) y del comando de vaciar el carrito por chat.
- **Bloque 41:** Tarjetas de tienda puntuales dentro del chat cuando el cliente pide ver una o varias tiendas.
- **Bloque 42:** Optimización del consumo de tokens en los prompts de IA y pruebas/ajustes con el modelo de NVIDIA.
- **Bloque 43:** El modelo de IA usado por cada proveedor pasa a ser configurable desde el admin, con cambio automático entre proveedores si uno falla.
- **Bloque 44:** El admin puede ver la lista real de modelos disponibles para la key guardada de cada proveedor de IA (evita typos de nombre de modelo).
- **Bloque 45:** Se retira Cerebras del sistema de IA (su cuenta gratuita dejó de funcionar) y se agrega NVIDIA como proveedor.
- **Bloque 46:** Suscripciones del Plan Business administrables (solo lectura + revocar) y anuncios/banners programados del marketplace.
- **Bloque 47:** Autenticación en dos pasos (2FA) opcional por código de correo en el login, monedas aceptadas por tienda, correo directo del admin a clientes/tiendas y barra de búsqueda + notificaciones en el panel admin.
- **Bloque 48:** Páginas legales/de ayuda editables desde el admin (Términos, FAQ, Ayuda, Contacto) y rediseño del botón flotante de chat.
- **Bloque 49:** Marca de la plataforma editable (nombre/logo), opción de pegar un link externo como imagen de producto, reordenar fotos de producto por drag & drop y plantillas de correo con nombre de la tienda.
- **Bloque 50:** Ofertas de vendedor sobre productos ya existentes, mostradas en el Home y en la tienda, con anuncio propio para vendedores verificados.
- **Bloque 51:** Ofertas ampliadas con contenido personalizado/HTML creadas por el admin, política de ofertas configurable (cooldown y duración), y subida de imágenes con recorte (ImageCropUploader).
- **Bloque 52:** Códigos de descuento del vendedor (% o monto fijo, con mínimo/máximo de compra, límite de usos y vigencia opcional) aplicables en el carrito; ofertas propias de cada tienda (distintas de las del Home) con imagen, descripción mejorable con IA y código de descuento asignado o creado al vuelo, incluyendo ofertas por tiempo limitado; y reseñas con hasta 4 fotos, solo en tiendas verificadas y solo para clientes logueados (con redirect a login y retorno automático). Follow-ups del mismo bloque: el ícono del carrito abre un mini-carrito flotante (drawer moderno, esquinas redondeadas, separado de los bordes) en vez de navegar a /carrito; corrección de imágenes de producto estiradas en mobile (alto fijo → aspect-ratio) y de la alineación del encabezado de tienda; scroll siempre reinicia arriba al cambiar de página.
- **Bloque 53:** La sección "Páginas" del admin quedó solo para Términos/Privacidad (HTML libre). Preguntas frecuentes pasó a tener su propia sección con CRUD real (antes era copy hardcodeado en React) — cada pregunta pertenece a un público (cliente o vendedor) vía el nuevo modelo `FaqItem`; el FAQ público es un acordeón de una sola apertura (abrir una pregunta cierra la anterior). Contacto y Centro de ayuda pasaron a tener su propia entrada de menú en el admin (seguían usando `StaticPage` por debajo, solo se reorganizó la UI).
- **Bloque 54:** Carrito persistente por cuenta — un cliente logueado que tiene productos en el carrito los recupera automáticamente al iniciar sesión en otro dispositivo (`CartSnapshot`, sincronizado en cada cambio mientras hay sesión). "Compartir carrito" genera un link público (`SharedCart`) que, al abrirlo, resuelve los productos contra el catálogo real (precio/stock vigentes, nunca los del momento en que se compartió) y los agrega al carrito de quien lo abre, con una animación de importación y pidiendo confirmación si ya tenía productos de otra tienda.

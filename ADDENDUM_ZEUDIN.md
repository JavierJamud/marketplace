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

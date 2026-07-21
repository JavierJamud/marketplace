# ZeuDin Marketplace — Monorepo

Marketplace multivendedor de Cuba: `frontend/` (React + Vite + Tailwind +
React Router + TanStack Query) y `backend/` (Node + Express + Prisma +
PostgreSQL autoalojado). Los mockups de diseño (`design_references/`,
`examples/`, tokens) siguen documentados más abajo en este mismo archivo — son
la fuente de verdad visual, ver [`ADDENDUM_ZEUDIN.md`](./ADDENDUM_ZEUDIN.md)
para el mapa completo de las 25 pantallas.

**Estado actual:** `Home.jsx` está implementado pixel-a-pixel contra
`Home.dc.html`, conectado a la API real (provincias/municipios, categorías,
tiendas, búsqueda de productos). El resto de las pantallas tiene rutas y
layouts (`PublicLayout`, `VendorLayout`, `AdminLayout`) funcionando, con
contenido placeholder ("Próximamente") hasta que se aborden una por una
siguiendo el mismo patrón.

## Stack

- **Frontend** (`frontend/`): React 18 + Vite + Tailwind CSS + React Router +
  TanStack Query + `lucide-react` + `react-hot-toast`. Contexts:
  `AuthContext`, `CartContext` (carrito de un solo vendedor), `LocationContext`
  (provincia/municipio globales, hook `useZone`).
- **Backend** (`backend/`): Express + Prisma ORM + JWT (`jsonwebtoken`) +
  `bcryptjs` + `zod`. Credenciales de integraciones cifradas en DB con
  AES-256-GCM (`src/lib/crypto.js`), nunca en `.env`.
- **Base de datos:** PostgreSQL autoalojado (ver setup abajo). Sin
  Stripe/PayPal — pagos vía WhatsApp, contra entrega o transferencia CUP.

## Setup local (Windows / cualquier OS con Postgres accesible)

### 1. PostgreSQL

Este repo asume un Postgres al que puedas conectarte por `localhost` (o la
red interna del backend). En desarrollo se probó contra **PostgreSQL 16
corriendo como servicio nativo de Windows** (`postgresql-x64-16`), pero
cualquier instalación local o remota con las credenciales correctas funciona
igual — solo cambia el `DATABASE_URL`.

Crear el rol y la base **dedicados** (nunca uses el superusuario `postgres`
para la app):

```sql
-- conectado como postgres (psql -U postgres)
CREATE ROLE zeudin_app WITH LOGIN PASSWORD 'una-password-fuerte-generada';
CREATE DATABASE zeudin OWNER zeudin_app;
GRANT ALL PRIVILEGES ON DATABASE zeudin TO zeudin_app;
```

`pg_hba.conf` de este entorno ya exige `scram-sha-256` incluso para
conexiones locales — dejalo así (nunca bajes a `trust`), tanto en dev como en
el VPS.

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env   # completá DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, INTEGRATIONS_ENCRYPTION_KEY

# Generar secretos:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET / JWT_REFRESH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # INTEGRATIONS_ENCRYPTION_KEY (32 bytes)

npm run prisma:migrate   # prisma migrate dev — crea las tablas
npm run prisma:seed      # carga cuba-seed-data.js (provincias, tiendas, productos, pedidos, KYC...)
npm run dev               # http://localhost:4000
```

El seed hashea con bcrypt una password de desarrollo compartida
(`Zeudin2026!`) para todas las cuentas sembradas (dueños de tienda y
clientes) — solo para dev, nunca reutilizar en producción.

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env   # VITE_API_URL=http://localhost:4000 (default)
npm run dev             # http://localhost:5173
```

## Variables de entorno (`backend/.env`)

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | `postgresql://zeudin_app:<password>@<host>:5432/zeudin?schema=public` |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Firma de access/refresh tokens |
| `INTEGRATIONS_ENCRYPTION_KEY` | Clave AES-256 (32 bytes hex) para cifrar credenciales de integraciones en la tabla `Integration` |
| `FRONTEND_URL` | Origen permitido por CORS |
| `RESEND_API_KEY` | Opcional, para envío de campañas (`AdminCampaigns`) |

## Migraciones

- Desarrollo: `npm run prisma:migrate` (= `prisma migrate dev`) desde `backend/`.
- Producción: `npm run prisma:deploy` (= `prisma migrate deploy`) — **nunca**
  `prisma db push` en producción.

## Backups

`backend/scripts/backup.js` corre `pg_dump` (formato `custom`, `-F c`) contra
`DATABASE_URL` y rota backups viejos (conserva los últimos `BACKUP_KEEP_LAST`,
default 14). Los dumps van a `backend/backups/` (gitignored) salvo que
definas `BACKUP_DIR`.

```bash
npm run db:backup
```

Si `pg_dump` no está en el `PATH` (común en Windows), seteá `PG_DUMP_PATH`
con la ruta completa al binario, ej.
`PG_DUMP_PATH="C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"`.

Para automatizarlo con cron en el VPS (diario, 3am, ejemplo):

```cron
0 3 * * * cd /ruta/al/repo/backend && /usr/bin/node scripts/backup.js >> /var/log/zeudin-backup.log 2>&1
```

## PostgreSQL en el VPS (producción)

Instalación nativa vía paquete del sistema (recomendado sobre Docker acá:
menos capas, `pg_dump`/`pg_basebackup` directos, más simple de operar en un
VPS chico):

```bash
# Debian/Ubuntu
sudo apt update && sudo apt install -y postgresql postgresql-contrib

# Crear rol y base dedicados (nunca el superusuario postgres para la app)
sudo -u postgres psql -c "CREATE ROLE zeudin_app WITH LOGIN PASSWORD '<password-fuerte>';"
sudo -u postgres psql -c "CREATE DATABASE zeudin OWNER zeudin_app;"
```

**`pg_hba.conf`** (`/etc/postgresql/16/main/pg_hba.conf`) — solo conexiones
locales/red interna, con password:

```
local   all             all                                     scram-sha-256
host    zeudin          zeudin_app      127.0.0.1/32            scram-sha-256
host    zeudin          zeudin_app      10.0.0.0/8              scram-sha-256   # si el backend corre en otra máquina de la red interna
```

**`postgresql.conf`** — si el backend está en otra máquina de la red interna
del VPS (no en `localhost`), ajustar:

```
listen_addresses = 'localhost,10.0.0.x'   # IP interna, nunca 0.0.0.0 sin firewall
```

Si el backend corre en el mismo VPS, dejar `listen_addresses = 'localhost'`
(default) y no exponer el puerto 5432 a internet — cero necesidad de
`0.0.0.0` ahí.

Reiniciar tras editar: `sudo systemctl restart postgresql`.

`DATABASE_URL` resultante:

```
DATABASE_URL="postgresql://zeudin_app:<password-fuerte>@localhost:5432/zeudin?schema=public"
```

Luego, desde `backend/`: `npm ci && npx prisma migrate deploy && npm run prisma:seed` (el seed es opcional en prod — normalmente solo corres las migraciones).

---

## Handoff de diseño original (Apex / ZeuDin) — sigue vigente para tokens

> Para el desarrollador (o para Claude Code / Antigravity que integra esto en
> `JavierJamud/marketplace`).

## Overview

Este paquete contiene el **diseño visual pulido y de alta fidelidad** de las 10
pantallas públicas y de vendedor del marketplace multivendedor. El objetivo del
handoff es **recrear estas pantallas dentro de tu repo existente**
(`frontend/`, React + Vite + Tailwind + React Router + TanStack Query + Context),
usando tus patrones y librerías ya establecidos.

**La buena noticia:** el `frontend/tailwind.config.js` de tu repo **ya define
1:1 el mismo sistema de diseño** que usan estos mockups (es el "Apex Marketplace
System"). O sea, casi ningún color o tamaño hay que inventarlo — solo hay que
**aplicar las clases de Tailwind que ya tenés** a la estructura que muestran
estos diseños. La tabla de mapeo más abajo hace esa traducción explícita.

## Sobre los archivos de este paquete

Los archivos en `design_references/` son **referencias de diseño creadas en
HTML** — prototipos que muestran el look & feel y el comportamiento previstos.
**No son código para copiar y pegar directo** al repo. Están hechos con un motor
de plantillas propio (etiquetas `<x-dc>`, `<sc-for>`, `<sc-if>`, `image-slot`,
`renderVals()`) que **no existe en tu stack**. Su valor es ser la **fuente de
verdad visual**: colores exactos, tipografías, espaciados, jerarquía, copy y
estados. La tarea es reproducir ese resultado con tus componentes React reales.

Los archivos en `examples/` **sí son código React real** escrito con tu stack
(Tailwind + react-router-dom + tus contexts), listos para pegar y ajustar. Son
el patrón "de oro" a seguir para el resto de las pantallas.

## Fidelidad

**Alta fidelidad (hi-fi).** Colores, tipografía, espaciado, radios, sombras y
estados son finales. Reproducí la UI de forma pixel-perfect usando las clases de
Tailwind de tu config. No reinventes tokens.

---

## Design tokens → clases de Tailwind (tu `tailwind.config.js`)

Los mockups usan valores hex/px crudos (porque el motor DC exige estilos inline).
En tu repo, **traducí cada valor a la clase de Tailwind equivalente** que ya
existe en tu config. No agregues estos hex sueltos al código React.

### Colores

| Hex en el mockup | Rol | Clase Tailwind en tu repo |
|---|---|---|
| `#0e1a28` | navy más oscuro (footer, sidebar vendor, hero) | `bg-primary` / `text-primary` |
| `#232F3E` | navy header, botones "bestseller" | `bg-primary-container` |
| `#fbf9fa` | fondo general de página | `bg-background` / `bg-surface` |
| `#ffffff` | tarjetas, paneles | `bg-surface-container-lowest` |
| `#f0edee` | fondo del dashboard vendedor | `bg-surface-container` |
| `#eae7e9` | bordes de tarjeta, divisores | `border-surface-container-high` |
| `#c5c6cc` | bordes de inputs / pills inactivas | `border-outline-variant` |
| `#FE9800` | **naranja CTA** (botones, badges, precio destacado, acentos) | `bg-secondary-container` / `text-secondary-container` |
| `#8A5100` | naranja oscuro (texto sobre naranja claro) | `text-secondary` |
| `#337475` / `#61a0a1` | teal (links secundarios, "Ver tienda", íconos de confianza) | `text-on-tertiary-container` (o define un `tertiary` accent) |
| `#003435` | teal oscuro (zona vendedor) | `bg-tertiary-container` |
| `#1b1b1d` | texto principal | `text-on-surface` |
| `#44474c` | texto secundario | `text-on-surface-variant` |
| `#75777c` | texto terciario / captions | `text-outline` |
| `#ba1a1a` | badges de descuento / error | `bg-error` / `text-error` |
| verde badge verificado | check de tienda verificada | `text-verified` (`#0CAE53`) |

### Tipografía

| Uso en el mockup | Clase Tailwind |
|---|---|
| `font-family:'Montserrat'` (títulos, logo, precios grandes) | `font-display` |
| `font-family:'Inter'` (todo el cuerpo) | `font-body` |
| `48px/56px -0.02em 700` (hero H1) | `text-display-lg` |
| `30-32px 700` (títulos de página / sección grande) | `text-headline-lg` |
| `24px 600` (subtítulos de sección) | `text-headline-md` |
| `20px 600` (títulos de tarjeta / bloque) | `text-title-lg` |
| `18px 400` (subtítulo hero) | `text-body-lg` |
| `14-16px 400` (cuerpo) | `text-body-md` |
| `14px 600` (labels de nav, botones) | `text-label-md` |
| `11-12px 500` (captions, badges) | `text-label-sm` |

### Radios, espaciado, ancho

- Tarjetas: `rounded-lg` (16px) — en el mockup es `border-radius:16px`.
- Botones / inputs / pills chicas: `rounded` (8px).
- Pills de categoría / badges: `rounded-full`.
- Contenedor central: `max-w-content` (1280px) → usá tu clase `.container-app`
  (`mx-auto w-full max-w-content px-4 sm:px-gutter`) que ya está en `index.css`.
- Sombra de tarjeta: `shadow-sm`/`shadow-md` (en mockup `0 4px 20px rgba(35,47,62,0.05)`;
  hover sube a `hover:shadow-md`, igual que tu `ProductCard.jsx` actual).

---

## Rutas: pantalla del mockup → ruta real de tu `App.jsx`

Los mockups navegan con `href="Archivo.dc.html"`. En tu repo usás `react-router-dom`,
así que **reemplazá cada `<a href>` por `<Link to>` con la ruta real**:

| Mockup (`design_references/`) | Componente en tu repo | Ruta (`App.jsx`) |
|---|---|---|
| `Home.dc.html` | `pages/public/Home.jsx` | `/` |
| `Shop.dc.html` | `pages/public/Shop.jsx` | `/catalogo` |
| `Product.dc.html` | `pages/public/Product.jsx` | `/producto/:vendorSlug/:productSlug` |
| `Store.dc.html` | `pages/public/Store.jsx` | `/tienda/:slug` |
| `Stores.dc.html` | `pages/public/Stores.jsx` | `/tiendas` |
| `Cart.dc.html` | `pages/public/Cart.jsx` | `/carrito` |
| `Checkout.dc.html` | `pages/public/Checkout.jsx` | `/checkout` |
| `Account.dc.html` | `pages/public/Account.jsx` | `/cuenta` |
| `CustomerPanel.dc.html` | `pages/customer/CustomerPanel.jsx` | `/cuenta/panel` |
| `VendorDashboard.dc.html` | `pages/vendor/VendorDashboard.jsx` | `/vendedor` (index) |

> Ojo con Product: el mockup usa `?id=p1` (query param). Tu ruta real usa slugs
> (`/producto/:vendorSlug/:productSlug`). Al integrar, resolvé el producto por
> slug con TanStack Query, no por query param.

---

## Layout compartido (Header + Footer)

**Las 8 pantallas públicas comparten el mismo header navy sticky y footer.** En tu
repo eso ya vive en `components/layout/PublicLayout.jsx` (envuelve las rutas
públicas en `App.jsx`). Poné el header/footer ahí una sola vez — no lo repitas en
cada página. Ver `examples/PublicLayout.jsx` para el header/footer ya traducido a
Tailwind + `<Link>` + `useCart()` (el badge del carrito) + `useAuth()`.

**Header:** navy (`bg-primary-container`), sticky, alto 76px, `max-w-content`.
Contiene: logo "ApexMarket" (cuadro naranja con "A" + wordmark), nav (Inicio /
Catálogo / Tiendas / Mi Cuenta con el activo en blanco y el resto en blanco 75%),
buscador central (fondo blanco 10%, lupa), ícono de usuario, ícono de carrito con
badge naranja (cantidad desde `useCart().items`), botón outline "Vender en Apex".

**Footer:** en Home es completo (4 columnas: marca + Comprar + Vendedores +
Ayuda, con barra inferior de copyright). En las demás páginas es la versión corta
(una línea de copyright + 3 links). Ver `examples/PublicLayout.jsx`.

**Excepciones (NO usan el layout público):**
- `Account.dc.html` — pantalla auth a pantalla completa, split 50/50 (panel navy
  con gradiente a la izquierda + formulario a la derecha). Sin header/footer.
- `VendorDashboard.dc.html` — usa `VendorLayout.jsx` (sidebar navy propio,
  `grid 250px 1fr`), no el `PublicLayout`.

---

## Pantalla por pantalla

Para cada una, el mockup en `design_references/` es la especificación exacta.
Acá va el resumen de layout, componentes y estado.

### 1. Home (`/`)
- **Propósito:** landing del marketplace.
- **Secciones (en orden):** Hero (grid 2 col — copy + CTA "Explorar catálogo"/"Ver
  tiendas" a la izquierda, imagen con 2 tarjetas flotantes "Envío 24-48h" y "Pagos
  seguros" a la derecha) → barra de confianza (4 items: envío/pagos/devoluciones/soporte)
  → pills de categoría (scroll horizontal) → **Productos destacados** (grid 4 col,
  reutiliza `ProductCard`) → banner "Oferta relámpago" (navy, countdown de 4 bloques
  días/horas/min/seg que corre por segundo, CTA naranja) → **Tiendas destacadas**
  (grid 4 col, solo verificadas, reutiliza `StoreCard`) → testimonios (grid 3 col) →
  newsletter (banner navy con input+botón) → footer completo.
- **Estado/datos:** productos y tiendas destacadas (TanStack Query a tu API);
  contador de carrito (`useCart`); el countdown es `setInterval` local.
- **Ver:** `examples/Home.jsx` (traducción completa de oro).

### 2. Shop / Catálogo (`/catalogo`)
- **Propósito:** catálogo con filtros.
- **Layout:** header de página con breadcrumb → pills de categoría (Todos + 6
  categorías, la activa en navy) → fila de tiendas destacadas verificadas (grid 4) →
  **grid principal `260px 1fr`**: sidebar sticky de filtros (rango de precio con
  slider `accent-color` naranja, checkboxes por vendedor, radios de rating mínimo,
  botón "Limpiar filtros") + grid de productos 3 col con selector de orden
  (relevancia / precio asc / precio desc / rating) y contador de resultados.
- **Estado:** `category`, `search`, `maxPrice`, `vendors{}` (checkboxes),
  `minRating`, `sort`. Filtrado y ordenado en cliente sobre la lista de la API.
  Estado vacío: "No encontramos productos con esos filtros."

### 3. Product / Detalle (`/producto/:vendorSlug/:productSlug`)
- **Propósito:** ficha de producto.
- **Layout:** breadcrumb → grid 2 col: galería (imagen principal 440px + 4 thumbs) +
  panel de compra (nombre de tienda con check verificado → título → rating+reseñas+stock
  → precio con precio viejo tachado y badge `-N%` → descripción → selector de cantidad
  −/+ → botón naranja "Agregar al carrito" + botón corazón → toast "✓ Agregado" →
  grid 2x2 de garantías envío/devolución/pago/soporte) → sección reseñas (3 col) →
  "También te puede interesar" (grid 4).
- **Estado:** `qty`, `added` (toast temporal 2s). Al agregar, `useCart().addItem`
  — **respetá la regla de carrito de un solo vendedor** (`CartContext`): si el
  producto es de otra tienda, disparar `CartConflictModal`.

### 4. Store / Tienda (`/tienda/:slug`)
- **Propósito:** perfil público de una tienda.
- **Layout:** banner con color de la tienda + avatar/nombre con check verificado +
  stats (rating, ventas, año, ubicación) → grid de productos de esa tienda (4 col) →
  **Comentarios de compradores** (públicos; formulario para dejar comentario + lista) →
  "Otras tiendas destacadas".
- **Estado:** producto/tienda por slug (API); lista de comentarios.

### 5. Stores / Tiendas (`/tiendas`)
- **Propósito:** listado de todas las tiendas.
- **Layout:** header de página (breadcrumb + "Todas las tiendas" + subtítulo con
  conteo; "las verificadas se muestran primero") → grid 3 col de `StoreCard`
  (ordenadas: verificadas primero).

### 6. Cart / Carrito (`/carrito`)
- **Propósito:** revisar carrito (un solo vendedor).
- **Layout:** `max-w-1100`, título "Tu carrito". Con items: lista de líneas
  (imagen, nombre, tienda, precio, stepper de cantidad, eliminar) + resumen de
  orden (subtotal, envío, total, botón "Ir al checkout"). Estado vacío: mensaje +
  CTA a catálogo.
- **Estado:** `useCart()` (`items`, `total`, `updateQuantity`, `removeItem`).

### 7. Checkout (`/checkout`)
- **Propósito:** finalizar compra.
- **Layout:** `max-w-1100`, título "Finalizar compra", stepper de pasos arriba
  (envío → pago → confirmación) + formulario de dirección/pago a la izquierda +
  resumen de orden a la derecha. **Contexto de negocio:** en Cuba no operan
  Stripe/PayPal para ventas — el pago cliente↔vendedor NO usa Stripe (ver
  `ARQUITECTURA_MARKETPLACE.md`). Ajustá los métodos de pago a los reales de tu app.
- **Estado:** paso actual + datos del formulario; `useCart()` para el resumen.

### 8. Account / Auth (`/cuenta`)
- **Propósito:** login + registro + verificación de correo.
- **Layout:** **pantalla completa split 50/50** (sin header/footer). Izquierda:
  panel navy con gradiente, logo, headline, stats. Derecha: toggle Login/Registro
  (pill), formularios, y paso de "Verificá tu correo" tras registro.
- **Estado:** `isLogin`, `step` (`form` → `verify`), errores, email de registro.
  Conectar a `useAuth().login` / `useAuth().register` de tu `AuthContext`.

### 9. CustomerPanel (`/cuenta/panel`)
- **Propósito:** panel del cliente.
- **Layout:** grid `260px 1fr`: sidebar (avatar + nombre + tabs: Pedidos /
  Favoritos / Direcciones / Perfil) + contenido por tab. Pedidos: lista de órdenes
  con estado (Entregado/En camino/Procesando/Cancelado) coloreado. Favoritos y
  direcciones con sus estados. Perfil: formulario editable.
- **Estado:** `tab` activo; datos del usuario y pedidos (API + `useAuth`).

### 10. VendorDashboard (`/vendedor`)
- **Propósito:** panel del vendedor.
- **Layout:** **NO usa PublicLayout.** Grid `250px 1fr`: sidebar navy propio
  (`bg-primary`) con logo + nav del vendedor (Resumen / Productos / Pedidos / Mesas /
  Verificación / Configuración — coincide con las rutas hijas de `/vendedor` en tu
  `App.jsx`) + main con título dinámico, tarjetas de métricas (ventas, pedidos,
  productos, rating), tabla de pedidos recientes con estados.
- **Estado:** métricas y pedidos del vendedor (API); tab/nav activa por ruta.

---

## Interacciones y comportamiento

- **Carrito:** el mockup usa `localStorage('apex_cart')`. **En tu repo, usá
  `useCart()` (`CartContext`)** — ya implementa la regla de "un solo vendedor por
  carrito" y el `CartConflictModal`. No uses localStorage crudo.
- **Badge del carrito** en el header: `useCart().items.reduce((a,i)=>a+i.quantity,0)`.
- **Toast "Agregado al carrito":** el mockup lo hace inline 2s; en tu repo ya tenés
  `react-hot-toast` (`main.jsx`) — usá `toast.success('Agregado al carrito')`.
- **Countdown de Home:** `setInterval` de 1s, limpiar en unmount (`useEffect`).
- **Filtros de Shop:** estado local con `useState`; filtrado/orden en cliente.
- **Hover de tarjetas:** `hover:shadow-md` + imagen `group-hover:scale-105`
  (igual que tu `ProductCard.jsx` actual).
- **Precios:** el mockup formatea con `es-AR`. Tu `ProductCard.jsx` usa `es-CU` +
  `CUP` — **respetá tu formato de moneda real** (`toLocaleString('es-CU')` + `CUP`),
  no copies `es-AR`/`$` del mockup.

## Imágenes / assets

Los mockups usan `image-slot` (placeholders donde el usuario suelta fotos) y emojis
como stand-in de producto. **En tu repo, usá las URLs reales de imagen** de tus
productos/tiendas (`product.images[0]`, `vendor.coverUrl`) como ya hace tu
`ProductCard.jsx`/`StoreCard.jsx`. Para el check de verificado, tenés
`components/ui/VerifiedBadge.jsx` y `assets/verified-badge.svg` — usalos en vez del
SVG inline de los mockups.

## Componentes tuyos que hay que reutilizar

- `components/ui/Card.jsx`, `Badge.jsx`, `VerifiedBadge.jsx`
- `components/ProductCard.jsx` — ya calza con las tarjetas de producto de los mockups
  (solo ajustar spacing/labels al diseño). Úsalo en Home, Shop, Store, Product-related.
- `components/StoreCard.jsx` — para Stores y las filas de tiendas destacadas.
- `context/CartContext.jsx` (`useCart`), `context/AuthContext.jsx` (`useAuth`)
- `lib/api.js` + TanStack Query para todo el fetching.
- `lucide-react` para íconos (los mockups dibujan SVGs inline; reemplazalos por
  íconos de lucide equivalentes: `ShoppingCart`, `Search`, `User`, `Truck`, `Shield`,
  `RotateCcw`, `Headphones`, `Heart`, `Star`, `MapPin`, etc.).

## Archivos de este paquete

- `design_references/*.dc.html` — los 10 mockups hi-fi (fuente de verdad visual).
- `examples/PublicLayout.jsx` — header + footer compartidos, traducidos a tu stack.
- `examples/Home.jsx` — página Home completa traducida (patrón de oro a replicar).
- `examples/tokens-cheatsheet.md` — la tabla de mapeo de arriba, para tener a mano.

## Cómo integrarlo (recomendado)

1. Abrí los `.dc.html` en el navegador para ver el objetivo visual de cada pantalla.
2. Meté el header/footer en `PublicLayout.jsx` usando `examples/PublicLayout.jsx`.
3. Reemplazá el contenido de cada `pages/**/*.jsx` para que matchee su mockup,
   usando las clases de Tailwind de tu config (tabla de tokens) y tus componentes UI.
4. Conectá datos con TanStack Query (`lib/api.js`) y estado con tus contexts.
5. `Home.jsx` primero (ya está resuelto en `examples/`), después el resto por
   analogía.

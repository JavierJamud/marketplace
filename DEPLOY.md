# Desplegar en Render (entorno de prueba gratuito)

Esta guía usa el Blueprint (`render.yaml` en la raíz del repo) para levantar los 3 recursos —backend, frontend y base de datos— de una sola vez, en el plan gratuito de Render. Pensado para **probar el proyecto funcionando**, no para producción real (ver limitaciones al final).

## Antes de empezar

Generá la clave de cifrado de integraciones en tu máquina (Render no puede generar este formato exacto solo — tiene que ser hexadecimal de 32 bytes):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Guardá el resultado, lo vas a pegar en el paso 3.

## Paso 1 — Crear el Blueprint

1. Entrá a [render.com](https://render.com) y creá una cuenta (no pide tarjeta).
2. Dashboard → **New** → **Blueprint**.
3. Conectá tu cuenta de GitHub y elegí el repositorio `marketplace`.
4. Render detecta `render.yaml` solo y te muestra los 3 recursos que va a crear: `zeudin-backend` (web service), `zeudin-frontend` (sitio estático) y `zeudin-db` (Postgres).

## Paso 2 — Nombre del proyecto

Render te pide un nombre para el Blueprint — cualquiera sirve, no afecta las URLs finales.

## Paso 3 — Pegar la clave que generaste

En la pantalla de variables de entorno, vas a ver `INTEGRATIONS_ENCRYPTION_KEY` pedida a mano (marcada `sync: false` en el blueprint, a propósito, para que nunca quede un secreto real escrito en el repo). Pegá ahí el valor que generaste en el paso "Antes de empezar".

El resto de las claves (`JWT_SECRET`, `JWT_REFRESH_SECRET`) las genera Render solo — no hace falta tocarlas.

## Paso 4 — Deploy y ajuste de URLs (si hizo falta)

Dale a **Apply** — Render crea los 3 recursos y arranca el primer deploy (puede tardar varios minutos, sobre todo el backend por instalar dependencias + Prisma).

Cuando termine, anotá las 2 URLs reales que Render le asignó a cada servicio (las ves en el dashboard de cada uno, arriba). Si coinciden con:

- `https://zeudin-backend.onrender.com`
- `https://zeudin-frontend.onrender.com`

no hay que tocar nada más. Si Render les puso un sufijo distinto (porque esos nombres ya estaban tomados por otra cuenta), actualizá a mano estas 3 variables de entorno con las URLs reales, una por una, en el dashboard de cada servicio (Settings → Environment):

- En `zeudin-backend`: `FRONTEND_URL` y `BACKEND_URL`.
- En `zeudin-frontend`: `VITE_API_URL` (esto obliga a un redeploy del frontend para que tome efecto — Render lo hace solo al guardar).

## Paso 5 — Crear tu cuenta de administrador

No hay ninguna URL pública para volverse admin (a propósito, por seguridad) — se crea por consola, una sola vez:

1. En el dashboard de `zeudin-backend`, abrí la pestaña **Shell** (terminal conectada al servidor real, ya con las variables de entorno cargadas).
2. Corré:
   ```bash
   ADMIN_EMAIL=tu@correo.com ADMIN_PASSWORD='UnaClaveLarga123!' node scripts/create-admin.js
   ```

## Paso 6 — Probar

Abrí la URL de `zeudin-frontend` — ahí está tu marketplace funcionando de verdad, con base de datos real. Iniciá sesión con el admin que creaste en el paso 5 para configurar el resto (nombre del sitio, categorías, y las integraciones reales si querés probarlas — Resend/Gemini/Groq/Stripe se cargan desde el panel de Admin → Integraciones, cifradas en la base, no como variable de entorno).

## Limitaciones del plan gratuito (por qué esto es para PROBAR, no para dejarlo así)

- **El backend se duerme** tras 15 minutos sin tráfico — la primera visita después tarda 30-50 segundos en responder mientras arranca de nuevo.
- **Los cron jobs** (recordatorios de vencimiento, chequeo de stock bajo, etc.) **no corren mientras el servicio está dormido** — en producción real hace falta un plan pago (o un ping externo que lo mantenga despierto, poco confiable para esto).
- **La base de datos gratuita se borra a los 90 días** — hacé un backup (`npm run db:backup` corriendo local contra la `DATABASE_URL` de Render) si generás datos que te importa conservar.
- **Las imágenes subidas por vendedores/clientes no persisten** entre deploys — el disco del plan gratuito es efímero, así que cualquier producto/foto de perfil que subas se pierde cuando Render reinicia el contenedor (deploy nuevo, o simplemente tras inactividad prolongada). Para producción real, antes de lanzar de verdad, hay que mover esos uploads a un storage externo (ej. Cloudflare R2 o S3) — fuera del alcance de esta guía de prueba.

Cuando ya lo hayas probado y quieras pasar a un hosting real (tu propio dominio, sin estas limitaciones), avisame y preparamos esa parte aparte — normalmente conviene un VPS (Hostinger, DigitalOcean) con Postgres administrado y storage externo para los uploads.

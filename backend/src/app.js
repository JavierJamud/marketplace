import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import "express-async-errors";

import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { AppError } from "./utils/AppError.js";

import authRoutes from "./routes/auth.routes.js";
import vendorsRoutes from "./routes/vendors.routes.js";
import productsRoutes from "./routes/products.routes.js";
import locationsRoutes from "./routes/locations.routes.js";
import categoriesRoutes from "./routes/categories.routes.js";
import businessCategoriesRoutes from "./routes/businessCategories.routes.js";
import searchRoutes from "./routes/search.routes.js";
import reviewsRoutes from "./routes/reviews.routes.js";
import ordersRoutes from "./routes/orders.routes.js";
import tablesRoutes from "./routes/tables.routes.js";
import verificationRoutes from "./routes/verification.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import customersRoutes from "./routes/customers.routes.js";
import settingsRoutes from "./routes/settings.routes.js";
import suggestionsRoutes from "./routes/suggestions.routes.js";
import aiRoutes from "./routes/ai.routes.js";
import assistantRoutes from "./routes/assistant.routes.js";
import announcementsRoutes from "./routes/announcements.routes.js";
import staticPagesRoutes from "./routes/staticPages.routes.js";
import contactRoutes from "./routes/contact.routes.js";
import offersRoutes from "./routes/offers.routes.js";
import discountCodesRoutes from "./routes/discountCodes.routes.js";
import storeOffersRoutes from "./routes/storeOffers.routes.js";
import faqRoutes from "./routes/faq.routes.js";
import cartRoutes from "./routes/cart.routes.js";
import sharedCartsRoutes from "./routes/sharedCarts.routes.js";
import customerListingsRoutes from "./routes/customerListings.routes.js";
import reportsRoutes from "./routes/reports.routes.js";
import vendorStaffRoutes from "./routes/vendorStaff.routes.js";
import vendorStaffSalesRoutes from "./routes/vendorStaffSales.routes.js";
import targetedOffersRoutes from "./routes/targetedOffers.routes.js";
import { SITE_UPLOAD_DIR } from "./controllers/settings.controller.js";
import { PRODUCT_UPLOAD_DIR } from "./controllers/products.controller.js";
import { VENDOR_BRANDING_DIR } from "./controllers/vendors.controller.js";
import { STAFF_PHOTO_UPLOAD_DIR } from "./controllers/vendorStaff.controller.js";
import { CUSTOMER_LISTING_UPLOAD_DIR } from "./controllers/customerListings.controller.js";
import { REPORT_UPLOAD_DIR } from "./controllers/reports.controller.js";
import { OFFER_UPLOAD_DIR } from "./controllers/offers.controller.js";
import { REVIEW_UPLOAD_DIR } from "./controllers/reviews.controller.js";
import { receiveStripeWebhook } from "./controllers/stripeWebhook.controller.js";
import { renderStoreOgPage } from "./controllers/og.controller.js";

export const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// Auditoría de seguridad: antes `origin: env.frontendUrl` solo admitía UN
// origen — si en producción el frontend termina sirviéndose desde más de
// un dominio (ej. "www." + raíz, o un subdominio admin separado), FRONTEND_URL
// admite una lista separada por comas sin tener que volver a tocar este
// archivo. Nunca `origin: true`/"*" con `credentials: true` (el navegador lo
// rechaza igual, pero es un error común a evitar).
const allowedOrigins = env.frontendUrls;

// Bloque 182 (bug real reportado en vivo — "no me carga el backend cuando
// cambio de red"): FRONTEND_URL solía tener que incluir a mano la IP de LAN
// exacta de la red del momento (ej. http://192.168.1.79:5173) para poder
// abrir el panel desde un celular en esa red — rota apenas se cambia de
// WiFi. En desarrollo, cualquier IP privada (RFC1918: 10.x, 172.16-31.x,
// 192.168.x) en el puerto del frontend (5173/5174, Vite con --host) se
// acepta sola, sin tocar FRONTEND_URL nunca más. Nunca se activa en
// producción (nodeEnv !== "development"), donde el allowlist sigue siendo
// estricto por diseño.
function isPrivateLanDevOrigin(origin) {
  const match = origin.match(/^http:\/\/(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}:(5173|5174)$/);
  if (!match) return false;
  const [, a, b] = match.map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Sin header Origin (curl, apps nativas, health checks) — se permite,
      // igual que el comportamiento por default de cors() con un string fijo.
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        (env.nodeEnv === "development" && (origin.includes("loca.lt") || isPrivateLanDevOrigin(origin)))
      ) {
        return callback(null, true);
      }
      // AppError (no un Error genérico): un origen rechazado es un 403
      // esperable del uso normal de la API, no un fallo real — con un Error
      // genérico, errorHandler.js lo trataba como 500 y lo registraba en
      // Admin > Errores, ensuciando el log con cada intento bloqueado.
      callback(new AppError("Origen no permitido por CORS.", 403));
    },
    credentials: true,
  })
);
app.use(morgan(env.nodeEnv === "development" ? "dev" : "combined"));

// Bloque 25: webhook de Stripe — TIENE que montarse antes de express.json()
// con su propio express.raw(), porque la verificación de firma de Stripe
// necesita el body crudo tal cual llegó, no el objeto ya parseado. Si esta
// ruta quedara después de express.json(), req.body ya sería un objeto JS y
// stripe.webhooks.constructEvent() fallaría siempre.
app.post("/stripe/webhook", express.raw({ type: "application/json" }), receiveStripeWebhook);

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "zeudin-marketplace-api" }));

// Imágenes del sitio (hero, etc.) — a diferencia de uploads/kyc, esto es
// público por diseño: sin credenciales, solo marketing.
app.use("/uploads/site", express.static(SITE_UPLOAD_DIR));
// Fotos de producto — públicas también, son parte del catálogo (Bloque 13).
app.use("/uploads/products", express.static(PRODUCT_UPLOAD_DIR));
// Logo/portada de tienda subidos por el vendedor (Bloque 133) — públicas,
// mismo criterio que /uploads/products de arriba.
app.use("/uploads/vendor-branding", express.static(VENDOR_BRANDING_DIR));
app.use("/uploads/vendor-staff", express.static(STAFF_PHOTO_UPLOAD_DIR));
// Imágenes de ofertas personalizadas (Bloque 51) — públicas, mismo criterio.
app.use("/uploads/offers", express.static(OFFER_UPLOAD_DIR));
// Fotos de reseñas (Bloque 52) — públicas, son parte del comentario visible.
app.use("/uploads/reviews", express.static(REVIEW_UPLOAD_DIR));
// Fotos de anuncios de venta rápida de clientes — públicas, mismo criterio.
app.use("/uploads/customer-listings", express.static(CUSTOMER_LISTING_UPLOAD_DIR));
// Capturas de reportes de fraude — públicas para que el admin abra el link
// directo desde AdminFraudReports.jsx, mismo criterio que las de reseña.
app.use("/uploads/reports", express.static(REPORT_UPLOAD_DIR));

// Bloque 137: HTML con meta tags reales de la tienda, para que un link
// compartido se previsualice con SUS datos — ver el comentario largo en
// og.controller.js (incluye la pieza de hosting que falta para producción).
app.get("/og/tienda/:slug", renderStoreOgPage);

app.use("/auth", authRoutes);
app.use("/vendors", vendorsRoutes);
app.use("/products", productsRoutes);
app.use("/locations", locationsRoutes);
app.use("/categories", categoriesRoutes);
app.use("/business-categories", businessCategoriesRoutes);
app.use("/search", searchRoutes);
app.use("/reviews", reviewsRoutes);
app.use("/orders", ordersRoutes);
app.use("/tables", tablesRoutes);
app.use("/verification", verificationRoutes);
app.use("/admin", adminRoutes);
app.use("/customers", customersRoutes);
app.use("/settings", settingsRoutes);
app.use("/suggestions", suggestionsRoutes);
app.use("/ai", aiRoutes);
app.use("/assistant", assistantRoutes);
app.use("/announcements", announcementsRoutes);
app.use("/static-pages", staticPagesRoutes);
app.use("/contact", contactRoutes);
app.use("/offers", offersRoutes);
app.use("/discount-codes", discountCodesRoutes);
app.use("/store-offers", storeOffersRoutes);
app.use("/faq", faqRoutes);
app.use("/cart", cartRoutes);
app.use("/shared-carts", sharedCartsRoutes);
app.use("/customer-listings", customerListingsRoutes);
app.use("/reports", reportsRoutes);
app.use("/vendor-staff", vendorStaffRoutes);
// Bloque 198: "Ventas manuales" — router propio, mismo criterio que
// vendor-staff de arriba (no cuelga de /vendors/me para no mezclar el
// modelo de permisos por sección con el resto de ese archivo).
app.use("/vendor-staff-sales", vendorStaffSalesRoutes);
// Bloque 194: "mis ofertas dirigidas" (popup) + descartar — top-level,
// mismo criterio que vendor-staff de arriba (router propio, no colgado de
// /admin porque lo consume el usuario final, no el admin).
app.use("/targeted-offers", targetedOffersRoutes);

app.use((req, res) => res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` }));

app.use(errorHandler);

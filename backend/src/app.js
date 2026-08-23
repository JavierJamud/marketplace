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
import { SITE_UPLOAD_DIR } from "./controllers/settings.controller.js";
import { PRODUCT_UPLOAD_DIR } from "./controllers/products.controller.js";
import { CUSTOMER_LISTING_UPLOAD_DIR } from "./controllers/customerListings.controller.js";
import { OFFER_UPLOAD_DIR } from "./controllers/offers.controller.js";
import { STORE_OFFER_UPLOAD_DIR } from "./controllers/storeOffers.controller.js";
import { REVIEW_UPLOAD_DIR } from "./controllers/reviews.controller.js";
import { receiveStripeWebhook } from "./controllers/stripeWebhook.controller.js";

export const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// Auditoría de seguridad: antes `origin: env.frontendUrl` solo admitía UN
// origen — si en producción el frontend termina sirviéndose desde más de
// un dominio (ej. "www." + raíz, o un subdominio admin separado), FRONTEND_URL
// admite una lista separada por comas sin tener que volver a tocar este
// archivo. Nunca `origin: true`/"*" con `credentials: true` (el navegador lo
// rechaza igual, pero es un error común a evitar).
const allowedOrigins = env.frontendUrl.split(",").map((o) => o.trim());
app.use(
  cors({
    origin: (origin, callback) => {
      // Sin header Origin (curl, apps nativas, health checks) — se permite,
      // igual que el comportamiento por default de cors() con un string fijo.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
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
// Imágenes de ofertas personalizadas (Bloque 51) — públicas, mismo criterio.
app.use("/uploads/offers", express.static(OFFER_UPLOAD_DIR));
// Imágenes de ofertas de tienda (Bloque 52) — públicas, mismo criterio.
app.use("/uploads/store-offers", express.static(STORE_OFFER_UPLOAD_DIR));
// Fotos de reseñas (Bloque 52) — públicas, son parte del comentario visible.
app.use("/uploads/reviews", express.static(REVIEW_UPLOAD_DIR));
// Fotos de anuncios de venta rápida de clientes — públicas, mismo criterio.
app.use("/uploads/customer-listings", express.static(CUSTOMER_LISTING_UPLOAD_DIR));

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

app.use((req, res) => res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` }));

app.use(errorHandler);

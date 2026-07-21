import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import "express-async-errors";

import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";

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
import { SITE_UPLOAD_DIR } from "./controllers/settings.controller.js";
import { PRODUCT_UPLOAD_DIR } from "./controllers/products.controller.js";
import { receiveStripeWebhook } from "./controllers/stripeWebhook.controller.js";

export const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: env.frontendUrl, credentials: true }));
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

app.use((req, res) => res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` }));

app.use(errorHandler);

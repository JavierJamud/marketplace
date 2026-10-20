-- El precio mensual con tarjeta acepta centavos (4.99 USD). Antes era entero y rechazaba cualquier precio con decimales.
ALTER TABLE "SiteSettings" ALTER COLUMN "cardSubscriptionPriceUsd" TYPE DOUBLE PRECISION;

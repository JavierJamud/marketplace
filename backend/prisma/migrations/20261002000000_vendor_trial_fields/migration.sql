-- Bloque 235 (pedido explícito — trial gratuito de 30 días del Plan
-- Premium): las 4 fechas viven en Vendor, nunca en localStorage, para que
-- la oferta/el checklist/la bienvenida se vean igual entrando desde
-- cualquier dispositivo. Ver el comentario largo en schema.prisma.
ALTER TABLE "Vendor"
  ADD COLUMN "trialOfferDismissedAt" TIMESTAMP(3),
  ADD COLUMN "trialStartedAt" TIMESTAMP(3),
  ADD COLUMN "trialEndsAt" TIMESTAMP(3),
  ADD COLUMN "trialWelcomeSeenAt" TIMESTAMP(3);

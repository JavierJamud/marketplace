-- Bloque 188: alertas de "pedido/mesa olvidado" — statusChangedAt se
-- inicializa con createdAt (mejor estimación disponible para filas ya
-- existentes: asume que su último avance real fue al menos tan reciente
-- como su creación) en vez de "ahora", para no marcar como "recién
-- actualizados" a todos los pedidos viejos de una sola vez.
ALTER TABLE "TableOrder" ADD COLUMN "statusChangedAt" TIMESTAMP(3);
UPDATE "TableOrder" SET "statusChangedAt" = "createdAt" WHERE "statusChangedAt" IS NULL;
ALTER TABLE "TableOrder" ALTER COLUMN "statusChangedAt" SET NOT NULL;
ALTER TABLE "TableOrder" ALTER COLUMN "statusChangedAt" SET DEFAULT now();

ALTER TABLE "TableOrder" ADD COLUMN "staleReminderSnoozedUntil" TIMESTAMP(3);

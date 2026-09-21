-- Bloque 146 (pedido explícito): video corto de liveness (girar la cabeza a
-- la izquierda y a la derecha) grabado junto con la selfie frontal —
-- opcional, nunca bloquea el trámite si el navegador no lo soporta.
ALTER TABLE "VerificationRequest" ADD COLUMN "selfieVideoUrl" TEXT;
ALTER TABLE "VerificationArchive" ADD COLUMN "selfieVideoUrl" TEXT;

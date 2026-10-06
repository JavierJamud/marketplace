-- Bloque 262: el asistente de negocio puede acompañar su respuesta con tarjetas de
-- producto (como el chat de la página principal).
ALTER TABLE "AssistantMessage" ADD COLUMN "products" JSONB;

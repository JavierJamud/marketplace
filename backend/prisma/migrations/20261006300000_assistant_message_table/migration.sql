-- Bloque 264: el asistente de negocio puede responder con una tabla ordenada.
ALTER TABLE "AssistantMessage" ADD COLUMN "tableData" JSONB;

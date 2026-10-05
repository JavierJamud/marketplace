-- Bloque 259: el asistente de negocio ya no depende del plan (lo usa el dueño de
-- cualquier tienda; lo que cambia con el plan es lo que cuenta). El interruptor
-- por plan de la migración 20261005120000 deja de usarse.
ALTER TABLE "PlanConfig" DROP COLUMN "allowAiAssistant";

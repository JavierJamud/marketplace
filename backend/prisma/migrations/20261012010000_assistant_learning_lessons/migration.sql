-- Aprendizaje automático del asistente (activación, resumen y fecha) y criterio aprendido de cada corrección del admin.
ALTER TABLE "SiteSettings" ADD COLUMN "botAutoLearn" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SiteSettings" ADD COLUMN "botLearningSnapshot" JSONB;
ALTER TABLE "SiteSettings" ADD COLUMN "botLearningAt" TIMESTAMP(3);
ALTER TABLE "ChatTrainingExample" ADD COLUMN "leccion" TEXT;

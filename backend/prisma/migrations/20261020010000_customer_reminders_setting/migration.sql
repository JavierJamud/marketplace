-- Interruptor del admin para los recordatorios automáticos a clientes.
ALTER TABLE "SiteSettings" ADD COLUMN "customerRemindersEnabled" BOOLEAN NOT NULL DEFAULT true;

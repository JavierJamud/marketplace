-- WhatsApp: cuándo se le recordó al admin que la plataforma está vinculada y ningún admin confirmó su número para recibir avisos.
ALTER TABLE "WhatsappSession" ADD COLUMN "adminNoticeReminderAt" TIMESTAMP(3);

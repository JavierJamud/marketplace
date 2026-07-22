-- Sección "Garantías" en VendorSettings.jsx: términos/condiciones propios de
-- cada negocio y días de garantía por defecto, exigidos antes de poder
-- generar/enviar un certificado de garantía (ver invoices.controller.js).
ALTER TABLE "Vendor" ADD COLUMN "warrantyTerms" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "warrantyDefaultDays" INTEGER;

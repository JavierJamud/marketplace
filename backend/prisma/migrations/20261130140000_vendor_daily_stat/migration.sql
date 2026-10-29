-- Visitas a la página de cada tienda y vistas de sus productos, por día (hora de Cuba): las usa el resumen semanal de la
-- tienda. Los totales de siempre (Product.viewCount) siguen igual; esto solo agrega el detalle por día.
CREATE TABLE "VendorDailyStat" (
    "vendorId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "storeViews" INTEGER NOT NULL DEFAULT 0,
    "productViews" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "VendorDailyStat_pkey" PRIMARY KEY ("vendorId","day")
);
CREATE INDEX "VendorDailyStat_day_idx" ON "VendorDailyStat"("day");
ALTER TABLE "VendorDailyStat" ADD CONSTRAINT "VendorDailyStat_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

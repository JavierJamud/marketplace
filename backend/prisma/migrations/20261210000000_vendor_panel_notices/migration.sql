-- Avisos del admin dentro del panel de las tiendas (pop-up con HTML, fechas y máximo de veces por tienda).
CREATE TABLE "VendorPanelNotice" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "maxViews" INTEGER NOT NULL DEFAULT 3,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VendorPanelNotice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VendorPanelNotice_isActive_startAt_endAt_idx" ON "VendorPanelNotice"("isActive", "startAt", "endAt");

CREATE TABLE "VendorPanelNoticeView" (
    "id" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "lastShownAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    CONSTRAINT "VendorPanelNoticeView_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VendorPanelNoticeView_noticeId_vendorId_key" ON "VendorPanelNoticeView"("noticeId", "vendorId");
CREATE INDEX "VendorPanelNoticeView_vendorId_idx" ON "VendorPanelNoticeView"("vendorId");
ALTER TABLE "VendorPanelNoticeView" ADD CONSTRAINT "VendorPanelNoticeView_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "VendorPanelNotice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VendorPanelNoticeView" ADD CONSTRAINT "VendorPanelNoticeView_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bloque 54: carrito persistente por cuenta + carritos compartibles por enlace.

CREATE TABLE "CartSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vendorMeta" JSONB,
    "items" JSONB NOT NULL,
    "discount" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CartSnapshot_userId_key" ON "CartSnapshot"("userId");

ALTER TABLE "CartSnapshot" ADD CONSTRAINT "CartSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SharedCart" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedCart_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SharedCart" ADD CONSTRAINT "SharedCart_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

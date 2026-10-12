ALTER TABLE "Vendor" ADD COLUMN "checkoutPaymentOptions" TEXT[] DEFAULT ARRAY['cod', 'online', 'cash']::TEXT[];

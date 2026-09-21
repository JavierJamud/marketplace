-- Bloque 150: nuevo tipo de notificación — Stripe confirmó el pago pero
-- todavía falta que el vendedor suba su comprobante para que un admin
-- finalice. ALTER TYPE ... ADD VALUE tiene que ser la única sentencia de su
-- migración (no se puede usar el valor nuevo en la misma transacción).
ALTER TYPE "VendorNotificationType" ADD VALUE 'VERIFICATION_STRIPE_PAID';

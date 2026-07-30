import { prisma } from "../lib/prisma.js";
import { sendVendorSuspendedEmail } from "../lib/email.js";

// Bloque 62: mismo patrón dual (fila de VendorNotification + email) que ya
// usa verificationNotify.service.js — evento y plantilla propios (menciona
// el motivo real de la suspensión automática y cómo reactivarla), distinto
// del ciclo de verificación/cobro que vive en aquel archivo. Así queda
// visible en la campanita del panel si el vendedor vuelve a intentar
// entrar, no solo en el correo que ya recibió (ver vendorLifecycle.job.js).
export async function notifyVendorSuspended(vendor, reason) {
  await Promise.all([
    prisma.vendorNotification.create({
      data: {
        vendorId: vendor.id,
        type: "VENDOR_SUSPENDED",
        title: "Tu tienda fue pausada",
        body: `Tu tienda se pausó automáticamente: ${reason}. Contacta a soporte para reactivarla.`,
      },
    }),
    sendVendorSuspendedEmail(vendor, reason),
  ]);
}

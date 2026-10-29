import { prisma } from "./prisma.js";
import { captureOrderRequest, describeOrderRequest, clientInfoSchema } from "./orderRequestInfo.js";

// Historial de vida de una tienda para el admin: quién la creó, desde dónde (IP, navegador, sistema, dispositivo, pantalla,
// zona horaria), cuándo pidió eliminarla, si se arrepintió y cuándo se eliminó de verdad. Pedido del dueño: "aunque el
// cliente después la elimine, todo este historial debe quedar guardado". Se guarda en ActivityLog (la fila nunca se borra:
// las cuentas y tiendas eliminadas se anonimizan, no se borran; ver lib/accountDeletion.js) con estas acciones fijas, y la
// pantalla Tiendas > Eliminadas las lee junto con el resto de la actividad de la tienda.
export const LIFECYCLE_ACTIONS = {
  created: "VENDOR_CREATED",
  deletionRequested: "VENDOR_DELETION_REQUESTED",
  deletionCancelled: "VENDOR_DELETION_CANCELLED",
  deleted: "VENDOR_DELETED",
};

// Datos técnicos de la petición (los mismos que se guardan de un pedido, ver OrderRequestInfo). `clientInfo` es lo que el
// navegador dice de sí mismo (lib/clientInfo.js del frontend); se valida y si no sirve se ignora.
export function requestContext(req, clientInfo) {
  const parsed = clientInfoSchema.safeParse(clientInfo);
  return captureOrderRequest(req, parsed.success ? parsed.data : undefined, "WEB");
}

// Versión legible del contexto guardado (navegador, sistema, tipo de dispositivo), para la pantalla del admin.
export function describeContext(ctx) {
  return ctx ? describeOrderRequest(ctx) : null;
}

export async function logVendorLifecycle({ vendorId, actorId, actorRole, action, description, req = null, clientInfo, extra = {} }) {
  await prisma.activityLog
    .create({
      data: {
        vendorId,
        actorId,
        actorRole,
        action,
        description,
        meta: { ...extra, ...(req ? { request: requestContext(req, clientInfo) } : {}) },
      },
    })
    .catch((err) => console.warn("[tienda] no se pudo guardar el historial:", err?.message));
}

// Foto de la tienda justo antes de eliminarla: nombre, enlace, contacto y cuánto tenía. Al eliminar se libera el enlace y la
// cuenta se anonimiza; esta foto es lo que queda para saber qué era.
export async function vendorSnapshot(vendorId) {
  const v = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: {
      companyName: true, slug: true, whatsapp: true, email: true, ownerName: true, ownerIdNumber: true, companyAddress: true,
      planType: true, verificationStatus: true, createdAt: true, currency: true,
      _count: { select: { products: true, orders: true } },
    },
  });
  if (!v) return null;
  const { _count, ...rest } = v;
  return { ...rest, products: _count.products, orders: _count.orders };
}

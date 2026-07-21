import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { generateInvoicePdf, generateWarrantyPdf } from "../lib/pdf.js";
import { sendDocumentEmail } from "../lib/email.js";

// Bloque 29: factura/garantía solo tienen sentido sobre un pedido que
// realmente se vendió (stock ya descontado en confirmOrderSale) — un
// Pendiente todavía puede no concretarse nunca, y uno Cancelado/Rechazado
// no debería tener comprobante de venta. Además exige que el vendedor haya
// completado sus datos de facturación (VendorSettings.jsx) — sin esto el
// PDF saldría con huecos donde debería ir el responsable/identificación/
// dirección de la empresa, así que se bloquea acá con un mensaje claro en
// vez de generar un documento incompleto.
async function loadConfirmedOrderForVendor(userId, orderId) {
  const vendor = await resolveMyVendor(userId);
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order || order.vendorId !== vendor.id) throw new AppError("Pedido no encontrado.", 404);
  if (order.status === "NEW") throw new AppError("Este pedido todavía no fue confirmado — confirmá la venta antes de generar la factura o garantía.", 400);
  if (order.status === "CANCELLED") throw new AppError("Este pedido fue rechazado/cancelado, no se puede facturar.", 400);

  const missing = [];
  if (!vendor.ownerName) missing.push("responsable del negocio");
  if (!vendor.ownerIdNumber) missing.push("identificación del responsable");
  if (!vendor.companyAddress) missing.push("dirección de la empresa");
  if (missing.length > 0) {
    throw new AppError(`Completá los datos de facturación de tu tienda antes de generar documentos (falta: ${missing.join(", ")}). Podés cargarlos en Configuración.`, 400);
  }

  return { vendor, order };
}

function resolveCustomer(data, order) {
  return {
    name: data.customerName?.trim() || order.customerName || undefined,
    idNumber: data.customerIdNumber,
    phone: data.customerPhone?.trim() || order.customerPhone || undefined,
    email: order.customerEmail || undefined,
  };
}

const customerFields = {
  customerName: z.string().trim().min(1).optional(),
  customerIdNumber: z.string().trim().min(1, "Falta la identificación del cliente."),
  customerPhone: z.string().trim().optional(),
};

const invoiceSchema = z.object(customerFields);
const invoiceEmailSchema = invoiceSchema.extend({ sendTo: z.string().email("Ingresá un correo válido.") });

const warrantyBaseFields = {
  ...customerFields,
  // Se identifica por OrderItem.id (no productId): sigue siendo válido aunque
  // el producto original se haya borrado/desactivado después del pedido.
  orderItemIds: z.array(z.string()).min(1, "Elegí al menos un producto para la garantía."),
  warrantyDays: z.number().int().positive("Los días de garantía deben ser un número positivo."),
};
const warrantySchema = z.object(warrantyBaseFields);
const warrantyEmailSchema = z.object({ ...warrantyBaseFields, sendTo: z.string().email("Ingresá un correo válido.") });

function pdfItemsFrom(orderItems) {
  return orderItems.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price }));
}

export async function downloadInvoice(req, res) {
  const { id } = req.params;
  const data = invoiceSchema.parse(req.body);
  const { vendor, order } = await loadConfirmedOrderForVendor(req.user.id, id);

  const pdfBuffer = await generateInvoicePdf({ vendor, order, items: pdfItemsFrom(order.items), customer: resolveCustomer(data, order) });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="factura-${order.code}.pdf"`);
  res.send(pdfBuffer);
}

export async function emailInvoice(req, res) {
  const { id } = req.params;
  const data = invoiceEmailSchema.parse(req.body);
  const { vendor, order } = await loadConfirmedOrderForVendor(req.user.id, id);
  const customer = resolveCustomer(data, order);

  const pdfBuffer = await generateInvoicePdf({ vendor, order, items: pdfItemsFrom(order.items), customer });

  const result = await sendDocumentEmail({
    to: data.sendTo,
    vendorId: vendor.id,
    orderId: order.id,
    vendorName: vendor.companyName,
    subject: `Factura de tu compra en ${vendor.companyName} — pedido ${order.code}`,
    html: `<p>Hola${customer.name ? ` ${customer.name}` : ""},</p><p>Adjuntamos la factura de tu compra en <strong>${vendor.companyName}</strong> (pedido ${order.code}).</p><p>¡Gracias por tu compra!</p>`,
    filename: `factura-${order.code}.pdf`,
    pdfBuffer,
  });
  if (!result.ok) throw new AppError(`No se pudo enviar el correo: ${result.error}`, 502);

  res.status(201).json({ ok: true });
}

function selectWarrantyItems(order, orderItemIds) {
  const selected = order.items.filter((i) => orderItemIds.includes(i.id));
  if (selected.length === 0) throw new AppError("Ninguno de los productos elegidos pertenece a este pedido.", 400);
  return selected;
}

export async function downloadWarranty(req, res) {
  const { id } = req.params;
  const data = warrantySchema.parse(req.body);
  const { vendor, order } = await loadConfirmedOrderForVendor(req.user.id, id);
  const items = selectWarrantyItems(order, data.orderItemIds);

  const pdfBuffer = await generateWarrantyPdf({ vendor, order, items: pdfItemsFrom(items), warrantyDays: data.warrantyDays, customer: resolveCustomer(data, order) });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="garantia-${order.code}.pdf"`);
  res.send(pdfBuffer);
}

export async function emailWarranty(req, res) {
  const { id } = req.params;
  const data = warrantyEmailSchema.parse(req.body);
  const { vendor, order } = await loadConfirmedOrderForVendor(req.user.id, id);
  const items = selectWarrantyItems(order, data.orderItemIds);
  const customer = resolveCustomer(data, order);

  const pdfBuffer = await generateWarrantyPdf({ vendor, order, items: pdfItemsFrom(items), warrantyDays: data.warrantyDays, customer });

  const result = await sendDocumentEmail({
    to: data.sendTo,
    vendorId: vendor.id,
    orderId: order.id,
    vendorName: vendor.companyName,
    subject: `Certificado de garantía — ${vendor.companyName} — pedido ${order.code}`,
    html: `<p>Hola${customer.name ? ` ${customer.name}` : ""},</p><p>Adjuntamos el certificado de garantía de tu compra en <strong>${vendor.companyName}</strong> (pedido ${order.code}), válido por ${data.warrantyDays} día(s).</p>`,
    filename: `garantia-${order.code}.pdf`,
    pdfBuffer,
  });
  if (!result.ok) throw new AppError(`No se pudo enviar el correo: ${result.error}`, 502);

  res.status(201).json({ ok: true });
}

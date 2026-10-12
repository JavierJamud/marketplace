import { prisma } from "../lib/prisma.js";
import { sendContactMessageEmail } from "../lib/email.js";

// Problema que un cliente le cuenta al asistente. Quien lo atiende depende de lo que reportó:
//  - con el número de un pedido que existe: el vendedor de ese pedido (aviso en su campanita y correo),
//  - sin pedido, o con un problema del sitio: el admin (aviso en su campanita, que lee los casos abiertos, y correo).
// Los correos salen con "Responder" apuntando al cliente, para que se contesten directo. Son best-effort: el caso queda
// guardado aunque el correo falle.

export async function createSupportCase({ kind, name, phone, email, message, orderCode }) {
  let vendor = null;
  let code = null;
  if (kind === "ORDER" && orderCode) {
    const order = await prisma.order.findUnique({
      where: { code: orderCode.toUpperCase() },
      select: { code: true, vendor: { select: { id: true, companyName: true, user: { select: { email: true } } } } },
    });
    if (order) {
      code = order.code;
      vendor = order.vendor;
    }
  }

  const supportCase = await prisma.supportCase.create({
    data: { kind, name, phone, email, message: message || null, orderCode: code ?? (orderCode || null), vendorId: vendor?.id ?? null },
  });

  const subjectLine = kind === "ORDER" ? `Problema con el pedido ${code ?? orderCode ?? ""}`.trim() : "Problema con el sitio web";
  const detail = [
    `${subjectLine}.`,
    `Nombre: ${name}`,
    `Teléfono: ${phone}`,
    `Correo: ${email}`,
    message ? `\nMensaje del cliente:\n${message}` : "\nEl cliente no dejó un mensaje adicional.",
  ].join("\n");

  if (vendor) {
    await prisma.vendorNotification
      .create({
        data: {
          vendorId: vendor.id,
          type: "SUPPORT_CASE",
          title: subjectLine,
          body: `${name} (${phone}, ${email}) reportó un problema.${message ? ` “${message.slice(0, 300)}”` : ""}`,
        },
      })
      .catch(() => {});
  }

  const recipients = [];
  if (vendor?.user?.email) recipients.push(vendor.user.email);
  if (!vendor) {
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { email: true } });
    if (admin?.email) recipients.push(admin.email);
  }
  await Promise.all(recipients.map((to) => sendContactMessageEmail({ to, name, email, message: detail }).catch(() => {})));

  return { supportCase, routedTo: vendor ? "vendor" : "admin", vendorName: vendor?.companyName ?? null };
}

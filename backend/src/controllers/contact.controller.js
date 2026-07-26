import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { sendContactMessageEmail } from "../lib/email.js";

const contactSchema = z.object({
  name: z.string().trim().min(2, "Contanos tu nombre."),
  email: z.string().trim().email("Correo inválido."),
  message: z.string().trim().min(5, "Cuéntanos un poco más."),
});

// Bloque 48: sin tabla de mensajes propia (ver decisión del bloque) — el
// mensaje del formulario público de /contacto va directo al correo del
// admin, reusando la misma infraestructura de Resend que el resto del
// proyecto. Un solo admin implícito hoy (Bloque 47, decisión D) — se
// resuelve el destinatario en vivo, nunca hardcodeado.
export async function sendContactMessage(req, res) {
  const { name, email, message } = contactSchema.parse(req.body);

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
  if (!admin?.email) throw new AppError("No se pudo enviar el mensaje. Prueba de nuevo más tarde.", 503);

  const result = await sendContactMessageEmail({ to: admin.email, name, email, message });
  if (!result.ok) throw new AppError("No se pudo enviar tu mensaje. Prueba de nuevo en un momento.", 502, { detail: result.error });

  res.json({ ok: true });
}

import { z } from "zod";
import { generateDescription, transcribeAudio } from "../lib/ai.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { AppError } from "../utils/AppError.js";
import { prisma } from "../lib/prisma.js";

const generateSchema = z.object({
  kind: z.enum(["product", "store", "warranty", "offer", "campaign"]),
  // Obligatorio: la IA "mejora" lo que el vendedor ya escribió, nunca
  // inventa un producto/tienda/garantía desde cero (regla de negocio del bloque).
  currentText: z.string().min(5, "Escribe primero una breve descripción para que la IA la pueda mejorar."),
  productName: z.string().optional(),
});

// Único uso de IA en todo el proyecto (Bloque 13) — genera texto, nunca
// guarda nada: el vendedor siempre revisa/edita antes de confirmar el save.
// Toma como referencia la tienda desde la que se pide (resuelta acá, nunca
// confiada del body) además del texto/nombre que ya trae el form.
export async function generateProductOrStoreDescription(req, res) {
  const { kind, currentText, productName } = generateSchema.parse(req.body);

  // Bloque 66: "campaign" lo pide un ADMIN desde AdminCampaigns.jsx, sin
  // ninguna tienda de por medio (el correo es de la plataforma, no de un
  // vendedor) — a diferencia de los otros 4 kinds, nunca hay que resolver
  // un Vendor acá (un admin no tiene fila propia en esa tabla).
  if (kind === "campaign") {
    const description = await generateDescription(kind, { currentText });
    return res.json({ description });
  }

  const vendor = await resolveMyVendor(req.user.id);

  // Solo el prompt de garantía usa el rubro — resolveMyVendor() se llama
  // desde ~28 puntos del backend sin include, así que se resuelve acá con
  // una consulta chica en vez de agregar el join a todos esos call sites.
  let businessCategoryName;
  if (kind === "warranty" && vendor.businessCategoryId) {
    const category = await prisma.businessCategory.findUnique({ where: { id: vendor.businessCategoryId }, select: { name: true } });
    businessCategoryName = category?.name;
  }

  const description = await generateDescription(kind, { currentText, vendorName: vendor.companyName, productName, businessCategoryName });
  res.json({ description });
}

// Bloque 32: endpoint compartido por AMBOS bots (tienda y general) — graban
// un audio, este endpoint lo transcribe y el frontend manda el texto
// resultante al flujo normal de chat de cada uno. Público (sin login, sin
// resolveMyVendor) a propósito: ninguno de los dos bots exige login para
// usar audio, mismo acceso que escribir texto.
export async function transcribeChatAudio(req, res) {
  if (!req.file) throw new AppError("Manda un audio para transcribir.", 400);
  const text = await transcribeAudio({ audioBuffer: req.file.buffer, mimeType: req.file.mimetype, filename: req.file.originalname });
  res.json({ text });
}

// Carga el contenido institucional del sitio: Términos, Privacidad, Centro de ayuda, Contacto (tabla StaticPage) y las
// preguntas frecuentes de clientes y vendedores (tabla FaqItem).
//
//   node prisma/cargar-contenido.mjs             exige que prisma/contenido/datos.json esté completo; si falta algo, no escribe nada
//   node prisma/cargar-contenido.mjs --borrador  rellena lo que falte con [CAMPO] visible, para ver cómo queda (no publicar así)
//   node prisma/cargar-contenido.mjs --solo=faq  solo una parte: legal (terminos y privacidad), ayuda, contacto o faq
//
// Los textos viven en prisma/contenido/*.html con marcadores {{CAMPO}}. Las cuatro páginas reemplazan el contenido que
// tuvieran (el admin puede volver a editarlas desde Páginas). Las preguntas frecuentes se identifican por su texto: si ya
// existe una igual para ese público se actualiza su respuesta, si no se agrega; nunca se borra ninguna otra.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import DOMPurify from "isomorphic-dompurify";
import { PrismaClient } from "@prisma/client";
import { parseFaqBatch } from "../src/lib/faqBatch.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "contenido");
const borrador = process.argv.includes("--borrador");
const solo = process.argv.find((a) => a.startsWith("--solo="))?.slice(7);
const quiere = (parte) => !solo || solo === parte;

const datos = JSON.parse(fs.readFileSync(path.join(dir, "datos.json"), "utf8"));
datos.WHATSAPP_NUMERO = String(datos.WHATSAPP ?? "").replace(/\D/g, "");

const PAGINAS = [
  { slug: "terminos", file: "terminos.html", parte: "legal" },
  { slug: "privacidad", file: "privacidad.html", parte: "legal" },
  { slug: "ayuda", file: "ayuda.html", parte: "ayuda" },
  { slug: "contacto", file: "contacto.html", parte: "contacto" },
];
const FAQS = [
  { audience: "CUSTOMER", file: "faq-clientes.html" },
  { audience: "VENDOR", file: "faq-vendedores.html" },
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const faltan = new Set();
const render = (html) =>
  html.replace(/\{\{([A-Z_]+)\}\}/g, (_m, k) => {
    const v = String(datos[k] ?? "").trim();
    if (v) return esc(v);
    faltan.add(k);
    return `[${k}]`;
  });
const leer = (file) => render(fs.readFileSync(path.join(dir, file), "utf8"));

const paginas = PAGINAS.filter((p) => quiere(p.parte)).map((p) => ({ slug: p.slug, html: leer(p.file) }));
const faqs = quiere("faq") ? FAQS.map((f) => ({ audience: f.audience, ...parseFaqBatch(leer(f.file)) })) : [];

if (faltan.size && !borrador) {
  console.error(`Faltan datos en prisma/contenido/datos.json: ${[...faltan].join(", ")}.\nCompleta esos campos o usa --borrador para una vista previa.`);
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  for (const { slug, html } of paginas) {
    const htmlContent = DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
    await prisma.staticPage.upsert({ where: { slug }, update: { htmlContent }, create: { slug, htmlContent } });
    console.log(`${slug}: cargada (${htmlContent.length} caracteres)`);
  }
  for (const { audience, items, skipped } of faqs) {
    let nuevas = 0;
    let actualizadas = 0;
    for (const it of items) {
      const existente = await prisma.faqItem.findFirst({ where: { audience, question: it.question } });
      if (existente) {
        await prisma.faqItem.update({ where: { id: existente.id }, data: { answer: it.answer } });
        actualizadas++;
      } else {
        await prisma.faqItem.create({ data: { audience, ...it } });
        nuevas++;
      }
    }
    console.log(`faq ${audience}: ${nuevas} nuevas, ${actualizadas} actualizadas${skipped.length ? `, ${skipped.length} omitidas (${skipped.map((s) => s.question).join("; ")})` : ""}`);
  }
  if (faltan.size) console.log(`BORRADOR con marcadores pendientes: ${[...faltan].join(", ")}`);
} finally {
  await prisma.$disconnect();
}

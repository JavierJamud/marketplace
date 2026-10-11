// Carga los textos legales (Términos y Privacidad) en la tabla StaticPage, que es lo que muestran /terminos y /privacidad.
//
//   node prisma/cargar-legal.mjs            exige que prisma/legal/datos.json esté completo; si falta algo, no escribe nada
//   node prisma/cargar-legal.mjs --borrador rellena lo que falte con [CAMPO] visible, para ver cómo queda (no publicar así)
//
// Los textos viven en prisma/legal/*.html con marcadores {{CAMPO}}. Cada carga reemplaza el contenido anterior de esas
// dos páginas (el admin puede volver a editarlas después desde Páginas). Pasa por el mismo sanitizador que el editor.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import DOMPurify from "isomorphic-dompurify";
import { PrismaClient } from "@prisma/client";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "legal");
const borrador = process.argv.includes("--borrador");
const datos = JSON.parse(fs.readFileSync(path.join(dir, "datos.json"), "utf8"));
const PAGINAS = { terminos: "terminos.html", privacidad: "privacidad.html" };

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const faltan = new Set();
const render = (html) =>
  html.replace(/\{\{([A-Z_]+)\}\}/g, (_m, k) => {
    const v = String(datos[k] ?? "").trim();
    if (v) return esc(v);
    faltan.add(k);
    return `[${k}]`;
  });

const out = Object.fromEntries(Object.entries(PAGINAS).map(([slug, file]) => [slug, render(fs.readFileSync(path.join(dir, file), "utf8"))]));

if (faltan.size && !borrador) {
  console.error(`Faltan datos en prisma/legal/datos.json: ${[...faltan].join(", ")}.\nCompleta esos campos o usa --borrador para una vista previa.`);
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  for (const [slug, html] of Object.entries(out)) {
    const htmlContent = DOMPurify.sanitize(html);
    await prisma.staticPage.upsert({ where: { slug }, update: { htmlContent }, create: { slug, htmlContent } });
    console.log(`${slug}: cargado (${htmlContent.length} caracteres)`);
  }
  if (faltan.size) console.log(`BORRADOR con marcadores pendientes: ${[...faltan].join(", ")}`);
} finally {
  await prisma.$disconnect();
}

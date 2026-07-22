import { z } from "zod";
import DOMPurify from "isomorphic-dompurify";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

// Bloque 48: whitelist fija — nunca se acepta un slug arbitrario ni en el
// endpoint público ni en el de admin, así el modelo StaticPage nunca
// termina con filas huérfanas de páginas que no existen de verdad.
export const STATIC_PAGE_SLUGS = ["terminos", "privacidad", "faq", "ayuda", "contacto"];

function assertKnownSlug(slug) {
  if (!STATIC_PAGE_SLUGS.includes(slug)) throw new AppError("Esa página no existe.", 404);
}

// Público — sin auth. htmlContent: null significa "sin editar todavía",
// el componente React (Terminos.jsx, etc.) muestra su copy fijo en ese
// caso — el contenido original nunca se pierde ni depende de esta tabla.
export async function getStaticPage(req, res) {
  const { slug } = req.params;
  assertKnownSlug(slug);
  const page = await prisma.staticPage.findUnique({ where: { slug } });
  res.json({ slug, htmlContent: page?.htmlContent ?? null, updatedAt: page?.updatedAt ?? null });
}

// Admin — arma la lista completa de las 5 páginas aunque todavía no exista
// fila para alguna (nunca editada), para que AdminPages.jsx siempre
// muestre las 5 con su estado real ("Editada" o "Predeterminada").
export async function listStaticPagesAdmin(_req, res) {
  const rows = await prisma.staticPage.findMany();
  const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r]));
  const pages = STATIC_PAGE_SLUGS.map((slug) => ({
    slug,
    htmlContent: bySlug[slug]?.htmlContent ?? null,
    updatedAt: bySlug[slug]?.updatedAt ?? null,
  }));
  res.json({ pages });
}

const updateSchema = z.object({ htmlContent: z.string().nullable() });

// Bloque 48: nunca se confía en el HTML tal cual llega, aunque venga de un
// admin autenticado — sanitizar antes de guardar es lo que hace que
// GET /static-pages/:slug (público, sin auth) sea seguro de inyectar
// directo en el DOM del lado del cliente sin sanitizar de nuevo ahí.
// htmlContent: "" o null = "restaurar predeterminado" (vuelve a null).
export async function updateStaticPage(req, res) {
  const { slug } = req.params;
  assertKnownSlug(slug);
  const { htmlContent } = updateSchema.parse(req.body);

  const clean = htmlContent?.trim() ? DOMPurify.sanitize(htmlContent) : null;

  const page = await prisma.staticPage.upsert({
    where: { slug },
    update: { htmlContent: clean },
    create: { slug, htmlContent: clean },
  });
  res.json({ slug, htmlContent: page.htmlContent, updatedAt: page.updatedAt });
}

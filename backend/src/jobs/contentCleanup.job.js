import cron from "node-cron";
import { readdir, stat, rmdir, unlink } from "node:fs/promises";
import { join, basename } from "node:path";
import { prisma } from "../lib/prisma.js";
import { logActivity } from "../lib/activityLog.js";
import { deleteUploadedImages, UPLOADS_ROOT } from "../lib/uploadFiles.js";

// Limpieza mensual de IMÁGENES que ya no usa nadie, para no gastar disco sin necesidad. Nunca borra información: ni registros de
// la base de datos, ni pedidos, ni historiales. Solo archivos de imagen, y solo si ya no hacen falta en ningún lugar del sitio.
//
// 1. Imágenes de ofertas que vencieron o se retiraron hace más de 30 días: se borra el archivo y la oferta conserva todos sus
//    datos (solo queda sin imagen). En el registro de actividad de la tienda queda una línea de lo que se limpió.
// 2. Imágenes huérfanas: archivos del disco que NINGÚN registro de la base menciona (de un borrado antiguo que no los quitó, de
//    una tienda o cuenta eliminada, o de una subida que no llegó a guardarse).
//
// Una imagen que aparece en cualquier tabla (producto, anuncio, oferta activa, reseña, pedido, mensaje, lo que sea) nunca se toca.

const OFFER_GRACE_DAYS = 30;
const ORPHAN_MIN_AGE_MS = 3 * 24 * 60 * 60 * 1000; // una subida reciente aún puede estar guardándose
const DAY_MS = 24 * 60 * 60 * 1000;

// --- 1. Imágenes de ofertas vencidas ----------------------------------------------------------------------------------------

async function cleanExpiredOfferImages() {
  const limit = new Date(Date.now() - OFFER_GRACE_DAYS * DAY_MS);
  const stale = await prisma.offer.findMany({
    where: {
      contentType: "CUSTOM",
      imageUrl: { not: null },
      OR: [
        { status: "EXPIRED", expiresAt: { lt: limit } },
        { status: "REMOVED", updatedAt: { lt: limit } },
      ],
    },
    include: { vendor: { select: { id: true, userId: true } } },
  });

  let cleaned = 0;
  for (const offer of stale) {
    // Solo las ofertas con imagen propia (CUSTOM) tienen un archivo suyo; las de producto usan la foto del producto, que no se toca.
    // Se comprueba además que ninguna otra oferta ACTIVA ni ningún otro registro use el mismo archivo.
    if (await isImageInUse(offer.imageUrl, offer.id)) continue;
    await deleteUploadedImages([offer.imageUrl]);
    await prisma.offer.update({ where: { id: offer.id }, data: { imageUrl: null } });
    if (offer.vendor) {
      await logActivity({
        actorId: offer.vendor.userId,
        actorRole: "VENDOR",
        vendorId: offer.vendor.id,
        action: "OFFER_IMAGE_PURGED",
        description: `Se liberó la imagen de la oferta "${offer.title}" (${offer.status === "REMOVED" ? "retirada" : "vencida"}). La oferta conserva sus datos.`,
        meta: { offerId: offer.id, status: offer.status },
      });
    }
    cleaned++;
  }
  return cleaned;
}

// --- Qué imágenes están en uso ----------------------------------------------------------------------------------------------

// "uuid" de una foto a partir de cualquier variante: <uuid>.webp, <uuid>-thumb.webp, <uuid>.w720.webp.
const photoId = (nameOrUrl) => basename(String(nameOrUrl)).replace(/\.w720\.webp$/, "").replace(/-thumb\.webp$/, "").replace(/\.[a-z0-9]+$/i, "");

const UPLOAD_URL_RE = /\/uploads\/[^"'\s,}\]\\)]+/g;

// Recorre TODAS las columnas de texto, listas de texto y JSON de la base y junta cada ruta "/uploads/..." que mencionan. Así no
// importa en qué tabla se use una imagen (hoy o en el futuro): si aparece en cualquier lado, cuenta como en uso.
// Los nombres de tabla y columna salen del propio catálogo de PostgreSQL y se escriben entre comillas.
async function usedPhotoIds({ exceptOfferId } = {}) {
  const columns = await prisma.$queryRaw`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (data_type IN ('text', 'character varying', 'json', 'jsonb') OR (data_type = 'ARRAY' AND udt_name IN ('_text', '_varchar')))
      AND table_name <> '_prisma_migrations'`;
  const ids = new Set();
  for (const { table_name: table, column_name: col } of columns) {
    // La propia oferta que se está limpiando no cuenta como uso de su imagen.
    const skipSelf = exceptOfferId && table === "Offer" && col === "imageUrl" ? ` AND "id" <> '${String(exceptOfferId).replace(/'/g, "")}'` : "";
    const rows = await prisma.$queryRawUnsafe(`SELECT "${col}"::text AS v FROM "${table}" WHERE "${col}"::text LIKE '%/uploads/%'${skipSelf}`);
    for (const r of rows) for (const url of r.v.match(UPLOAD_URL_RE) ?? []) ids.add(photoId(url));
  }
  return ids;
}

async function isImageInUse(url, offerId) {
  const used = await usedPhotoIds({ exceptOfferId: offerId });
  return used.has(photoId(url));
}

// --- 2. Imágenes huérfanas --------------------------------------------------------------------------------------------------

// Carpetas que se revisan. `site` (marca, banners y anuncios del admin), `kyc` (verificación de identidad), reportes y documentos
// no entran: las gestiona el admin o los trámites con sus propias reglas.
const SWEPT_DIRS = ["customer-listings", "products", "offers", "reviews", "vendor-branding", "vendor-staff"];

async function listFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out;
}

// Quita las carpetas de dueño que se quedaron vacías (una por usuario o por tienda).
async function removeEmptyOwnerDirs(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) await rmdir(join(root, e.name)).catch(() => {});
  }
}

// `dryRun`: solo cuenta y lista, no borra nada. Sirve para revisar la lista contra datos reales antes de dejarlo trabajar solo.
export async function sweepOrphanPhotos({ dryRun = false } = {}) {
  const used = await usedPhotoIds();
  const result = { checked: 0, orphans: [], bytes: 0, aborted: false };
  const now = Date.now();

  // Cinturón de seguridad: si la base no menciona ninguna imagen pero hay archivos en el disco, algo anda mal con la lectura
  // (base vacía o vacía por error) y no se borra nada.
  const files = [];
  for (const dirName of SWEPT_DIRS) files.push(...(await listFiles(join(UPLOADS_ROOT, dirName))));
  if (files.length > 0 && used.size === 0) return { ...result, checked: files.length, aborted: true };

  for (const file of files) {
    result.checked++;
    if (used.has(photoId(file))) continue;
    const info = await stat(file).catch(() => null);
    if (!info || now - info.mtimeMs < ORPHAN_MIN_AGE_MS) continue;
    result.orphans.push(file.slice(UPLOADS_ROOT.length + 1));
    result.bytes += info.size;
    if (!dryRun) await unlink(file).catch(() => {});
  }
  if (!dryRun) {
    await removeEmptyOwnerDirs(join(UPLOADS_ROOT, "customer-listings"));
    await removeEmptyOwnerDirs(join(UPLOADS_ROOT, "products"));
  }
  return result;
}

// --- Ejecución --------------------------------------------------------------------------------------------------------------

export async function runContentCleanupJob() {
  const offerImages = await cleanExpiredOfferImages();
  const sweep = await sweepOrphanPhotos();
  console.log(
    `[contentCleanupJob] imágenes de ofertas liberadas=${offerImages} huérfanas eliminadas=${sweep.orphans.length} (${Math.round(sweep.bytes / 1024)} KB)${sweep.aborted ? " ABORTADO: la base no menciona ninguna imagen" : ""}`
  );
  return { offerImages, orphans: sweep.orphans.length, aborted: sweep.aborted };
}

// El día 1 de cada mes a las 3:30 am hora de Cuba, cuando casi no hay visitas.
export function startContentCleanupJob() {
  cron.schedule(
    "30 3 1 * *",
    () => {
      runContentCleanupJob().catch((err) => console.error("[contentCleanupJob] error:", err));
    },
    { timezone: "America/Havana" }
  );
}

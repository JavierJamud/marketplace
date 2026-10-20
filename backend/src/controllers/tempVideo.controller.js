import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegStatic from "ffmpeg-static";
import { AppError } from "../utils/AppError.js";

// Página temporal del admin para comprimir videos: se sube el original, el servidor lo pasa a H.264 más liviano y solo se
// guarda el resultado, que es lo que se descarga. No se sirve como archivo público (no está bajo express.static) y todo se
// borra solo a las 24 horas.
const __dirname = dirname(fileURLToPath(import.meta.url));
export const TEMP_VIDEO_DIR = join(__dirname, "..", "..", "uploads", "temp-video");
mkdirSync(TEMP_VIDEO_DIR, { recursive: true });

// Cloudflare (plan gratis) corta cualquier envío de más de 100 MB antes de llegar al servidor.
export const TEMP_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const KEEP_MS = 24 * 60 * 60 * 1000;
const MAX_RUN_MS = 30 * 60 * 1000;
const FFMPEG = ffmpegStatic && existsSync(ffmpegStatic) ? ffmpegStatic : "ffmpeg";
const ID_RE = /^[0-9a-f-]{36}$/;

const metaPath = (id) => join(TEMP_VIDEO_DIR, `${id}.json`);
const outPath = (id) => join(TEMP_VIDEO_DIR, `${id}.mp4`);
const srcPath = (id) => join(TEMP_VIDEO_DIR, `${id}.src`);

// Progreso de la compresión en curso (la API corre en una sola instancia de PM2).
const progress = new Map();
// De a un video por vez: comprimir usa mucha CPU y el sitio tiene que seguir respondiendo.
let queue = Promise.resolve();

async function readMeta(id) {
  try {
    return JSON.parse(await readFile(metaPath(id), "utf8"));
  } catch {
    return null;
  }
}

const saveMeta = (meta) => writeFile(metaPath(meta.id), JSON.stringify(meta));

async function removeVideo(id) {
  progress.delete(id);
  await Promise.all([metaPath(id), outPath(id), srcPath(id)].map((p) => rm(p, { force: true })));
}

async function cleanupExpired() {
  const files = await readdir(TEMP_VIDEO_DIR).catch(() => []);
  for (const f of files.filter((f) => f.endsWith(".json"))) {
    const meta = await readMeta(f.slice(0, -5));
    if (meta && Date.now() - new Date(meta.createdAt).getTime() > KEEP_MS) await removeVideo(meta.id);
  }
}
setInterval(() => cleanupExpired().catch(() => {}), 60 * 60 * 1000).unref();

// Si la API se reinició a mitad de una compresión, ese video quedó a medias: se marca como fallido para no esperarlo nunca.
(async () => {
  const files = await readdir(TEMP_VIDEO_DIR).catch(() => []);
  for (const f of files.filter((f) => f.endsWith(".json"))) {
    const meta = await readMeta(f.slice(0, -5));
    if (meta?.status === "processing") {
      await rm(srcPath(meta.id), { force: true });
      await saveMeta({ ...meta, status: "failed", error: "El servidor se reinició mientras se comprimía. Súbelo otra vez." });
    }
  }
})().catch(() => {});

const toSeconds = (h, m, s) => Number(h) * 3600 + Number(m) * 60 + Number(s);

function compress(id) {
  return new Promise((resolve, reject) => {
    // CRF 28: bastante más liviano que el original y todavía nítido en un teléfono. El lado mayor queda en 1280 px como
    // máximo (sin agrandar videos chicos) y "faststart" deja que el video empiece a verse antes de bajarse entero.
    const args = [
      "-hide_banner", "-y", "-i", srcPath(id),
      "-map", "0:v:0", "-map", "0:a:0?",
      "-vf", "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "96k",
      "-movflags", "+faststart", "-threads", "2",
      outPath(id),
    ];
    const proc = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
    const timer = setTimeout(() => proc.kill("SIGKILL"), MAX_RUN_MS);
    let duration = 0;
    let tail = "";
    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      tail = (tail + text).slice(-2000);
      const d = text.match(/Duration: (\d+):(\d+):([\d.]+)/);
      if (d) duration = toSeconds(d[1], d[2], d[3]);
      const t = [...text.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop();
      if (t && duration > 0) progress.set(id, Math.min(99, Math.round((toSeconds(t[1], t[2], t[3]) / duration) * 100)));
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(tail.trim().split("\n").pop() || `ffmpeg terminó con código ${code}`));
    });
  });
}

async function runJob(id) {
  const meta = await readMeta(id);
  if (!meta) return;
  try {
    await compress(id);
    // Borrado mientras se comprimía: se descarta el resultado en vez de revivirlo.
    if (!(await readMeta(id))) return void (await rm(outPath(id), { force: true }));
    const { size } = await stat(outPath(id));
    await saveMeta({ ...meta, status: "done", compressedSize: size, finishedAt: new Date().toISOString() });
  } catch (err) {
    await rm(outPath(id), { force: true });
    // Si el admin lo borró mientras se comprimía, no hay nada que marcar.
    if (await readMeta(id)) await saveMeta({ ...meta, status: "failed", error: `No se pudo comprimir: ${String(err.message).slice(0, 300)}` });
  } finally {
    progress.delete(id);
    await rm(srcPath(id), { force: true });
  }
}

const publicMeta = (meta) => ({
  id: meta.id,
  name: meta.name,
  status: meta.status,
  originalSize: meta.originalSize,
  compressedSize: meta.compressedSize ?? null,
  progress: meta.status === "processing" ? progress.get(meta.id) ?? 0 : null,
  error: meta.error ?? null,
  createdAt: meta.createdAt,
  expiresAt: new Date(new Date(meta.createdAt).getTime() + KEEP_MS).toISOString(),
});

export async function listTempVideos(_req, res) {
  await cleanupExpired();
  const files = await readdir(TEMP_VIDEO_DIR).catch(() => []);
  const metas = (await Promise.all(files.filter((f) => f.endsWith(".json")).map((f) => readMeta(f.slice(0, -5))))).filter(Boolean);
  metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ videos: metas.map(publicMeta), maxBytes: TEMP_VIDEO_MAX_BYTES });
}

export async function uploadTempVideo(req, res) {
  if (!req.file) throw new AppError("Elige un archivo de video.", 400);
  const id = req.file.filename.replace(/\.src$/, "");
  const baseName = req.file.originalname.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 80) || "video";
  const meta = { id, name: baseName, status: "processing", originalSize: req.file.size, createdAt: new Date().toISOString() };
  await saveMeta(meta);
  progress.set(id, 0);
  queue = queue.then(() => runJob(id));
  res.status(201).json({ video: publicMeta(meta) });
}

export async function downloadTempVideo(req, res) {
  const { id } = req.params;
  if (!ID_RE.test(id)) throw new AppError("Video no encontrado.", 404);
  const meta = await readMeta(id);
  if (!meta || meta.status !== "done") throw new AppError("Ese video ya no está o todavía se está comprimiendo.", 404);
  res.download(outPath(id), `${meta.name}-comprimido.mp4`);
}

export async function deleteTempVideo(req, res) {
  const { id } = req.params;
  if (!ID_RE.test(id)) throw new AppError("Video no encontrado.", 404);
  await removeVideo(id);
  res.status(204).end();
}

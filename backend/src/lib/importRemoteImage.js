import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

// Cuando un vendedor pega el enlace de una foto, el servidor la descarga, la optimiza (WebP, 1400 px y miniatura de 500 px, igual
// que las fotos subidas) y la guarda en la propia tienda. Antes el enlace se usaba tal cual: una foto de 2 MB de otro sitio hacía
// lenta la portada, y si ese sitio la borraba el producto se quedaba sin foto.
//
// Seguridad: es una descarga hecha por el servidor a una dirección que escribió un usuario, así que (1) solo http/https, (2) la
// dirección IP a la que se conecta se valida en el momento de conectar (evita redes internas, también con redirecciones y con
// nombres que cambian de IP), (3) tope de tamaño y de tiempo, (4) debe ser realmente una imagen que sharp pueda leer.

const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // enlace local (incluye metadatos de la nube)
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) || // 192.0.0.0/24 y 192.0.2.0/24
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast y reservadas
    );
  }
  if (net.isIPv6(address)) {
    const v = address.toLowerCase();
    if (v === "::" || v === "::1") return true;
    if (v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return true; // fe80::/10
    if (v.startsWith("fc") || v.startsWith("fd")) return true; // únicas locales
    if (v.startsWith("ff")) return true; // multicast
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4 dentro de IPv6
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true;
}

// Resolución de nombres que rechaza las direcciones privadas justo al conectar.
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: 4 }];
    const publicOnes = list.filter((a) => !isPrivateAddress(a.address));
    if (!publicOnes.length) return callback(new Error("Dirección no permitida."));
    if (options?.all) return callback(null, publicOnes);
    callback(null, publicOnes[0].address, publicOnes[0].family);
  });
}

function download(urlString, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      return reject(new Error("Enlace no válido."));
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return reject(new Error("Solo se permiten enlaces http o https."));
    if (url.username || url.password) return reject(new Error("Enlace no permitido."));
    // Una IP escrita directamente también se valida (no pasa por la resolución de nombres).
    if (net.isIP(url.hostname.replace(/^\[|\]$/g, "")) && isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ""))) return reject(new Error("Dirección no permitida."));

    const lib = url.protocol === "https:" ? https : http;
    const req = lib.get(
      url,
      { lookup: safeLookup, timeout: TIMEOUT_MS, headers: { "User-Agent": "Mozilla/5.0 (compatible; BaznovaImageImport/1.0)", Accept: "image/*" } },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error("Demasiadas redirecciones."));
          return resolve(download(new URL(res.headers.location, url).toString(), redirectsLeft - 1));
        }
        if (status !== 200) {
          res.resume();
          return reject(new Error(`El sitio respondió ${status}.`));
        }
        const declared = Number(res.headers["content-length"]);
        if (declared > MAX_BYTES) {
          res.resume();
          return reject(new Error("La imagen es demasiado pesada."));
        }
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy(new Error("La imagen es demasiado pesada."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("El sitio tardó demasiado en responder.")));
    req.on("error", reject);
  });
}

// Descarga y guarda la imagen en `dir`. Devuelve el nombre del archivo grande (`<uuid>.webp`); la miniatura queda como
// `<uuid>-thumb.webp`, igual que las fotos subidas. Lanza un error con un mensaje claro si no se pudo.
export async function importRemoteImage(url, dir, { maxWidth = 1400, thumbWidth = 500, quality = 80 } = {}) {
  const buffer = await download(url);
  let big;
  let thumb;
  try {
    big = await sharp(buffer).rotate().resize({ width: maxWidth, withoutEnlargement: true }).webp({ quality }).toBuffer();
    thumb = await sharp(buffer).rotate().resize({ width: thumbWidth, withoutEnlargement: true }).webp({ quality }).toBuffer();
  } catch {
    throw new Error("El enlace no es una imagen válida.");
  }
  await mkdir(dir, { recursive: true });
  const base = crypto.randomUUID();
  await writeFile(join(dir, `${base}.webp`), big);
  await writeFile(join(dir, `${base}-thumb.webp`), thumb);
  return `${base}.webp`;
}

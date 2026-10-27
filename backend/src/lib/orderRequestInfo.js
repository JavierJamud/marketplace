import { z } from "zod";
import { describeUserAgent } from "./userAgent.js";

// Datos técnicos de cómo llegó un pedido (ver el modelo OrderRequestInfo). Solo para el panel de administración.

// Lo que el navegador informa de sí mismo al hacer el pedido (Checkout.jsx). Todo opcional y recortado: es una pista.
export const clientInfoSchema = z
  .object({
    timezone: z.string().trim().max(60).optional(),
    screen: z.string().trim().regex(/^\d{2,5}x\d{2,5}(@[\d.]{1,4}x)?$/).optional(),
    language: z.string().trim().max(35).optional(),
    standalone: z.boolean().optional(),
  })
  .optional();

const header = (req, name, max = 300) => {
  const v = req.get?.(name);
  return v ? String(v).slice(0, max) : null;
};
// Las Client Hints vienen entre comillas ("Android"); se guardan sin ellas.
const hint = (req, name) => header(req, name, 80)?.replace(/^"|"$/g, "") || null;

// IPv4 que llega como IPv6 mapeada (::ffff:1.2.3.4) se guarda como IPv4. req.ip ya respeta "trust proxy" (app.js).
export function requestIp(req) {
  const ip = req.ip ? String(req.ip) : null;
  return ip?.startsWith("::ffff:") ? ip.slice(7) : ip;
}

// Fila para crear junto con el pedido. `source`: WEB o PARTNER_API.
export function captureOrderRequest(req, clientInfo, source = "WEB") {
  if (!req) return null;
  const mobile = header(req, "sec-ch-ua-mobile", 4);
  return {
    source,
    ip: requestIp(req),
    userAgent: header(req, "user-agent"),
    acceptLanguage: header(req, "accept-language", 120),
    referer: header(req, "referer"),
    origin: header(req, "origin", 120),
    platformHint: hint(req, "sec-ch-ua-platform"),
    mobileHint: mobile === "?1" ? true : mobile === "?0" ? false : null,
    modelHint: hint(req, "sec-ch-ua-model"),
    timezone: clientInfo?.timezone ?? null,
    screen: clientInfo?.screen ?? null,
    language: clientInfo?.language ?? null,
    standalone: clientInfo?.standalone ?? null,
  };
}

// Versión legible para el admin: además de los datos crudos, navegador, sistema y tipo de dispositivo.
export function describeOrderRequest(info) {
  if (!info) return null;
  const ua = info.userAgent ? describeUserAgent(info.userAgent) : null;
  // El modelo exacto solo lo da el navegador (Client Hints) o algunos Android en el User-Agent ("; SM-A515F Build/").
  const uaModel = info.userAgent?.match(/Android [\d.]+; (?:[a-z]{2}-[a-z]{2}; )?([^;)]+?)(?: Build\/|\))/i)?.[1];
  const model = info.modelHint || (uaModel && uaModel !== "K" ? uaModel : null) || (/iPhone/.test(info.userAgent ?? "") ? "iPhone" : /iPad/.test(info.userAgent ?? "") ? "iPad" : null);
  const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\//.test(info.userAgent ?? "") ? (/Instagram/.test(info.userAgent) ? "Instagram" : /WhatsApp/.test(info.userAgent) ? "WhatsApp" : "Facebook") : null;
  return {
    source: info.source,
    ip: info.ip,
    // Dentro de Instagram o Facebook el User-Agent no nombra un navegador conocido: se dice cuál app lo abrió.
    browser: ua?.browser === "Otro navegador" && inApp ? `Navegador de ${inApp}` : ua?.browser ?? null,
    browserVersion: info.userAgent?.match(/(?:Edg|EdgA|SamsungBrowser|OPR|Firefox|FxiOS|CriOS|Chrome|Version)\/([\d.]+)/)?.[1]?.split(".")[0] ?? null,
    os: info.platformHint || ua?.os || null,
    // Windows 11 se presenta como "Windows NT 10.0", igual que Windows 10: no se puede saber cuál de los dos es.
    osVersion: /Windows NT 10\.0/.test(info.userAgent ?? "")
      ? "10 u 11"
      : info.userAgent?.match(/Android ([\d.]+)|(?:iPhone|CPU) OS ([\d_]+)|Windows NT ([\d.]+)|Mac OS X ([\d_.]+)/)?.slice(1).find(Boolean)?.replace(/_/g, ".") ?? null,
    device: info.mobileHint === true && ua?.device === "Computadora" ? "Celular" : ua?.device ?? null,
    model,
    inApp,
    standalone: info.standalone,
    timezone: info.timezone,
    screen: info.screen,
    language: info.language || info.acceptLanguage?.split(",")[0] || null,
    acceptLanguage: info.acceptLanguage,
    referer: info.referer,
    origin: info.origin,
    userAgent: info.userAgent,
    createdAt: info.createdAt,
  };
}

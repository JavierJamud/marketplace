import makeWASocket, {
  Browsers, DisconnectReason, fetchLatestWaWebVersion, isJidBroadcast, isJidGroup, isJidNewsletter, isJidStatusBroadcast,
  isLidUser, isPnUser, jidDecode,
} from "baileys";
import { dbAuthState } from "../authStore.js";

// Conexión real con WhatsApp como "dispositivo vinculado" (lo mismo que WhatsApp Web), sin navegador.
// Solo envía texto a personas y lee respuestas de texto: nada de grupos, estados ni historial.

// Baileys escribe mucho en su registro; aquí no se guarda nada de eso.
const silent = { level: "silent", child: () => silent, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };

function ignoredJid(jid) {
  return isJidGroup(jid) || isJidBroadcast(jid) || isJidStatusBroadcast(jid) || isJidNewsletter(jid);
}

function textOf(message) {
  return message?.conversation ?? message?.extendedTextMessage?.text ?? "";
}

export function createBaileysDriver({ onQr, onOpen, onClose, onText }) {
  let sock = null;
  // Cada conexión tiene su número: los eventos de una conexión ya cerrada se ignoran.
  let generation = 0;

  // WhatsApp identifica a algunos contactos con un id interno (LID) en vez del teléfono.
  async function phoneOfSender(key) {
    const candidates = [key.remoteJid, key.remoteJidAlt, key.participant, key.participantAlt].filter(Boolean);
    const direct = candidates.find((jid) => isPnUser(jid));
    if (direct) return `+${jidDecode(direct)?.user}`;
    const lid = candidates.find((jid) => isLidUser(jid));
    if (!lid) return null;
    const pn = await sock?.signalRepository?.lidMapping?.getPNForLID(lid).catch(() => null);
    return pn ? `+${jidDecode(pn)?.user}` : null;
  }

  async function start() {
    const mine = ++generation;
    const { state, saveCreds } = await dbAuthState(silent);
    // La versión de WhatsApp Web cambia seguido; si no se puede consultar, Baileys usa la que trae.
    const latest = await fetchLatestWaWebVersion().catch(() => null);
    sock = makeWASocket({
      auth: state,
      ...(latest?.version ? { version: latest.version } : {}),
      logger: silent,
      browser: Browsers.ubuntu("Chrome"),
      // Si la sesión se marca "en línea", el teléfono de la empresa deja de sonar con los mensajes que entran.
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      generateHighQualityLinkPreview: false,
      shouldIgnoreJid: ignoredJid,
      getMessage: async () => undefined,
    });
    const current = sock;

    current.ev.on("creds.update", saveCreds);

    current.ev.on("connection.update", (update) => {
      if (mine !== generation) return;
      if (update.qr) onQr(update.qr);
      if (update.connection === "open") {
        onOpen({ phone: `+${jidDecode(current.user?.id)?.user ?? ""}`, pushName: current.user?.name ?? null });
      }
      if (update.connection === "close") {
        const code = update.lastDisconnect?.error?.output?.statusCode ?? null;
        onClose({ code, loggedOut: code === DisconnectReason.loggedOut });
      }
    });

    current.ev.on("messages.upsert", async ({ type, messages }) => {
      if (mine !== generation || type !== "notify") return;
      for (const item of messages) {
        if (item.key?.fromMe || ignoredJid(item.key?.remoteJid)) continue;
        const text = textOf(item.message).trim();
        if (!text) continue;
        const phone = await phoneOfSender(item.key).catch(() => null);
        if (phone) onText({ phone, text });
      }
    });
  }

  // Cierra la conexión sin desvincular: la sesión guardada sigue sirviendo.
  async function stop() {
    generation += 1;
    const current = sock;
    sock = null;
    if (current) await Promise.resolve(current.end(undefined)).catch(() => {});
  }

  // Desvincula: el dispositivo desaparece de "Dispositivos vinculados" en el teléfono.
  async function logout() {
    generation += 1;
    const current = sock;
    sock = null;
    if (current) await current.logout().catch(() => {});
  }

  // El identificador de WhatsApp de un número, o null si ese número no tiene WhatsApp.
  async function resolveJid(phone) {
    const found = await sock.onWhatsApp(phone);
    const hit = found?.find((entry) => entry.exists);
    return hit?.jid ?? null;
  }

  // Antes de cada mensaje se muestra "escribiendo..." un momento, según el largo del texto, como lo haría una persona.
  // Un número que manda textos al instante y sin pausa es lo que WhatsApp toma por un robot de spam.
  async function sendText(jid, text) {
    try {
      await sock.sendPresenceUpdate("composing", jid);
      await new Promise((resolve) => setTimeout(resolve, Math.min(4000, 1000 + String(text).length * 8)));
      await sock.sendPresenceUpdate("paused", jid);
    } catch {
      /* el "escribiendo" es un detalle: si falla, el mensaje sale igual */
    }
    const sent = await sock.sendMessage(jid, { text });
    return sent?.key?.id ?? null;
  }

  return { start, stop, logout, resolveJid, sendText };
}

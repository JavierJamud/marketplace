import fs from "node:fs";
import { prisma } from "../../lib/prisma.js";
import { digitsOf } from "../phone.js";

// WhatsApp de mentira para probar en local sin vincular un teléfono (WHATSAPP_DRIVER=mock, nunca en producción).
// - Muestra un QR falso y se "conecta" solo a los WHATSAPP_MOCK_SCAN_MS (6 s si no se indica).
// - Los números que terminan en 0000 no tienen WhatsApp. Los que terminan en 9999 fallan al enviar.
// - Cada mensaje "enviado" se imprime completo en la consola del proceso.
// - WHATSAPP_MOCK_INBOX: archivo de texto con líneas "+5355512345|BAJA" que simulan respuestas que llegan.

const LINKED_KEY = "mock-linked";
const MOCK_PHONE = "+5350000001";

export function createMockDriver({ onQr, onOpen, onText }) {
  const scanMs = Number(process.env.WHATSAPP_MOCK_SCAN_MS) || 6000;
  const inbox = process.env.WHATSAPP_MOCK_INBOX || "";
  let timers = [];
  let readLines = 0;
  let sequence = 0;

  function open() {
    onOpen({ phone: MOCK_PHONE, pushName: "Baznova (prueba)" });
    if (!inbox) return;
    timers.push(setInterval(() => {
      let lines = [];
      try {
        lines = fs.readFileSync(inbox, "utf8").split(/\r?\n/).filter(Boolean);
      } catch {
        return;
      }
      for (const line of lines.slice(readLines)) {
        const [phone, ...rest] = line.split("|");
        onText({ phone: `+${digitsOf(phone)}`, text: rest.join("|") });
      }
      readLines = lines.length;
    }, 1000));
  }

  async function start() {
    const linked = await prisma.whatsappAuthKey.findUnique({ where: { id: LINKED_KEY } });
    if (linked) {
      timers.push(setTimeout(open, 300));
      return;
    }
    onQr(`MOCK-QR-${Date.now()}`);
    timers.push(setTimeout(async () => {
      await prisma.whatsappAuthKey.upsert({ where: { id: LINKED_KEY }, create: { id: LINKED_KEY, value: "1" }, update: {} });
      open();
    }, scanMs));
  }

  async function stop() {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  }

  async function resolveJid(phone) {
    const digits = digitsOf(phone);
    return digits.endsWith("0000") ? null : `${digits}@s.whatsapp.net`;
  }

  async function sendText(jid, text) {
    if (jid.split("@")[0].endsWith("9999")) throw new Error("MOCK_SEND_FAILED");
    sequence += 1;
    console.log(`[whatsapp:mock] >>> ${jid}\n${text}\n[whatsapp:mock] <<<`);
    return `MOCK-${Date.now()}-${sequence}`;
  }

  return { start, stop, logout: stop, resolveJid, sendText };
}

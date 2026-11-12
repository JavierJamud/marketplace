import { BufferJSON, initAuthCreds, makeCacheableSignalKeyStore, proto } from "baileys";
import { prisma } from "../lib/prisma.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";

// Credenciales de la sesión de WhatsApp guardadas en la base de datos, cifradas. Así la sesión sobrevive a un
// reinicio o a un despliegue nuevo sin escanear el QR otra vez, y no queda ningún archivo suelto en el servidor.

const CHUNK = 50;

function pack(value) {
  const { ciphertext, iv, authTag } = encryptSecret(JSON.stringify(value, BufferJSON.replacer));
  return `${iv}.${authTag}.${ciphertext}`;
}

function unpack(text) {
  const [iv, authTag, ciphertext] = text.split(".");
  return JSON.parse(decryptSecret({ ciphertext, iv, authTag }), BufferJSON.reviver);
}

export async function dbAuthState(logger) {
  // WhatsApp cambia llaves muy seguido: las escrituras van en fila para que una vieja no pise a una nueva.
  let chain = Promise.resolve();
  const inOrder = (fn) => {
    const next = chain.then(fn, fn);
    chain = next.catch((err) => console.error("[whatsapp] no se pudo guardar la sesión:", err.message));
    return next;
  };

  const saved = await prisma.whatsappAuthKey.findUnique({ where: { id: "creds" } });
  const creds = saved ? unpack(saved.value) : initAuthCreds();

  const store = {
    async get(type, ids) {
      const rows = await prisma.whatsappAuthKey.findMany({ where: { id: { in: ids.map((id) => `${type}-${id}`) } } });
      const byId = new Map(rows.map((row) => [row.id, row.value]));
      const out = {};
      for (const id of ids) {
        const raw = byId.get(`${type}-${id}`);
        if (!raw) continue;
        const value = unpack(raw);
        out[id] = type === "app-state-sync-key" && value ? proto.Message.AppStateSyncKeyData.fromObject(value) : value;
      }
      return out;
    },
    set(data) {
      return inOrder(async () => {
        const writes = [];
        const removals = [];
        for (const [type, entries] of Object.entries(data)) {
          for (const [id, value] of Object.entries(entries ?? {})) {
            if (value) writes.push({ id: `${type}-${id}`, value: pack(value) });
            else removals.push(`${type}-${id}`);
          }
        }
        for (let i = 0; i < writes.length; i += CHUNK) {
          await prisma.$transaction(
            writes.slice(i, i + CHUNK).map((row) => prisma.whatsappAuthKey.upsert({ where: { id: row.id }, create: row, update: { value: row.value } })),
          );
        }
        if (removals.length) await prisma.whatsappAuthKey.deleteMany({ where: { id: { in: removals } } });
      });
    },
  };

  return {
    state: { creds, keys: makeCacheableSignalKeyStore(store, logger) },
    saveCreds: () => inOrder(() => {
      const value = pack(creds);
      return prisma.whatsappAuthKey.upsert({ where: { id: "creds" }, create: { id: "creds", value }, update: { value } });
    }),
  };
}

// Borra la sesión guardada: la próxima conexión pide QR.
export async function clearAuthState() {
  await prisma.whatsappAuthKey.deleteMany({});
}

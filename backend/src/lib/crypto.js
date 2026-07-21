import crypto from "node:crypto";
import { env } from "../config/env.js";

// Credenciales de integraciones de terceros SIEMPRE cifradas en la base de
// datos (nunca en .env) — AES-256-GCM con la clave maestra del servidor.
const ALGORITHM = "aes-256-gcm";
const key = Buffer.from(env.integrationsEncryptionKey, "hex");

export function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptSecret({ ciphertext, iv, authTag }) {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

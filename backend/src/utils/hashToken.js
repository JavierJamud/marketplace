import { createHash } from "node:crypto";

// Bloque 60: hash determinístico (no bcrypt) para tokens opacos de alta
// entropía (refresh tokens, tokens de "dispositivo de confianza") — a
// diferencia de un código de 6 dígitos (bcrypt, lento a propósito porque hay
// poquísimas combinaciones posibles), un token de 32+ bytes aleatorios ya es
// imposible de fuerza-brutear, así que acá conviene un hash rápido e
// indexable (permite buscar por igualdad exacta en la DB) en vez de uno lento.
export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

import { lazy } from "react";

// Igual que lazy(), pero si el archivo de la pantalla no llega (señal débil, o justo cuando se publica una versión nueva) lo
// vuelve a pedir dos veces antes de rendirse. Solo si los tres intentos fallan llega el error a ErrorBoundary, que recarga.
const WAITS_MS = [600, 1500];

export function lazyRetry(factory) {
  return lazy(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await factory();
      } catch (err) {
        if (attempt >= WAITS_MS.length) throw err;
        await new Promise((r) => setTimeout(r, WAITS_MS[attempt]));
      }
    }
  });
}

import { copyToClipboard } from "./clipboard.js";

// Compartir un enlace. En el celular abre el menú de compartir del teléfono (WhatsApp, Instagram, Telegram...), que es como
// la gente comparte allí. En la computadora copia el enlace: el menú del sistema casi nunca tiene ahí WhatsApp.
// Devuelve "shared", "copied" o "cancelled" (la persona cerró el menú sin elegir); si no se pudo copiar, lanza un error.
export async function shareLink({ url, title, text }) {
  const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  if (touch && navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (err) {
      if (err?.name === "AbortError") return "cancelled";
      // Navegador que lo anuncia pero lo bloquea: se copia el enlace.
    }
  }
  await copyToClipboard(url);
  return "copied";
}

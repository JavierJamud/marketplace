// Bug real reportado en vivo: navigator.clipboard.writeText() por sí solo
// falla en varios navegadores/contextos reales (Firefox con ciertas
// políticas de privacidad, ventanas sin foco, extensiones que bloquean el
// Clipboard API async) — el usuario lo vio como "No se pudo copiar el
// enlace." al hacer clic en Compartir. copyToClipboard() intenta la API
// moderna primero y, si falla o no existe, cae a la técnica clásica
// (textarea oculto + document.execCommand("copy")), que funciona en casi
// cualquier navegador porque no depende del Clipboard API async.
export async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // sigue al fallback en vez de fallar directo
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);

  if (!ok) throw new Error("No se pudo copiar al portapapeles.");
  return true;
}

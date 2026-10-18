// Resumen legible de un User-Agent para el admin ("Chrome en Android, celular"). Aproximado a propósito: alcanza para
// reconocer un dispositivo, no para estadísticas finas.
export function describeUserAgent(ua) {
  const s = String(ua ?? "");
  if (!s) return { browser: "Navegador sin datos", os: "sistema sin datos", device: "inicio de sesión anterior a este registro" };
  const browser = /EdgA?\//.test(s)
    ? "Edge"
    : /SamsungBrowser\//.test(s)
      ? "Samsung Internet"
      : /OPR\/|Opera/.test(s)
        ? "Opera"
        : /Firefox\/|FxiOS/.test(s)
          ? "Firefox"
          : /CriOS|Chrome\//.test(s)
            ? "Chrome"
            : /Safari\//.test(s)
              ? "Safari"
              : "Otro navegador";
  const os = /Android/.test(s) ? "Android" : /iPhone|iPad|iPod/.test(s) ? "iOS" : /Windows/.test(s) ? "Windows" : /Mac OS X|Macintosh/.test(s) ? "macOS" : /CrOS/.test(s) ? "ChromeOS" : /Linux/.test(s) ? "Linux" : "Otro sistema";
  const device = /iPad|Tablet/.test(s) || (/Android/.test(s) && !/Mobile/.test(s)) ? "Tablet" : /Mobi|iPhone|Android/.test(s) ? "Celular" : "Computadora";
  return { browser, os, device };
}

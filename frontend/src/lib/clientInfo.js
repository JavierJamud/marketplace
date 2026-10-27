// Lo que el navegador dice de sí mismo al enviar un pedido (zona horaria, pantalla, idioma, app instalada). Solo lo ve el
// admin, para dar soporte; el servidor lo valida y lo recorta (backend/src/lib/orderRequestInfo.js).
export function clientInfo() {
  try {
    const dpr = window.devicePixelRatio && window.devicePixelRatio !== 1 ? `@${Math.round(window.devicePixelRatio * 100) / 100}x` : "";
    return {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
      screen: window.screen?.width ? `${window.screen.width}x${window.screen.height}${dpr}` : undefined,
      language: navigator.language || undefined,
      standalone: window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true,
    };
  } catch {
    return undefined;
  }
}

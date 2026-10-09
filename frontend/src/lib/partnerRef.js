// Enlace de socio de la API: baznova.com/vender?socio=CODIGO. El código se guarda unos días en
// este navegador para que sobreviva al registro en varios pasos, y se envía al crear la tienda.
const KEY = "baznova_partner_ref";
const DAYS = 30;

export function capturePartnerRef(search = window.location.search) {
  try {
    const code = new URLSearchParams(search).get("socio");
    if (!code) return;
    const clean = code.trim().toUpperCase().slice(0, 24);
    if (!/^[A-Z0-9][A-Z0-9-]{2,23}$/.test(clean)) return;
    localStorage.setItem(KEY, JSON.stringify({ code: clean, at: Date.now() }));
  } catch {
    // almacenamiento no disponible: se ignora
  }
}

export function getPartnerCode() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw?.code || Date.now() - raw.at > DAYS * 86_400_000) return undefined;
    return raw.code;
  } catch {
    return undefined;
  }
}

export function clearPartnerRef() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignorar
  }
}

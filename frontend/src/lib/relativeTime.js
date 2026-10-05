// Bloque 242: "Hace 3 d", "Ayer", "Nunca" para columnas de fecha donde lo que
// importa es cuánto hace, no el día exacto (último acceso, último pedido).
// La fecha completa queda disponible con exactDate() para el atributo title.
const DAY_MS = 24 * 60 * 60 * 1000;

export function timeAgo(iso, never = "Nunca") {
  if (!iso) return never;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
  if (days < 1) return "Hoy";
  if (days === 1) return "Ayer";
  if (days < 30) return `Hace ${days} d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Hace ${months} ${months === 1 ? "mes" : "meses"}`;
  const years = Math.floor(days / 365);
  return `Hace ${years} ${years === 1 ? "año" : "años"}`;
}

export function exactDate(iso) {
  return iso ? new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" }) : "";
}

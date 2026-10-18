// Comparación de texto para buscadores del panel: sin tildes ni mayúsculas, y con tolerancia a errores de tipeo
// (mismo criterio que backend/src/services/vendorSearch.service.js).
export const normalizeText = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Distancia de edición con letras intercambiadas: "pnael" está a 1 de "panel".
export function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// ¿El producto coincide con lo buscado? Primero literal (nombre, descripción, etiquetas, código de barras); si no, cada palabra
// buscada de 4+ letras tiene que parecerse a una palabra del nombre o de las etiquetas.
export function productMatches(p, query) {
  const q = normalizeText(query);
  if (!q) return true;
  const fields = [p.name, p.description, ...(p.tags ?? []), p.barcode].map(normalizeText);
  if (fields.some((f) => f.includes(q))) return true;
  const words = q.split(" ").filter((w) => w.length >= 4);
  if (!words.length) return false;
  const vocab = new Set(normalizeText([p.name, ...(p.tags ?? [])].join(" ")).split(" ").filter((w) => w.length >= 3));
  return words.every((w) => {
    const max = w.length >= 6 ? 2 : 1;
    for (const v of vocab) if (Math.abs(v.length - w.length) <= max && editDistance(w, v) <= max) return true;
    return false;
  });
}

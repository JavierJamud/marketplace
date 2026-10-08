// Bloque 289 (pedido explícito — "en la barra de búsqueda del admin y del vendedor, si escribo el nombre
// de una sección o subsección debe salir en los resultados y llevarme a esa ventana"): búsqueda de
// secciones del panel, sin ir al servidor. Ignora mayúsculas y tildes ("configuracion" encuentra
// "Configuración") y acepta varias palabras en cualquier orden ("pago metodos"). Cada sección puede
// traer `keywords` con lo que contiene (sus tarjetas o ajustes), para encontrarla por eso también.
export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// Devuelve hasta `limit` secciones: primero las que EMPIEZAN con lo escrito, luego las que lo
// contienen en el nombre, y al final las que lo tienen solo en sus palabras clave.
export function searchSections(sections, query, limit = 7) {
  const tokens = normalizeText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const scored = [];
  for (const section of sections) {
    const label = normalizeText(section.label);
    const hay = `${label} ${normalizeText(section.keywords)}`;
    if (!tokens.every((t) => hay.includes(t))) continue;
    const score = label.startsWith(tokens[0]) ? 0 : tokens.every((t) => label.includes(t)) ? 1 : 2;
    scored.push({ section, score });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((x) => x.section);
}

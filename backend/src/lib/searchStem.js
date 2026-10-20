// Términos de búsqueda de los chats: el singular de cada palabra y las muletillas de una frase conversacional que nunca son el
// nombre de un producto. La búsqueda compara por "contiene", así que buscar el singular encuentra las dos formas: "paneles"
// no contenía "Panel solar" y el asistente decía que no había paneles aunque sí estaban publicados.

// Palabras de relleno de un pedido escrito como frase ("no me decido por qué tienda", "que me salieran un poco baratos").
export const CONVERSATIONAL_FILLERS = new Set([
  "decido", "decidir", "decidirme", "decidi", "decidí", "aun", "aún", "todavia", "todavía", "poco", "mucho", "muy", "mas", "más", "menos",
  "barato", "baratos", "barata", "baratas", "economico", "económico", "economicos", "económicos", "economica", "económica",
  "salga", "salgan", "saliera", "salieran", "hacer", "hacerlo", "hacerlos", "hacerla", "hacerlas", "tienda", "tiendas",
  "mejor", "bueno", "buena", "buenos", "buenas", "precio", "precios", "cerca", "lugar", "ahora", "hoy", "pero", "entonces",
  "favorito", "alguien", "saber", "quiere", "queria", "quería", "gustaria", "gustaría", "podrian", "podrían", "ustedes", "usted",
  // Preguntas sobre un producto ya mostrado ("¿quieres ver precios por cantidad?"): no son el nombre de lo que busca.
  "quieres", "cantidad", "cantidades", "mayor", "mayoreo", "volumen",
]);

// Quien busca barato quiere ver primero los precios más bajos.
export const WANTS_CHEAP_RE = /\bbarat[oa]s?\b|econ[oó]mic[oa]s?|\bmenor precio\b|\bmas barat|\bmás barat/i;

export function toSearchStem(word) {
  const w = word.toLowerCase();
  if (w.length <= 4) return w;
  if (w.endsWith("ces")) return `${w.slice(0, -3)}z`; // luces -> luz
  if (/[lrndjy]es$/.test(w)) return w.slice(0, -2); // paneles -> panel, solares -> solar
  if (/[aeoáéó]s$/.test(w)) return w.slice(0, -1); // zapatos -> zapato, baterías -> batería
  return w;
}

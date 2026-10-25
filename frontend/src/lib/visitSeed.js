// Semilla de la visita para la rotación de productos (ver rotate en backend/src/lib/productRanking.js). Se crea una vez por carga
// de la página: al volver a entrar o recargar, el orden de la portada, el catálogo y las tiendas cambia; mientras la persona
// navega dentro del sitio se mantiene, para que las tarjetas no salten de lugar al ir y volver.
export const VISIT_SEED = Math.random().toString(36).slice(2, 10) || "v";

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { api } from "../lib/api.js";
import { usePrefersReducedMotion } from "../lib/useMediaQuery.js";

// "Lo más buscado": búsquedas reales de los clientes (ya filtradas y redactadas por la IA en el servidor). Cada frase lleva al
// catálogo con esa búsqueda. Con pocas frases se muestran fijas; con varias pasan en carriles que van en sentidos opuestos y
// a distinta velocidad. Si la persona pidió menos movimiento, quedan quietas y en varias líneas. Sin datos, no se muestra nada.
const CSS = `
@keyframes trend-left { from { transform: translateX(0) } to { transform: translateX(-50%) } }
@keyframes trend-right { from { transform: translateX(-50%) } to { transform: translateX(0) } }
.trend-lane:hover .trend-track, .trend-lane:focus-within .trend-track { animation-play-state: paused }
`;

function Chip({ item, tone }) {
  return (
    <Link
      to={`/catalogo?q=${encodeURIComponent(item.term)}`}
      className={`group inline-flex min-h-11 flex-shrink-0 items-center gap-2 rounded-full border px-4 text-[14px] font-semibold transition-colors ${
        tone ? "border-secondary-container/60 bg-secondary-container/15 text-on-surface hover:bg-secondary-container/30" : "border-outline-variant bg-surface-container-lowest text-on-surface hover:border-tertiary-accent hover:text-tertiary-accent"
      }`}
    >
      <Search className="h-3.5 w-3.5 flex-shrink-0 text-outline group-hover:text-current" aria-hidden="true" />
      <span className="whitespace-nowrap">{item.phrase}</span>
    </Link>
  );
}

function Lane({ items, reverse, seconds, tone }) {
  // El contenido va dos veces seguidas para que el recorrido de -50% cierre el ciclo sin saltos.
  const doubled = [...items, ...items];
  return (
    <div className="trend-lane overflow-hidden py-1.5 [mask-image:linear-gradient(to_right,transparent,#000_6%,#000_94%,transparent)]">
      <div className="trend-track flex w-max gap-3" style={{ animation: `${reverse ? "trend-right" : "trend-left"} ${seconds}s linear infinite` }}>
        {doubled.map((item, i) => (
          <span key={i} aria-hidden={i >= items.length ? "true" : undefined} className="flex">
            <Chip item={item} tone={tone} />
          </span>
        ))}
      </div>
    </div>
  );
}

export function TrendingSearches() {
  const reduced = usePrefersReducedMotion();
  const { data } = useQuery({
    queryKey: ["trending-searches"],
    queryFn: async () => (await api.get("/search/trending")).data.items,
    staleTime: 10 * 60 * 1000,
  });
  const items = useMemo(() => data ?? [], [data]);

  const lanes = useMemo(() => {
    if (items.length < 6) return null;
    const a = [];
    const b = [];
    items.forEach((it, i) => (i % 2 ? b : a).push(it));
    // Cada carril necesita suficientes frases para llenar el ancho de una pantalla grande.
    const fill = (arr) => (arr.length >= 4 ? arr : [...arr, ...arr, ...arr].slice(0, Math.max(4, arr.length * 2)));
    return [fill(a), fill(b)];
  }, [items]);

  if (!items.length) return null;
  const still = reduced || !lanes;

  return (
    <section className="container-app pb-12 md:pb-16" aria-labelledby="mas-buscado">
      <style>{CSS}</style>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="mas-buscado" className="font-display text-title-lg text-on-surface md:text-headline-md">
            Lo más buscado ahora
          </h2>
          <p className="mt-1 text-body-md text-on-surface-variant">Lo que otros clientes están buscando. Toca una y mira qué hay.</p>
        </div>
        <Link to="/catalogo" className="inline-flex min-h-11 items-center text-label-md font-semibold text-tertiary-accent hover:underline">
          Ver todo el catálogo
        </Link>
      </div>
      {still ? (
        <ul className="flex flex-wrap gap-2.5">
          {items.map((it) => (
            <li key={it.term}>
              <Chip item={it} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="-mx-4 sm:-mx-6 lg:mx-0">
          <Lane items={lanes[0]} seconds={Math.max(28, lanes[0].length * 7)} />
          <Lane items={lanes[1]} reverse seconds={Math.max(34, lanes[1].length * 8)} tone />
        </div>
      )}
    </section>
  );
}

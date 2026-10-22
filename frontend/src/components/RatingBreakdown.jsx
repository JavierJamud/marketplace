import { Star } from "lucide-react";

// Desglose de reseñas de 5 a 1 estrellas con barras (admin y panel de la tienda). `summary`: { average, count, breakdown }.
// Así se ve que una reseña mala entre muchas buenas mueve poco el promedio.
export function RatingBreakdown({ summary }) {
  if (!summary?.count) return <p className="text-[12.5px] text-on-surface-variant">Sin reseñas todavía.</p>;
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[22px] font-extrabold text-on-surface">{Number(summary.average).toFixed(1)}</span>
        <Star className="h-4 w-4 fill-secondary-container text-secondary-container" aria-hidden="true" />
        <span className="text-[12.5px] text-on-surface-variant">
          {summary.count} {summary.count === 1 ? "reseña" : "reseñas"}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {[5, 4, 3, 2, 1].map((stars) => {
          const n = summary.breakdown?.[stars] ?? 0;
          const pct = Math.round((n / summary.count) * 100);
          return (
            <li key={stars} className="flex items-center gap-2 text-[12px] text-on-surface-variant">
              <span className="w-3 text-right font-semibold">{stars}</span>
              <Star className="h-3 w-3 text-outline" aria-hidden="true" />
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container-high" role="presentation">
                <span className="block h-full rounded-full bg-secondary-container" style={{ width: `${pct}%` }} />
              </span>
              <span className="w-8 text-right tabular-nums">{n}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

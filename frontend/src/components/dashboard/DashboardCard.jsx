import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";

// Bloque 221 (pedido explícito, con imagen de referencia de un dashboard
// fintech — "rediseña los paneles de vendedores y de admin... fíjate en
// cada detalle", manteniendo la paleta propia del sitio): piezas
// compartidas por AdminDashboard.jsx y VendorDashboard.jsx — tarjeta con
// sombra suave y cabecera "ícono en círculo + título + subtítulo + botón
// de flecha", que es el patrón que se repite en cada tarjeta de la
// referencia.
export const CARD_SHADOW = "shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]";
export const CARD = `rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest ${CARD_SHADOW}`;

const TONES = {
  neutral: "bg-surface-container text-on-surface-variant",
  teal: "bg-tertiary-accent/12 text-tertiary-accent",
  green: "bg-verified/10 text-verified-dark",
  orange: "bg-secondary/10 text-secondary",
  blue: "bg-[#0e6ba8]/10 text-[#0e6ba8]",
  // Bloque 230 (Fase 3): único tono "crítico" real del set — hasta ahora
  // nada de este panel necesitaba distinguirse de "orange" (advertencia)
  // con un rojo de verdad.
  red: "bg-error/10 text-error",
};

export function IconCircle({ icon: Icon, tone = "neutral" }) {
  return (
    <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${TONES[tone] ?? TONES.neutral}`}>
      <Icon className="h-4 w-4" />
    </div>
  );
}

// Botón redondo de "abrir" (flecha en diagonal) que la referencia pone en
// la esquina de cada tarjeta — acá siempre lleva a la sección real a la
// que pertenece el dato (o a un ancla de la misma página), nunca es
// decorativo.
export function ArrowLink({ to, hash, label }) {
  const cls =
    "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-surface-container-high text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface";
  if (hash) {
    return (
      <a href={hash} className={cls} aria-label={label} title={label}>
        <ArrowUpRight className="h-4 w-4" />
      </a>
    );
  }
  return (
    <Link to={to} className={cls} aria-label={label} title={label}>
      <ArrowUpRight className="h-4 w-4" />
    </Link>
  );
}

export function CardHeader({ icon, tone, title, subtitle, to, hash, linkLabel, right }) {
  return (
    // Bloque 225 (bug real encontrado en vivo, en mobile — el selector de
    // día/semana/mes/año de la gráfica única se salía del ancho de la
    // tarjeta en vez de acomodarse): antes `right` nunca envolvía a una
    // segunda línea (`flex-shrink-0` sin `flex-wrap` en el padre) — se veía
    // bien con contenido corto (un badge, 2-3 pestañas), pero cualquier
    // `right` más ancho que el espacio libre se salía del contenedor en vez
    // de acomodarse debajo. `flex-wrap` acá beneficia a cada tarjeta que ya
    // usa CardHeader en todo el panel, no solo a esta gráfica.
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <IconCircle icon={icon} tone={tone} />}
        <div className="min-w-0">
          <div className="text-[14px] font-bold leading-tight text-on-surface">{title}</div>
          {subtitle && <p className="mt-0.5 text-[11.5px] leading-snug text-outline">{subtitle}</p>}
        </div>
      </div>
      <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
        {right}
        {(to || hash) && <ArrowLink to={to} hash={hash} label={linkLabel ?? `Abrir ${title}`} />}
      </div>
    </div>
  );
}

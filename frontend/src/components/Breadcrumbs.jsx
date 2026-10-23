import { Link } from "react-router-dom";

// Ruta de navegación "Inicio / Tiendas / La Esquina Caliente" encima del título de cada sección pública. Antes solo la tenían
// el catálogo y la ficha de producto: desde Tiendas, Ayuda o el carrito no había cómo volver al inicio sin el logo.
// `items`: los pasos después de "Inicio"; el último es la página actual (sin enlace). `tone="dark"` para fondos oscuros
// (el banner de la tienda). Cada enlace tiene un área de toque de 44px sin agrandar la línea (py-[14px] con -my-[14px]).
export function Breadcrumbs({ items = [], tone = "light", className = "" }) {
  const steps = [{ label: "Inicio", to: "/" }, ...items];
  const link = tone === "dark" ? "text-white/75 hover:text-white" : "text-outline hover:text-primary-container";
  const current = tone === "dark" ? "text-white" : "text-on-surface";
  const sep = tone === "dark" ? "text-white/50" : "text-outline";
  return (
    <nav aria-label="Ruta de navegación" className={`text-label-sm ${className}`}>
      <ol className="flex flex-wrap items-center gap-x-1.5">
        {steps.map((s, i) => {
          const last = i === steps.length - 1;
          return (
            <li key={`${s.label}-${i}`} className="flex min-w-0 items-center gap-x-1.5">
              {last || !s.to ? (
                <span aria-current={last ? "page" : undefined} className={`line-clamp-1 [overflow-wrap:anywhere] ${current}`}>
                  {s.label}
                </span>
              ) : (
                <Link
                  to={s.to}
                  className={`-my-[14px] inline-block py-[14px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent ${link}`}
                >
                  {s.label}
                </Link>
              )}
              {!last && (
                <span aria-hidden="true" className={sep}>
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

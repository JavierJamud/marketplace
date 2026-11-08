import clsx from "clsx";

// Botón de filtro con forma de píldora ("Todos (5)", "Pendientes", "Esta semana"). Uno solo para todo el sitio, así todos
// los filtros miden y se comportan igual. El texto nunca se parte en dos renglones: si no cabe, la píldora entera pasa a la
// línea de abajo (el contenedor debe llevar flex-wrap). Con la letra agrandada en el teléfono la píldora crece con el texto
// porque el alto es mínimo, no fijo.
export function Chip({ active = false, count, size = "md", className, children, ...props }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={clsx(
        "inline-flex flex-shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border font-semibold leading-tight transition-colors",
        size === "sm" ? "min-h-9 px-3 py-1.5 text-[12px]" : "min-h-10 px-3.5 py-2 text-[13px]",
        active
          ? "border-primary-container bg-primary-container text-white"
          : "border-surface-container-high bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
        className
      )}
      {...props}
    >
      {children}
      {count != null && <span className={clsx("tabular-nums", active ? "text-white/80" : "text-outline")}>({count})</span>}
    </button>
  );
}

// Fila de Chips: baja de renglón cuando no caben.
export function ChipRow({ className, children }) {
  return <div className={clsx("flex flex-wrap gap-2", className)}>{children}</div>;
}

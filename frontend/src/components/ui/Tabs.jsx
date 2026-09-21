import clsx from "clsx";

// Bloque 115 (pedido explícito — "unir varias secciones en una sola ventana
// con pestañas para organizar mejor el panel"): componente compartido nuevo,
// no existía ninguno en components/ui — antes cada página con varias
// secciones relacionadas las apilaba todas en una sola pantalla larga (ver
// VendorSettings.jsx antes de este bloque). Uso: `const [tab, setTab] =
// useState(TABS[0].id)` en la página, `<Tabs tabs={TABS} value={tab}
// onChange={setTab} />` arriba del contenido, y renderizar según `tab` —
// deliberadamente NO maneja el estado de qué tab está activo (la página
// dueña del formulario lo hace), así queda usable con cualquier fuente de
// verdad (useState local, un query param, etc.) sin acoplarse a ninguna.
export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={clsx("flex gap-1 overflow-x-auto border-b border-surface-container-high", className)}>
      {tabs.map((t) => {
        const active = t.id === value;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={clsx(
              "flex flex-shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-label-lg font-semibold transition-colors",
              active
                ? "border-tertiary-accent text-tertiary-accent"
                : "border-transparent text-on-surface-variant hover:text-on-surface"
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

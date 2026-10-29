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
//
// En el celular las pestañas son botones que bajan de renglón (flex-wrap): antes eran una fila que se deslizaba de lado, con
// la barra de desplazamiento a la vista y la mitad de las pestañas escondidas (pedido del dueño, visto en un Galaxy M14). Desde
// sm vuelven a ser la fila subrayada, sin barra de desplazamiento visible.
export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div
      className={clsx(
        "flex flex-wrap gap-1.5 sm:flex-nowrap sm:gap-1 sm:overflow-x-auto sm:border-b sm:border-surface-container-high [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {tabs.map((t) => {
        const active = t.id === value;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            aria-pressed={active}
            className={clsx(
              "flex min-h-10 flex-shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-semibold transition-colors",
              "sm:min-h-0 sm:rounded-none sm:border-0 sm:border-b-2 sm:px-4 sm:py-2.5 sm:text-label-lg",
              active
                ? "border-tertiary-accent bg-tertiary-accent/10 text-tertiary-accent sm:bg-transparent"
                : "border-surface-container-high bg-surface-container-lowest text-on-surface-variant hover:text-on-surface sm:border-transparent sm:bg-transparent"
            )}
          >
            {Icon && <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />}
            {t.label}
            {/* `count` (opcional): lo pendiente en esa pestaña; en rojo si hay algo por atender. */}
            {t.count > 0 && (
              <span className="rounded-full bg-error px-1.5 py-0.5 text-[11px] font-extrabold leading-none text-white" aria-label={`${t.count} por atender`}>
                {t.count > 99 ? "99+" : t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

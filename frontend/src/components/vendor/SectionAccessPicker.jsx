import { MANUALLY_ASSIGNABLE_SECTIONS } from "../../lib/vendorSections.js";

// Bloque 185 (pedido explícito — "al seleccionar las secciones de su panel
// a las que tendrá acceso, también debe seleccionar qué permisos tendrá el
// usuario en esa sección, si solo lectura o modificar, si leer o
// escribir"): cada sección elegida abre su propio selector de nivel al
// lado, en vez de un paso aparte.
// Bloque 187: se extrae de VendorUsers.jsx a un componente compartido —
// AdminVendorStaffModal.jsx (el admin editando un usuario ajeno) necesita
// EXACTAMENTE el mismo control, y antes no lo tenía (por eso el nivel
// view/manage que el admin intentaba guardar se perdía en silencio).
// Auditoría de roles 2026-10-28: la casilla era un carácter ☑/☐ dentro de un botón de unos 24 px y los botones de nivel
// medían 22 px con letra de 10,5 px. En el celular, que es donde el dueño crea usuarios, costaba acertar. Ahora la casilla
// es un checkbox real dentro de una etiqueta que ocupa la fila (44 px) y los niveles son botones de 44 px con letra de 12 px.
// Los niveles son botones con aria-pressed dentro de un grupo, no role="radio": el patrón de radio pide un solo tabulador y
// flechas para cambiar, y estos botones se tabulan uno por uno. Un lector de pantalla anunciaba "botón de opción" y el
// usuario de teclado esperaba flechas que no hacían nada.
const LEVELS = [
  { value: "view", label: "Solo lectura" },
  { value: "manage", label: "Leer y escribir" },
];

export function SectionAccessPicker({ sections, permissions, onToggleSection, onSetLevel }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-label-md font-semibold text-on-surface">¿A qué secciones tiene acceso?</legend>
      <div className="flex flex-col gap-1.5">
        {MANUALLY_ASSIGNABLE_SECTIONS.map((s) => {
          const active = sections.includes(s.key);
          const level = permissions[s.key] ?? "manage";
          return (
            <div
              key={s.key}
              className={`flex flex-col gap-1 rounded-md border px-3 py-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${
                active ? "border-tertiary-accent/40 bg-tertiary-accent/5" : "border-outline-variant"
              }`}
            >
              <label className={`flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-[13px] font-semibold ${active ? "text-tertiary-accent" : "text-on-surface-variant"}`}>
                <input type="checkbox" checked={active} onChange={() => onToggleSection(s.key)} className="h-5 w-5 flex-shrink-0 accent-tertiary-accent" />
                <span className="min-w-0 break-words">{s.label}</span>
              </label>
              {active && (
                <div role="group" aria-label={`Permiso en ${s.label}`} className="mb-1.5 flex flex-shrink-0 overflow-hidden rounded-full border border-outline-variant bg-surface-container-lowest sm:mb-0">
                  {LEVELS.map((l) => (
                    <button
                      key={l.value}
                      type="button"
                      aria-pressed={level === l.value}
                      onClick={() => onSetLevel(s.key, l.value)}
                      className={`min-h-11 flex-1 whitespace-nowrap px-3.5 text-xs font-bold transition sm:flex-none ${
                        level === l.value ? "bg-tertiary-accent text-white" : "text-on-surface-variant hover:bg-surface-container"
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-on-surface-variant">
        "Solo lectura" deja ver la sección pero no crear, editar, borrar ni cambiar nada dentro de ella.
      </p>
    </fieldset>
  );
}

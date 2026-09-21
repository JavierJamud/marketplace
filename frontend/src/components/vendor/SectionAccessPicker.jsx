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
export function SectionAccessPicker({ sections, permissions, onToggleSection, onSetLevel }) {
  return (
    <div>
      <p className="mb-1.5 text-label-md font-semibold text-on-surface">¿A qué secciones tiene acceso?</p>
      <div className="flex flex-col gap-1.5">
        {MANUALLY_ASSIGNABLE_SECTIONS.map((s) => {
          const active = sections.includes(s.key);
          const level = permissions[s.key] ?? "manage";
          return (
            <div
              key={s.key}
              className={`flex flex-col gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between ${
                active ? "border-tertiary-accent/40 bg-tertiary-accent/5" : "border-outline-variant"
              }`}
            >
              <button
                type="button"
                onClick={() => onToggleSection(s.key)}
                className={`text-left text-[12.5px] font-semibold ${active ? "text-tertiary-accent" : "text-on-surface-variant"}`}
              >
                {active ? "☑" : "☐"} {s.label}
              </button>
              {active && (
                <div className="flex flex-shrink-0 overflow-hidden rounded-full border border-outline-variant">
                  <button
                    type="button"
                    onClick={() => onSetLevel(s.key, "view")}
                    className={`px-2.5 py-1 text-[10.5px] font-bold transition ${
                      level === "view" ? "bg-secondary-container text-on-secondary-container" : "text-outline hover:bg-surface-container"
                    }`}
                  >
                    Solo lectura
                  </button>
                  <button
                    type="button"
                    onClick={() => onSetLevel(s.key, "manage")}
                    className={`px-2.5 py-1 text-[10.5px] font-bold transition ${
                      level === "manage" ? "bg-secondary-container text-on-secondary-container" : "text-outline hover:bg-surface-container"
                    }`}
                  >
                    Leer y escribir
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-outline">
        "Solo lectura" deja ver la sección pero no crear, editar, borrar ni cambiar nada dentro de ella.
      </p>
    </div>
  );
}

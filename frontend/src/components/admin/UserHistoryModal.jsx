import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, History, UserX } from "lucide-react";
import { api } from "../../lib/api.js";
import { Spinner } from "../ui/Spinner.jsx";

// Historial de una cuenta (backend adminUserHistory.controller.js): datos reales (también de una cuenta eliminada), cómo y
// por qué se eliminó, y su actividad en orden, de lo más reciente a lo más antiguo.

const fmt = (d) => new Date(d).toLocaleString("es-CU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

const DOT = {
  delete: "bg-error",
  warning: "bg-secondary-container",
  account: "bg-tertiary-accent",
};

const ROLE = { CUSTOMER: "Cliente", VENDOR: "Vendedor", VENDOR_STAFF: "Personal de tienda", ADMIN: "Administrador", PARTNER: "Socio" };

export function UserHistoryModal({ userId, onClose }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-user-history", userId],
    queryFn: async () => (await api.get(`/admin/users/${userId}/history`)).data,
  });

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const u = data?.user;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-inverse-surface/50 sm:items-center sm:p-4 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Historial de la cuenta"
        onClick={(e) => e.stopPropagation()}
        className="modal-panel flex w-full max-w-lg flex-col rounded-t-2xl bg-surface-container-lowest shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start gap-3 border-b border-surface-container-high p-4">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-tertiary-accent/10 text-tertiary-accent">
            <History className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-bold text-on-surface">Historial de la cuenta</h2>
            <p className="truncate text-[12.5px] text-outline">{u?.fullName ?? ""}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && (
            <div className="flex items-center gap-2 py-8 text-[13px] text-outline">
              <Spinner className="text-tertiary-accent" /> Cargando el historial...
            </div>
          )}
          {isError && (
            <div className="py-6 text-[13px] text-on-surface">
              No se pudo cargar el historial.
              <button type="button" onClick={() => refetch()} className="ml-2 h-11 rounded-xl border border-outline-variant px-4 font-semibold">
                Reintentar
              </button>
            </div>
          )}
          {u && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                <dt className="text-outline">Correo</dt>
                <dd className="break-all font-semibold text-on-surface">{u.email ?? <span className="font-normal text-outline">No quedó guardado (se eliminó antes de que se guardara)</span>}</dd>
                <dt className="text-outline">Teléfono</dt>
                <dd className="text-on-surface">{u.phone || "Sin teléfono"}</dd>
                <dt className="text-outline">Tipo</dt>
                <dd className="text-on-surface">{ROLE[u.role] ?? u.role}{u.storeName ? ` · ${u.storeName}` : ""}</dd>
                <dt className="text-outline">Alta</dt>
                <dd className="text-on-surface">{fmt(u.createdAt)}</dd>
                <dt className="text-outline">Último acceso</dt>
                <dd className="text-on-surface">{u.lastLoginAt ? fmt(u.lastLoginAt) : "Sin registro"}</dd>
              </dl>

              {u.deletion && (
                <div className="mt-4 rounded-xl border border-error/30 bg-error/5 p-3 text-[13px]">
                  <div className="flex items-center gap-1.5 font-bold text-error">
                    <UserX className="h-4 w-4" /> Cuenta eliminada el {fmt(u.deletedAt)}
                  </div>
                  <p className="mt-1 text-on-surface">{u.deletion.source}{u.deletion.by ? ` (${u.deletion.by})` : ""}.</p>
                  {u.deletionRequestedAt && <p className="text-on-surface-variant">Pidió la eliminación el {fmt(u.deletionRequestedAt)}.</p>}
                  {u.deletion.reason && <p className="text-on-surface-variant">Motivo: {u.deletion.reason}</p>}
                </div>
              )}
              {!u.deletion && u.isSuspended && (
                <div className="mt-4 rounded-xl border border-error/30 bg-error/5 p-3 text-[13px] font-semibold text-error">Cuenta bloqueada</div>
              )}

              <h3 className="mb-2 mt-5 text-[13px] font-bold text-on-surface">Actividad</h3>
              {data.events.length === 0 ? (
                <p className="text-[13px] text-outline">Sin actividad registrada.</p>
              ) : (
                <ol className="space-y-2.5">
                  {data.events.map((e, i) => (
                    <li key={i} className="flex gap-2.5 text-[12.5px]">
                      <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${DOT[e.kind] ?? "bg-outline-variant"}`} />
                      <span className="min-w-0">
                        <span className="text-on-surface">{e.text}</span>
                        <span className="block text-[11.5px] text-outline">{fmt(e.at)}</span>
                        {e.detail && <span className="block text-on-surface-variant">{e.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
